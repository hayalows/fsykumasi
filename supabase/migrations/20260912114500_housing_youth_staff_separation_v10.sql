-- Housing youth/staff separation v10.
-- FSY counselors and other staff need separate sleeping spaces from youth.
-- Company room blocks therefore model youth only; staff capacity stays visible as a separate need.

create or replace function public.get_housing_company_needs_v1(
  p_session_id uuid,
  p_attendance_pct integer default 100
)
returns table(
  company_id uuid,
  company_name text,
  company_number integer,
  sex public.participant_sex,
  registered_participants integer,
  projected_participants integer,
  counselor_spaces integer,
  target_spaces integer
)
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if not private.has_capability(p_session_id,'housing_view') then
    raise exception 'Housing access required';
  end if;
  if p_attendance_pct<1 or p_attendance_pct>100 then
    raise exception 'Attendance scenario must be between 1 and 100';
  end if;

  return query
  with base as (
    select
      c.id company_id,
      coalesce(nullif(c.custom_name,''),c.name) company_name,
      coalesce(c.operational_number,nullif(regexp_replace(c.name,'\D','','g'),'')::integer,9999) company_number,
      g.sex,
      count(distinct p.id) filter(
        where p.id is not null and private.operational_participant_is_eligible(p_session_id,p.id)
      )::integer participant_count
    from public.companies c
    join public.counselor_groups g
      on g.company_id=c.id and g.session_id=c.session_id and g.state='published'
    left join public.participants p
      on p.group_id=g.id and p.session_id=c.session_id
    where c.session_id=p_session_id and g.sex is not null
    group by c.id,c.custom_name,c.name,c.operational_number,g.sex
  )
  select
    b.company_id,b.company_name,b.company_number,b.sex,
    b.participant_count,
    ceil(b.participant_count * p_attendance_pct / 100.0)::integer,
    0::integer as counselor_spaces,
    ceil(b.participant_count * p_attendance_pct / 100.0)::integer as target_spaces
  from base b
  order by b.company_number,b.company_name,b.sex;
end;
$$;

create or replace function public.preview_housing_company_plan_v1(
  p_session_id uuid,
  p_attendance_pct integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  need record;
  room_rec record;
  allocated integer;
  room_order integer;
  total_standard_capacity integer;
  male_capacity integer;
  female_capacity integer;
  flex_capacity integer;
  target_total integer;
  target_male integer;
  target_female integer;
  shortage_total integer;
  assignments_started integer;
  male_staff_spaces integer;
  female_staff_spaces integer;
  unknown_staff_spaces integer;
  result jsonb;
begin
  if not private.has_capability(p_session_id,'housing_view') then raise exception 'Housing access required'; end if;
  if p_attendance_pct<1 or p_attendance_pct>100 then raise exception 'Attendance scenario must be between 1 and 100'; end if;

  drop table if exists pg_temp.tmp_housing_plan;
  drop table if exists pg_temp.tmp_housing_needs;

  create temporary table tmp_housing_needs(
    company_id uuid,
    company_name text,
    company_number integer,
    sex public.participant_sex,
    registered_participants integer,
    projected_participants integer,
    counselor_spaces integer,
    target_spaces integer,
    allocated_capacity integer default 0,
    allocated_rooms integer default 0,
    shortage integer default 0
  ) on commit drop;

  insert into tmp_housing_needs(
    company_id,company_name,company_number,sex,registered_participants,projected_participants,counselor_spaces,target_spaces
  )
  select * from public.get_housing_company_needs_v1(p_session_id,p_attendance_pct);

  create temporary table tmp_housing_plan(
    room_id uuid primary key,
    company_id uuid,
    sex public.participant_sex,
    plan_order integer,
    capacity integer
  ) on commit drop;

  for need in
    select * from tmp_housing_needs order by company_number,company_name,sex
  loop
    allocated := 0;
    room_order := 0;
    for room_rec in
      select r.id,r.capacity
      from public.housing_rooms r
      where r.session_id=p_session_id
        and r.active
        and r.availability_status='available'
        and r.space_type='room'
        and r.sex=need.sex
        and not exists(select 1 from tmp_housing_plan x where x.room_id=r.id)
        and not exists(
          select 1 from public.housing_room_plans hp
          where hp.room_id=r.id and hp.session_id=p_session_id and hp.plan_kind<>'company'
        )
      order by
        coalesce(r.sort_index,2147483647),
        coalesce(r.hall,r.building,''),coalesce(r.area,''),coalesce(r.floor,''),r.room_name
    loop
      exit when allocated >= need.target_spaces;
      room_order := room_order + 1;
      insert into tmp_housing_plan(room_id,company_id,sex,plan_order,capacity)
      values(room_rec.id,need.company_id,need.sex,room_order,room_rec.capacity);
      allocated := allocated + room_rec.capacity;
    end loop;

    update tmp_housing_needs
    set allocated_capacity=allocated,
        allocated_rooms=room_order,
        shortage=greatest(0,target_spaces-allocated)
    where company_id=need.company_id and sex=need.sex;
  end loop;

  select coalesce(sum(r.capacity),0)::integer,
         coalesce(sum(r.capacity) filter(where r.sex='male'),0)::integer,
         coalesce(sum(r.capacity) filter(where r.sex='female'),0)::integer
  into total_standard_capacity,male_capacity,female_capacity
  from public.housing_rooms r
  where r.session_id=p_session_id
    and r.active
    and r.availability_status='available'
    and r.space_type='room'
    and r.sex is not null
    and not exists(
      select 1 from public.housing_room_plans hp
      where hp.room_id=r.id and hp.session_id=p_session_id and hp.plan_kind<>'company'
    );

  select coalesce(sum(r.capacity),0)::integer into flex_capacity
  from public.housing_rooms r
  where r.session_id=p_session_id and r.active and r.availability_status='available' and r.space_type<>'room';

  select coalesce(sum(target_spaces),0)::integer,
         coalesce(sum(target_spaces) filter(where sex='male'),0)::integer,
         coalesce(sum(target_spaces) filter(where sex='female'),0)::integer,
         coalesce(sum(shortage),0)::integer
  into target_total,target_male,target_female,shortage_total
  from tmp_housing_needs;

  select count(*)::integer into assignments_started
  from public.housing_assignments a
  where a.session_id=p_session_id and a.active;

  select
    count(*) filter(where s.is_current and s.sex='male')::integer,
    count(*) filter(where s.is_current and s.sex='female')::integer,
    count(*) filter(where s.is_current and s.sex is null)::integer
  into male_staff_spaces,female_staff_spaces,unknown_staff_spaces
  from public.staff s
  where s.session_id=p_session_id;

  select jsonb_build_object(
    'attendance_pct',p_attendance_pct,
    'summary',jsonb_build_object(
      'standard_capacity',total_standard_capacity,
      'male_capacity',male_capacity,
      'female_capacity',female_capacity,
      'flex_capacity',flex_capacity,
      'target_spaces',target_total,
      'male_target',target_male,
      'female_target',target_female,
      'shortage',shortage_total,
      'assignments_started',assignments_started,
      'can_apply',assignments_started=0,
      'youth_only',true,
      'male_staff_spaces',coalesce(male_staff_spaces,0),
      'female_staff_spaces',coalesce(female_staff_spaces,0),
      'unknown_staff_spaces',coalesce(unknown_staff_spaces,0),
      'staff_spaces_total',coalesce(male_staff_spaces,0)+coalesce(female_staff_spaces,0)+coalesce(unknown_staff_spaces,0)
    ),
    'blocks',coalesce((
      select jsonb_agg(jsonb_build_object(
        'company_id',n.company_id,
        'company_name',n.company_name,
        'company_number',n.company_number,
        'sex',n.sex::text,
        'registered_participants',n.registered_participants,
        'projected_participants',n.projected_participants,
        'counselor_spaces',0,
        'target_spaces',n.target_spaces,
        'allocated_capacity',n.allocated_capacity,
        'allocated_rooms',n.allocated_rooms,
        'shortage',n.shortage,
        'rooms',coalesce((
          select jsonb_agg(jsonb_build_object(
            'id',r.id,'name',r.room_name,'hall',r.hall,'area',r.area,'floor',r.floor,
            'capacity',r.capacity,'plan_order',p.plan_order
          ) order by p.plan_order)
          from tmp_housing_plan p
          join public.housing_rooms r on r.id=p.room_id
          where p.company_id=n.company_id and p.sex=n.sex
        ),'[]'::jsonb)
      ) order by n.company_number,n.company_name,n.sex)
      from tmp_housing_needs n
    ),'[]'::jsonb)
  ) into result;

  return result;
end;
$$;

create or replace function public.assign_housing_person_v2(
  p_session_id uuid,
  p_person_type text,
  p_person_id uuid,
  p_room_id uuid,
  p_bed_label text default null,
  p_move_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  room_row public.housing_rooms%rowtype;
  person_sex public.participant_sex;
  previous_row public.housing_assignments%rowtype;
  new_id uuid;
  occupancy integer;
  clean_bed text := nullif(trim(coalesce(p_bed_label,'')), '');
  clean_reason text := nullif(trim(coalesce(p_move_reason,'')), '');
begin
  if not private.has_capability(p_session_id,'housing_manage') then raise exception 'Your account cannot manage Housing'; end if;
  if clean_reason is not null and char_length(clean_reason)>240 then raise exception 'Room change reason must be 240 characters or fewer'; end if;

  select * into room_row
  from public.housing_rooms
  where id=p_room_id and session_id=p_session_id and active
  for update;
  if room_row.id is null then raise exception 'Housing room not found'; end if;
  if room_row.availability_status<>'available' then raise exception 'This housing space is not currently available'; end if;
  if room_row.sex is null then raise exception 'Set this room to Male or Female before assigning someone'; end if;

  if p_person_type='participant' then
    if not private.operational_participant_is_eligible(p_session_id,p_person_id) then
      raise exception 'Only currently eligible participants can be assigned to Housing';
    end if;
    select p.sex into person_sex
    from public.participants p
    where p.id=p_person_id and p.session_id=p_session_id;
    if person_sex is null then raise exception 'Participant not found'; end if;
    select * into previous_row
    from public.housing_assignments
    where session_id=p_session_id and participant_id=p_person_id and active
    for update;

    if exists(
      select 1 from public.housing_assignments a
      where a.session_id=p_session_id and a.room_id=p_room_id and a.active and a.staff_id is not null
        and a.id is distinct from previous_row.id
    ) then
      raise exception 'FSY staff cannot share a room with youth. Choose a participant room.';
    end if;
    if exists(
      select 1 from public.housing_room_plans hp
      where hp.session_id=p_session_id and hp.room_id=p_room_id and hp.plan_kind='staff'
    ) then
      raise exception 'This room is reserved for staff housing';
    end if;
  elsif p_person_type='staff' then
    select s.sex into person_sex
    from public.staff s
    where s.id=p_person_id and s.session_id=p_session_id and s.is_current;
    if not found then raise exception 'Staff member not found'; end if;
    if person_sex is null then raise exception 'Record this staff member''s sex before assigning Housing'; end if;
    select * into previous_row
    from public.housing_assignments
    where session_id=p_session_id and staff_id=p_person_id and active
    for update;

    if exists(
      select 1 from public.housing_assignments a
      where a.session_id=p_session_id and a.room_id=p_room_id and a.active and a.participant_id is not null
        and a.id is distinct from previous_row.id
    ) then
      raise exception 'FSY staff cannot share a room with youth. Choose a staff room.';
    end if;
    if exists(
      select 1 from public.housing_room_plans hp
      where hp.session_id=p_session_id and hp.room_id=p_room_id and hp.plan_kind='company'
    ) then
      raise exception 'This room is reserved for a youth company block';
    end if;
  else
    raise exception 'Person type must be participant or staff';
  end if;

  if room_row.sex<>person_sex then raise exception 'This room is assigned to the other sex'; end if;

  if previous_row.id is not null and previous_row.room_id=p_room_id then
    if previous_row.bed_label is distinct from clean_bed then
      update public.housing_assignments set bed_label=clean_bed where id=previous_row.id;
      insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
      values(p_session_id,(select auth.uid()),'housing_assignment_updated','housing_assignment',previous_row.id::text,
        jsonb_build_object('person_type',p_person_type,'person_id',p_person_id,'room_id',p_room_id,'bed_label',clean_bed));
    end if;
    return previous_row.id;
  end if;

  select count(*) into occupancy
  from public.housing_assignments
  where room_id=p_room_id and active and id is distinct from previous_row.id;
  if occupancy>=room_row.capacity then raise exception 'This room is already at capacity'; end if;

  if previous_row.id is not null then
    update public.housing_assignments set active=false,ended_at=now() where id=previous_row.id;
  end if;

  insert into public.housing_assignments(session_id,room_id,participant_id,staff_id,bed_label,assigned_by,moved_from_id)
  values(
    p_session_id,p_room_id,
    case when p_person_type='participant' then p_person_id end,
    case when p_person_type='staff' then p_person_id end,
    clean_bed,(select auth.uid()),previous_row.id
  ) returning id into new_id;

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(
    p_session_id,(select auth.uid()),case when previous_row.id is null then 'housing_assigned' else 'housing_moved' end,
    'housing_assignment',new_id::text,
    jsonb_build_object(
      'person_type',p_person_type,'person_id',p_person_id,'room_id',p_room_id,
      'previous_assignment_id',previous_row.id,'previous_room_id',previous_row.room_id,
      'move_reason',case when previous_row.id is null then null else clean_reason end
    )
  );
  return new_id;
end;
$$;

create or replace function public.restore_housing_assignment_v1(
  p_session_id uuid,
  p_assignment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  target public.housing_assignments%rowtype;
  room_row public.housing_rooms%rowtype;
  occupancy integer;
  person_sex public.participant_sex;
begin
  if not private.has_capability(p_session_id,'housing_manage') then raise exception 'Your account cannot manage Housing'; end if;

  select * into target
  from public.housing_assignments
  where id=p_assignment_id and session_id=p_session_id
  for update;
  if target.id is null then raise exception 'Housing assignment not found'; end if;
  if target.active then return jsonb_build_object('restored',false,'reason','already_active','assignment_id',target.id); end if;

  select * into room_row
  from public.housing_rooms
  where id=target.room_id and session_id=p_session_id and active
  for update;
  if room_row.id is null then raise exception 'The original room is no longer available'; end if;
  if room_row.availability_status<>'available' then raise exception 'The original room is no longer available'; end if;

  if target.participant_id is not null then
    select p.sex into person_sex
    from public.participants p
    where p.id=target.participant_id and p.session_id=p_session_id and p.is_current
      and private.operational_participant_is_eligible(p_session_id,p.id);
    if person_sex is null then raise exception 'This participant is no longer eligible for active Housing'; end if;
    if exists(select 1 from public.housing_assignments a where a.session_id=p_session_id and a.participant_id=target.participant_id and a.active) then
      raise exception 'This participant already has another active room';
    end if;
    if exists(select 1 from public.housing_assignments a where a.session_id=p_session_id and a.room_id=room_row.id and a.active and a.staff_id is not null) then
      raise exception 'FSY staff cannot share a room with youth. The original room now contains staff.';
    end if;
    if exists(select 1 from public.housing_room_plans hp where hp.session_id=p_session_id and hp.room_id=room_row.id and hp.plan_kind='staff') then
      raise exception 'The original room is now reserved for staff housing';
    end if;
  else
    select s.sex into person_sex
    from public.staff s
    where s.id=target.staff_id and s.session_id=p_session_id and s.is_current;
    if person_sex is null then raise exception 'This staff member is no longer active or does not have a recorded sex'; end if;
    if exists(select 1 from public.housing_assignments a where a.session_id=p_session_id and a.staff_id=target.staff_id and a.active) then
      raise exception 'This staff member already has another active room';
    end if;
    if exists(select 1 from public.housing_assignments a where a.session_id=p_session_id and a.room_id=room_row.id and a.active and a.participant_id is not null) then
      raise exception 'FSY staff cannot share a room with youth. The original room now contains youth.';
    end if;
    if exists(select 1 from public.housing_room_plans hp where hp.session_id=p_session_id and hp.room_id=room_row.id and hp.plan_kind='company') then
      raise exception 'The original room is now reserved for a youth company block';
    end if;
  end if;

  if room_row.sex is not null and person_sex is not null and room_row.sex<>person_sex then
    raise exception 'The original room is no longer compatible';
  end if;
  select count(*)::integer into occupancy
  from public.housing_assignments
  where room_id=room_row.id and active;
  if occupancy>=room_row.capacity then raise exception 'The original room is full'; end if;

  update public.housing_assignments set active=true,ended_at=null where id=target.id;
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_session_id,(select auth.uid()),'housing_assignment_restored','housing_assignment',target.id::text,
    jsonb_build_object('room_id',room_row.id,'occupancy_before',occupancy));
  return jsonb_build_object('restored',true,'assignment_id',target.id,'room_id',target.room_id);
end;
$$;

revoke all on function public.get_housing_company_needs_v1(uuid,integer) from public,anon;
revoke all on function public.preview_housing_company_plan_v1(uuid,integer) from public,anon;
revoke all on function public.assign_housing_person_v2(uuid,text,uuid,uuid,text,text) from public,anon;
revoke all on function public.restore_housing_assignment_v1(uuid,uuid) from public,anon;
grant execute on function public.get_housing_company_needs_v1(uuid,integer) to authenticated;
grant execute on function public.preview_housing_company_plan_v1(uuid,integer) to authenticated;
grant execute on function public.assign_housing_person_v2(uuid,text,uuid,uuid,text,text) to authenticated;
grant execute on function public.restore_housing_assignment_v1(uuid,uuid) to authenticated;

comment on function public.get_housing_company_needs_v1(uuid,integer)
is 'Youth-only Company x Sex Housing demand for an attendance scenario. Staff are housed separately.';
comment on function public.preview_housing_company_plan_v1(uuid,integer)
is 'Youth-only deterministic Company x Sex room-block plan plus separate current staff bed counts.';
comment on function public.assign_housing_person_v2(uuid,text,uuid,uuid,text,text)
is 'Assigns one current person to compatible Housing while preventing youth/staff room mixing.';
