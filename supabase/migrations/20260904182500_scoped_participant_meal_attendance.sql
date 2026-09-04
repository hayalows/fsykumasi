-- Participant-first meal attendance with assistant-coordinator company scope.
-- This migration does not seed meal attendance or change participant assignments.

alter table public.operational_teams drop constraint if exists operational_teams_capabilities_check;
alter table public.operational_teams add constraint operational_teams_capabilities_check check (
  capabilities <@ array[
    'people_lookup','groups_view','checkin_record','headcount_view','headcount_record',
    'housing_view','housing_manage','housing_export',
    'wellness_status','wellness_private','wellness_manage','wellness_export',
    'food_view','food_manage','food_export','meal_attendance_view','meal_attendance_record',
    'registration_view','registration_manage','identity_manage','arrival_manage',
    'staff_view','staff_manage','inclusion_view','facilities_view','materials_view',
    'financial_view','publicity_view','reports_export','access_admin'
  ]::text[]
);

create or replace function private.effective_capabilities(target_session uuid, target_user uuid default null::uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
with subject as (select coalesce(target_user,(select auth.uid())) user_id), base as (
  select unnest(case
    when aa.role in ('session_director','logistics_admin') then array[
      'people_lookup','groups_view','checkin_record','headcount_view','headcount_record',
      'registration_view','registration_manage','identity_manage','arrival_manage',
      'staff_view','staff_manage','housing_view','housing_manage','housing_export',
      'food_view','food_manage','food_export','meal_attendance_view','meal_attendance_record',
      'wellness_status','wellness_private','wellness_manage','wellness_export',
      'inclusion_view','facilities_view','materials_view','financial_view','publicity_view',
      'reports_export','access_admin'
    ]::text[]
    when aa.role='coordinator' then array[
      'people_lookup','groups_view','checkin_record','headcount_view','headcount_record',
      'registration_view','registration_manage','identity_manage','arrival_manage',
      'staff_view','staff_manage','housing_view','housing_manage','housing_export',
      'food_view','food_manage','food_export','meal_attendance_view','meal_attendance_record',
      'wellness_status','wellness_private','wellness_manage','wellness_export',
      'inclusion_view','facilities_view','materials_view','financial_view','publicity_view',
      'reports_export'
    ]::text[]
    when aa.role='assistant_coordinator' then array[
      'people_lookup','groups_view','checkin_record','headcount_view','headcount_record',
      'meal_attendance_view','meal_attendance_record'
    ]::text[]
    else '{}'::text[] end) capability
  from public.access_assignments aa,subject s
  where aa.session_id=target_session and aa.user_id=s.user_id and aa.active
), explicit_caps as (
  select unnest(aa.capabilities) capability
  from public.access_assignments aa,subject s
  where aa.session_id=target_session and aa.user_id=s.user_id and aa.active
), team_caps as (
  select unnest(ot.capabilities) capability
  from public.team_memberships tm
  join public.operational_teams ot on ot.id=tm.team_id
  join subject s on s.user_id=tm.user_id
  where tm.session_id=target_session and tm.active and ot.active
)
select coalesce(array_agg(distinct capability order by capability),'{}'::text[])
from (select capability from base union all select capability from explicit_caps union all select capability from team_caps) caps
where capability is not null;
$$;
revoke all on function private.effective_capabilities(uuid, uuid) from public;
grant execute on function private.effective_capabilities(uuid, uuid) to authenticated;

create or replace function public.get_meal_services(p_session_id uuid, p_service_date date default null::date)
returns table(
  service_id uuid,
  service_date date,
  meal_type text,
  label text,
  status text,
  opened_at timestamptz,
  closed_at timestamptz,
  served_count integer,
  expected_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    private.has_capability(p_session_id, 'food_view')
    or private.has_capability(p_session_id, 'meal_attendance_view')
  ) then raise exception 'Meal attendance access required'; end if;

  return query
  select
    m.id,
    m.service_date,
    m.meal_type,
    coalesce(nullif(m.label, ''), initcap(m.meal_type)),
    m.status,
    m.opened_at,
    m.closed_at,
    (
      select count(*)::integer
      from public.meal_attendance a
      join public.participants p on p.id = a.participant_id and p.session_id = p_session_id
      left join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id
      left join public.companies c on c.id = g.company_id and c.session_id = p.session_id
      where a.meal_service_id = m.id
        and a.participant_id is not null
        and private.operational_participant_is_eligible(p_session_id, p.id)
        and (
          private.has_capability(p_session_id, 'food_view')
          or (c.id is not null and private.can_access_company(p_session_id, c.id))
        )
    ),
    (
      select count(*)::integer
      from public.participants p
      left join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id
      left join public.companies c on c.id = g.company_id and c.session_id = p.session_id
      where p.session_id = p_session_id
        and private.operational_participant_is_eligible(p_session_id, p.id)
        and (
          not exists(select 1 from public.participant_badge_assignments b where b.session_id = p_session_id and b.participant_id = p.id)
          or exists(select 1 from public.participant_badge_assignments b where b.session_id = p_session_id and b.participant_id = p.id and b.state <> 'retired')
        )
        and (
          private.has_capability(p_session_id, 'food_view')
          or (c.id is not null and private.can_access_company(p_session_id, c.id))
        )
    )
  from public.meal_services m
  where m.session_id = p_session_id
    and (p_service_date is null or m.service_date = p_service_date)
  order by
    case m.status when 'open' then 1 when 'planned' then 2 else 3 end,
    case when m.status = 'open' then m.opened_at end desc nulls last,
    m.service_date,
    case m.meal_type when 'breakfast' then 1 when 'lunch' then 2 when 'dinner' then 3 when 'snack' then 4 else 5 end,
    m.id;
end;
$$;
revoke all on function public.get_meal_services(uuid, date) from public, anon;
grant execute on function public.get_meal_services(uuid, date) to authenticated;

create or replace function public.get_meal_roster(p_session_id uuid)
returns table(person_type text, person_id uuid, display_name text, fsy_id text, company_name text, group_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    private.has_capability(p_session_id, 'food_view')
    or private.has_capability(p_session_id, 'meal_attendance_view')
  ) then raise exception 'Meal attendance access required'; end if;

  return query
  select
    'participant'::text,
    p.id,
    trim(concat_ws(' ', p.first_name, p.last_name)),
    b.fsy_id,
    coalesce(nullif(c.custom_name, ''), c.name),
    coalesce(nullif(g.custom_name, ''), g.name)
  from public.participants p
  left join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id
  left join public.companies c on c.id = g.company_id and c.session_id = p.session_id
  left join lateral (
    select badge.fsy_id
    from public.participant_badge_assignments badge
    where badge.session_id = p_session_id and badge.participant_id = p.id and badge.state <> 'retired'
    order by badge.assigned_at desc
    limit 1
  ) b on true
  where p.session_id = p_session_id
    and private.operational_participant_is_eligible(p_session_id, p.id)
    and (
      not exists(select 1 from public.participant_badge_assignments badge where badge.session_id = p_session_id and badge.participant_id = p.id)
      or exists(select 1 from public.participant_badge_assignments badge where badge.session_id = p_session_id and badge.participant_id = p.id and badge.state <> 'retired')
    )
    and (
      private.has_capability(p_session_id, 'food_view')
      or (c.id is not null and private.can_access_company(p_session_id, c.id))
    )
  order by 3;
end;
$$;
revoke all on function public.get_meal_roster(uuid) from public, anon;
grant execute on function public.get_meal_roster(uuid) to authenticated;

create or replace function public.get_meal_attendance(p_meal_service_id uuid)
returns table(attendance_id uuid, person_type text, person_id uuid, display_name text, fsy_id text, company_name text, group_name text, served_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare target_session uuid;
begin
  select m.session_id into target_session from public.meal_services m where m.id = p_meal_service_id;
  if target_session is null then raise exception 'Meal service not found'; end if;
  if not (
    private.has_capability(target_session, 'food_view')
    or private.has_capability(target_session, 'meal_attendance_view')
  ) then raise exception 'Meal attendance access required'; end if;

  return query
  select
    a.id,
    'participant'::text,
    p.id,
    trim(concat_ws(' ', p.first_name, p.last_name)),
    b.fsy_id,
    coalesce(nullif(c.custom_name, ''), c.name),
    coalesce(nullif(g.custom_name, ''), g.name),
    a.served_at
  from public.meal_attendance a
  join public.participants p on p.id = a.participant_id
  left join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id
  left join public.companies c on c.id = g.company_id and c.session_id = p.session_id
  left join lateral (
    select badge.fsy_id
    from public.participant_badge_assignments badge
    where badge.session_id = target_session and badge.participant_id = p.id and badge.state <> 'retired'
    order by badge.assigned_at desc
    limit 1
  ) b on true
  where a.meal_service_id = p_meal_service_id
    and a.participant_id is not null
    and (
      private.has_capability(target_session, 'food_view')
      or (c.id is not null and private.can_access_company(target_session, c.id))
    )
  order by 8 desc;
end;
$$;
revoke all on function public.get_meal_attendance(uuid) from public, anon;
grant execute on function public.get_meal_attendance(uuid) to authenticated;

create or replace function public.get_meal_progress(p_meal_service_id uuid)
returns table(company_id uuid, company_name text, expected_count integer, served_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare target_session uuid;
begin
  select m.session_id into target_session from public.meal_services m where m.id = p_meal_service_id;
  if target_session is null then raise exception 'Meal service not found'; end if;
  if not (
    private.has_capability(target_session, 'food_view')
    or private.has_capability(target_session, 'meal_attendance_view')
  ) then raise exception 'Meal attendance access required'; end if;

  return query
  select
    c.id,
    coalesce(nullif(c.custom_name, ''), c.name, 'Unassigned')::text,
    count(*)::integer,
    count(a.id)::integer
  from public.participants p
  left join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id
  left join public.companies c on c.id = g.company_id and c.session_id = p.session_id
  left join public.meal_attendance a on a.meal_service_id = p_meal_service_id and a.participant_id = p.id
  where p.session_id = target_session
    and private.operational_participant_is_eligible(target_session, p.id)
    and (
      not exists(select 1 from public.participant_badge_assignments badge where badge.session_id = target_session and badge.participant_id = p.id)
      or exists(select 1 from public.participant_badge_assignments badge where badge.session_id = target_session and badge.participant_id = p.id and badge.state <> 'retired')
    )
    and (
      private.has_capability(target_session, 'food_view')
      or (c.id is not null and private.can_access_company(target_session, c.id))
    )
  group by c.id, c.custom_name, c.name, c.operational_number
  order by c.operational_number nulls last, coalesce(nullif(c.custom_name, ''), c.name, 'Unassigned');
end;
$$;
revoke all on function public.get_meal_progress(uuid) from public, anon;
grant execute on function public.get_meal_progress(uuid) to authenticated;

create or replace function public.set_participant_meal_served(
  p_meal_service_id uuid,
  p_participant_id uuid,
  p_served boolean
)
returns table(attendance_id uuid, served_at timestamptz, served boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.meal_services%rowtype;
  participant_company uuid;
  existing_id uuid;
  existing_at timestamptz;
  allowed boolean := false;
begin
  select * into target from public.meal_services where id = p_meal_service_id for update;
  if target.id is null then raise exception 'Meal service not found'; end if;
  if target.status <> 'open' then raise exception 'This meal service is not open'; end if;
  if p_participant_id is null then raise exception 'Choose a participant'; end if;

  if not exists(
    select 1 from public.participants p
    where p.id = p_participant_id
      and p.session_id = target.session_id
      and private.operational_participant_is_eligible(target.session_id, p.id)
  ) then raise exception 'Participant is not currently eligible for meal attendance'; end if;

  select g.company_id into participant_company
  from public.participants p
  left join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id
  where p.id = p_participant_id and p.session_id = target.session_id;

  if private.has_capability(target.session_id, 'food_manage') then
    allowed := true;
  elsif private.has_capability(target.session_id, 'meal_attendance_record')
    and participant_company is not null
    and private.can_access_company(target.session_id, participant_company) then
    allowed := true;
  end if;

  if not allowed then raise exception 'You can only record meals for participants in your assigned companies'; end if;

  if coalesce(p_served, false) then
    insert into public.meal_attendance(session_id, meal_service_id, participant_id, recorded_by, served_at)
    values(target.session_id, p_meal_service_id, p_participant_id, (select auth.uid()), now())
    on conflict do nothing
    returning id, meal_attendance.served_at into existing_id, existing_at;

    if existing_id is null then
      select a.id, a.served_at into existing_id, existing_at
      from public.meal_attendance a
      where a.meal_service_id = p_meal_service_id and a.participant_id = p_participant_id;
    else
      insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
      values(target.session_id, (select auth.uid()), 'meal_attendance_marked', 'meal_service', p_meal_service_id::text,
        jsonb_build_object('person_type','participant','person_id',p_participant_id));
    end if;

    return query select existing_id, existing_at, true;
    return;
  end if;

  delete from public.meal_attendance a
  where a.meal_service_id = p_meal_service_id and a.participant_id = p_participant_id
  returning a.id, a.served_at into existing_id, existing_at;

  if existing_id is not null then
    insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
    values(target.session_id, (select auth.uid()), 'meal_attendance_unmarked', 'meal_service', p_meal_service_id::text,
      jsonb_build_object('person_type','participant','person_id',p_participant_id));
  end if;

  return query select existing_id, existing_at, false;
end;
$$;
revoke all on function public.set_participant_meal_served(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_participant_meal_served(uuid, uuid, boolean) to authenticated;
