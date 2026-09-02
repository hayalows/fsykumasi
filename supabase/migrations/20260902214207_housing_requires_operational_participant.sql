create or replace function public.assign_housing_person(p_session_id uuid,p_person_type text,p_person_id uuid,p_room_id uuid,p_bed_label text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare room_row public.housing_rooms%rowtype; person_sex public.participant_sex; previous_id uuid; new_id uuid; occupancy integer;
begin
 if not private.has_capability(p_session_id,'housing_manage') then raise exception 'Your account cannot manage Housing'; end if;
 select * into room_row from public.housing_rooms where id=p_room_id and session_id=p_session_id and active for update;
 if room_row.id is null then raise exception 'Housing room not found'; end if;
 if p_person_type='participant' then
  if not private.operational_participant_is_eligible(p_session_id,p_person_id) then raise exception 'Only currently eligible participants can be assigned to Housing'; end if;
  select sex into person_sex from public.participants where id=p_person_id and session_id=p_session_id;
  if person_sex is null then raise exception 'Participant not found'; end if;
  select id into previous_id from public.housing_assignments where session_id=p_session_id and participant_id=p_person_id and active for update;
 elsif p_person_type='staff' then
  select sex into person_sex from public.staff where id=p_person_id and session_id=p_session_id and is_current;
  if not found then raise exception 'Staff member not found'; end if;
  select id into previous_id from public.housing_assignments where session_id=p_session_id and staff_id=p_person_id and active for update;
 else raise exception 'Person type must be participant or staff'; end if;
 if room_row.sex is not null and person_sex is not null and room_row.sex<>person_sex then raise exception 'This room is assigned to the other sex'; end if;
 select count(*) into occupancy from public.housing_assignments where room_id=p_room_id and active and id is distinct from previous_id;
 if occupancy>=room_row.capacity then raise exception 'This room is already at capacity'; end if;
 if previous_id is not null then update public.housing_assignments set active=false,ended_at=now() where id=previous_id; end if;
 insert into public.housing_assignments(session_id,room_id,participant_id,staff_id,bed_label,assigned_by,moved_from_id)
 values(p_session_id,p_room_id,case when p_person_type='participant' then p_person_id end,case when p_person_type='staff' then p_person_id end,nullif(trim(coalesce(p_bed_label,'')),''),(select auth.uid()),previous_id)
 returning id into new_id;
 insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
 values(p_session_id,(select auth.uid()),case when previous_id is null then 'housing_assigned' else 'housing_moved' end,'housing_assignment',new_id::text,jsonb_build_object('person_type',p_person_type,'person_id',p_person_id,'room_id',p_room_id,'previous_assignment_id',previous_id));
 return new_id;
end; $$;
revoke all on function public.assign_housing_person(uuid,text,uuid,uuid,text) from public,anon;
grant execute on function public.assign_housing_person(uuid,text,uuid,uuid,text) to authenticated;