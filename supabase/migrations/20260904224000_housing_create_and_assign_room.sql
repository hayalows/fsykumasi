-- Create a room for a person and assign them in one transaction.
-- The room restriction follows the selected person's recorded sex, so Housing
-- does not need to repeat that decision during a person-first assignment flow.
create or replace function public.create_housing_room_and_assign(
  p_session_id uuid,
  p_person_type text,
  p_person_id uuid,
  p_room_name text,
  p_building text default null,
  p_floor text default null,
  p_capacity integer default 4,
  p_notes text default null,
  p_bed_label text default null
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

  if p_person_type = 'participant' then
    if not private.operational_participant_is_eligible(p_session_id,p_person_id) then
      raise exception 'Only currently eligible participants can be assigned to Housing';
    end if;
    select p.sex into person_sex
      from public.participants p
      where p.id=p_person_id and p.session_id=p_session_id and p.is_current;
    if not found then raise exception 'Participant not found'; end if;
    if person_sex is null then raise exception 'Record this participant''s sex before creating a Housing room for them'; end if;
  elsif p_person_type = 'staff' then
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

  new_assignment_id := public.assign_housing_person(
    p_session_id,
    p_person_type,
    p_person_id,
    new_room_id,
    p_bed_label
  );

  return query select new_room_id,new_assignment_id;
end;
$$;

revoke all on function public.create_housing_room_and_assign(uuid,text,uuid,text,text,text,integer,text,text) from public,anon;
grant execute on function public.create_housing_room_and_assign(uuid,text,uuid,text,text,text,integer,text,text) to authenticated;

comment on function public.create_housing_room_and_assign(uuid,text,uuid,text,text,text,integer,text,text)
is 'Atomically creates a Housing room restricted to the selected person sex when known, then assigns that person to it.';
