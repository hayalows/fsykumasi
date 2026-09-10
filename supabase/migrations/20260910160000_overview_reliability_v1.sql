-- Overview reliability v1
-- Keep the operational overview useful on large sessions and when no meal service is open.
create or replace function public.get_my_operational_overview(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  caller_role public.app_role;
  caps text[] := array[]::text[];
  whole boolean := false;

  company_count integer := 0;
  company_names jsonb := '[]'::jsonb;
  group_count integer := 0;
  counselor_count integer := 0;
  uncovered_groups integer := 0;
  participant_count integer := 0;

  checked_in integer := 0;
  recent_arrivals integer := 0;

  registration_ready integer := 0;
  registration_attention integer := 0;
  registration_arrived integer := 0;
  onsite_pending_verification integer := 0;
  onsite_pending_id integer := 0;

  housing_waiting integer := 0;
  housing_assigned integer := 0;
  wellness_open integer := 0;
  dietary_open integer := 0;
  access_pending integer := 0;

  hc_id uuid;
  hc_label text;
  hc_opens_at timestamptz;
  hc_closes_at timestamptz;
  hc_unresolved integer := 0;
  hc_missing integer := 0;
  hc_total integer := 0;

  meal_id uuid;
  meal_label text;
  meal_status text;
  meal_served integer := 0;
  meal_expected integer := 0;
begin
  if caller is null then
    raise exception 'Sign in required';
  end if;

  select aa.role into caller_role
  from public.access_assignments aa
  where aa.session_id = p_session_id
    and aa.user_id = caller
    and aa.active
  order by aa.created_at desc
  limit 1;

  if caller_role is null then
    raise exception 'Active session access required';
  end if;

  caps := coalesce(private.effective_capabilities(p_session_id, caller), array[]::text[]);
  whole := caller_role in (
    'coordinator'::public.app_role,
    'logistics_admin'::public.app_role,
    'session_director'::public.app_role
  );

  if whole or caller_role = 'assistant_coordinator' then
    select count(*)::integer,
           coalesce(jsonb_agg(v.name order by v.name), '[]'::jsonb)
    into company_count, company_names
    from (
      select c.id, coalesce(nullif(c.custom_name, ''), c.name) as name
      from public.companies c
      where c.session_id = p_session_id
        and (whole or private.can_access_company(p_session_id, c.id))
    ) v;

    select
      count(*)::integer,
      count(distinct g.counselor_id) filter (where g.counselor_id is not null)::integer,
      count(*) filter (where g.counselor_id is null)::integer
    into group_count, counselor_count, uncovered_groups
    from public.counselor_groups g
    where g.session_id = p_session_id
      and g.state = 'published'
      and (whole or private.can_access_company(p_session_id, g.company_id));

    select count(*)::integer into participant_count
    from public.participants p
    join private.participant_eligibility_projection(p_session_id) eligibility
      on eligibility.participant_id = p.id
     and eligibility.eligible
    left join public.counselor_groups g
      on g.id = p.group_id and g.session_id = p.session_id
    where p.session_id = p_session_id
      and p.is_current
      and (whole or (g.company_id is not null and private.can_access_company(p_session_id, g.company_id)));
  end if;

  if whole
     or caller_role = 'assistant_coordinator'
     or 'registration_view' = any(caps)
     or 'registration_manage' = any(caps)
     or 'checkin_record' = any(caps) then
    select
      count(*)::integer,
      count(*) filter (where ci.recorded_at >= now() - interval '15 minutes')::integer
    into checked_in, recent_arrivals
    from public.check_ins ci
    join public.participants p
      on p.id = ci.participant_id and p.session_id = ci.session_id
    left join public.counselor_groups g
      on g.id = p.group_id and g.session_id = p.session_id
    where ci.session_id = p_session_id
      and ci.status::text = 'arrived'
      and p.is_current
      and (
        caller_role <> 'assistant_coordinator'
        or (g.company_id is not null and private.can_access_company(p_session_id, g.company_id))
      );
  end if;

  if 'registration_view' = any(caps)
     or 'registration_manage' = any(caps)
     or 'checkin_record' = any(caps) then
    with base as materialized (
      select
        p.id,
        p.source_kind,
        p.verification_status,
        p.group_id,
        coalesce(p.attendance_status, 'expected') as attendance_status,
        ci.status::text as checkin_status,
        eligibility.eligible,
        exists(
          select 1
          from public.participant_badge_assignments b
          where b.session_id = p_session_id
            and b.participant_id = p.id
            and b.state <> 'retired'
        ) as has_badge
      from public.participants p
      join private.participant_eligibility_projection(p_session_id) eligibility
        on eligibility.participant_id = p.id
      left join public.check_ins ci
        on ci.session_id = p.session_id and ci.participant_id = p.id
      where p.session_id = p_session_id and p.is_current
    )
    select
      count(*) filter (
        where checkin_status is distinct from 'arrived'
          and attendance_status <> 'confirmed_not_attending'
          and eligible
          and group_id is not null
          and (source_kind <> 'on_site' or has_badge)
      )::integer,
      count(*) filter (
        where checkin_status is distinct from 'arrived'
          and attendance_status <> 'confirmed_not_attending'
          and (
            verification_status <> 'verified'
            or not eligible
            or group_id is null
            or attendance_status = 'unknown'
            or (source_kind = 'on_site' and group_id is not null and not has_badge)
          )
      )::integer,
      count(*) filter (where checkin_status = 'arrived')::integer,
      count(*) filter (
        where source_kind = 'on_site'
          and verification_status <> 'verified'
          and attendance_status <> 'confirmed_not_attending'
      )::integer,
      count(*) filter (
        where source_kind = 'on_site'
          and verification_status = 'verified'
          and group_id is not null
          and not has_badge
          and attendance_status <> 'confirmed_not_attending'
      )::integer
    into
      registration_ready,
      registration_attention,
      registration_arrived,
      onsite_pending_verification,
      onsite_pending_id
    from base;
  end if;

  if 'housing_view' = any(caps) then
    select count(*)::integer into housing_waiting
    from public.check_ins ci
    join public.participants p
      on p.id = ci.participant_id and p.session_id = ci.session_id
    where ci.session_id = p_session_id
      and ci.status::text = 'arrived'
      and p.is_current
      and not exists(
        select 1
        from public.housing_assignments h
        where h.session_id = p_session_id
          and h.participant_id = p.id
          and h.active
      );

    select count(*)::integer into housing_assigned
    from public.housing_assignments h
    where h.session_id = p_session_id
      and h.participant_id is not null
      and h.active;
  end if;

  if 'wellness_private' = any(caps) or 'wellness_status' = any(caps) then
    select count(*)::integer into wellness_open
    from public.wellness_encounters w
    where w.session_id = p_session_id and w.closed_at is null;
  end if;

  if 'food_view' = any(caps) then
    select (
      select count(*)
      from public.participants p
      join public.participant_private_details d on d.participant_id = p.id
      where p.session_id = p_session_id
        and p.is_current
        and p.registration_status = 'approved'
        and nullif(trim(coalesce(d.dietary_information, '')), '') is not null
        and lower(regexp_replace(coalesce(d.dietary_information, ''), '[^[:alnum:]]', '', 'g')) not in (
          'na','none','nil','no','nothing','notapplicable','food','normal','normalfood',
          'noallergies','noallergy','nodietaryneeds','nodietaryrestrictions','norestrictions',
          'nospecialdiet','noproblem'
        )
        and not exists(
          select 1 from public.food_acknowledgements f
          where f.session_id = p_session_id and f.participant_id = p.id
        )
    ) + (
      select count(*)
      from public.staff s
      join public.staff_private_details d on d.staff_id = s.id
      where s.session_id = p_session_id
        and s.is_current
        and s.registration_status = 'approved'
        and nullif(trim(coalesce(d.dietary_information, '')), '') is not null
        and lower(regexp_replace(coalesce(d.dietary_information, ''), '[^[:alnum:]]', '', 'g')) not in (
          'na','none','nil','notapplicable','food','normal','normalfood',
          'noallergies','noallergy','nodietaryneeds','nodietaryrestrictions','norestrictions',
          'nospecialdiet','noproblem'
        )
        and not exists(
          select 1 from public.food_acknowledgements f
          where f.session_id = p_session_id and f.staff_id = s.id
        )
    ) into dietary_open;
  end if;

  -- Do not invoke a whole-roster meal aggregate when there is no open service.
  if 'food_view' = any(caps) or 'meal_attendance_view' = any(caps) then
    select
      m.id,
      coalesce(nullif(m.label, ''), initcap(m.meal_type)),
      m.status
    into meal_id, meal_label, meal_status
    from public.meal_services m
    where m.session_id = p_session_id
      and m.status = 'open'
    order by m.opened_at desc nulls last, m.service_date desc, m.id
    limit 1;

    if meal_id is not null then
      with visible_participants as materialized (
        select p.id
        from public.participants p
        join private.participant_eligibility_projection(p_session_id) eligibility
          on eligibility.participant_id = p.id
         and eligibility.eligible
        left join public.counselor_groups g
          on g.id = p.group_id and g.session_id = p.session_id
        where p.session_id = p_session_id
          and p.is_current
          and (
            not exists (
              select 1
              from public.participant_badge_assignments b
              where b.session_id = p_session_id
                and b.participant_id = p.id
            )
            or exists (
              select 1
              from public.participant_badge_assignments b
              where b.session_id = p_session_id
                and b.participant_id = p.id
                and b.state <> 'retired'
            )
          )
          and (
            'food_view' = any(caps)
            or (g.company_id is not null and private.can_access_company(p_session_id, g.company_id))
          )
      )
      select
        (select count(*)::integer
         from public.meal_attendance a
         join visible_participants vp on vp.id = a.participant_id
         where a.meal_service_id = meal_id
           and a.session_id = p_session_id
           and a.participant_id is not null),
        (select count(*)::integer from visible_participants)
      into meal_served, meal_expected;
    end if;
  end if;

  if 'access_admin' = any(caps) or whole then
    select (
      select count(*)
      from public.access_requests a
      where a.session_id = p_session_id and a.status::text = 'pending'
    ) + (
      select count(*)
      from public.leader_invites i
      where i.session_id = p_session_id
        and i.status::text = 'pending'
        and i.expires_at > now()
    ) into access_pending;
  end if;

  -- Overview deliberately ignores legacy aggregate rounds. Only modern person-level
  -- rounds can become live work here.
  select r.id, r.label, r.opens_at, r.closes_at
  into hc_id, hc_label, hc_opens_at, hc_closes_at
  from public.headcount_rounds r
  where r.session_id = p_session_id
    and r.roster_version >= 3
    and r.voided_at is null
  order by r.opens_at desc
  limit 1;

  if hc_id is not null
     and hc_closes_at is null
     and ('headcount_view' = any(caps) or 'headcount_record' = any(caps) or whole) then
    select
      count(*) filter (where hp.status = 'unresolved')::integer,
      count(*) filter (where hp.status = 'missing')::integer,
      count(*)::integer
    into hc_unresolved, hc_missing, hc_total
    from public.headcount_round_people hp
    where hp.round_id = hc_id
      and (
        caller_role <> 'assistant_coordinator'
        or (hp.company_id is not null and private.can_access_company(p_session_id, hp.company_id))
      );
  end if;

  return jsonb_build_object(
    'role', caller_role::text,
    'wholeSession', whole,
    'scope', jsonb_build_object(
      'companyCount', company_count,
      'companyNames', company_names,
      'groupCount', group_count,
      'counselorCount', counselor_count,
      'uncoveredGroups', uncovered_groups,
      'participantCount', participant_count
    ),
    'session', jsonb_build_object(
      'checkedIn', checked_in,
      'recentArrivals', recent_arrivals
    ),
    'registration', jsonb_build_object(
      'ready', registration_ready,
      'attention', registration_attention,
      'arrived', registration_arrived,
      'onSitePendingVerification', onsite_pending_verification,
      'onSitePendingId', onsite_pending_id
    ),
    'housing', jsonb_build_object(
      'waiting', housing_waiting,
      'assigned', housing_assigned
    ),
    'headcount', jsonb_build_object(
      'roundId', hc_id,
      'label', hc_label,
      'opensAt', hc_opens_at,
      'closesAt', hc_closes_at,
      'unresolved', hc_unresolved,
      'missing', hc_missing,
      'total', hc_total
    ),
    'wellness', jsonb_build_object('open', wellness_open),
    'food', jsonb_build_object(
      'dietaryOpen', dietary_open,
      'serviceId', meal_id,
      'serviceLabel', meal_label,
      'serviceStatus', meal_status,
      'served', meal_served,
      'expected', meal_expected,
      'remaining', greatest(0, coalesce(meal_expected, 0) - coalesce(meal_served, 0))
    ),
    'access', jsonb_build_object('pending', access_pending),
    'refreshedAt', now()
  );
end;
$$;

revoke all on function public.get_my_operational_overview(uuid) from public;
grant execute on function public.get_my_operational_overview(uuid) to authenticated;