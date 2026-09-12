-- Housing inventory safety v9.
-- Keeps pre-V8 manual rooms out of official planning until reviewed, freezes workbook imports
-- once live room assignments begin, adds a reviewed one-room editor RPC, and keeps legacy
-- room editor/create-and-assign flows compatible with the V8 physical inventory model.

update public.housing_rooms r
set availability_status = case
      when exists(select 1 from public.housing_assignments a where a.room_id=r.id and a.active) then 'available'
      else 'pending'
    end,
    source_name = coalesce(r.source_name,'Legacy/manual room · review before use')
where r.inventory_key like 'legacy:%';

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
  inserted_count integer := 0;
  updated_count integer := 0;
  total_capacity integer := 0;
  room_count integer := 0;
  plans_cleared integer := 0;
begin
  if not private.has_capability(p_session_id,'housing_manage') then raise exception 'Your account cannot manage Housing'; end if;
  if jsonb_typeof(p_rows)<>'array' then raise exception 'Housing import rows must be an array'; end if;
  if jsonb_array_length(p_rows)<1 then raise exception 'No housing rows were provided'; end if;
  if jsonb_array_length(p_rows)>2000 then raise exception 'Housing import is limited to 2000 rows at a time'; end if;
  if exists(select 1 from public.housing_assignments a where a.session_id=p_session_id and a.active) then
    raise exception 'Housing inventory import is locked after live room assignments begin. Add or edit individual rooms instead.';
  end if;

  with deleted as (
    delete from public.housing_room_plans hp where hp.session_id=p_session_id and hp.plan_kind='company' returning 1
  ) select count(*)::integer into plans_cleared from deleted;

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

    if hall_value is null or room_value is null then raise exception 'Every imported housing row needs a hall and room name'; end if;
    if capacity_value<1 or capacity_value>50 then raise exception 'Invalid capacity for %',room_value; end if;
    if type_value not in ('room','flat','executive','other') then raise exception 'Invalid space type for %',room_value; end if;
    if status_value not in ('available','reserved','out_of_service','pending') then raise exception 'Invalid availability status for %',room_value; end if;
    sex_value := case lower(coalesce(item->>'sex','')) when 'male' then 'male'::public.participant_sex when 'female' then 'female'::public.participant_sex else null end;
    room_key := private.housing_inventory_key_v1(hall_value,area_value,floor_value,room_value);
    building_value := hall_value || case when area_value is not null then ' · ' || area_value else '' end;

    if exists(select 1 from public.housing_rooms r where r.session_id=p_session_id and r.inventory_key=room_key) then
      update public.housing_rooms r
      set hall=hall_value,area=area_value,floor=floor_value,building=building_value,
          room_name=room_value,space_type=type_value,availability_status=status_value,
          sex=sex_value,capacity=capacity_value,notes=notes_value,active=true,
          source_name=nullif(trim(coalesce(p_source_name,'')),''),source_sheet=source_sheet_value,
          source_row=source_row_value,sort_index=sort_value,updated_at=now()
      where r.session_id=p_session_id and r.inventory_key=room_key;
      updated_count := updated_count + 1;
    else
      insert into public.housing_rooms(
        session_id,hall,area,floor,building,room_name,space_type,availability_status,sex,capacity,
        notes,active,created_by,inventory_key,source_name,source_sheet,source_row,sort_index
      ) values(
        p_session_id,hall_value,area_value,floor_value,building_value,room_value,type_value,status_value,sex_value,capacity_value,
        notes_value,true,(select auth.uid()),room_key,nullif(trim(coalesce(p_source_name,'')),''),source_sheet_value,source_row_value,sort_value
      );
      inserted_count := inserted_count + 1;
    end if;
    room_count := room_count + 1;
    total_capacity := total_capacity + capacity_value;
  end loop;

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_session_id,(select auth.uid()),'housing_inventory_imported','housing_inventory',p_session_id::text,
    jsonb_build_object('source_name',nullif(trim(coalesce(p_source_name,'')),''),'rows',room_count,'inserted',inserted_count,
      'updated',updated_count,'capacity',total_capacity,'omitted_rooms_changed',false,'plans_cleared',plans_cleared));
  return jsonb_build_object('rows',room_count,'inserted',inserted_count,'updated',updated_count,'capacity',total_capacity,
    'omitted_rooms_changed',false,'plans_cleared',plans_cleared);
end;
$$;

create or replace function public.save_housing_inventory_room_v1(
  p_session_id uuid,
  p_room_id uuid,
  p_hall text,
  p_area text default null,
  p_floor text default null,
  p_room_name text default null,
  p_space_type text default 'room',
  p_availability_status text default 'available',
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
  old_row public.housing_rooms%rowtype;
  room_key text;
  building_value text;
  occupancy integer := 0;
  session_live boolean := false;
  planned boolean := false;
  plans_cleared integer := 0;
  clean_hall text := nullif(trim(coalesce(p_hall,'')),'');
  clean_area text := nullif(trim(coalesce(p_area,'')),'');
  clean_floor text := nullif(trim(coalesce(p_floor,'')),'');
  clean_room text := nullif(trim(coalesce(p_room_name,'')),'');
  clean_type text := lower(coalesce(nullif(trim(p_space_type),''),'room'));
  clean_status text := lower(coalesce(nullif(trim(p_availability_status),''),'available'));
  clean_notes text := nullif(trim(coalesce(p_notes,'')),'');
begin
  if not private.has_capability(p_session_id,'housing_manage') then raise exception 'Your account cannot manage Housing'; end if;
  if clean_hall is null then raise exception 'Hall or main housing location is required'; end if;
  if clean_room is null then raise exception 'Room name is required'; end if;
  if p_capacity<1 or p_capacity>50 then raise exception 'Room capacity must be between 1 and 50'; end if;
  if clean_type not in ('room','flat','executive','other') then raise exception 'Choose a valid housing space type'; end if;
  if clean_status not in ('available','reserved','out_of_service','pending') then raise exception 'Choose a valid availability status'; end if;

  room_key := private.housing_inventory_key_v1(clean_hall,clean_area,clean_floor,clean_room);
  building_value := clean_hall || case when clean_area is not null then ' · ' || clean_area else '' end;
  select exists(select 1 from public.housing_assignments a where a.session_id=p_session_id and a.active) into session_live;

  if p_room_id is null then
    insert into public.housing_rooms(session_id,hall,area,floor,building,room_name,space_type,availability_status,sex,capacity,notes,active,created_by,inventory_key,source_name)
    values(p_session_id,clean_hall,clean_area,clean_floor,building_value,clean_room,clean_type,clean_status,p_sex,p_capacity,clean_notes,true,(select auth.uid()),room_key,'Manual Housing inventory')
    returning id into rid;
  else
    select * into old_row from public.housing_rooms where id=p_room_id and session_id=p_session_id for update;
    if old_row.id is null then raise exception 'Housing room not found'; end if;
    select count(*)::integer into occupancy from public.housing_assignments a where a.room_id=p_room_id and a.active;
    if p_capacity<occupancy then raise exception 'Capacity cannot be lower than the current occupancy of %',occupancy; end if;
    if occupancy>0 and clean_status<>'available' then raise exception 'Move current occupants before making this room unavailable'; end if;
    if occupancy>0 and p_sex is distinct from old_row.sex then raise exception 'Move current occupants before changing this room between Male and Female'; end if;
    select exists(select 1 from public.housing_room_plans hp where hp.room_id=p_room_id and hp.session_id=p_session_id and hp.plan_kind='company') into planned;
    if session_live and planned and (
      clean_type is distinct from old_row.space_type or clean_status is distinct from old_row.availability_status or
      p_sex is distinct from old_row.sex or p_capacity is distinct from old_row.capacity
    ) then raise exception 'This room is part of the saved company plan. After live assignments begin, change its label/location only or manage people through Live Housing.'; end if;

    update public.housing_rooms
    set hall=clean_hall,area=clean_area,floor=clean_floor,building=building_value,room_name=clean_room,
        space_type=clean_type,availability_status=clean_status,sex=p_sex,capacity=p_capacity,notes=clean_notes,
        inventory_key=room_key,source_name=coalesce(source_name,'Manual Housing inventory'),updated_at=now()
    where id=p_room_id and session_id=p_session_id returning id into rid;
  end if;

  if not session_live then
    with deleted as (delete from public.housing_room_plans hp where hp.session_id=p_session_id and hp.plan_kind='company' returning 1)
    select count(*)::integer into plans_cleared from deleted;
  end if;
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_session_id,(select auth.uid()),case when p_room_id is null then 'housing_inventory_room_created' else 'housing_inventory_room_updated' end,
    'housing_room',rid::text,jsonb_build_object('hall',clean_hall,'area',clean_area,'floor',clean_floor,'room_name',clean_room,
      'space_type',clean_type,'availability_status',clean_status,'sex',p_sex,'capacity',p_capacity,'plans_cleared',plans_cleared));
  return rid;
exception when unique_violation then raise exception 'A room with this hall, area, floor and room name already exists';
end;
$$;

-- Keep older room editor and create-and-assign screens compatible with inventory_key and V8 safety rules.
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
declare existing public.housing_rooms%rowtype;
begin
  if p_room_id is not null then select * into existing from public.housing_rooms where id=p_room_id and session_id=p_session_id; end if;
  return public.save_housing_inventory_room_v1(
    p_session_id,p_room_id,
    coalesce(nullif(existing.hall,''),nullif(trim(coalesce(p_building,'')),''),'Housing'),
    existing.area,p_floor,p_room_name,coalesce(existing.space_type,'room'),coalesce(existing.availability_status,'available'),
    p_sex,p_capacity,p_notes
  );
end;
$$;

-- Live Housing should only load spaces that can actually become assignment choices.
create or replace function public.get_housing_rooms(p_session_id uuid)
returns table(id uuid,room_name text,building text,floor text,sex public.participant_sex,capacity integer,occupancy bigint,notes text)
language sql stable security definer set search_path=''
as $$
  select r.id,r.room_name,r.building,r.floor,r.sex,r.capacity,count(a.id) filter(where a.active),r.notes
  from public.housing_rooms r left join public.housing_assignments a on a.room_id=r.id and a.active
  where r.session_id=p_session_id and r.active and r.availability_status='available' and r.sex is not null
    and private.has_capability(p_session_id,'housing_view')
  group by r.id
  order by coalesce(r.sort_index,2147483647),coalesce(r.building,''),coalesce(r.floor,''),r.room_name;
$$;

revoke all on function public.import_housing_inventory_v1(uuid,text,jsonb) from public,anon;
revoke all on function public.save_housing_inventory_room_v1(uuid,uuid,text,text,text,text,text,text,public.participant_sex,integer,text) from public,anon;
revoke all on function public.save_housing_room(uuid,uuid,text,text,text,public.participant_sex,integer,text) from public,anon;
revoke all on function public.get_housing_rooms(uuid) from public,anon;
grant execute on function public.import_housing_inventory_v1(uuid,text,jsonb) to authenticated;
grant execute on function public.save_housing_inventory_room_v1(uuid,uuid,text,text,text,text,text,text,public.participant_sex,integer,text) to authenticated;
grant execute on function public.save_housing_room(uuid,uuid,text,text,text,public.participant_sex,integer,text) to authenticated;
grant execute on function public.get_housing_rooms(uuid) to authenticated;

comment on function public.import_housing_inventory_v1(uuid,text,jsonb)
is 'Additive pre-live Housing inventory import. Omitted rooms are preserved, and saved company planning metadata is cleared for recalculation.';
comment on function public.save_housing_inventory_room_v1(uuid,uuid,text,text,text,text,text,text,public.participant_sex,integer,text)
is 'Creates or reviews one physical Housing inventory unit without changing any person assignment.';
