-- Housing assignment v2 keeps same-room edits in place and records an optional reason for room moves.
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
set search_path = ''
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
  if not private.has_capability(p_session_id,'housing_manage') then
    raise exception 'Your account cannot manage Housing';
  end if;

  if clean_reason is not null and char_length(clean_reason) > 240 then
    raise exception 'Room change reason must be 240 characters or fewer';
  end if;

  select * into room_row
    from public.housing_rooms
    where id=p_room_id and session_id=p_session_id and active
    for update;
  if room_row.id is null then raise exception 'Housing room not found'; end if;

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
  elsif p_person_type='staff' then
    select s.sex into person_sex
      from public.staff s
      where s.id=p_person_id and s.session_id=p_session_id and s.is_current;
    if not found then raise exception 'Staff member not found'; end if;
    select * into previous_row
      from public.housing_assignments
      where session_id=p_session_id and staff_id=p_person_id and active
      for update;
  else
    raise exception 'Person type must be participant or staff';
  end if;

  if room_row.sex is not null and person_sex is not null and room_row.sex<>person_sex then
    raise exception 'This room is assigned to the other sex';
  end if;

  -- Editing only the bed/key label should not create a false room-move history record.
  if previous_row.id is not null and previous_row.room_id=p_room_id then
    if previous_row.bed_label is distinct from clean_bed then
      update public.housing_assignments
        set bed_label=clean_bed
        where id=previous_row.id;
      insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
      values(
        p_session_id,
        (select auth.uid()),
        'housing_assignment_updated',
        'housing_assignment',
        previous_row.id::text,
        jsonb_build_object(
          'person_type',p_person_type,
          'person_id',p_person_id,
          'room_id',p_room_id,
          'bed_label',clean_bed
        )
      );
    end if;
    return previous_row.id;
  end if;

  select count(*) into occupancy
    from public.housing_assignments
    where room_id=p_room_id and active and id is distinct from previous_row.id;
  if occupancy>=room_row.capacity then raise exception 'This room is already at capacity'; end if;

  if previous_row.id is not null then
    update public.housing_assignments
      set active=false,ended_at=now()
      where id=previous_row.id;
  end if;

  insert into public.housing_assignments(session_id,room_id,participant_id,staff_id,bed_label,assigned_by,moved_from_id)
  values(
    p_session_id,
    p_room_id,
    case when p_person_type='participant' then p_person_id end,
    case when p_person_type='staff' then p_person_id end,
    clean_bed,
    (select auth.uid()),
    previous_row.id
  )
  returning id into new_id;

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(
    p_session_id,
    (select auth.uid()),
    case when previous_row.id is null then 'housing_assigned' else 'housing_moved' end,
    'housing_assignment',
    new_id::text,
    jsonb_build_object(
      'person_type',p_person_type,
      'person_id',p_person_id,
      'room_id',p_room_id,
      'previous_assignment_id',previous_row.id,
      'previous_room_id',previous_row.room_id,
      'move_reason',case when previous_row.id is null then null else clean_reason end
    )
  );

  return new_id;
end;
$$;

revoke all on function public.assign_housing_person_v2(uuid,text,uuid,uuid,text,text) from public,anon;
grant execute on function public.assign_housing_person_v2(uuid,text,uuid,uuid,text,text) to authenticated;

comment on function public.assign_housing_person_v2(uuid,text,uuid,uuid,text,text)
is 'Assigns or moves a participant/staff member in Housing, preserving same-room bed/key edits and recording an optional move reason in the audit event.';

-- Create-and-assign v2 carries the optional room-move reason through the same transaction.
create or replace function public.create_housing_room_and_assign_v2(
  p_session_id uuid,
  p_person_type text,
  p_person_id uuid,
  p_room_name text,
  p_building text default null,
  p_floor text default null,
  p_capacity integer default 4,
  p_notes text default null,
  p_bed_label text default null,
  p_move_reason text default null
)
returns table(room_id uuid, assignment_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  person_sex public.participant_sex;
  new_room_id uuid;
  new_assignment_id uuid;
begin
  if not private.has_capability(p_session_id,'housing_manage') then
    raise exception 'Your account cannot manage Housing';
  end if;

  if p_person_type='participant' then
    if not private.operational_participant_is_eligible(p_session_id,p_person_id) then
      raise exception 'Only currently eligible participants can be assigned to Housing';
    end if;
    select p.sex into person_sex
      from public.participants p
      where p.id=p_person_id and p.session_id=p_session_id and p.is_current;
    if not found then raise exception 'Participant not found'; end if;
    if person_sex is null then raise exception 'Record this participant''s sex before creating a Housing room for them'; end if;
  elsif p_person_type='staff' then
    select s.sex into person_sex
      from public.staff s
      where s.id=p_person_id and s.session_id=p_session_id and s.is_current;
    if not found then raise exception 'Staff member not found'; end if;
  else
    raise exception 'Person type must be participant or staff';
  end if;

  new_room_id := public.save_housing_room(
    p_session_id,
    null,
    p_room_name,
    p_building,
    p_floor,
    person_sex,
    p_capacity,
    p_notes
  );

  new_assignment_id := public.assign_housing_person_v2(
    p_session_id,
    p_person_type,
    p_person_id,
    new_room_id,
    p_bed_label,
    p_move_reason
  );

  return query select new_room_id,new_assignment_id;
end;
$$;

revoke all on function public.create_housing_room_and_assign_v2(uuid,text,uuid,text,text,text,integer,text,text,text) from public,anon;
grant execute on function public.create_housing_room_and_assign_v2(uuid,text,uuid,text,text,text,integer,text,text,text) to authenticated;

comment on function public.create_housing_room_and_assign_v2(uuid,text,uuid,text,text,text,integer,text,text,text)
is 'Atomically creates a Housing room restricted to the selected person sex, assigns them, and preserves an optional move reason when replacing an existing room.';
