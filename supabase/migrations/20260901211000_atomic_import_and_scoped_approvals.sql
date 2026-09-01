-- Close production-safety gaps before connecting real FSY data.
-- 1) Participant imports run inside one database transaction.
-- 2) Scoped roles cannot be approved without a real structured scope.
-- 3) Assistant coordinators cannot browse unrelated companies or staff.

create or replace function private.ensure_session_access_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.session_access_codes(session_id, access_code)
  values (
    new.id,
    upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10))
  )
  on conflict (session_id) do nothing;
  return new;
end;
$$;

revoke all on function private.ensure_session_access_code() from public;

drop trigger if exists session_private_access_code_trigger on public.sessions;
create trigger session_private_access_code_trigger
  after insert on public.sessions
  for each row execute function private.ensure_session_access_code();

insert into private.session_access_codes(session_id, access_code)
select
  s.id,
  upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10))
from public.sessions s
left join private.session_access_codes sac on sac.session_id = s.id
where sac.session_id is null
on conflict (session_id) do nothing;

create or replace function public.rotate_session_access_code(p_session_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_code text;
begin
  if not private.has_session_role(
    p_session_id,
    array['logistics_admin','session_director']::public.app_role[]
  ) then
    raise exception 'Only access approvers can rotate the session code';
  end if;

  next_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));

  insert into private.session_access_codes(session_id, access_code, rotated_at)
  values (p_session_id, next_code, now())
  on conflict (session_id) do update
    set access_code = excluded.access_code,
        rotated_at = excluded.rotated_at;

  return next_code;
end;
$$;

revoke all on function public.rotate_session_access_code(uuid) from public;
grant execute on function public.rotate_session_access_code(uuid) to authenticated;

-- Scoped roles should see only their assigned operational area.
drop policy if exists "members read companies" on public.companies;
create policy "scoped company visibility" on public.companies for select to authenticated
  using (
    private.has_session_wide_visibility(session_id)
    or private.can_access_company(session_id, id)
  );

drop policy if exists "members read staff" on public.staff;
create policy "scoped staff visibility" on public.staff for select to authenticated
  using (
    private.has_session_wide_visibility(session_id)
    or (
      assigned_company_id is not null
      and private.can_access_company(session_id, assigned_company_id)
    )
  );

-- Reviews must go through this RPC so scoped roles receive actual structured access.
revoke update on public.access_requests from authenticated;

create or replace function public.review_access_request(
  p_request_id uuid,
  p_decision public.access_request_status,
  p_company_ids uuid[] default '{}',
  p_committee_scope text[] default '{}',
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.access_requests%rowtype;
  expected_company_count integer;
  valid_company_count integer;
begin
  select * into target
  from public.access_requests
  where id = p_request_id
  for update;

  if target.id is null then
    raise exception 'Access request not found';
  end if;

  if not private.has_session_role(
    target.session_id,
    array['logistics_admin','session_director']::public.app_role[]
  ) then
    raise exception 'Only logistical administrators or session directors can review access';
  end if;

  if target.status <> 'pending' then
    raise exception 'This access request has already been reviewed';
  end if;

  if p_decision not in ('approved','rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  if p_decision = 'approved' and target.requested_role = 'assistant_coordinator' then
    expected_company_count := cardinality(coalesce(p_company_ids, '{}'::uuid[]));
    if expected_company_count = 0 then
      raise exception 'Assistant coordinators must be assigned at least one company';
    end if;

    select count(*) into valid_company_count
    from public.companies c
    where c.session_id = target.session_id
      and c.id = any(coalesce(p_company_ids, '{}'::uuid[]));

    if valid_company_count <> expected_company_count then
      raise exception 'One or more selected companies do not belong to this session';
    end if;
  end if;

  if p_decision = 'approved' and target.requested_role = 'committee_viewer' then
    if cardinality(coalesce(p_committee_scope, '{}'::text[])) = 0 then
      raise exception 'Committee viewers must be assigned at least one committee scope';
    end if;
  end if;

  update public.access_requests
  set
    company_ids = case
      when target.requested_role = 'assistant_coordinator' and p_decision = 'approved'
        then coalesce(p_company_ids, '{}'::uuid[])
      else '{}'::uuid[]
    end,
    committee_scope = case
      when target.requested_role = 'committee_viewer' and p_decision = 'approved'
        then array(
          select distinct trim(x.scope)
          from unnest(coalesce(p_committee_scope, '{}'::text[])) as x(scope)
          where trim(x.scope) <> ''
        )
      else '{}'::text[]
    end,
    decision_note = nullif(trim(coalesce(p_note, '')), ''),
    status = p_decision
  where id = p_request_id;
end;
$$;

revoke all on function public.review_access_request(uuid, public.access_request_status, uuid[], text[], text) from public;
grant execute on function public.review_access_request(uuid, public.access_request_status, uuid[], text[], text) to authenticated;

-- A whole participant import is one RPC call and therefore one transaction.
-- Any invalid row aborts the entire import instead of leaving partial data behind.
create or replace function public.apply_participant_import(
  p_session_id uuid,
  p_source_filename text,
  p_participants jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_id uuid;
  row_count integer;
  duplicate_count integer;
begin
  if not private.has_session_role(
    p_session_id,
    array['logistics_admin','session_director']::public.app_role[]
  ) then
    raise exception 'Only logistical administrators or session directors can import participants';
  end if;

  if jsonb_typeof(p_participants) <> 'array' then
    raise exception 'Participant payload must be an array';
  end if;

  row_count := jsonb_array_length(p_participants);
  if row_count < 1 or row_count > 5000 then
    raise exception 'Participant import must contain between 1 and 5000 rows';
  end if;

  with parsed as (
    select *
    from jsonb_to_recordset(p_participants) as x(
      registration_id text,
      first_name text,
      last_name text,
      sex text,
      age integer,
      unit_name text
    )
  )
  select count(*) - count(distinct registration_id)
  into duplicate_count
  from parsed;

  if duplicate_count > 0 then
    raise exception 'Duplicate registration IDs exist inside this import';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_participants) as x(
      registration_id text,
      first_name text,
      last_name text,
      sex text,
      age integer,
      unit_name text
    )
    where nullif(trim(registration_id), '') is null
       or nullif(trim(first_name), '') is null
       or nullif(trim(last_name), '') is null
       or sex is null
       or lower(trim(sex)) not in ('female','male')
       or age is null
       or age not between 14 and 18
       or nullif(trim(unit_name), '') is null
  ) then
    raise exception 'One or more participant rows failed database validation';
  end if;

  insert into public.import_batches(
    session_id,
    imported_by,
    source_filename,
    record_count,
    error_count,
    status
  ) values (
    p_session_id,
    (select auth.uid()),
    coalesce(nullif(trim(p_source_filename), ''), 'participant-import'),
    row_count,
    0,
    'validated'
  )
  returning id into batch_id;

  insert into public.participants(
    session_id,
    import_batch_id,
    registration_id,
    first_name,
    last_name,
    sex,
    age,
    unit_name
  )
  select
    p_session_id,
    batch_id,
    trim(x.registration_id),
    trim(x.first_name),
    trim(x.last_name),
    lower(trim(x.sex))::public.participant_sex,
    x.age,
    trim(x.unit_name)
  from jsonb_to_recordset(p_participants) as x(
    registration_id text,
    first_name text,
    last_name text,
    sex text,
    age integer,
    unit_name text
  )
  on conflict (session_id, registration_id) do update set
    import_batch_id = excluded.import_batch_id,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    sex = excluded.sex,
    age = excluded.age,
    unit_name = excluded.unit_name,
    updated_at = now();

  update public.import_batches
  set status = 'applied'
  where id = batch_id;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_session_id,
    (select auth.uid()),
    'participant_import_applied',
    'import_batch',
    batch_id::text,
    jsonb_build_object('record_count', row_count, 'source_filename', p_source_filename)
  );

  return batch_id;
end;
$$;

revoke all on function public.apply_participant_import(uuid, text, jsonb) from public;
grant execute on function public.apply_participant_import(uuid, text, jsonb) to authenticated;
