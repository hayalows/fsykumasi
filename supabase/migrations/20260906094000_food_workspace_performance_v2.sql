-- Food workspace v2: replace whole-roster hydration and row-by-row permission/eligibility
-- checks with small server-side pages and set-based aggregates.

create or replace function public.get_meal_services_v2(
  p_session_id uuid,
  p_service_date date default null
)
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
declare
  caller uuid := (select auth.uid());
  caps text[] := array[]::text[];
  food_scope boolean := false;
  meal_scope boolean := false;
  caller_companies uuid[] := array[]::uuid[];
begin
  if caller is null then
    raise exception 'Sign in required';
  end if;

  caps := coalesce(private.effective_capabilities(p_session_id, caller), array[]::text[]);
  food_scope := 'food_view' = any(caps);
  meal_scope := food_scope or 'meal_attendance_view' = any(caps);
  if not meal_scope then
    raise exception 'Meal attendance access required';
  end if;

  select coalesce(aa.company_ids, array[]::uuid[])
  into caller_companies
  from public.access_assignments aa
  where aa.session_id = p_session_id
    and aa.user_id = caller
    and aa.active
  order by aa.created_at desc
  limit 1;

  caller_companies := coalesce(caller_companies, array[]::uuid[]);

  return query
  with visible_participants as materialized (
    select p.id
    from public.participants p
    join public.sessions s on s.id = p.session_id
    join public.participant_private_details d on d.participant_id = p.id
    left join public.counselor_groups g
      on g.id = p.group_id and g.session_id = p.session_id
    where p.session_id = p_session_id
      and p.is_current
      and p.registration_status = 'approved'
      and p.verification_status = 'verified'
      and p.attendance_status <> 'confirmed_not_attending'
      and d.date_of_birth is not null
      and s.starts_on is not null
      and s.ends_on is not null
      and extract(year from s.starts_on)::int - extract(year from d.date_of_birth)::int >= 14
      and s.ends_on < (d.date_of_birth + interval '19 years')::date
      and (
        not exists (
          select 1
          from public.participant_badge_assignments badge
          where badge.session_id = p_session_id and badge.participant_id = p.id
        )
        or exists (
          select 1
          from public.participant_badge_assignments badge
          where badge.session_id = p_session_id
            and badge.participant_id = p.id
            and badge.state <> 'retired'
        )
      )
      and (
        food_scope
        or (g.company_id is not null and g.company_id = any(caller_companies))
      )
  ),
  expected as (
    select count(*)::integer as count from visible_participants
  ),
  served as (
    select a.meal_service_id, count(*)::integer as count
    from public.meal_attendance a
    join visible_participants vp on vp.id = a.participant_id
    where a.session_id = p_session_id
      and a.participant_id is not null
    group by a.meal_service_id
  )
  select
    m.id,
    m.service_date,
    m.meal_type,
    coalesce(nullif(m.label, ''), initcap(m.meal_type)),
    m.status,
    m.opened_at,
    m.closed_at,
    coalesce(served.count, 0),
    expected.count
  from public.meal_services m
  cross join expected
  left join served on served.meal_service_id = m.id
  where m.session_id = p_session_id
    and (p_service_date is null or m.service_date = p_service_date)
  order by
    case m.status when 'open' then 1 when 'planned' then 2 else 3 end,
    case when m.status = 'open' then m.opened_at end desc nulls last,
    m.service_date desc,
    case m.meal_type when 'breakfast' then 1 when 'lunch' then 2 when 'dinner' then 3 when 'snack' then 4 else 5 end,
    m.id;
end;
$$;

create or replace function public.get_meal_roster_page_v2(
  p_meal_service_id uuid,
  p_query text default null,
  p_company_id uuid default null,
  p_status text default 'remaining',
  p_limit integer default 80,
  p_offset integer default 0
)
returns table(
  participant_id uuid,
  display_name text,
  fsy_id text,
  company_id uuid,
  company_name text,
  group_name text,
  served_at timestamptz,
  total_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target_session uuid;
  caps text[] := array[]::text[];
  food_scope boolean := false;
  meal_scope boolean := false;
  caller_companies uuid[] := array[]::uuid[];
  search_text text := lower(trim(coalesce(p_query, '')));
  status_filter text := lower(trim(coalesce(p_status, 'remaining')));
  row_limit integer := least(200, greatest(1, coalesce(p_limit, 80)));
  row_offset integer := greatest(0, coalesce(p_offset, 0));
begin
  if caller is null then
    raise exception 'Sign in required';
  end if;

  select m.session_id into target_session
  from public.meal_services m
  where m.id = p_meal_service_id;

  if target_session is null then
    raise exception 'Meal service not found';
  end if;

  caps := coalesce(private.effective_capabilities(target_session, caller), array[]::text[]);
  food_scope := 'food_view' = any(caps);
  meal_scope := food_scope or 'meal_attendance_view' = any(caps);
  if not meal_scope then
    raise exception 'Meal attendance access required';
  end if;

  if status_filter not in ('remaining', 'served', 'all') then
    raise exception 'Unsupported meal roster filter';
  end if;

  select coalesce(aa.company_ids, array[]::uuid[])
  into caller_companies
  from public.access_assignments aa
  where aa.session_id = target_session
    and aa.user_id = caller
    and aa.active
  order by aa.created_at desc
  limit 1;

  caller_companies := coalesce(caller_companies, array[]::uuid[]);

  if p_company_id is not null
     and not food_scope
     and not (p_company_id = any(caller_companies)) then
    raise exception 'That company is outside your meal attendance scope';
  end if;

  return query
  with eligible as materialized (
    select
      p.id,
      trim(concat_ws(' ', p.first_name, p.last_name))::text as participant_name,
      badge.fsy_id,
      c.id as participant_company_id,
      coalesce(nullif(c.custom_name, ''), c.name, 'Unassigned')::text as participant_company_name,
      coalesce(nullif(g.custom_name, ''), g.name, '')::text as participant_group_name
    from public.participants p
    join public.sessions s on s.id = p.session_id
    join public.participant_private_details d on d.participant_id = p.id
    left join public.counselor_groups g
      on g.id = p.group_id and g.session_id = p.session_id
    left join public.companies c
      on c.id = g.company_id and c.session_id = p.session_id
    left join public.participant_badge_assignments badge
      on badge.session_id = target_session
      and badge.participant_id = p.id
      and badge.state <> 'retired'
    where p.session_id = target_session
      and p.is_current
      and p.registration_status = 'approved'
      and p.verification_status = 'verified'
      and p.attendance_status <> 'confirmed_not_attending'
      and d.date_of_birth is not null
      and s.starts_on is not null
      and s.ends_on is not null
      and extract(year from s.starts_on)::int - extract(year from d.date_of_birth)::int >= 14
      and s.ends_on < (d.date_of_birth + interval '19 years')::date
      and (
        not exists (
          select 1
          from public.participant_badge_assignments any_badge
          where any_badge.session_id = target_session and any_badge.participant_id = p.id
        )
        or badge.participant_id is not null
      )
      and (
        food_scope
        or (c.id is not null and c.id = any(caller_companies))
      )
  ),
  filtered as (
    select e.*, a.served_at
    from eligible e
    left join public.meal_attendance a
      on a.meal_service_id = p_meal_service_id
      and a.participant_id = e.id
    where (p_company_id is null or e.participant_company_id = p_company_id)
      and (
        status_filter = 'all'
        or (status_filter = 'remaining' and a.id is null)
        or (status_filter = 'served' and a.id is not null)
      )
      and (
        search_text = ''
        or lower(e.participant_name) like '%' || search_text || '%'
        or lower(coalesce(e.fsy_id, '')) like '%' || search_text || '%'
        or lower(e.participant_company_name) like '%' || search_text || '%'
        or lower(e.participant_group_name) like '%' || search_text || '%'
      )
  )
  select
    f.id,
    f.participant_name,
    f.fsy_id,
    f.participant_company_id,
    f.participant_company_name,
    f.participant_group_name,
    f.served_at,
    count(*) over()::integer
  from filtered f
  order by
    case when f.served_at is null then 0 else 1 end,
    f.participant_name,
    f.id
  limit row_limit
  offset row_offset;
end;
$$;

create or replace function public.get_meal_progress_v2(p_meal_service_id uuid)
returns table(
  company_id uuid,
  company_name text,
  expected_count integer,
  served_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  target_session uuid;
  caps text[] := array[]::text[];
  food_scope boolean := false;
  meal_scope boolean := false;
  caller_companies uuid[] := array[]::uuid[];
begin
  if caller is null then
    raise exception 'Sign in required';
  end if;

  select m.session_id into target_session
  from public.meal_services m
  where m.id = p_meal_service_id;

  if target_session is null then
    raise exception 'Meal service not found';
  end if;

  caps := coalesce(private.effective_capabilities(target_session, caller), array[]::text[]);
  food_scope := 'food_view' = any(caps);
  meal_scope := food_scope or 'meal_attendance_view' = any(caps);
  if not meal_scope then
    raise exception 'Meal attendance access required';
  end if;

  select coalesce(aa.company_ids, array[]::uuid[])
  into caller_companies
  from public.access_assignments aa
  where aa.session_id = target_session
    and aa.user_id = caller
    and aa.active
  order by aa.created_at desc
  limit 1;

  caller_companies := coalesce(caller_companies, array[]::uuid[]);

  return query
  with eligible as materialized (
    select
      p.id,
      c.id as participant_company_id,
      coalesce(nullif(c.custom_name, ''), c.name, 'Unassigned')::text as participant_company_name,
      c.operational_number
    from public.participants p
    join public.sessions s on s.id = p.session_id
    join public.participant_private_details d on d.participant_id = p.id
    left join public.counselor_groups g
      on g.id = p.group_id and g.session_id = p.session_id
    left join public.companies c
      on c.id = g.company_id and c.session_id = p.session_id
    left join public.participant_badge_assignments badge
      on badge.session_id = target_session
      and badge.participant_id = p.id
      and badge.state <> 'retired'
    where p.session_id = target_session
      and p.is_current
      and p.registration_status = 'approved'
      and p.verification_status = 'verified'
      and p.attendance_status <> 'confirmed_not_attending'
      and d.date_of_birth is not null
      and s.starts_on is not null
      and s.ends_on is not null
      and extract(year from s.starts_on)::int - extract(year from d.date_of_birth)::int >= 14
      and s.ends_on < (d.date_of_birth + interval '19 years')::date
      and (
        not exists (
          select 1
          from public.participant_badge_assignments any_badge
          where any_badge.session_id = target_session and any_badge.participant_id = p.id
        )
        or badge.participant_id is not null
      )
      and (
        food_scope
        or (c.id is not null and c.id = any(caller_companies))
      )
  )
  select
    e.participant_company_id,
    e.participant_company_name,
    count(*)::integer,
    count(a.id)::integer
  from eligible e
  left join public.meal_attendance a
    on a.meal_service_id = p_meal_service_id
    and a.participant_id = e.id
  group by e.participant_company_id, e.participant_company_name, e.operational_number
  order by e.operational_number nulls last, e.participant_company_name;
end;
$$;

create or replace function public.get_food_needs_v2(p_session_id uuid)
returns table(
  person_type text,
  person_id uuid,
  display_name text,
  dietary_information text,
  group_name text,
  company_name text,
  acknowledged boolean,
  acknowledged_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  caps text[] := array[]::text[];
begin
  if caller is null then
    raise exception 'Sign in required';
  end if;

  caps := coalesce(private.effective_capabilities(p_session_id, caller), array[]::text[]);
  if not ('food_view' = any(caps)) then
    raise exception 'Food access required';
  end if;

  return query
  select
    'participant'::text,
    p.id,
    trim(concat_ws(' ', p.first_name, p.last_name)),
    d.dietary_information,
    coalesce(nullif(g.custom_name, ''), g.name),
    coalesce(nullif(c.custom_name, ''), c.name),
    (fa.id is not null),
    fa.acknowledged_at
  from public.participants p
  join public.participant_private_details d on d.participant_id = p.id
  left join public.counselor_groups g on g.id = p.group_id
  left join public.companies c on c.id = g.company_id
  left join public.food_acknowledgements fa
    on fa.session_id = p_session_id and fa.participant_id = p.id
  where p.session_id = p_session_id
    and p.is_current
    and p.registration_status = 'approved'
    and nullif(trim(coalesce(d.dietary_information, '')), '') is not null
    and lower(regexp_replace(coalesce(d.dietary_information, ''), '[^[:alnum:]]', '', 'g')) not in (
      'na','none','nil','no','nothing','notapplicable','food','normal','normalfood',
      'noallergies','noallergy','nodietaryneeds','nodietaryrestrictions','norestrictions',
      'nospecialdiet','noproblem'
    )

  union all

  select
    'staff'::text,
    s.id,
    s.full_name,
    d.dietary_information,
    null::text,
    coalesce(nullif(c.custom_name, ''), c.name),
    (fa.id is not null),
    fa.acknowledged_at
  from public.staff s
  join public.staff_private_details d on d.staff_id = s.id
  left join public.companies c on c.id = s.assigned_company_id
  left join public.food_acknowledgements fa
    on fa.session_id = p_session_id and fa.staff_id = s.id
  where s.session_id = p_session_id
    and s.is_current
    and s.registration_status = 'approved'
    and nullif(trim(coalesce(d.dietary_information, '')), '') is not null
    and lower(regexp_replace(coalesce(d.dietary_information, ''), '[^[:alnum:]]', '', 'g')) not in (
      'na','none','nil','no','nothing','notapplicable','food','normal','normalfood',
      'noallergies','noallergy','nodietaryneeds','nodietaryrestrictions','norestrictions',
      'nospecialdiet','noproblem'
    )
  order by 7, 3;
end;
$$;

create or replace function public.set_participant_meal_served_v2(
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
  caller uuid := (select auth.uid());
  target public.meal_services%rowtype;
  caps text[] := array[]::text[];
  caller_companies uuid[] := array[]::uuid[];
  participant_company uuid;
  existing_id uuid;
  existing_at timestamptz;
  allowed boolean := false;
begin
  if caller is null then
    raise exception 'Sign in required';
  end if;

  select * into target
  from public.meal_services
  where id = p_meal_service_id
  for update;

  if target.id is null then raise exception 'Meal service not found'; end if;
  if target.status <> 'open' then raise exception 'This meal service is not open'; end if;
  if p_participant_id is null then raise exception 'Choose a participant'; end if;

  caps := coalesce(private.effective_capabilities(target.session_id, caller), array[]::text[]);

  select coalesce(aa.company_ids, array[]::uuid[])
  into caller_companies
  from public.access_assignments aa
  where aa.session_id = target.session_id
    and aa.user_id = caller
    and aa.active
  order by aa.created_at desc
  limit 1;
  caller_companies := coalesce(caller_companies, array[]::uuid[]);

  if not exists (
    select 1
    from public.participants p
    join public.sessions session_row on session_row.id = p.session_id
    join public.participant_private_details d on d.participant_id = p.id
    where p.id = p_participant_id
      and p.session_id = target.session_id
      and p.is_current
      and p.registration_status = 'approved'
      and p.verification_status = 'verified'
      and p.attendance_status <> 'confirmed_not_attending'
      and d.date_of_birth is not null
      and session_row.starts_on is not null
      and session_row.ends_on is not null
      and extract(year from session_row.starts_on)::int - extract(year from d.date_of_birth)::int >= 14
      and session_row.ends_on < (d.date_of_birth + interval '19 years')::date
  ) then
    raise exception 'Participant is not currently eligible for meal attendance';
  end if;

  select g.company_id into participant_company
  from public.participants p
  left join public.counselor_groups g
    on g.id = p.group_id and g.session_id = p.session_id
  where p.id = p_participant_id and p.session_id = target.session_id;

  if 'food_manage' = any(caps) then
    allowed := true;
  elsif 'meal_attendance_record' = any(caps)
    and participant_company is not null
    and participant_company = any(caller_companies) then
    allowed := true;
  end if;

  if not allowed then
    raise exception 'You can only record meals for participants in your assigned companies';
  end if;

  if coalesce(p_served, false) then
    insert into public.meal_attendance(session_id, meal_service_id, participant_id, recorded_by, served_at)
    values(target.session_id, p_meal_service_id, p_participant_id, caller, now())
    on conflict do nothing
    returning id, meal_attendance.served_at into existing_id, existing_at;

    if existing_id is null then
      select a.id, a.served_at into existing_id, existing_at
      from public.meal_attendance a
      where a.meal_service_id = p_meal_service_id
        and a.participant_id = p_participant_id;
    else
      insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
      values(
        target.session_id,
        caller,
        'meal_attendance_marked',
        'meal_service',
        p_meal_service_id::text,
        jsonb_build_object('person_type', 'participant', 'person_id', p_participant_id)
      );
    end if;

    return query select existing_id, existing_at, true;
    return;
  end if;

  delete from public.meal_attendance a
  where a.meal_service_id = p_meal_service_id
    and a.participant_id = p_participant_id
  returning a.id, a.served_at into existing_id, existing_at;

  if existing_id is not null then
    insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
    values(
      target.session_id,
      caller,
      'meal_attendance_unmarked',
      'meal_service',
      p_meal_service_id::text,
      jsonb_build_object('person_type', 'participant', 'person_id', p_participant_id)
    );
  end if;

  return query select existing_id, existing_at, false;
end;
$$;

revoke all on function public.get_meal_services_v2(uuid, date) from public;
revoke all on function public.get_meal_roster_page_v2(uuid, text, uuid, text, integer, integer) from public;
revoke all on function public.get_meal_progress_v2(uuid) from public;
revoke all on function public.get_food_needs_v2(uuid) from public;
revoke all on function public.set_participant_meal_served_v2(uuid, uuid, boolean) from public;

grant execute on function public.get_meal_services_v2(uuid, date) to authenticated;
grant execute on function public.get_meal_roster_page_v2(uuid, text, uuid, text, integer, integer) to authenticated;
grant execute on function public.get_meal_progress_v2(uuid) to authenticated;
grant execute on function public.get_food_needs_v2(uuid) to authenticated;
grant execute on function public.set_participant_meal_served_v2(uuid, uuid, boolean) to authenticated;