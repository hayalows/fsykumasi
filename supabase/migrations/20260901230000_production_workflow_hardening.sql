-- Complete the first-run and live operations paths without trusting actor IDs
-- or partial multi-request writes from the browser.

create or replace function public.bootstrap_session_admin(
  p_access_code text,
  p_role public.app_role
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session uuid;
  next_code text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if p_role not in ('logistics_admin', 'session_director') then
    raise exception 'Initial access must be a logistics administrator or session director';
  end if;

  select s.id into target_session
  from public.sessions s
  join private.session_access_codes sac on sac.session_id = s.id
  where upper(sac.access_code) = upper(trim(p_access_code))
    and s.status in ('planning', 'active')
  for update of sac
  limit 1;

  if target_session is null then
    raise exception 'Unable to initialize leadership access';
  end if;

  if exists (
    select 1 from public.access_assignments aa
    where aa.session_id = target_session and aa.active
  ) then
    raise exception 'Leadership access has already been initialized';
  end if;

  insert into public.access_assignments(session_id, user_id, role, active)
  values (target_session, (select auth.uid()), p_role, true);

  next_code := upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 10));
  update private.session_access_codes
  set access_code = next_code, rotated_at = now()
  where session_id = target_session;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id)
  values (target_session, (select auth.uid()), 'session_admin_bootstrapped', 'session', target_session::text);

  return target_session;
end;
$$;

revoke all on function public.bootstrap_session_admin(text, public.app_role) from public, anon;
grant execute on function public.bootstrap_session_admin(text, public.app_role) to authenticated;

-- All check-in writes go through one narrow RPC. The actor and timestamp are
-- database-derived so an authorized client cannot forge the audit trail.
revoke insert, update, delete on public.check_ins from authenticated;
drop policy if exists "operations record checkins" on public.check_ins;

create or replace function public.record_participant_checkin(
  p_session_id uuid,
  p_participant_id uuid,
  p_status public.check_in_status,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_session_role(
    p_session_id,
    array['coordinator','logistics_admin','session_director']::public.app_role[]
  ) then
    raise exception 'Your role cannot record check-in';
  end if;

  if not exists (
    select 1 from public.participants p
    where p.id = p_participant_id and p.session_id = p_session_id
  ) then
    raise exception 'Participant does not belong to this session';
  end if;

  insert into public.check_ins(session_id, participant_id, status, note, recorded_by, recorded_at)
  values (
    p_session_id,
    p_participant_id,
    p_status,
    nullif(trim(coalesce(p_note, '')), ''),
    (select auth.uid()),
    now()
  )
  on conflict (session_id, participant_id) do update set
    status = excluded.status,
    note = excluded.note,
    recorded_by = excluded.recorded_by,
    recorded_at = excluded.recorded_at;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_session_id,
    (select auth.uid()),
    'participant_checkin_recorded',
    'participant',
    p_participant_id::text,
    jsonb_build_object('status', p_status)
  );
end;
$$;

revoke all on function public.record_participant_checkin(uuid, uuid, public.check_in_status, text) from public, anon;
grant execute on function public.record_participant_checkin(uuid, uuid, public.check_in_status, text) to authenticated;

-- Group publishing is one transaction: either the complete reviewed plan is
-- accepted or no company, group, or participant assignment is changed.
create or replace function public.publish_grouping_plan(
  p_session_id uuid,
  p_plan jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  company_item jsonb;
  group_item jsonb;
  new_company_id uuid;
  new_group_id uuid;
  participant_total integer;
  supplied_total integer;
  distinct_total integer;
  company_count integer;
  group_count integer := 0;
  company_index integer := 0;
  colors text[] := array['#005175','#007DA5','#8DBF67','#FCB449'];
begin
  if not private.has_session_role(
    p_session_id,
    array['coordinator','logistics_admin','session_director']::public.app_role[]
  ) then
    raise exception 'Your role cannot publish groups';
  end if;

  if jsonb_typeof(p_plan) <> 'array' then
    raise exception 'Grouping plan must be an array';
  end if;

  company_count := jsonb_array_length(p_plan);
  if company_count < 1 or company_count > 500 then
    raise exception 'Grouping plan must contain between 1 and 500 companies';
  end if;

  if exists (select 1 from public.counselor_groups g where g.session_id = p_session_id)
     or exists (select 1 from public.companies c where c.session_id = p_session_id) then
    raise exception 'A grouping plan is already published for this session';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_plan) c(item)
    where jsonb_typeof(c.item -> 'groups') <> 'array'
       or jsonb_array_length(c.item -> 'groups') < 1
       or jsonb_array_length(c.item -> 'groups') > 3
       or nullif(trim(c.item ->> 'name'), '') is null
  ) then
    raise exception 'Each company needs a name and one to three groups';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_plan) c(item)
    cross join lateral jsonb_array_elements(c.item -> 'groups') g(item)
    where nullif(trim(g.item ->> 'name'), '') is null
       or lower(g.item ->> 'sex') not in ('female','male')
       or jsonb_typeof(g.item -> 'participant_ids') <> 'array'
       or jsonb_array_length(g.item -> 'participant_ids') not between 8 and 10
  ) then
    raise exception 'Every counselor group needs a name, a sex, and 8 to 10 participants';
  end if;

  select count(*) into participant_total
  from public.participants p where p.session_id = p_session_id;

  with supplied as (
    select (jsonb_array_elements_text(g.item -> 'participant_ids'))::uuid as participant_id
    from jsonb_array_elements(p_plan) c(item)
    cross join lateral jsonb_array_elements(c.item -> 'groups') g(item)
  )
  select count(*), count(distinct participant_id)
  into supplied_total, distinct_total
  from supplied;

  if participant_total = 0 or supplied_total <> participant_total or distinct_total <> participant_total then
    raise exception 'Every session participant must be assigned exactly once';
  end if;

  if exists (
    with supplied as (
      select (jsonb_array_elements_text(g.item -> 'participant_ids'))::uuid as participant_id
      from jsonb_array_elements(p_plan) c(item)
      cross join lateral jsonb_array_elements(c.item -> 'groups') g(item)
    )
    select 1 from supplied s
    left join public.participants p on p.id = s.participant_id and p.session_id = p_session_id
    where p.id is null
  ) then
    raise exception 'Grouping plan contains a participant from another session';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_plan) with ordinality c(item, company_no)
    cross join lateral jsonb_array_elements(c.item -> 'groups') with ordinality g(item, group_no)
    cross join lateral jsonb_array_elements_text(g.item -> 'participant_ids') member(value)
    join public.participants p on p.id = member.value::uuid
    group by c.company_no, g.group_no, p.unit_name
    having count(*) > 1
  ) then
    raise exception 'A counselor group contains youth from the same unit';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_plan) c(item)
    cross join lateral jsonb_array_elements(c.item -> 'groups') g(item)
    cross join lateral jsonb_array_elements_text(g.item -> 'participant_ids') member(value)
    join public.participants p on p.id = member.value::uuid
    where p.sex::text <> lower(g.item ->> 'sex')
  ) then
    raise exception 'A counselor group mixes participant sexes';
  end if;

  for company_item in select value from jsonb_array_elements(p_plan)
  loop
    company_index := company_index + 1;
    new_company_id := extensions.gen_random_uuid();
    insert into public.companies(id, session_id, name, color)
    values (
      new_company_id,
      p_session_id,
      trim(company_item ->> 'name'),
      colors[1 + ((company_index - 1) % cardinality(colors))]
    );

    for group_item in select value from jsonb_array_elements(company_item -> 'groups')
    loop
      group_count := group_count + 1;
      new_group_id := extensions.gen_random_uuid();
      insert into public.counselor_groups(id, session_id, company_id, name, sex, state)
      values (
        new_group_id,
        p_session_id,
        new_company_id,
        trim(group_item ->> 'name'),
        lower(group_item ->> 'sex')::public.participant_sex,
        'published'
      );

      update public.participants p
      set group_id = new_group_id, updated_at = now()
      where p.session_id = p_session_id
        and p.id in (
          select value::uuid from jsonb_array_elements_text(group_item -> 'participant_ids')
        );
    end loop;
  end loop;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_session_id,
    (select auth.uid()),
    'grouping_plan_published',
    'session',
    p_session_id::text,
    jsonb_build_object('company_count', company_count, 'group_count', group_count, 'participant_count', participant_total)
  );

  return jsonb_build_object(
    'company_count', company_count,
    'group_count', group_count,
    'participant_count', participant_total
  );
end;
$$;

revoke all on function public.publish_grouping_plan(uuid, jsonb) from public, anon;
grant execute on function public.publish_grouping_plan(uuid, jsonb) to authenticated;

-- Head-count writes are also database-attributed and scoped by company.
revoke insert, update, delete on public.headcount_rounds, public.headcount_submissions from authenticated;
drop policy if exists "leaders manage rounds" on public.headcount_rounds;
drop policy if exists "leaders manage scoped submissions" on public.headcount_submissions;

create or replace function public.open_headcount_round(
  p_session_id uuid,
  p_label text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_round uuid;
begin
  if not private.has_session_role(
    p_session_id,
    array['coordinator','logistics_admin','session_director']::public.app_role[]
  ) then
    raise exception 'Your role cannot open a head-count round';
  end if;

  if nullif(trim(p_label), '') is null or length(trim(p_label)) > 80 then
    raise exception 'Add a short label for this head-count round';
  end if;

  if not exists (select 1 from public.companies c where c.session_id = p_session_id) then
    raise exception 'Publish companies before opening head count';
  end if;

  update public.headcount_rounds
  set closes_at = now()
  where session_id = p_session_id and closes_at is null;

  insert into public.headcount_rounds(session_id, label, created_by)
  values (p_session_id, trim(p_label), (select auth.uid()))
  returning id into next_round;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_session_id, (select auth.uid()), 'headcount_round_opened', 'headcount_round', next_round::text, jsonb_build_object('label', trim(p_label)));

  return next_round;
end;
$$;

revoke all on function public.open_headcount_round(uuid, text) from public, anon;
grant execute on function public.open_headcount_round(uuid, text) to authenticated;

create or replace function public.submit_company_headcount(
  p_round_id uuid,
  p_company_id uuid,
  p_accounted_count integer,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session uuid;
  expected integer;
begin
  select r.session_id into target_session
  from public.headcount_rounds r
  where r.id = p_round_id and r.closes_at is null;

  if target_session is null then
    raise exception 'This head-count round is closed or unavailable';
  end if;

  if not private.can_access_company(target_session, p_company_id) then
    raise exception 'You cannot submit for this company';
  end if;

  if not exists (
    select 1 from public.companies c
    where c.id = p_company_id and c.session_id = target_session
  ) then
    raise exception 'Company does not belong to this session';
  end if;

  select count(*) into expected
  from public.participants p
  join public.counselor_groups g on g.id = p.group_id
  where g.company_id = p_company_id and p.session_id = target_session;

  if p_accounted_count is null or p_accounted_count < 0 or p_accounted_count > expected then
    raise exception 'Accounted count must be between 0 and the expected company total';
  end if;

  insert into public.headcount_submissions(
    round_id, company_id, expected_count, accounted_count, status, note, submitted_by, submitted_at
  ) values (
    p_round_id,
    p_company_id,
    expected,
    p_accounted_count,
    case when p_accounted_count = expected then 'submitted'::public.submission_status else 'exception'::public.submission_status end,
    nullif(trim(coalesce(p_note, '')), ''),
    (select auth.uid()),
    now()
  )
  on conflict (round_id, company_id) do update set
    expected_count = excluded.expected_count,
    accounted_count = excluded.accounted_count,
    status = excluded.status,
    note = excluded.note,
    submitted_by = excluded.submitted_by,
    submitted_at = excluded.submitted_at;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_session,
    (select auth.uid()),
    'company_headcount_submitted',
    'company',
    p_company_id::text,
    jsonb_build_object('round_id', p_round_id, 'expected', expected, 'accounted', p_accounted_count)
  );
end;
$$;

revoke all on function public.submit_company_headcount(uuid, uuid, integer, text) from public, anon;
grant execute on function public.submit_company_headcount(uuid, uuid, integer, text) to authenticated;

create index if not exists participants_session_last_name_id_idx
  on public.participants(session_id, last_name, id);

do $$ begin
  alter publication supabase_realtime add table public.headcount_rounds;
exception when duplicate_object then null;
end $$;
