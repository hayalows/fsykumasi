-- Role-aware Overview summaries, seamless on-site FSY IDs, legacy head-count cleanup,
-- and smaller Food payloads for field use.

with archived as (
  update public.headcount_rounds
  set closes_at = now()
  where roster_version < 3
    and closes_at is null
    and opens_at < now() - interval '6 hours'
  returning id, session_id, label, opens_at
)
insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
select session_id, null, 'legacy_headcount_round_archived', 'headcount_round', id::text,
       jsonb_build_object(
         'label', label,
         'opened_at', opens_at,
         'reason', 'Legacy aggregate round automatically archived after migration to person-level head count'
       )
from archived;

create or replace function private.ensure_on_site_fsy_id(
  p_participant_id uuid,
  p_actor_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.participants%rowtype;
  target_group public.counselor_groups%rowtype;
  target_company public.companies%rowtype;
  existing_id text;
  origin text;
  company_number integer;
  next_slot integer;
  next_id text;
  next_state text;
begin
  select * into target
  from public.participants
  where id = p_participant_id
  for update;

  if target.id is null then
    raise exception 'Participant not found';
  end if;

  select b.fsy_id into existing_id
  from public.participant_badge_assignments b
  where b.session_id = target.session_id
    and b.participant_id = target.id
    and b.state <> 'retired'
  order by b.assigned_at desc
  limit 1;

  if existing_id is not null then
    return existing_id;
  end if;

  if target.source_kind <> 'on_site' then
    return null;
  end if;
  if target.group_id is null then
    raise exception 'Choose a counselor group before issuing an FSY ID';
  end if;
  if not private.operational_participant_is_eligible(target.session_id, target.id) then
    raise exception 'This on-site participant must be verified and eligible before an FSY ID can be issued';
  end if;

  select * into target_group
  from public.counselor_groups
  where id = target.group_id and session_id = target.session_id;
  if target_group.id is null then
    raise exception 'Counselor group not found';
  end if;

  select * into target_company
  from public.companies
  where id = target_group.company_id and session_id = target.session_id;
  if target_company.id is null then
    raise exception 'Company not found';
  end if;

  origin := private.origin_code_for_participant(target);
  if origin is null then
    raise exception 'Recognize the participant Stake, District, or Mission before issuing an FSY ID';
  end if;

  company_number := coalesce(
    target_company.operational_number,
    nullif(regexp_replace(target_company.name, '\D', '', 'g'), '')::integer
  );
  if company_number is null then
    raise exception 'The target company needs an operational number before an FSY ID can be issued';
  end if;

  -- Serialize company sequencing so two registration desks cannot issue the same slot.
  perform 1 from public.sessions where id = target.session_id for update;

  select coalesce(max(b.slot_number), 0) + 1 into next_slot
  from public.participant_badge_assignments b
  where b.session_id = target.session_id and b.company_id = target_company.id;

  if next_slot > 99 then
    raise exception 'Company sequence is full. Review the company before issuing another FSY ID';
  end if;

  next_id := 'C'
    || lpad(company_number::text, 2, '0')
    || '-'
    || lpad(next_slot::text, 2, '0')
    || '-'
    || origin;

  next_state := case when exists(
    select 1
    from public.participant_badge_assignments b
    where b.session_id = target.session_id and b.state = 'finalized'
  ) then 'finalized' else 'draft' end;

  insert into public.participant_badge_assignments(
    session_id, participant_id, company_id, group_id, slot_number, origin_code,
    fsy_id, badge_name, state, assigned_by, finalized_by, finalized_at
  ) values (
    target.session_id, target.id, target_company.id, target_group.id, next_slot, origin,
    next_id, trim(concat_ws(' ', target.first_name, target.last_name)), next_state,
    p_actor_id,
    case when next_state = 'finalized' then p_actor_id else null end,
    case when next_state = 'finalized' then now() else null end
  );

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(
    target.session_id,
    p_actor_id,
    'on_site_fsy_id_issued',
    'participant',
    target.id::text,
    jsonb_build_object(
      'fsy_id', next_id,
      'company_id', target_company.id,
      'group_id', target_group.id,
      'slot_number', next_slot,
      'state', next_state
    )
  );

  return next_id;
end;
$$;

create or replace function public.assign_participant_to_group(
  p_participant_id uuid,
  p_group_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.participants%rowtype;
  target_group public.counselor_groups%rowtype;
  max_size integer;
  avoid_units boolean;
begin
  select * into target from public.participants where id = p_participant_id for update;
  select * into target_group from public.counselor_groups where id = p_group_id;

  if target.id is null or target_group.id is null or target.session_id <> target_group.session_id then
    raise exception 'Participant and group must belong to the same session';
  end if;

  if not (
    private.has_capability(target.session_id, 'registration_manage')
    or private.has_session_role(
      target.session_id,
      array['coordinator','logistics_admin','session_director']::public.app_role[]
    )
  ) then
    raise exception 'Registration management access required to assign participants';
  end if;

  if not private.operational_participant_is_eligible(target.session_id, target.id) then
    raise exception 'This record is not currently eligible for youth operations. Review registration status, verification and age first';
  end if;
  if target.sex <> target_group.sex then
    raise exception 'Participant sex does not match the selected group';
  end if;

  select group_max_size, avoid_same_unit into max_size, avoid_units
  from public.session_structure_settings
  where session_id = target.session_id;

  max_size := coalesce(max_size, 10);
  avoid_units := coalesce(avoid_units, true);

  if (
    select count(*)
    from public.participants p
    where p.group_id = target_group.id and p.id <> target.id
  ) >= max_size then
    raise exception 'This counselor group is already at its configured maximum size';
  end if;

  if avoid_units and exists(
    select 1
    from public.participants peer
    where peer.group_id = target_group.id
      and peer.id <> target.id
      and lower(trim(peer.unit_name)) = lower(trim(target.unit_name))
  ) then
    raise exception 'This group already contains someone from the same unit';
  end if;

  update public.participants
  set group_id = target_group.id, updated_at = now()
  where id = target.id;

  -- On-site participants become ordinary operational participants in the same transaction:
  -- placement creates their company-first FSY ID instead of leaving a second manual task.
  if target.source_kind = 'on_site' then
    perform private.ensure_on_site_fsy_id(target.id, (select auth.uid()));
  end if;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(
    target.session_id,
    (select auth.uid()),
    'participant_group_assigned',
    'participant',
    target.id::text,
    jsonb_build_object('group_id', target_group.id, 'workflow', 'registration_checkin_desk')
  );
end;
$$;

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
declare
  caller_role public.app_role;
  participant_company uuid;
  participant_source text;
begin
  select aa.role into caller_role
  from public.access_assignments aa
  where aa.session_id = p_session_id
    and aa.user_id = (select auth.uid())
    and aa.active
  limit 1;

  select g.company_id, p.source_kind into participant_company, participant_source
  from public.participants p
  left join public.counselor_groups g on g.id = p.group_id
  where p.id = p_participant_id and p.session_id = p_session_id;

  if caller_role = 'assistant_coordinator' then
    if participant_company is null or not private.can_access_company(p_session_id, participant_company) then
      raise exception 'Your account cannot record check-in outside your assigned companies';
    end if;
  elsif not private.has_capability(p_session_id, 'checkin_record') then
    raise exception 'Your account cannot record check-in for this participant';
  end if;

  if not private.operational_participant_is_eligible(p_session_id, p_participant_id) then
    raise exception 'This record is outside the current youth operational eligibility rules';
  end if;

  if exists(
       select 1 from public.counselor_groups g
       where g.session_id = p_session_id and g.state = 'published'
     )
     and not exists(
       select 1 from public.participants p
       where p.id = p_participant_id and p.session_id = p_session_id and p.group_id is not null
     ) then
    raise exception 'Participant still needs a counselor group assignment';
  end if;

  if p_status::text = 'arrived'
     and participant_source = 'on_site'
     and not exists(
       select 1
       from public.participant_badge_assignments b
       where b.session_id = p_session_id
         and b.participant_id = p_participant_id
         and b.state <> 'retired'
     ) then
    raise exception 'On-site participant still needs an FSY ID before check-in';
  end if;

  insert into public.check_ins(session_id, participant_id, status, note, recorded_by, recorded_at)
  values(
    p_session_id,
    p_participant_id,
    p_status,
    nullif(trim(coalesce(p_note, '')), ''),
    (select auth.uid()),
    now()
  )
  on conflict(session_id, participant_id) do update
  set status = excluded.status,
      note = excluded.note,
      recorded_by = excluded.recorded_by,
      recorded_at = excluded.recorded_at;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(
    p_session_id,
    (select auth.uid()),
    'participant_checkin_recorded',
    'participant',
    p_participant_id::text,
    jsonb_build_object('status', p_status)
  );
end;
$$;

-- Repair already-verified and already-grouped on-site records created before ID issuance became atomic.
do $$
declare
  r record;
begin
  for r in
    select p.id
    from public.participants p
    where p.source_kind = 'on_site'
      and p.is_current
      and p.group_id is not null
      and private.operational_participant_is_eligible(p.session_id, p.id)
      and private.origin_code_for_participant(p) is not null
      and not exists(
        select 1
        from public.participant_badge_assignments b
        where b.session_id = p.session_id
          and b.participant_id = p.id
          and b.state <> 'retired'
      )
    order by p.session_id, p.id
  loop
    perform private.ensure_on_site_fsy_id(r.id, null);
  end loop;
end;
$$;

-- Filter obvious non-answers before they leave Postgres. This removes large pages of
-- "None / No / N/A" data that the client previously downloaded only to discard.
create or replace function public.get_food_needs(p_session_id uuid)
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
language sql
stable
security definer
set search_path = ''
as $$
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
    and private.has_capability(p_session_id, 'food_view')

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
    and private.has_capability(p_session_id, 'food_view')
  order by 7, 3;
$$;

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
    left join public.counselor_groups g
      on g.id = p.group_id and g.session_id = p.session_id
    where p.session_id = p_session_id
      and p.is_current
      and private.operational_participant_is_eligible(p_session_id, p.id)
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
    with base as (
      select
        p.id,
        p.source_kind,
        p.verification_status,
        p.group_id,
        coalesce(p.attendance_status, 'expected') as attendance_status,
        ci.status::text as checkin_status,
        private.operational_participant_is_eligible(p_session_id, p.id) as eligible,
        exists(
          select 1
          from public.participant_badge_assignments b
          where b.session_id = p_session_id
            and b.participant_id = p.id
            and b.state <> 'retired'
        ) as has_badge
      from public.participants p
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
          'na','none','nil','no','nothing','notapplicable','food','normal','normalfood',
          'noallergies','noallergy','nodietaryneeds','nodietaryrestrictions','norestrictions',
          'nospecialdiet','noproblem'
        )
        and not exists(
          select 1 from public.food_acknowledgements f
          where f.session_id = p_session_id and f.staff_id = s.id
        )
    ) into dietary_open;
  end if;

  if 'food_view' = any(caps) or 'meal_attendance_view' = any(caps) then
    select ms.service_id, ms.label, ms.status, ms.served_count, ms.expected_count
    into meal_id, meal_label, meal_status, meal_served, meal_expected
    from public.get_meal_services(p_session_id, null) ms
    where ms.status = 'open'
    limit 1;
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
  where r.session_id = p_session_id and r.roster_version >= 3
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
