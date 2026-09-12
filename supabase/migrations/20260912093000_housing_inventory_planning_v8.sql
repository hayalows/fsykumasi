-- Housing inventory + company-block planning v8.
-- Adds durable physical identity, safe workbook import, scenario planning, and planned company room blocks.
-- Existing assignments remain authoritative and are not rewritten by planning.

alter table public.housing_rooms
  add column if not exists hall text,
  add column if not exists area text,
  add column if not exists space_type text not null default 'room',
  add column if not exists availability_status text not null default 'available',
  add column if not exists inventory_key text,
  add column if not exists source_name text,
  add column if not exists source_sheet text,
  add column if not exists source_row integer,
  add column if not exists sort_index integer;

update public.housing_rooms
set inventory_key = 'legacy:' || id::text
where inventory_key is null;

alter table public.housing_rooms
  alter column inventory_key set not null;

alter table public.housing_rooms
  drop constraint if exists housing_rooms_space_type_check;
alter table public.housing_rooms
  add constraint housing_rooms_space_type_check
  check (space_type in ('room','flat','executive','other'));

alter table public.housing_rooms
  drop constraint if exists housing_rooms_availability_status_check;
alter table public.housing_rooms
  add constraint housing_rooms_availability_status_check
  check (availability_status in ('available','reserved','out_of_service','pending'));

-- Room labels repeat across physical areas (for example 135M), so room_name alone cannot identify a room.
alter table public.housing_rooms
  drop constraint if exists housing_rooms_session_id_room_name_key;

create unique index if not exists housing_rooms_session_inventory_key_idx
  on public.housing_rooms(session_id, inventory_key);
create index if not exists housing_rooms_session_location_idx
  on public.housing_rooms(session_id, hall, area, floor, sort_index, room_name);
create index if not exists housing_rooms_session_status_idx
  on public.housing_rooms(session_id, active, availability_status, sex, space_type);

create or replace function private.housing_inventory_key_v1(
  p_hall text,
  p_area text,
  p_floor text,
  p_room_name text
)
returns text
language sql
immutable
set search_path=''
as $$
  select lower(regexp_replace(
    concat_ws('|',
      coalesce(nullif(trim(p_hall),''),'unknown-hall'),
      coalesce(nullif(trim(p_area),''),'unknown-area'),
      coalesce(nullif(trim(p_floor),''),'unknown-floor'),
      coalesce(nullif(trim(p_room_name),''),'unknown-room')
    ),
    '\s+', ' ', 'g'
  ));
$$;
revoke all on function private.housing_inventory_key_v1(text,text,text,text) from public;

create table if not exists public.housing_room_plans(
  room_id uuid primary key references public.housing_rooms(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  plan_kind text not null default 'company',
  company_id uuid references public.companies(id) on delete set null,
  sex public.participant_sex,
  label text,
  attendance_pct integer,
  plan_order integer,
  created_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint housing_room_plans_kind_check check(plan_kind in ('company','reserve','staff','flex')),
  constraint housing_room_plans_company_check check(
    (plan_kind='company' and company_id is not null and sex is not null)
    or plan_kind<>'company'
  ),
  constraint housing_room_plans_attendance_check check(attendance_pct is null or attendance_pct between 1 and 100)
);
create index if not exists housing_room_plans_session_company_idx
  on public.housing_room_plans(session_id, company_id, sex, plan_order);

alter table public.housing_room_plans enable row level security;
revoke all on public.housing_room_plans from anon, authenticated;
grant select on public.housing_room_plans to authenticated;
drop policy if exists "housing team reads room plans" on public.housing_room_plans;
create policy "housing team reads room plans"
on public.housing_room_plans for select to authenticated
using (private.has_capability(session_id,'housing_view'));

-- Keep the existing manual room editor compatible, but give every new manual room a durable key.
create or replace function public.save_housing_room(
  p_session_id uuid,
  p_room_id uuid,
  p_room_name text,
  p_building text default null,
  p_floor text default null,
  p_sex public.participant_sex default null,
  p_capacity integer default 1,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  rid uuid;
  room_key text;
  current_key text;
begin
  if not private.has_capability(p_session_id,'housing_manage') then
    raise exception 'Your account cannot manage Housing';
  end if;
  if nullif(trim(coalesce(p_room_name,'')),'') is null then
    raise exception 'Room name is required';
  end if;
  if p_capacity<1 or p_capacity>50 then
    raise exception 'Room capacity must be between 1 and 50';
  end if;

  if p_room_id is null then
    room_key := private.housing_inventory_key_v1(p_building,null,p_floor,p_room_name);
    insert into public.housing_rooms(
      session_id,room_name,building,hall,floor,sex,capacity,notes,created_by,
      inventory_key,space_type,availability_status
    ) values(
      p_session_id,trim(p_room_name),nullif(trim(coalesce(p_building,'')),''),nullif(trim(coalesce(p_building,'')),''),
      nullif(trim(coalesce(p_floor,'')),''),p_sex,p_capacity,nullif(trim(coalesce(p_notes,'')),''),(select auth.uid()),
      room_key,'room','available'
    )
    returning id into rid;
  else
    select inventory_key into current_key
    from public.housing_rooms
    where id=p_room_id and session_id=p_session_id;
    if current_key is null then raise exception 'Housing room not found'; end if;

    update public.housing_rooms
    set room_name=trim(p_room_name),
        building=nullif(trim(coalesce(p_building,'')),''),
        hall=coalesce(hall,nullif(trim(coalesce(p_building,'')),'')),
        floor=nullif(trim(coalesce(p_floor,'')),''),
        sex=p_sex,
        capacity=p_capacity,
        notes=nullif(trim(coalesce(p_notes,'')),''),
        updated_at=now()
    where id=p_room_id and session_id=p_session_id
    returning id into rid;
    if rid is null then raise exception 'Housing room not found'; end if;
  end if;

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id)
  values(
    p_session_id,(select auth.uid()),
    case when p_room_id is null then 'housing_room_created' else 'housing_room_updated' end,
    'housing_room',rid::text
  );
  return rid;
exception
  when unique_violation then
    raise exception 'A room with this location and name already exists';
end;
$$;

-- Bulk import is additive: omitted rooms are never deleted or deactivated.
create or replace function public.import_housing_inventory_v1(
  p_session_id uuid,
  p_source_name text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  item jsonb;
  room_id uuid;
  room_key text;
  hall_value text;
  area_value text;
  floor_value text;
  room_value text;
  building_value text;
  type_value text;
  status_value text;
  sex_value public.participant_sex;
  capacity_value integer;
  notes_value text;
  source_sheet_value text;
  source_row_value integer;
  sort_value integer;
  existed boolean;
  inserted_count integer := 0;
  updated_count integer := 0;
  total_capacity integer := 0;
  room_count integer := 0;
  current_occupancy integer;
begin
  if not private.has_capability(p_session_id,'housing_manage') then
    raise exception 'Your account cannot manage Housing';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Housing import rows must be an array';
  end if;
  if jsonb_array_length(p_rows) < 1 then raise exception 'No housing rows were provided'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'Housing import is limited to 2000 rows at a time'; end if;

  for item in select value from jsonb_array_elements(p_rows)
  loop
    hall_value := nullif(trim(coalesce(item->>'hall','')),'');
    area_value := nullif(trim(coalesce(item->>'area','')),'');
    floor_value := nullif(trim(coalesce(item->>'floor','')),'');
    room_value := nullif(trim(coalesce(item->>'room_name','')),'');
    type_value := lower(coalesce(nullif(trim(item->>'space_type'),''),'room'));
    status_value := lower(coalesce(nullif(trim(item->>'availability_status'),''),'available'));
    capacity_value := coalesce(nullif(item->>'capacity','')::integer,1);
    notes_value := nullif(trim(coalesce(item->>'notes','')),'');
    source_sheet_value := nullif(trim(coalesce(item->>'source_sheet','')),'');
    source_row_value := nullif(item->>'source_row','')::integer;
    sort_value := nullif(item->>'sort_index','')::integer;

    if room_value is null then raise exception 'Every imported housing row needs a room name'; end if;
    if hall_value is null then raise exception 'Every imported housing row needs a hall'; end if;
    if capacity_value<1 or capacity_value>50 then raise exception 'Invalid capacity for %',room_value; end if;
    if type_value not in ('room','flat','executive','other') then raise exception 'Invalid space type for %',room_value; end if;
    if status_value not in ('available','reserved','out_of_service','pending') then raise exception 'Invalid availability status for %',room_value; end if;

    sex_value := case lower(coalesce(item->>'sex',''))
      when 'male' then 'male'::public.participant_sex
      when 'female' then 'female'::public.participant_sex
      else null
    end;

    room_key := private.housing_inventory_key_v1(hall_value,area_value,floor_value,room_value);
    building_value := coalesce(hall_value,'') || case when area_value is not null then ' · ' || area_value else '' end;

    select exists(
      select 1 from public.housing_rooms r
      where r.session_id=p_session_id and r.inventory_key=room_key
    ) into existed;

    if existed then
      select count(*)::integer into current_occupancy
      from public.housing_assignments a
      join public.housing_rooms r on r.id=a.room_id
      where r.session_id=p_session_id and r.inventory_key=room_key and a.active;
      if capacity_value < current_occupancy then
        raise exception 'Capacity for % cannot be lower than its current occupancy of %',room_value,current_occupancy;
      end if;

      update public.housing_rooms r
      set hall=hall_value,area=area_value,floor=floor_value,building=building_value,
          room_name=room_value,space_type=type_value,availability_status=status_value,
          sex=sex_value,capacity=capacity_value,notes=notes_value,active=true,
          source_name=nullif(trim(coalesce(p_source_name,'')),''),
          source_sheet=source_sheet_value,source_row=source_row_value,sort_index=sort_value,
          updated_at=now()
      where r.session_id=p_session_id and r.inventory_key=room_key
      returning r.id into room_id;
      updated_count := updated_count + 1;
    else
      insert into public.housing_rooms(
        session_id,hall,area,floor,building,room_name,space_type,availability_status,
        sex,capacity,notes,active,created_by,inventory_key,source_name,source_sheet,source_row,sort_index
      ) values(
        p_session_id,hall_value,area_value,floor_value,building_value,room_value,type_value,status_value,
        sex_value,capacity_value,notes_value,true,(select auth.uid()),room_key,
        nullif(trim(coalesce(p_source_name,'')),''),source_sheet_value,source_row_value,sort_value
      ) returning id into room_id;
      inserted_count := inserted_count + 1;
    end if;

    room_count := room_count + 1;
    total_capacity := total_capacity + capacity_value;
  end loop;

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(
    p_session_id,(select auth.uid()),'housing_inventory_imported','housing_inventory',p_session_id::text,
    jsonb_build_object(
      'source_name',nullif(trim(coalesce(p_source_name,'')),''),
      'rows',room_count,'inserted',inserted_count,'updated',updated_count,'capacity',total_capacity,
      'omitted_rooms_changed',false
    )
  );

  return jsonb_build_object(
    'rows',room_count,'inserted',inserted_count,'updated',updated_count,
    'capacity',total_capacity,'omitted_rooms_changed',false
  );
end;
$$;

create or replace function public.get_housing_rooms_v8(p_session_id uuid)
returns table(
  id uuid,
  room_name text,
  building text,
  hall text,
  area text,
  floor text,
  sex public.participant_sex,
  capacity integer,
  occupancy bigint,
  notes text,
  active boolean,
  space_type text,
  availability_status text,
  inventory_key text,
  source_name text,
  source_sheet text,
  source_row integer,
  sort_index integer,
  plan_kind text,
  plan_company_id uuid,
  plan_company_name text,
  plan_label text,
  plan_order integer,
  plan_attendance_pct integer
)
language sql
stable
security definer
set search_path=''
as $$
  select
    r.id,r.room_name,r.building,r.hall,r.area,r.floor,r.sex,r.capacity,
    count(a.id) filter(where a.active),r.notes,r.active,r.space_type,r.availability_status,
    r.inventory_key,r.source_name,r.source_sheet,r.source_row,r.sort_index,
    hp.plan_kind,hp.company_id,coalesce(nullif(c.custom_name,''),c.name),hp.label,hp.plan_order,hp.attendance_pct
  from public.housing_rooms r
  left join public.housing_assignments a on a.room_id=r.id and a.active
  left join public.housing_room_plans hp on hp.room_id=r.id and hp.session_id=r.session_id
  left join public.companies c on c.id=hp.company_id
  where r.session_id=p_session_id
    and r.active
    and private.has_capability(p_session_id,'housing_view')
  group by r.id,hp.room_id,hp.plan_kind,hp.company_id,c.id,hp.label,hp.plan_order,hp.attendance_pct
  order by coalesce(r.hall,r.building,''),coalesce(r.area,''),coalesce(r.floor,''),coalesce(r.sort_index,2147483647),r.room_name;
$$;

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
  if p_attendance_pct<1 or p_attendance_pct>100 then raise exception 'Attendance scenario must be between 1 and 100'; end if;

  return query
  with base as (
    select
      c.id company_id,
      coalesce(nullif(c.custom_name,''),c.name) company_name,
      coalesce(c.operational_number,nullif(regexp_replace(c.name,'\D','','g'),'')::integer,9999) company_number,
      g.sex,
      count(distinct p.id) filter(
        where p.id is not null and private.operational_participant_is_eligible(p_session_id,p.id)
      )::integer participant_count,
      count(distinct g.id)::integer group_count
    from public.companies c
    join public.counselor_groups g on g.company_id=c.id and g.session_id=c.session_id and g.state='published'
    left join public.participants p on p.group_id=g.id and p.session_id=c.session_id
    where c.session_id=p_session_id and g.sex is not null
    group by c.id,c.custom_name,c.name,c.operational_number,g.sex
  )
  select
    b.company_id,b.company_name,b.company_number,b.sex,
    b.participant_count,
    ceil(b.participant_count * p_attendance_pct / 100.0)::integer,
    b.group_count,
    ceil(b.participant_count * p_attendance_pct / 100.0)::integer + b.group_count
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
  where r.session_id=p_session_id and r.active and r.availability_status='available' and r.space_type='room' and r.sex is not null;

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
      'can_apply',assignments_started=0
    ),
    'blocks',coalesce((
      select jsonb_agg(jsonb_build_object(
        'company_id',n.company_id,
        'company_name',n.company_name,
        'company_number',n.company_number,
        'sex',n.sex::text,
        'registered_participants',n.registered_participants,
        'projected_participants',n.projected_participants,
        'counselor_spaces',n.counselor_spaces,
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

create or replace function public.apply_housing_company_plan_v1(
  p_session_id uuid,
  p_attendance_pct integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  plan jsonb;
  block jsonb;
  room_item jsonb;
  active_assignments integer;
  label_value text;
  applied_rooms integer := 0;
begin
  if not private.has_capability(p_session_id,'housing_manage') then raise exception 'Your account cannot manage Housing'; end if;

  select count(*)::integer into active_assignments
  from public.housing_assignments a
  where a.session_id=p_session_id and a.active;
  if active_assignments>0 then
    raise exception 'Automatic company planning is locked after live room assignments begin. Review existing assignments before changing blocks.';
  end if;

  plan := public.preview_housing_company_plan_v1(p_session_id,p_attendance_pct);
  delete from public.housing_room_plans hp
  where hp.session_id=p_session_id and hp.plan_kind='company';

  for block in select value from jsonb_array_elements(plan->'blocks')
  loop
    label_value := coalesce(block->>'company_name','Company') || ' · ' ||
      case block->>'sex' when 'male' then 'Young Men' else 'Young Women' end;
    for room_item in select value from jsonb_array_elements(block->'rooms')
    loop
      insert into public.housing_room_plans(
        room_id,session_id,plan_kind,company_id,sex,label,attendance_pct,plan_order,created_by,updated_by
      ) values(
        (room_item->>'id')::uuid,p_session_id,'company',(block->>'company_id')::uuid,
        (block->>'sex')::public.participant_sex,label_value,p_attendance_pct,
        coalesce((room_item->>'plan_order')::integer,1),(select auth.uid()),(select auth.uid())
      )
      on conflict(room_id) do update set
        session_id=excluded.session_id,plan_kind=excluded.plan_kind,company_id=excluded.company_id,
        sex=excluded.sex,label=excluded.label,attendance_pct=excluded.attendance_pct,
        plan_order=excluded.plan_order,updated_by=(select auth.uid()),updated_at=now();
      applied_rooms := applied_rooms + 1;
    end loop;
  end loop;

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(
    p_session_id,(select auth.uid()),'housing_company_plan_applied','housing_plan',p_session_id::text,
    jsonb_build_object(
      'attendance_pct',p_attendance_pct,'rooms',applied_rooms,
      'summary',plan->'summary'
    )
  );

  return plan || jsonb_build_object('applied',true,'applied_rooms',applied_rooms);
end;
$$;

create or replace function public.clear_housing_company_plan_v1(p_session_id uuid)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare cleared integer;
begin
  if not private.has_capability(p_session_id,'housing_manage') then raise exception 'Your account cannot manage Housing'; end if;
  if exists(select 1 from public.housing_assignments a where a.session_id=p_session_id and a.active) then
    raise exception 'Automatic company planning is locked after live room assignments begin';
  end if;
  with deleted as (
    delete from public.housing_room_plans hp
    where hp.session_id=p_session_id and hp.plan_kind='company'
    returning 1
  ) select count(*)::integer into cleared from deleted;
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_session_id,(select auth.uid()),'housing_company_plan_cleared','housing_plan',p_session_id::text,jsonb_build_object('rooms',cleared));
  return cleared;
end;
$$;

-- Harden assignment: unavailable, pending and untyped spaces cannot receive people through direct RPC calls.
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
  if clean_reason is not null and char_length(clean_reason) > 240 then raise exception 'Room change reason must be 240 characters or fewer'; end if;

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
    select p.sex into person_sex from public.participants p where p.id=p_person_id and p.session_id=p_session_id;
    if person_sex is null then raise exception 'Participant not found'; end if;
    select * into previous_row from public.housing_assignments
      where session_id=p_session_id and participant_id=p_person_id and active for update;
  elsif p_person_type='staff' then
    select s.sex into person_sex from public.staff s
      where s.id=p_person_id and s.session_id=p_session_id and s.is_current;
    if not found then raise exception 'Staff member not found'; end if;
    select * into previous_row from public.housing_assignments
      where session_id=p_session_id and staff_id=p_person_id and active for update;
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

-- The legacy/live Housing room loader stays focused on spaces that can become assignment choices.
-- Flexible flats/executive rooms remain visible in Inventory until a Male/Female use is deliberately set.
create or replace function public.get_housing_rooms(p_session_id uuid)
returns table(
  id uuid,
  room_name text,
  building text,
  floor text,
  sex public.participant_sex,
  capacity integer,
  occupancy bigint,
  notes text
)
language sql
stable
security definer
set search_path=''
as $$
  select r.id,r.room_name,r.building,r.floor,r.sex,r.capacity,count(a.id) filter(where a.active),r.notes
  from public.housing_rooms r
  left join public.housing_assignments a on a.room_id=r.id and a.active
  where r.session_id=p_session_id
    and r.active
    and r.availability_status='available'
    and (r.space_type='room' or r.sex is not null)
    and private.has_capability(p_session_id,'housing_view')
  group by r.id
  order by coalesce(r.sort_index,2147483647),coalesce(r.building,''),coalesce(r.floor,''),r.room_name;
$$;
revoke all on function public.get_housing_rooms(uuid) from public,anon;
grant execute on function public.get_housing_rooms(uuid) to authenticated;

revoke all on function public.import_housing_inventory_v1(uuid,text,jsonb) from public,anon;
revoke all on function public.get_housing_rooms_v8(uuid) from public,anon;
revoke all on function public.get_housing_company_needs_v1(uuid,integer) from public,anon;
revoke all on function public.preview_housing_company_plan_v1(uuid,integer) from public,anon;
revoke all on function public.apply_housing_company_plan_v1(uuid,integer) from public,anon;
revoke all on function public.clear_housing_company_plan_v1(uuid) from public,anon;
revoke all on function public.assign_housing_person_v2(uuid,text,uuid,uuid,text,text) from public,anon;

grant execute on function public.import_housing_inventory_v1(uuid,text,jsonb) to authenticated;
grant execute on function public.get_housing_rooms_v8(uuid) to authenticated;
grant execute on function public.get_housing_company_needs_v1(uuid,integer) to authenticated;
grant execute on function public.preview_housing_company_plan_v1(uuid,integer) to authenticated;
grant execute on function public.apply_housing_company_plan_v1(uuid,integer) to authenticated;
grant execute on function public.clear_housing_company_plan_v1(uuid) to authenticated;
grant execute on function public.assign_housing_person_v2(uuid,text,uuid,uuid,text,text) to authenticated;

comment on function public.import_housing_inventory_v1(uuid,text,jsonb)
is 'Additive Housing inventory import. Upserts rooms by physical inventory key and never removes omitted rooms.';
comment on function public.preview_housing_company_plan_v1(uuid,integer)
is 'Read-only deterministic Company x Sex Housing block plan for an attendance scenario. Standard rooms only; special spaces remain flexible.';
comment on function public.apply_housing_company_plan_v1(uuid,integer)
is 'Applies the current deterministic Company x Sex Housing plan before live room assignments begin.';

-- Realtime keeps inventory/plan views current across Housing devices.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='housing_rooms'
  ) then alter publication supabase_realtime add table public.housing_rooms; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='housing_room_plans'
  ) then alter publication supabase_realtime add table public.housing_room_plans; end if;
end $$;
