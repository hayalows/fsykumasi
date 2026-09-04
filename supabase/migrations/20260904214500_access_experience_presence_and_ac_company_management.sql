-- Access experience v2: safer Assistant Coordinator company management,
-- admin-visible sign-in activity, and private Realtime Presence authorization.

create or replace function public.get_session_account_activity(p_session_id uuid)
returns table(user_id uuid, last_sign_in_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_manage_access(p_session_id) then
    raise exception 'Website access administration required';
  end if;

  return query
  with session_users as (
    select aa.user_id
    from public.access_assignments aa
    where aa.session_id = p_session_id
    union
    select sal.user_id
    from public.staff_account_links sal
    where sal.session_id = p_session_id
  )
  select su.user_id, au.last_sign_in_at
  from session_users su
  left join auth.users au on au.id = su.user_id;
end;
$$;
revoke all on function public.get_session_account_activity(uuid) from public, anon;
grant execute on function public.get_session_account_activity(uuid) to authenticated;

create or replace function public.suggest_assistant_coordinator_companies(p_staff_id uuid)
returns table(
  company_id uuid,
  company_name text,
  current_staff_id uuid,
  current_staff_name text,
  current_load integer,
  target_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target public.staff%rowtype;
  company_total integer := 0;
  assistant_total integer := 0;
  current_count integer := 0;
  max_load integer := 4;
  desired_count integer := 0;
  needed integer := 0;
begin
  select * into target from public.staff where id = p_staff_id;
  if target.id is null then raise exception 'Staff member not found'; end if;
  if not private.can_manage_access(target.session_id) then raise exception 'Administrative access is required'; end if;
  if target.operational_role <> 'assistant_coordinator' or not target.is_current or target.registration_status <> 'approved' then
    raise exception 'Only current approved Assistant Coordinators can receive company suggestions';
  end if;

  select count(*) into company_total from public.companies c where c.session_id = target.session_id;
  select count(*) into assistant_total
  from public.staff s
  where s.session_id = target.session_id
    and s.operational_role = 'assistant_coordinator'
    and s.is_current
    and s.registration_status = 'approved';
  select count(*) into current_count
  from public.staff_company_assignments sca
  where sca.session_id = target.session_id and sca.staff_id = target.id;
  select coalesce(ss.companies_per_assistant_coordinator, 4) into max_load
  from public.session_structure_settings ss
  where ss.session_id = target.session_id;
  max_load := coalesce(max_load, 4);

  if company_total = 0 or assistant_total = 0 then return; end if;
  desired_count := least(max_load, ceil(company_total::numeric / assistant_total)::integer);
  needed := greatest(0, desired_count - current_count);
  if needed = 0 then return; end if;

  return query
  with owners as (
    select
      c.id,
      coalesce(nullif(c.custom_name, ''), c.name) as display_name,
      c.operational_number,
      sca.staff_id as owner_id,
      s.full_name as owner_name,
      coalesce(loads.company_load, 0)::integer as owner_load,
      row_number() over (
        partition by sca.staff_id
        order by c.operational_number nulls last, c.name, c.id
      ) as donor_rank
    from public.companies c
    left join public.staff_company_assignments sca
      on sca.session_id = c.session_id and sca.company_id = c.id
    left join public.staff s on s.id = sca.staff_id
    left join lateral (
      select count(*) as company_load
      from public.staff_company_assignments own
      where own.session_id = target.session_id and own.staff_id = sca.staff_id
    ) loads on true
    where c.session_id = target.session_id
      and coalesce(sca.staff_id, '00000000-0000-0000-0000-000000000000'::uuid) <> target.id
  ), candidates as (
    select *
    from owners
    where owner_id is null or owner_load > 1
    order by
      case when owner_id is null then 0 else 1 end,
      donor_rank,
      owner_load desc,
      operational_number nulls last,
      display_name,
      id
    limit needed
  )
  select
    c.id,
    c.display_name,
    c.owner_id,
    c.owner_name,
    c.owner_load,
    desired_count
  from candidates c
  order by
    case when c.owner_id is null then 0 else 1 end,
    c.donor_rank,
    c.owner_load desc,
    c.operational_number nulls last,
    c.display_name;
end;
$$;
revoke all on function public.suggest_assistant_coordinator_companies(uuid) from public, anon;
grant execute on function public.suggest_assistant_coordinator_companies(uuid) to authenticated;

create or replace function public.set_assistant_coordinator_companies(p_staff_id uuid, p_company_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.staff%rowtype;
  desired uuid[] := '{}'::uuid[];
  previous uuid[] := '{}'::uuid[];
  donor_ids uuid[] := '{}'::uuid[];
  max_load integer := 4;
  donor_without_scope text;
  target_has_active_access boolean := false;
begin
  select * into target from public.staff where id = p_staff_id for update;
  if target.id is null then raise exception 'Staff member not found'; end if;
  if not private.can_manage_access(target.session_id) then raise exception 'Administrative access is required'; end if;
  if target.operational_role <> 'assistant_coordinator' or not target.is_current or target.registration_status <> 'approved' then
    raise exception 'Only current approved Assistant Coordinators can be assigned to companies';
  end if;

  select coalesce(array_agg(distinct company_id order by company_id), '{}'::uuid[])
    into desired
  from unnest(coalesce(p_company_ids, '{}'::uuid[])) company_id;

  if exists (
    select 1
    from unnest(desired) requested(company_id)
    left join public.companies c on c.id = requested.company_id
    where c.id is null or c.session_id <> target.session_id
  ) then
    raise exception 'Every selected company must belong to this FSY session';
  end if;

  select coalesce(ss.companies_per_assistant_coordinator, 4) into max_load
  from public.session_structure_settings ss
  where ss.session_id = target.session_id;
  max_load := coalesce(max_load, 4);
  if cardinality(desired) > max_load then
    raise exception 'An Assistant Coordinator can supervise at most % companies', max_load;
  end if;

  select exists(
    select 1
    from public.staff_account_links sal
    where sal.session_id = target.session_id
      and sal.staff_id = target.id
      and sal.access_enabled
  ) into target_has_active_access;
  if target_has_active_access and cardinality(desired) = 0 then
    raise exception 'An Assistant Coordinator with active website access must keep at least one company';
  end if;

  select coalesce(array_agg(sca.company_id order by sca.assigned_at, sca.company_id), '{}'::uuid[])
    into previous
  from public.staff_company_assignments sca
  where sca.session_id = target.session_id and sca.staff_id = target.id;

  select coalesce(array_agg(distinct sca.staff_id), '{}'::uuid[])
    into donor_ids
  from public.staff_company_assignments sca
  where sca.session_id = target.session_id
    and sca.company_id = any(desired)
    and sca.staff_id <> target.id;

  select s.full_name into donor_without_scope
  from unnest(donor_ids) donor(staff_id)
  join public.staff s on s.id = donor.staff_id
  join public.staff_account_links sal
    on sal.session_id = target.session_id
    and sal.staff_id = donor.staff_id
    and sal.access_enabled
  where not exists (
    select 1
    from public.staff_company_assignments remaining
    where remaining.session_id = target.session_id
      and remaining.staff_id = donor.staff_id
      and not (remaining.company_id = any(desired))
  )
  limit 1;

  if donor_without_scope is not null then
    raise exception 'That move would leave % with active website access but no company. Move only some of their companies or assign them another company first.', donor_without_scope;
  end if;

  delete from public.staff_company_assignments sca
  where sca.session_id = target.session_id
    and sca.staff_id = target.id
    and not (sca.company_id = any(desired));

  delete from public.staff_company_assignments sca
  where sca.session_id = target.session_id
    and sca.company_id = any(desired)
    and sca.staff_id <> target.id;

  insert into public.staff_company_assignments(session_id, staff_id, company_id, assigned_by)
  select target.session_id, target.id, requested.company_id, (select auth.uid())
  from unnest(desired) requested(company_id)
  on conflict(staff_id, company_id) do nothing;

  update public.staff s
  set assigned_company_id = (
    select sca.company_id
    from public.staff_company_assignments sca
    where sca.staff_id = s.id
    order by sca.assigned_at, sca.company_id
    limit 1
  )
  where s.id = target.id or s.id = any(donor_ids);

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(
    target.session_id,
    (select auth.uid()),
    'assistant_coordinator_companies_set',
    'staff',
    target.id::text,
    jsonb_build_object(
      'previous_company_ids', previous,
      'company_ids', desired,
      'transferred_from_staff_ids', donor_ids,
      'website_scope_synced', exists(
        select 1 from public.staff_account_links sal
        where sal.session_id = target.session_id and sal.staff_id = target.id
      )
    )
  );

  return jsonb_build_object('staff_id', target.id, 'company_ids', desired, 'company_limit', max_load);
end;
$$;
revoke all on function public.set_assistant_coordinator_companies(uuid, uuid[]) from public, anon;
grant execute on function public.set_assistant_coordinator_companies(uuid, uuid[]) to authenticated;

-- Private Presence keeps online indicators scoped to authenticated members of the
-- same FSY session. The topic shape is fsy-session:<session-uuid>:presence.
drop policy if exists "fsy session members can read presence" on realtime.messages;
create policy "fsy session members can read presence"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'presence'
  and private.has_session_access(
    case
      when (select realtime.topic()) ~ '^fsy-session:[0-9a-fA-F-]{36}:presence$'
      then split_part((select realtime.topic()), ':', 2)::uuid
      else null::uuid
    end
  )
);

drop policy if exists "fsy session members can track presence" on realtime.messages;
create policy "fsy session members can track presence"
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'presence'
  and private.has_session_access(
    case
      when (select realtime.topic()) ~ '^fsy-session:[0-9a-fA-F-]{36}:presence$'
      then split_part((select realtime.topic()), ':', 2)::uuid
      else null::uuid
    end
  )
);
