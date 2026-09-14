-- Day-of ground roster operations v65.
-- The on-ground roster is authoritative for operational readiness without rewriting
-- source registration history. Staff who are physically present become ready to
-- serve, and participant arrival can be rebalanced into staffed companies safely.

create or replace function private.normalize_ghana_phone_v1(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  with cleaned as (
    select regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g') as digits
  )
  select case
    when digits ~ '^233[0-9]{9}$' then '0' || right(digits, 9)
    when digits ~ '^[0-9]{9}$' then '0' || digits
    when digits ~ '^0[0-9]{9}$' then digits
    else digits
  end
  from cleaned;
$$;

create or replace function private.normalize_person_name_v1(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]+', ' ', 'g'));
$$;

create or replace function private.person_name_token_key_v1(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(string_agg(token, ' ' order by token), '')
  from (
    select distinct token
    from regexp_split_to_table(private.normalize_person_name_v1(p_value), '\s+') as token
    where length(token) > 1
  ) q;
$$;

create or replace function private.company_number_v1(p_name text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(substring(coalesce(p_name, '') from '([0-9]+)'), '')::integer, 999999);
$$;

-- Day-of readiness is operational. The preserved source approval value remains
-- useful history, but it must not make a ground-roster staff member unavailable.
create or replace function private.staff_can_plan(target_staff uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.staff s
    join public.staff_operations o on o.staff_id = s.id
    where s.id = target_staff
      and s.is_current
      and o.planning_state <> 'excluded'
      and o.service_clearance <> 'not_cleared'
      and o.arrival_state not in ('no_show', 'left')
  );
$$;

create or replace function private.place_ready_staff_if_open_v1(p_staff_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.staff%rowtype;
  target_group uuid;
  target_company uuid;
  current_company uuid;
  ready_group_count integer;
begin
  select * into target
  from public.staff
  where id = p_staff_id
  for update;

  if target.id is null then
    raise exception 'Staff member not found';
  end if;

  -- Serialize automatic placement for every staff arrival in a session. In
  -- particular, this prevents two Assistant Coordinators from selecting the
  -- same unassigned company before either insert becomes visible.
  perform pg_advisory_xact_lock(hashtextextended('fsy-staff-placement:' || target.session_id::text, 0));

  if target.operational_role = 'counselor' then
    select g.company_id into current_company
    from public.counselor_groups g
    where g.session_id = target.session_id and g.counselor_id = target.id
    limit 1;

    if current_company is not null then
      return jsonb_build_object('staff_id', target.id, 'company_id', current_company, 'placed', false, 'reason', 'already_assigned');
    end if;

    if target.sex is null then
      return jsonb_build_object('staff_id', target.id, 'placed', false, 'reason', 'sex_required');
    end if;

    select g.id, g.company_id into target_group, target_company
    from public.counselor_groups g
    join public.companies c on c.id = g.company_id and c.session_id = g.session_id
    where g.session_id = target.session_id
      and g.state = 'published'
      and g.counselor_id is null
      and g.sex = target.sex
      and (
        select count(*)
        from public.counselor_groups gx
        join public.staff_operations ox on ox.staff_id = gx.counselor_id
        where gx.session_id = g.session_id
          and gx.company_id = g.company_id
          and ox.planning_state = 'primary'
          and ox.arrival_state = 'arrived'
          and ox.service_clearance = 'cleared'
      ) < 3
    order by
      case when exists (
        select 1
        from public.staff_company_assignments sca
        join public.staff_operations ao on ao.staff_id = sca.staff_id
        where sca.session_id = g.session_id
          and sca.company_id = g.company_id
          and ao.planning_state = 'primary'
          and ao.arrival_state = 'arrived'
          and ao.service_clearance = 'cleared'
      ) then 0 else 1 end,
      case when (
        select count(*)
        from public.counselor_groups gx
        join public.staff_operations ox on ox.staff_id = gx.counselor_id
        where gx.session_id = g.session_id
          and gx.company_id = g.company_id
          and ox.planning_state = 'primary'
          and ox.arrival_state = 'arrived'
          and ox.service_clearance = 'cleared'
      ) between 1 and 2 then 0 else 1 end,
      private.company_number_v1(c.name), c.name, g.name, g.id
    limit 1
    for update of g;

    if target_group is null then
      return jsonb_build_object('staff_id', target.id, 'placed', false, 'reason', 'no_open_group');
    end if;

    update public.counselor_groups
    set counselor_id = target.id
    where id = target_group and counselor_id is null;

    if not found then
      return jsonb_build_object('staff_id', target.id, 'placed', false, 'reason', 'slot_changed');
    end if;

    update public.staff set assigned_company_id = target_company where id = target.id;

    insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
    values (target.session_id, auth.uid(), 'staff_auto_placed_day_of', 'staff', target.id::text,
      jsonb_build_object('role', 'counselor', 'company_id', target_company, 'group_id', target_group));

    return jsonb_build_object('staff_id', target.id, 'company_id', target_company, 'group_id', target_group, 'placed', true);
  end if;

  if target.operational_role = 'assistant_coordinator' then
    select sca.company_id into current_company
    from public.staff_company_assignments sca
    where sca.session_id = target.session_id and sca.staff_id = target.id
    order by sca.assigned_at
    limit 1;

    if current_company is not null then
      return jsonb_build_object('staff_id', target.id, 'company_id', current_company, 'placed', false, 'reason', 'already_assigned');
    end if;

    select c.id into target_company
    from public.companies c
    where c.session_id = target.session_id
      and not exists (
        select 1 from public.staff_company_assignments sca
        where sca.session_id = c.session_id and sca.company_id = c.id
      )
      and (
        select count(*)
        from public.counselor_groups gx
        join public.staff_operations ox on ox.staff_id = gx.counselor_id
        where gx.session_id = c.session_id
          and gx.company_id = c.id
          and ox.planning_state = 'primary'
          and ox.arrival_state = 'arrived'
          and ox.service_clearance = 'cleared'
      ) <= 3
    order by
      case when (
        select count(*)
        from public.counselor_groups gx
        join public.staff_operations ox on ox.staff_id = gx.counselor_id
        where gx.session_id = c.session_id
          and gx.company_id = c.id
          and ox.planning_state = 'primary'
          and ox.arrival_state = 'arrived'
          and ox.service_clearance = 'cleared'
      ) > 0 then 0 else 1 end,
      private.company_number_v1(c.name), c.name, c.id
    limit 1;

    if target_company is null then
      return jsonb_build_object('staff_id', target.id, 'placed', false, 'reason', 'no_open_company');
    end if;

    insert into public.staff_company_assignments(session_id, staff_id, company_id, assignment_role, assigned_by)
    values (target.session_id, target.id, target_company, 'assistant_coordinator', auth.uid())
    on conflict (staff_id, company_id) do nothing;

    update public.staff set assigned_company_id = target_company where id = target.id;

    insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
    values (target.session_id, auth.uid(), 'staff_auto_placed_day_of', 'staff', target.id::text,
      jsonb_build_object('role', 'assistant_coordinator', 'company_id', target_company));

    return jsonb_build_object('staff_id', target.id, 'company_id', target_company, 'placed', true);
  end if;

  return jsonb_build_object('staff_id', target.id, 'placed', false, 'reason', 'role_not_placed');
end;
$$;

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
  target_group uuid;
  max_size integer := 15;
  current_valid boolean := false;
  caller_is_assistant boolean := false;
  current_company uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('fsy-arrival:' || p_session_id::text, 0));

  select p.sex, p.group_id into participant_sex, current_group
  from public.participants p
  where p.id = p_participant_id and p.session_id = p_session_id
  for update;

  if not found then
    raise exception 'Participant not found in this session';
  end if;

  caller_is_assistant := private.has_session_role(
    p_session_id,
    array['assistant_coordinator']::public.app_role[]
  );
  if caller_is_assistant and current_group is not null then
    select g.company_id into current_company
    from public.counselor_groups g
    where g.id = current_group and g.session_id = p_session_id;
  end if;

  select coalesce(s.group_max_size, 15) into max_size
  from public.session_structure_settings s
  where s.session_id = p_session_id;
  max_size := coalesce(max_size, 15);

  -- Before a ground staff roster is in use, preserve the existing placement behavior.
  if not exists (
    select 1
    from public.counselor_groups g
    join public.staff_operations o on o.staff_id = g.counselor_id
    join public.staff_company_assignments sca on sca.session_id = g.session_id and sca.company_id = g.company_id
    join public.staff_operations ao on ao.staff_id = sca.staff_id
    where g.session_id = p_session_id
      and g.state = 'published'
      and o.planning_state = 'primary' and o.arrival_state = 'arrived' and o.service_clearance = 'cleared'
      and ao.planning_state = 'primary' and ao.arrival_state = 'arrived' and ao.service_clearance = 'cleared'
  ) then
    return current_group;
  end if;

  if current_group is not null then
    select exists (
      select 1
      from public.counselor_groups g
      join public.staff_operations o on o.staff_id = g.counselor_id
      where g.id = current_group
        and g.session_id = p_session_id
        and g.state = 'published'
        and g.sex = participant_sex
        and o.planning_state = 'primary'
        and o.arrival_state = 'arrived'
        and o.service_clearance = 'cleared'
        and exists (
          select 1
          from public.staff_company_assignments sca
          join public.staff_operations ao on ao.staff_id = sca.staff_id
          where sca.session_id = g.session_id
            and sca.company_id = g.company_id
            and ao.planning_state = 'primary'
            and ao.arrival_state = 'arrived'
            and ao.service_clearance = 'cleared'
        )
        and (
          not caller_is_assistant
          or (
            g.company_id = current_company
            and private.can_access_company(p_session_id, g.company_id)
          )
        )
        and (
          select count(*)
          from public.participants gp
          join public.check_ins ci on ci.session_id = gp.session_id and ci.participant_id = gp.id and ci.status = 'arrived'
          where gp.session_id = p_session_id
            and gp.group_id = g.id
            and gp.id <> p_participant_id
        ) < max_size
    ) into current_valid;

    if current_valid then
      return current_group;
    end if;
  end if;

  select g.id into target_group
  from public.counselor_groups g
  join public.companies c on c.id = g.company_id and c.session_id = g.session_id
  join public.staff_operations o on o.staff_id = g.counselor_id
  where g.session_id = p_session_id
    and g.state = 'published'
    and g.sex = participant_sex
    and o.planning_state = 'primary'
    and o.arrival_state = 'arrived'
    and o.service_clearance = 'cleared'
    and exists (
      select 1
      from public.staff_company_assignments sca
      join public.staff_operations ao on ao.staff_id = sca.staff_id
      where sca.session_id = g.session_id
        and sca.company_id = g.company_id
        and ao.planning_state = 'primary'
        and ao.arrival_state = 'arrived'
        and ao.service_clearance = 'cleared'
    )
    and (
      not caller_is_assistant
      or (
        g.company_id = current_company
        and private.can_access_company(p_session_id, g.company_id)
      )
    )
    and (
      select count(*)
      from public.participants gp
      join public.check_ins ci on ci.session_id = gp.session_id and ci.participant_id = gp.id and ci.status = 'arrived'
      where gp.session_id = p_session_id
        and gp.group_id = g.id
        and gp.id <> p_participant_id
    ) < max_size
  order by
    (
      select count(*)
      from public.participants cp
      join public.counselor_groups cg on cg.id = cp.group_id and cg.company_id = g.company_id
      join public.check_ins ci on ci.session_id = cp.session_id and ci.participant_id = cp.id and ci.status = 'arrived'
      where cp.session_id = p_session_id and cp.id <> p_participant_id
    ),
    (
      select count(*)
      from public.participants gp
      join public.check_ins ci on ci.session_id = gp.session_id and ci.participant_id = gp.id and ci.status = 'arrived'
      where gp.session_id = p_session_id and gp.group_id = g.id and gp.id <> p_participant_id
    ),
    private.company_number_v1(c.name), c.name, g.name, g.id
  limit 1;

  if target_group is null then
    raise exception 'No staffed counselor group has space for this participant. Add or assign another counselor, then try again.';
  end if;

  if target_group is distinct from current_group then
    update public.participants
    set group_id = target_group
    where id = p_participant_id and session_id = p_session_id;

    insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
    values (p_session_id, auth.uid(), 'participant_rebalanced_at_arrival', 'participant', p_participant_id::text,
      jsonb_build_object('previous_group_id', current_group, 'group_id', target_group, 'source', 'day_of_ground_roster'));
  end if;

  return target_group;
end;
$$;

create or replace function public.apply_day_of_staff_roster_v1(
  p_session_id uuid,
  p_rows jsonb,
  p_source_label text default 'Day-of ground roster'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_record record;
  matched_id uuid;
  candidate_ids uuid[];
  new_id uuid;
  expected_ac_count integer;
  expected_counselor_count integer;
  assigned_ac_count integer;
  assigned_counselor_count integer;
  created_count integer := 0;
  matched_count integer := 0;
begin
  if auth.uid() is not null and not (
    private.has_session_role(p_session_id, array['coordinator','logistics_admin','session_director']::public.app_role[])
    or private.has_capability(p_session_id, 'staff_manage')
  ) then
    raise exception 'Staff management access is required';
  end if;

  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Roster rows are required';
  end if;

  create temporary table if not exists pg_temp.tmp_ground_roster_v65(
    team_no integer,
    slot_no integer,
    roster_role text,
    full_name text,
    phone text,
    sex public.participant_sex,
    explicit_staff_id uuid
  ) on commit drop;
  truncate pg_temp.tmp_ground_roster_v65;

  create temporary table if not exists pg_temp.tmp_ground_resolved_v65(
    team_no integer,
    slot_no integer,
    roster_role text,
    full_name text,
    phone text,
    sex public.participant_sex,
    staff_id uuid primary key,
    created_new boolean default false
  ) on commit drop;
  truncate pg_temp.tmp_ground_resolved_v65;

  insert into pg_temp.tmp_ground_roster_v65(team_no, slot_no, roster_role, full_name, phone, sex, explicit_staff_id)
  select
    (item->>'team_no')::integer,
    (item->>'slot_no')::integer,
    lower(trim(item->>'roster_role')),
    trim(item->>'full_name'),
    nullif(trim(coalesce(item->>'phone','')), ''),
    case
      when lower(trim(coalesce(item->>'sex',''))) in ('m','male') then 'male'::public.participant_sex
      when lower(trim(coalesce(item->>'sex',''))) in ('f','female') then 'female'::public.participant_sex
      else null
    end,
    nullif(item->>'staff_id','')::uuid
  from jsonb_array_elements(p_rows) item;

  if exists (
    select 1 from pg_temp.tmp_ground_roster_v65
    where team_no is null or team_no < 1
      or slot_no is null or slot_no < 0
      or roster_role not in ('assistant_coordinator','counselor')
      or nullif(full_name,'') is null
      or (roster_role = 'counselor' and sex is null)
  ) then
    raise exception 'Every roster row needs a team number, slot, supported role, name, and counselor sex';
  end if;

  if exists (
    select team_no, slot_no from pg_temp.tmp_ground_roster_v65 group by team_no, slot_no having count(*) > 1
  ) then
    raise exception 'A roster team slot appears more than once';
  end if;

  for row_record in
    select * from pg_temp.tmp_ground_roster_v65 order by team_no, slot_no
  loop
    matched_id := null;
    candidate_ids := null;

    if row_record.explicit_staff_id is not null then
      select s.id into matched_id
      from public.staff s
      where s.id = row_record.explicit_staff_id and s.session_id = p_session_id;
      if matched_id is null then
        raise exception 'A supplied staff ID does not belong to this session';
      end if;
      if exists (select 1 from pg_temp.tmp_ground_resolved_v65 r where r.staff_id = matched_id) then
        raise exception 'The same staff record was supplied for more than one roster position';
      end if;
    end if;

    if matched_id is null and nullif(private.normalize_ghana_phone_v1(row_record.phone),'') is not null then
      select array_agg(distinct s.id) into candidate_ids
      from public.staff s
      left join public.staff_private_details d on d.staff_id = s.id
      where s.session_id = p_session_id
        and not exists (select 1 from pg_temp.tmp_ground_resolved_v65 r where r.staff_id = s.id)
        and private.normalize_ghana_phone_v1(coalesce(d.phone, s.phone)) = private.normalize_ghana_phone_v1(row_record.phone);
      if coalesce(array_length(candidate_ids,1),0) = 1 then matched_id := candidate_ids[1]; end if;
    end if;

    if matched_id is null then
      candidate_ids := null;
      select array_agg(s.id) into candidate_ids
      from public.staff s
      where s.session_id = p_session_id
        and not exists (select 1 from pg_temp.tmp_ground_resolved_v65 r where r.staff_id = s.id)
        and private.normalize_person_name_v1(s.full_name) = private.normalize_person_name_v1(row_record.full_name);
      if coalesce(array_length(candidate_ids,1),0) = 1 then matched_id := candidate_ids[1]; end if;
    end if;

    if matched_id is null then
      candidate_ids := null;
      select array_agg(s.id) into candidate_ids
      from public.staff s
      where s.session_id = p_session_id
        and not exists (select 1 from pg_temp.tmp_ground_resolved_v65 r where r.staff_id = s.id)
        and private.person_name_token_key_v1(s.full_name) = private.person_name_token_key_v1(row_record.full_name);
      if coalesce(array_length(candidate_ids,1),0) = 1 then matched_id := candidate_ids[1]; end if;
    end if;

    if matched_id is null then
      new_id := extensions.gen_random_uuid();
      insert into public.staff(
        id, session_id, full_name, phone, staff_role, first_name, last_name, sex,
        registration_status, is_current, operational_role, source_kind
      ) values (
        new_id,
        p_session_id,
        row_record.full_name,
        row_record.phone,
        case when row_record.roster_role = 'assistant_coordinator' then 'Assistant Coordinator' else 'Counselor' end,
        split_part(row_record.full_name, ' ', 1),
        nullif(trim(substr(row_record.full_name, length(split_part(row_record.full_name, ' ', 1)) + 1)), ''),
        row_record.sex,
        'awaiting',
        true,
        row_record.roster_role,
        'on_site'
      );
      insert into public.staff_private_details(staff_id, session_id, phone, updated_at)
      values (new_id, p_session_id, row_record.phone, now())
      on conflict (staff_id) do update set phone = coalesce(public.staff_private_details.phone, excluded.phone), updated_at = now();
      matched_id := new_id;
      created_count := created_count + 1;
    else
      matched_count := matched_count + 1;
      update public.staff
      set is_current = true,
          operational_role = row_record.roster_role,
          staff_role = case when row_record.roster_role = 'assistant_coordinator' then 'Assistant Coordinator' else 'Counselor' end,
          sex = coalesce(row_record.sex, sex),
          phone = coalesce(phone, row_record.phone)
      where id = matched_id;
      if row_record.phone is not null then
        insert into public.staff_private_details(staff_id, session_id, phone, updated_at)
        values (matched_id, p_session_id, row_record.phone, now())
        on conflict (staff_id) do update
        set phone = coalesce(public.staff_private_details.phone, excluded.phone), updated_at = now();
      end if;
    end if;

    insert into public.staff_operations(staff_id, planning_state, arrival_state, service_clearance, revision, updated_by, updated_at)
    values (matched_id, 'primary', 'arrived', 'cleared', 1, auth.uid(), now())
    on conflict (staff_id) do update
    set planning_state = 'primary',
        arrival_state = 'arrived',
        service_clearance = 'cleared',
        revision = public.staff_operations.revision + 1,
        updated_by = auth.uid(),
        updated_at = now();

    insert into pg_temp.tmp_ground_resolved_v65(team_no, slot_no, roster_role, full_name, phone, sex, staff_id, created_new)
    values (row_record.team_no, row_record.slot_no, row_record.roster_role, row_record.full_name, row_record.phone, row_record.sex, matched_id, matched_id = new_id);
    new_id := null;
  end loop;

  select count(*) filter (where roster_role='assistant_coordinator'), count(*) filter (where roster_role='counselor')
  into expected_ac_count, expected_counselor_count
  from pg_temp.tmp_ground_resolved_v65;

  -- People omitted from the current ground roster remain available for a later arrival,
  -- but are no longer treated as present primary staff.
  update public.staff_operations o
  set planning_state = 'reserve',
      arrival_state = 'expected',
      revision = o.revision + 1,
      updated_by = auth.uid(),
      updated_at = now()
  from public.staff s
  where s.id = o.staff_id
    and s.session_id = p_session_id
    and s.operational_role in ('counselor','assistant_coordinator')
    and not exists (select 1 from pg_temp.tmp_ground_resolved_v65 r where r.staff_id = s.id)
    and (o.planning_state is distinct from 'reserve' or o.arrival_state is distinct from 'expected');

  -- The updated roster replaces the old counselor/AC placements. Groups and participant
  -- identities stay intact so existing registration data remains recoverable.
  update public.counselor_groups set counselor_id = null where session_id = p_session_id;
  delete from public.staff_company_assignments where session_id = p_session_id;
  update public.staff
  set assigned_company_id = null
  where session_id = p_session_id and operational_role in ('counselor','assistant_coordinator');

  update public.session_structure_settings
  set group_max_size = 15,
      groups_per_company = 3,
      companies_per_assistant_coordinator = 1,
      updated_at = now()
  where session_id = p_session_id;

  with company_slots as (
    select c.id,
           row_number() over(order by private.company_number_v1(c.name), c.name, c.id) as team_no
    from public.companies c
    where c.session_id = p_session_id
  )
  insert into public.staff_company_assignments(session_id, staff_id, company_id, assignment_role, assigned_by)
  select p_session_id, r.staff_id, c.id, 'assistant_coordinator', auth.uid()
  from pg_temp.tmp_ground_resolved_v65 r
  join company_slots c on c.team_no = r.team_no
  where r.roster_role = 'assistant_coordinator';

  with company_slots as (
    select c.id,
           row_number() over(order by private.company_number_v1(c.name), c.name, c.id) as team_no
    from public.companies c
    where c.session_id = p_session_id
  ), roster_counselors as (
    select r.*,
           row_number() over(partition by r.team_no, r.sex order by r.slot_no, r.staff_id) as sex_rank
    from pg_temp.tmp_ground_resolved_v65 r
    where r.roster_role = 'counselor'
  ), group_slots as (
    select g.id, g.company_id, g.sex, c.team_no,
           row_number() over(partition by c.team_no, g.sex order by g.name, g.id) as sex_rank
    from public.counselor_groups g
    join company_slots c on c.id = g.company_id
    where g.session_id = p_session_id and g.state = 'published'
  )
  update public.counselor_groups g
  set counselor_id = r.staff_id
  from roster_counselors r
  join group_slots gs on gs.team_no = r.team_no and gs.sex = r.sex and gs.sex_rank = r.sex_rank
  where g.id = gs.id;

  update public.staff s
  set assigned_company_id = sca.company_id
  from public.staff_company_assignments sca
  where sca.session_id = p_session_id and sca.staff_id = s.id;

  update public.staff s
  set assigned_company_id = g.company_id
  from public.counselor_groups g
  where g.session_id = p_session_id and g.counselor_id = s.id;

  select count(*) into assigned_ac_count
  from public.staff_company_assignments sca
  where sca.session_id = p_session_id
    and exists (select 1 from pg_temp.tmp_ground_resolved_v65 r where r.staff_id=sca.staff_id and r.roster_role='assistant_coordinator');

  select count(*) into assigned_counselor_count
  from public.counselor_groups g
  where g.session_id = p_session_id
    and exists (select 1 from pg_temp.tmp_ground_resolved_v65 r where r.staff_id=g.counselor_id and r.roster_role='counselor');

  if assigned_ac_count <> expected_ac_count then
    raise exception 'Roster assignment stopped: % Assistant Coordinators expected, % assigned', expected_ac_count, assigned_ac_count;
  end if;
  if assigned_counselor_count <> expected_counselor_count then
    raise exception 'Roster assignment stopped: % counselors expected, % assigned', expected_counselor_count, assigned_counselor_count;
  end if;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_session_id, auth.uid(), 'day_of_staff_roster_applied', 'session', p_session_id::text,
    jsonb_build_object(
      'source_label', coalesce(nullif(trim(p_source_label),''), 'Day-of ground roster'),
      'staff_count', expected_ac_count + expected_counselor_count,
      'assistant_coordinators', expected_ac_count,
      'counselors', expected_counselor_count,
      'matched_existing', matched_count,
      'created_new', created_count,
      'group_max_size', 15,
      'groups_per_company', 3
    ));

  return jsonb_build_object(
    'staff_count', expected_ac_count + expected_counselor_count,
    'assistant_coordinators', expected_ac_count,
    'counselors', expected_counselor_count,
    'matched_existing', matched_count,
    'created_new', created_count,
    'assigned_assistant_coordinators', assigned_ac_count,
    'assigned_counselors', assigned_counselor_count,
    'group_max_size', 15,
    'groups_per_company', 3
  );
end;
$$;

revoke all on function public.apply_day_of_staff_roster_v1(uuid,jsonb,text) from public, anon;
grant execute on function public.apply_day_of_staff_roster_v1(uuid,jsonb,text) to authenticated;

create or replace function public.get_staff_arrival_roster_v1(p_session_id uuid)
returns table(
  staff_id uuid,
  full_name text,
  preferred_name text,
  unit_name text,
  stake_name text,
  operational_role text,
  registration_status text,
  is_current boolean,
  planning_state text,
  arrival_state text,
  service_clearance text,
  operations_revision integer,
  assignment_label text,
  committee_duties text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_session_access(p_session_id) then
    raise exception 'Session access is required';
  end if;

  if not (
    private.has_capability(p_session_id, 'registration_manage')
    or private.has_capability(p_session_id, 'staff_manage')
    or private.has_session_role(p_session_id, array['coordinator','logistics_admin','session_director']::public.app_role[])
  ) then
    raise exception 'Registration or staff management access is required';
  end if;

  return query
  select
    s.id,
    s.full_name,
    coalesce(s.preferred_name, ''),
    coalesce(s.unit_name, ''),
    coalesce(s.stake_name, ''),
    coalesce(s.operational_role::text, 'other'),
    coalesce(s.registration_status::text, ''),
    s.is_current,
    coalesce(o.planning_state, 'reserve'),
    coalesce(o.arrival_state, 'expected'),
    coalesce(o.service_clearance, 'confirmation_required'),
    coalesce(o.revision, 0),
    case
      when s.operational_role::text = 'counselor' then coalesce((
        select coalesce(nullif(g.custom_name, ''), g.name)
        from public.counselor_groups g
        where g.session_id = s.session_id and g.counselor_id = s.id
        order by g.name limit 1
      ), 'Counselor')
      when s.operational_role::text = 'assistant_coordinator' then coalesce((
        select string_agg(coalesce(nullif(c.custom_name, ''), c.name), ' · ' order by c.name)
        from public.staff_company_assignments sca
        join public.companies c on c.id = sca.company_id and c.session_id = sca.session_id
        where sca.session_id = s.session_id and sca.staff_id = s.id
      ), 'Assistant coordinator')
      when s.operational_role::text = 'committee_member' then coalesce((
        select concat(initcap(d.duty), ' committee')
        from public.staff_committee_duties d
        where d.staff_id = s.id
        order by d.duty limit 1
      ), 'Committee member')
      when s.operational_role::text = 'coordinator' then 'Coordinator'
      when s.operational_role::text = 'logistics_admin' then 'Logistical administrator'
      when s.operational_role::text = 'session_director' then 'Session directing couple'
      when s.operational_role::text = 'area_advisory_couple' then 'FSY area advisory couple'
      else 'Staff'
    end,
    coalesce((
      select array_agg(d.duty order by d.duty)
      from public.staff_committee_duties d
      where d.staff_id = s.id
    ), '{}'::text[])
  from public.staff s
  left join public.staff_operations o on o.staff_id = s.id
  where s.session_id = p_session_id
  order by s.full_name, s.id;
end;
$$;

create or replace function public.record_staff_arrival_v1(
  p_staff_id uuid,
  p_arrival text,
  p_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.staff%rowtype;
  previous public.staff_operations%rowtype;
  result public.staff_operations%rowtype;
  placement jsonb;
begin
  if p_arrival not in ('expected', 'arrived') then
    raise exception 'Registration can only check staff in or undo that check-in';
  end if;

  select * into target from public.staff where id = p_staff_id for update;
  if target.id is null then raise exception 'Staff member not found'; end if;

  if not (
    private.has_capability(target.session_id, 'registration_manage')
    or private.has_capability(target.session_id, 'staff_manage')
    or private.has_session_role(target.session_id, array['coordinator','logistics_admin','session_director']::public.app_role[])
  ) then
    raise exception 'Registration or staff management access is required';
  end if;

  insert into public.staff_operations(staff_id, planning_state, arrival_state, service_clearance, revision, updated_by, updated_at)
  values (target.id, 'reserve', 'expected', 'confirmation_required', 0, auth.uid(), now())
  on conflict (staff_id) do nothing;

  select * into previous from public.staff_operations where staff_id = target.id for update;

  if previous.revision is distinct from p_revision then
    raise exception 'Staff record changed. Refresh and review again.';
  end if;

  if previous.arrival_state = p_arrival then
    if p_arrival = 'arrived' and (previous.planning_state <> 'primary' or previous.service_clearance <> 'cleared') then
      update public.staff_operations
      set planning_state='primary', service_clearance='cleared', revision=revision+1, updated_by=auth.uid(), updated_at=now()
      where staff_id=target.id
      returning * into result;
      placement := private.place_ready_staff_if_open_v1(target.id);
      return jsonb_build_object('staff_id',target.id,'arrival_state',result.arrival_state,'revision',result.revision,'unchanged',false,'placement',placement);
    end if;
    return jsonb_build_object('staff_id', target.id, 'arrival_state', previous.arrival_state, 'revision', previous.revision, 'unchanged', true);
  end if;

  if p_arrival = 'expected' and previous.arrival_state <> 'arrived' then
    raise exception 'Only an arrived check-in can be undone to expected';
  end if;

  update public.staff_operations
  set arrival_state = p_arrival,
      planning_state = case when p_arrival='arrived' then 'primary' else planning_state end,
      service_clearance = case when p_arrival='arrived' then 'cleared' else service_clearance end,
      revision = revision + 1,
      updated_by = auth.uid(),
      updated_at = now()
  where staff_id = target.id and revision = p_revision
  returning * into result;

  if result.staff_id is null then
    raise exception 'Staff record changed. Refresh and review again.';
  end if;

  if p_arrival = 'arrived' then
    update public.staff set is_current=true where id=target.id;
    placement := private.place_ready_staff_if_open_v1(target.id);
  end if;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (target.session_id, auth.uid(), case when p_arrival='arrived' then 'staff_checked_in' else 'staff_checkin_undone' end,
    'staff', target.id::text,
    jsonb_build_object('previous_arrival',previous.arrival_state,'arrival_state',result.arrival_state,'source','registration_staff_checkin','placement',placement));

  return jsonb_build_object('staff_id',target.id,'arrival_state',result.arrival_state,'revision',result.revision,'unchanged',false,'placement',placement);
end;
$$;

create or replace function public.add_on_site_staff_from_checkin_v1(
  p_session_id uuid,
  p_first_name text,
  p_last_name text,
  p_preferred_name text,
  p_sex public.participant_sex,
  p_date_of_birth date,
  p_unit_name text,
  p_stake_name text default null,
  p_phone text default null,
  p_email text default null,
  p_tshirt_size text default null,
  p_medical_information text default null,
  p_dietary_information text default null,
  p_operational_role text default 'counselor',
  p_search_confirmed boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_id uuid := extensions.gen_random_uuid();
  session_start date;
  calculated_age integer;
  full_name_value text;
begin
  if not (
    private.has_capability(p_session_id, 'registration_manage')
    or private.has_capability(p_session_id, 'staff_manage')
    or private.has_session_role(p_session_id, array['coordinator','logistics_admin','session_director']::public.app_role[])
  ) then raise exception 'Registration or staff management access is required'; end if;

  if not p_search_confirmed then raise exception 'Search the existing staff list before adding someone'; end if;
  if p_operational_role not in ('counselor','assistant_coordinator','committee_member','other') then
    raise exception 'Choose Counselor, Assistant Coordinator, Committee member, or Other';
  end if;

  select starts_on into session_start from public.sessions where id=p_session_id;
  if session_start is null then raise exception 'Session start date is required'; end if;
  if p_date_of_birth is null or p_date_of_birth > session_start then raise exception 'A valid date of birth is required'; end if;
  calculated_age := extract(year from age(session_start,p_date_of_birth))::integer;
  full_name_value := trim(coalesce(p_first_name,'')) || ' ' || trim(coalesce(p_last_name,''));

  if nullif(trim(coalesce(p_first_name,'')),'') is null
    or nullif(trim(coalesce(p_last_name,'')),'') is null
    or p_sex is null
    or nullif(trim(coalesce(p_unit_name,'')),'') is null
    or calculated_age not between 1 and 120 then
    raise exception 'Name, date of birth, sex, and ward or branch are required';
  end if;
  if nullif(trim(coalesce(p_phone,'')),'') is null and nullif(trim(coalesce(p_email,'')),'') is null then
    raise exception 'Add a phone number or email address for this staff member';
  end if;

  if exists (
    select 1 from public.staff s
    join public.staff_private_details d on d.staff_id=s.id
    where s.session_id=p_session_id
      and lower(trim(coalesce(s.first_name,'')))=lower(trim(p_first_name))
      and lower(trim(coalesce(s.last_name,'')))=lower(trim(p_last_name))
      and d.date_of_birth=p_date_of_birth
  ) then raise exception 'This staff member already has a record in the session. Review the existing record instead of adding another'; end if;

  insert into public.staff(id,session_id,full_name,staff_role,first_name,last_name,preferred_name,sex,age,unit_name,stake_name,registration_status,is_current,operational_role,source_kind)
  values (next_id,p_session_id,trim(full_name_value),initcap(replace(p_operational_role,'_',' ')),trim(p_first_name),trim(p_last_name),nullif(trim(coalesce(p_preferred_name,'')),''),p_sex,calculated_age,trim(p_unit_name),nullif(trim(coalesce(p_stake_name,'')),''),'awaiting',true,p_operational_role,'on_site');

  insert into public.staff_private_details(staff_id,session_id,date_of_birth,email,phone,medical_information,dietary_information,tshirt_size,updated_at)
  values (next_id,p_session_id,p_date_of_birth,nullif(lower(trim(coalesce(p_email,''))),''),nullif(trim(coalesce(p_phone,'')),''),nullif(trim(coalesce(p_medical_information,'')),''),nullif(trim(coalesce(p_dietary_information,'')),''),nullif(trim(coalesce(p_tshirt_size,'')),''),now());

  insert into public.staff_operations(staff_id,planning_state,arrival_state,service_clearance,revision,updated_by,updated_at)
  values (next_id,'primary','arrived','cleared',1,auth.uid(),now());

  perform private.place_ready_staff_if_open_v1(next_id);

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values (p_session_id,auth.uid(),'staff_added_from_checkin','staff',next_id::text,
    jsonb_build_object('operational_role',p_operational_role,'age_at_session_start',calculated_age,'unit_name',trim(p_unit_name),'source','registration_staff_checkin','ready_to_serve',true));

  return next_id;
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
  caller_is_assistant boolean := false;
  participant_company uuid;
  participant_source text;
  participant_group uuid;
  active_badge public.participant_badge_assignments%rowtype;
begin
  select aa.role into caller_role
  from public.access_assignments aa
  where aa.session_id = p_session_id
    and aa.user_id = auth.uid()
    and aa.active
  limit 1;

  caller_is_assistant := private.has_session_role(
    p_session_id,
    array['assistant_coordinator']::public.app_role[]
  );

  select g.company_id, p.source_kind, p.group_id
    into participant_company, participant_source, participant_group
  from public.participants p
  left join public.counselor_groups g on g.id=p.group_id and g.session_id=p.session_id
  where p.id=p_participant_id and p.session_id=p_session_id;

  if not (
    private.has_session_role(p_session_id,array['coordinator','logistics_admin','session_director']::public.app_role[])
    or (
      private.has_capability(p_session_id,'checkin_record')
      and (
        not caller_is_assistant
        or (participant_company is not null and private.can_access_company(p_session_id,participant_company))
      )
    )
  ) then raise exception 'Your role cannot record check-in for this participant'; end if;

  if not exists (select 1 from public.participants p where p.id=p_participant_id and p.session_id=p_session_id) then
    raise exception 'Participant does not belong to this session';
  end if;
  if not private.operational_participant_is_eligible(p_session_id,p_participant_id) then
    raise exception 'This record is outside the current youth operational eligibility rules';
  end if;

  if p_status='arrived'::public.check_in_status then
    perform private.assign_arriving_participant_to_ready_group_v1(p_session_id,p_participant_id);
  end if;

  select p.group_id, g.company_id, p.source_kind
    into participant_group, participant_company, participant_source
  from public.participants p
  left join public.counselor_groups g on g.id=p.group_id and g.session_id=p.session_id
  where p.id=p_participant_id and p.session_id=p_session_id;

  if exists (select 1 from public.counselor_groups g where g.session_id=p_session_id and g.state='published')
    and participant_group is null then
    raise exception 'Participant still needs a counselor group assignment';
  end if;

  -- Assistant Coordinator check-in stays inside the caller's company scope.
  -- A pre-existing group is not enough: the group must have a present
  -- counselor, present Assistant Coordinator coverage, and live capacity.
  if caller_is_assistant and not exists (
    select 1
    from public.counselor_groups g
    join public.staff_operations o on o.staff_id = g.counselor_id
    where g.id = participant_group
      and g.session_id = p_session_id
      and g.state = 'published'
      and g.sex = (select p.sex from public.participants p where p.id = p_participant_id)
      and private.can_access_company(p_session_id, g.company_id)
      and o.planning_state = 'primary'
      and o.arrival_state = 'arrived'
      and o.service_clearance = 'cleared'
      and exists (
        select 1
        from public.staff_company_assignments sca
        join public.staff_operations ao on ao.staff_id = sca.staff_id
        where sca.session_id = p_session_id
          and sca.company_id = g.company_id
          and ao.planning_state = 'primary'
          and ao.arrival_state = 'arrived'
          and ao.service_clearance = 'cleared'
      )
      and (
        select count(*)
        from public.participants gp
        join public.check_ins ci on ci.session_id = gp.session_id and ci.participant_id = gp.id and ci.status = 'arrived'
        where gp.session_id = p_session_id
          and gp.group_id = g.id
          and gp.id <> p_participant_id
      ) < coalesce((select ss.group_max_size from public.session_structure_settings ss where ss.session_id = p_session_id), 15)
  ) then
    raise exception 'This participant needs a staffed counselor group with space before check-in';
  end if;

  -- Moving an existing participant group fires the established audited
  -- preserve_identity_group_change trigger. It updates the active badge for a
  -- same-company move, or creates the replacement ID and ID-history row for a
  -- company transfer. On-site/exception records without an ID use the same
  -- allocator here, so placement and identity are committed together.
  if p_status='arrived'::public.check_in_status then
    if participant_source = 'on_site'
      or exists (
        select 1 from public.participant_operation_decisions od
        where od.participant_id = p_participant_id and od.cohort_state = 'exception'
      ) then
      perform private.ensure_on_site_fsy_id(p_participant_id, auth.uid());
    end if;

    select b.* into active_badge
    from public.participant_badge_assignments b
    where b.session_id = p_session_id
      and b.participant_id = p_participant_id
      and b.state <> 'retired'
    order by b.assigned_at desc
    limit 1
    for update;

    if active_badge.id is not null and (
      active_badge.group_id is distinct from participant_group
      or active_badge.company_id is distinct from participant_company
    ) then
      raise exception 'Participant identity did not follow the arrival placement. Refresh and try again.';
    end if;
  end if;

  insert into public.check_ins(session_id,participant_id,status,note,recorded_by,recorded_at)
  values (p_session_id,p_participant_id,p_status,nullif(trim(coalesce(p_note,'')),''),auth.uid(),now())
  on conflict (session_id,participant_id) do update set
    status=excluded.status,note=excluded.note,recorded_by=excluded.recorded_by,recorded_at=excluded.recorded_at;

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values (p_session_id,auth.uid(),'participant_checkin_recorded','participant',p_participant_id::text,jsonb_build_object('status',p_status));
end;
$$;
