-- Participant ground roster v72.
-- Day One operations use physical arrival as the live capacity source while
-- preserving imported registration records as history. Existing paper/group
-- assignments stay useful, but an absent participant does not consume a live
-- place. Staff placement is deliberately not a prerequisite for youth arrival;
-- counselors and Assistant Coordinators can be attached after the ground roster
-- settles.

create or replace function private.assign_arriving_participant_to_ready_group_v1(
  p_session_id uuid,
  p_participant_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  participant_sex public.participant_sex;
  current_group uuid;
  current_company uuid;
  target_group uuid;
  max_size integer := 15;
  current_has_space boolean := false;
begin
  -- One allocator at a time. This makes the 15-person live cap safe even when
  -- several registration desks check people in at once.
  perform pg_advisory_xact_lock(hashtextextended('fsy-participant-ground:' || p_session_id::text, 0));

  select p.sex, p.group_id, g.company_id
    into participant_sex, current_group, current_company
  from public.participants p
  left join public.counselor_groups g
    on g.id = p.group_id and g.session_id = p.session_id
  where p.id = p_participant_id and p.session_id = p_session_id
  for update of p;

  if not found then
    raise exception 'Participant not found in this session';
  end if;

  select coalesce(s.group_max_size, 15)
    into max_size
  from public.session_structure_settings s
  where s.session_id = p_session_id;
  max_size := coalesce(max_size, 15);

  -- Keep the participant's existing paper assignment whenever that exact group
  -- still has a real on-ground place. This minimizes unnecessary moves and ID
  -- changes while allowing no-shows to release capacity automatically.
  if current_group is not null then
    select exists (
      select 1
      from public.counselor_groups g
      where g.id = current_group
        and g.session_id = p_session_id
        and g.state = 'published'
        and g.sex = participant_sex
        and (
          select count(*)
          from public.participants gp
          join public.check_ins ci
            on ci.session_id = gp.session_id
           and ci.participant_id = gp.id
           and ci.status = 'arrived'
          where gp.session_id = p_session_id
            and gp.group_id = g.id
            and gp.id <> p_participant_id
        ) < max_size
    ) into current_has_space;

    if current_has_space then
      return current_group;
    end if;
  end if;

  -- If the original company still has another same-sex group with live space,
  -- keep the participant in that company before moving them elsewhere.
  if current_company is not null then
    select g.id into target_group
    from public.counselor_groups g
    where g.session_id = p_session_id
      and g.company_id = current_company
      and g.state = 'published'
      and g.sex = participant_sex
      and (
        select count(*)
        from public.participants gp
        join public.check_ins ci
          on ci.session_id = gp.session_id
         and ci.participant_id = gp.id
         and ci.status = 'arrived'
        where gp.session_id = p_session_id
          and gp.group_id = g.id
          and gp.id <> p_participant_id
      ) < max_size
    order by
      (
        select count(*)
        from public.participants gp
        join public.check_ins ci
          on ci.session_id = gp.session_id
         and ci.participant_id = gp.id
         and ci.status = 'arrived'
        where gp.session_id = p_session_id
          and gp.group_id = g.id
          and gp.id <> p_participant_id
      ),
      coalesce(g.operational_number, 9999),
      g.name,
      g.id
    limit 1;
  end if;

  -- Otherwise use first-come live balancing: the least occupied company that
  -- has a compatible group, then its least occupied compatible group.
  if target_group is null then
    select g.id into target_group
    from public.counselor_groups g
    join public.companies c
      on c.id = g.company_id and c.session_id = g.session_id
    where g.session_id = p_session_id
      and g.state = 'published'
      and g.sex = participant_sex
      and (
        select count(*)
        from public.participants gp
        join public.check_ins ci
          on ci.session_id = gp.session_id
         and ci.participant_id = gp.id
         and ci.status = 'arrived'
        where gp.session_id = p_session_id
          and gp.group_id = g.id
          and gp.id <> p_participant_id
      ) < max_size
    order by
      (
        select count(*)
        from public.participants cp
        join public.counselor_groups cg
          on cg.id = cp.group_id and cg.company_id = g.company_id
        join public.check_ins ci
          on ci.session_id = cp.session_id
         and ci.participant_id = cp.id
         and ci.status = 'arrived'
        where cp.session_id = p_session_id
          and cp.id <> p_participant_id
      ),
      (
        select count(*)
        from public.participants gp
        join public.check_ins ci
          on ci.session_id = gp.session_id
         and ci.participant_id = gp.id
         and ci.status = 'arrived'
        where gp.session_id = p_session_id
          and gp.group_id = g.id
          and gp.id <> p_participant_id
      ),
      coalesce(c.operational_number, 9999),
      c.name,
      coalesce(g.operational_number, 9999),
      g.name,
      g.id
    limit 1;
  end if;

  if target_group is null then
    raise exception 'No same-sex counselor group has a live place. Review the ground roster before checking in another participant';
  end if;

  if target_group is distinct from current_group then
    update public.participants
    set group_id = target_group,
        attendance_status = 'expected',
        updated_at = now()
    where id = p_participant_id and session_id = p_session_id;

    insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
    values (
      p_session_id,
      auth.uid(),
      'participant_rebalanced_at_arrival',
      'participant',
      p_participant_id::text,
      jsonb_build_object(
        'previous_group_id', current_group,
        'group_id', target_group,
        'source', 'participant_ground_roster_v72',
        'capacity_basis', 'arrived_participants'
      )
    );
  end if;

  return target_group;
end;
$$;

create or replace function public.get_participant_ground_roster_v1(p_session_id uuid)
returns table(
  company_id uuid,
  company_name text,
  company_custom_name text,
  company_number integer,
  group_id uuid,
  group_name text,
  group_custom_name text,
  group_number integer,
  sex public.participant_sex,
  state text,
  arrived_count integer,
  roster_count integer,
  max_size integer,
  counselor_id uuid,
  counselor_name text,
  counselor_arrived boolean,
  arrived_assistant_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.name,
    c.custom_name,
    c.operational_number,
    g.id,
    g.name,
    g.custom_name,
    g.operational_number,
    g.sex,
    g.state,
    count(p.id) filter (
      where p.is_current
        and ci.status = 'arrived'
    )::integer as arrived_count,
    count(p.id) filter (
      where p.is_current
        and coalesce(p.operational_status, 'active') = 'active'
        and p.attendance_status <> 'confirmed_not_attending'
    )::integer as roster_count,
    coalesce(ss.group_max_size, 15)::integer,
    g.counselor_id,
    st.full_name,
    coalesce(so.arrival_state = 'arrived', false),
    (
      select count(*)::integer
      from public.staff_company_assignments sca
      join public.staff s2 on s2.id = sca.staff_id and s2.session_id = sca.session_id
      join public.staff_operations so2 on so2.staff_id = s2.id
      where sca.session_id = p_session_id
        and sca.company_id = c.id
        and s2.is_current
        and s2.operational_role = 'assistant_coordinator'
        and so2.arrival_state = 'arrived'
    )
  from public.counselor_groups g
  join public.companies c
    on c.id = g.company_id and c.session_id = g.session_id
  left join public.participants p
    on p.group_id = g.id and p.session_id = g.session_id
  left join public.check_ins ci
    on ci.session_id = p.session_id
   and ci.participant_id = p.id
  left join public.staff st
    on st.id = g.counselor_id and st.session_id = g.session_id
  left join public.staff_operations so
    on so.staff_id = st.id
  left join public.session_structure_settings ss
    on ss.session_id = g.session_id
  where g.session_id = p_session_id
    and (
      private.has_capability(p_session_id, 'registration_view')
      or private.has_capability(p_session_id, 'registration_manage')
      or private.has_capability(p_session_id, 'checkin_record')
      or private.has_session_role(
        p_session_id,
        array['coordinator','logistics_admin','session_director','area_advisory_couple']::public.app_role[]
      )
    )
  group by
    c.id,
    g.id,
    ss.group_max_size,
    st.id,
    so.arrival_state
  order by
    coalesce(c.operational_number, 9999),
    c.name,
    coalesce(g.operational_number, 9999),
    g.name;
$$;

create or replace function public.check_in_participant_on_ground_v1(
  p_session_id uuid,
  p_participant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.participants%rowtype;
  target_group public.counselor_groups%rowtype;
  target_company public.companies%rowtype;
  min_age integer := 12;
  max_age integer := 18;
  calculated_age integer;
  checkin_at timestamptz := now();
  membership_created boolean := false;
  active_fsy_id text;
begin
  if not (
    private.has_capability(p_session_id, 'registration_manage')
    or private.has_session_role(
      p_session_id,
      array['coordinator','logistics_admin','session_director','area_advisory_couple']::public.app_role[]
    )
  ) then
    raise exception 'Registration management access required';
  end if;

  select * into target
  from public.participants
  where id = p_participant_id and session_id = p_session_id
  for update;

  if target.id is null then
    raise exception 'Participant not found in this session';
  end if;
  if not target.is_current then
    raise exception 'This is an older participant record. Use the current record instead';
  end if;
  if target.registration_status = 'cancelled' then
    raise exception 'This registration is cancelled. Review it before recording an on-ground arrival';
  end if;
  if coalesce(target.operational_status, 'active') = 'withdrawn' then
    raise exception 'This participant was withdrawn. A coordinator must review the record before arrival';
  end if;

  select
    coalesce(ss.participant_min_age, 12),
    coalesce(ss.participant_max_age, 18)
    into min_age, max_age
  from public.session_structure_settings ss
  where ss.session_id = p_session_id;
  min_age := coalesce(min_age, 12);
  max_age := coalesce(max_age, 18);
  calculated_age := private.session_participant_age(p_session_id, p_participant_id);

  if calculated_age is null or calculated_age not between min_age and max_age then
    raise exception 'This participant is outside the active youth age range of %-% for this session', min_age, max_age;
  end if;

  -- Physical presence is enough for the operational desk to finish local
  -- verification. Source approval/payment history is not rewritten here.
  update public.participants
  set verification_status = 'verified',
      attendance_status = 'expected',
      operational_status = 'active',
      updated_at = now()
  where id = p_participant_id and session_id = p_session_id;

  perform private.assign_arriving_participant_to_ready_group_v1(p_session_id, p_participant_id);

  select g.* into target_group
  from public.participants p
  join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id
  where p.id = p_participant_id and p.session_id = p_session_id;

  select c.* into target_company
  from public.companies c
  where c.id = target_group.company_id and c.session_id = p_session_id;

  if not exists (
    select 1
    from public.participant_membership_profiles m
    where m.participant_id = p_participant_id and m.session_id = p_session_id
  ) then
    insert into public.participant_membership_profiles(
      participant_id, session_id, membership_status, recorded_by, recorded_at, updated_at
    ) values (
      p_participant_id, p_session_id, 'not_sure', auth.uid(), checkin_at, checkin_at
    );
    membership_created := true;
  end if;

  if target.source_kind = 'on_site' then
    active_fsy_id := private.ensure_on_site_fsy_id(p_participant_id, auth.uid());
  else
    select b.fsy_id into active_fsy_id
    from public.participant_badge_assignments b
    where b.session_id = p_session_id
      and b.participant_id = p_participant_id
      and b.state <> 'retired'
    order by b.assigned_at desc
    limit 1;
  end if;

  insert into public.check_ins(session_id, participant_id, status, note, recorded_by, recorded_at)
  values (
    p_session_id,
    p_participant_id,
    'arrived'::public.check_in_status,
    'On-ground arrival',
    auth.uid(),
    checkin_at
  )
  on conflict (session_id, participant_id) do update set
    status = excluded.status,
    note = excluded.note,
    recorded_by = excluded.recorded_by,
    recorded_at = excluded.recorded_at;

  if membership_created then
    update public.participant_membership_profiles
    set created_checkin_recorded_at = checkin_at,
        updated_at = checkin_at
    where participant_id = p_participant_id and session_id = p_session_id;
  end if;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_session_id,
    auth.uid(),
    'participant_ground_checkin',
    'participant',
    p_participant_id::text,
    jsonb_build_object(
      'group_id', target_group.id,
      'company_id', target_company.id,
      'membership_created_as_not_sure', membership_created,
      'registration_status_preserved', target.registration_status,
      'source_kind', target.source_kind
    )
  );

  return jsonb_build_object(
    'participant_id', p_participant_id,
    'group_id', target_group.id,
    'group_name', coalesce(target_group.custom_name, target_group.name),
    'company_id', target_company.id,
    'company_name', coalesce(target_company.custom_name, target_company.name),
    'fsy_id', active_fsy_id,
    'recorded_at', checkin_at,
    'paperwork_follow_up', target.registration_status <> 'approved'
  );
end;
$$;

create or replace function public.add_on_site_ground_participant_v1(
  p_session_id uuid,
  p_first_name text,
  p_last_name text,
  p_preferred_name text,
  p_sex public.participant_sex,
  p_date_of_birth date,
  p_unit_name text,
  p_stake_name text,
  p_phone text default null,
  p_contact_1_name text default null,
  p_contact_1_phone text default null,
  p_tshirt_size text default null,
  p_medical_information text default null,
  p_dietary_information text default null,
  p_search_confirmed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_id uuid := extensions.gen_random_uuid();
  session_start date;
  calculated_age integer;
  min_age integer := 12;
  max_age integer := 18;
  canonical_size text;
  target_group public.counselor_groups%rowtype;
  target_company public.companies%rowtype;
  next_fsy_id text;
  checkin_at timestamptz := now();
begin
  if not (
    private.has_capability(p_session_id, 'registration_manage')
    or private.has_session_role(
      p_session_id,
      array['coordinator','logistics_admin','session_director','area_advisory_couple']::public.app_role[]
    )
  ) then
    raise exception 'Registration management access required';
  end if;

  if not p_search_confirmed then
    raise exception 'Search the existing participant list before adding someone';
  end if;

  select s.starts_on into session_start
  from public.sessions s
  where s.id = p_session_id;
  if session_start is null then
    raise exception 'Session start date is required';
  end if;
  if p_date_of_birth is null or p_date_of_birth > session_start then
    raise exception 'Enter a valid date of birth';
  end if;

  select
    coalesce(ss.participant_min_age, 12),
    coalesce(ss.participant_max_age, 18)
    into min_age, max_age
  from public.session_structure_settings ss
  where ss.session_id = p_session_id;
  min_age := coalesce(min_age, 12);
  max_age := coalesce(max_age, 18);
  calculated_age := extract(year from age(session_start, p_date_of_birth))::integer;

  if nullif(trim(coalesce(p_first_name, '')), '') is null
     or nullif(trim(coalesce(p_last_name, '')), '') is null
     or p_sex is null
     or nullif(trim(coalesce(p_unit_name, '')), '') is null
     or nullif(trim(coalesce(p_stake_name, '')), '') is null then
    raise exception 'First name, last name, date of birth, sex, ward or branch, and stake or district are required';
  end if;
  if calculated_age not between min_age and max_age then
    raise exception 'This participant is outside the active youth age range of %-% for this session', min_age, max_age;
  end if;
  if nullif(trim(coalesce(p_contact_1_phone, '')), '') is null then
    raise exception 'Add a parent or guardian phone number';
  end if;

  if nullif(trim(coalesce(p_tshirt_size, '')), '') is not null then
    canonical_size := case lower(trim(p_tshirt_size))
      when 'small' then 'Small'
      when 'medium' then 'Medium'
      when 'large' then 'Large'
      when 'extra large' then 'Extra Large'
      when 'extra extra large' then 'Extra Extra Large'
      else null
    end;
    if canonical_size is null then
      raise exception 'Choose a T-shirt size from Small, Medium, Large, Extra Large, or Extra Extra Large';
    end if;
  end if;

  if exists (
    select 1
    from public.participants participant
    join public.participant_private_details details
      on details.participant_id = participant.id
    where participant.session_id = p_session_id
      and lower(trim(coalesce(participant.first_name, ''))) = lower(trim(p_first_name))
      and lower(trim(coalesce(participant.last_name, ''))) = lower(trim(p_last_name))
      and details.date_of_birth = p_date_of_birth
  ) then
    raise exception 'This participant already has a session record. Search again and use the existing record';
  end if;

  insert into public.participants(
    id,
    session_id,
    registration_id,
    first_name,
    last_name,
    preferred_name,
    sex,
    age,
    unit_name,
    stake_name,
    source_kind,
    registration_status,
    verification_status,
    is_current,
    reconciliation_status,
    attendance_status,
    operational_status
  ) values (
    next_id,
    p_session_id,
    'ONSITE-' || upper(substr(replace(next_id::text, '-', ''), 1, 12)),
    trim(p_first_name),
    trim(p_last_name),
    nullif(trim(coalesce(p_preferred_name, '')), ''),
    p_sex,
    calculated_age,
    trim(p_unit_name),
    trim(p_stake_name),
    'on_site',
    'awaiting',
    'verified',
    true,
    'current',
    'expected',
    'active'
  );

  insert into public.participant_private_details(
    participant_id,
    session_id,
    date_of_birth,
    phone,
    contact_1_name,
    contact_1_phone,
    tshirt_size,
    medical_information,
    dietary_information,
    updated_at
  ) values (
    next_id,
    p_session_id,
    p_date_of_birth,
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_contact_1_name, '')), ''),
    trim(p_contact_1_phone),
    canonical_size,
    nullif(trim(coalesce(p_medical_information, '')), ''),
    nullif(trim(coalesce(p_dietary_information, '')), ''),
    checkin_at
  );

  insert into public.participant_membership_profiles(
    participant_id,
    session_id,
    membership_status,
    recorded_by,
    recorded_at,
    updated_at
  ) values (
    next_id,
    p_session_id,
    'not_sure',
    auth.uid(),
    checkin_at,
    checkin_at
  );

  perform private.assign_arriving_participant_to_ready_group_v1(p_session_id, next_id);

  select g.* into target_group
  from public.participants p
  join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id
  where p.id = next_id;

  select c.* into target_company
  from public.companies c
  where c.id = target_group.company_id and c.session_id = p_session_id;

  next_fsy_id := private.ensure_on_site_fsy_id(next_id, auth.uid());

  insert into public.check_ins(session_id, participant_id, status, note, recorded_by, recorded_at)
  values (
    p_session_id,
    next_id,
    'arrived'::public.check_in_status,
    'Added on site and checked in from ground roster',
    auth.uid(),
    checkin_at
  );

  update public.participant_membership_profiles
  set created_checkin_recorded_at = checkin_at,
      updated_at = checkin_at
  where participant_id = next_id and session_id = p_session_id;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_session_id,
    auth.uid(),
    'on_site_ground_participant_added',
    'participant',
    next_id::text,
    jsonb_build_object(
      'group_id', target_group.id,
      'company_id', target_company.id,
      'fsy_id', next_fsy_id,
      'registration_status', 'awaiting',
      'paperwork_follow_up', true,
      'membership_status', 'not_sure',
      'workflow', 'participant_ground_roster_v72'
    )
  );

  return jsonb_build_object(
    'participant_id', next_id,
    'group_id', target_group.id,
    'group_name', coalesce(target_group.custom_name, target_group.name),
    'company_id', target_company.id,
    'company_name', coalesce(target_company.custom_name, target_company.name),
    'fsy_id', next_fsy_id,
    'recorded_at', checkin_at,
    'paperwork_follow_up', true
  );
end;
$$;

create or replace function public.move_ground_participant_v1(
  p_participant_id uuid,
  p_group_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.participants%rowtype;
  destination public.counselor_groups%rowtype;
  destination_company public.companies%rowtype;
  previous_group uuid;
  max_size integer := 15;
  active_fsy_id text;
begin
  select * into target
  from public.participants
  where id = p_participant_id
  for update;

  select * into destination
  from public.counselor_groups
  where id = p_group_id
  for update;

  if target.id is null or destination.id is null or target.session_id <> destination.session_id then
    raise exception 'Participant and group must belong to the same session';
  end if;
  if not (
    private.has_capability(target.session_id, 'registration_manage')
    or private.has_session_role(
      target.session_id,
      array['coordinator','logistics_admin','session_director','area_advisory_couple']::public.app_role[]
    )
  ) then
    raise exception 'Registration management access required';
  end if;
  if destination.state <> 'published' then
    raise exception 'Choose a published counselor group';
  end if;
  if destination.sex <> target.sex then
    raise exception 'Choose a counselor group for the participant sex';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('fsy-participant-ground:' || target.session_id::text, 0));

  select coalesce(ss.group_max_size, 15) into max_size
  from public.session_structure_settings ss
  where ss.session_id = target.session_id;
  max_size := coalesce(max_size, 15);

  if exists (
    select 1 from public.check_ins ci
    where ci.session_id = target.session_id
      and ci.participant_id = target.id
      and ci.status = 'arrived'
  ) and (
    select count(*)
    from public.participants p
    join public.check_ins ci
      on ci.session_id = p.session_id
     and ci.participant_id = p.id
     and ci.status = 'arrived'
    where p.session_id = target.session_id
      and p.group_id = destination.id
      and p.id <> target.id
  ) >= max_size then
    raise exception 'That counselor group already has % participants on ground', max_size;
  end if;

  previous_group := target.group_id;

  update public.participants
  set group_id = destination.id,
      updated_at = now()
  where id = target.id;

  if target.source_kind = 'on_site' then
    active_fsy_id := private.ensure_on_site_fsy_id(target.id, auth.uid());
  else
    select b.fsy_id into active_fsy_id
    from public.participant_badge_assignments b
    where b.session_id = target.session_id
      and b.participant_id = target.id
      and b.state <> 'retired'
    order by b.assigned_at desc
    limit 1;
  end if;

  select * into destination_company
  from public.companies
  where id = destination.company_id and session_id = target.session_id;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target.session_id,
    auth.uid(),
    'participant_ground_group_changed',
    'participant',
    target.id::text,
    jsonb_build_object(
      'previous_group_id', previous_group,
      'group_id', destination.id,
      'company_id', destination.company_id,
      'capacity_basis', 'arrived_participants'
    )
  );

  return jsonb_build_object(
    'participant_id', target.id,
    'group_id', destination.id,
    'group_name', coalesce(destination.custom_name, destination.name),
    'company_id', destination.company_id,
    'company_name', coalesce(destination_company.custom_name, destination_company.name),
    'fsy_id', active_fsy_id
  );
end;
$$;

revoke all on function public.get_participant_ground_roster_v1(uuid) from public, anon;
revoke all on function public.check_in_participant_on_ground_v1(uuid,uuid) from public, anon;
revoke all on function public.add_on_site_ground_participant_v1(uuid,text,text,text,public.participant_sex,date,text,text,text,text,text,text,text,text,boolean) from public, anon;
revoke all on function public.move_ground_participant_v1(uuid,uuid) from public, anon;

grant execute on function public.get_participant_ground_roster_v1(uuid) to authenticated;
grant execute on function public.check_in_participant_on_ground_v1(uuid,uuid) to authenticated;
grant execute on function public.add_on_site_ground_participant_v1(uuid,text,text,text,public.participant_sex,date,text,text,text,text,text,text,text,text,boolean) to authenticated;
grant execute on function public.move_ground_participant_v1(uuid,uuid) to authenticated;
