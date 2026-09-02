-- Housing source of truth: rooms, occupancy, assignments, moves, audit-safe RPCs.
create table if not exists public.housing_rooms(
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  building text,
  floor text,
  room_name text not null,
  sex public.participant_sex,
  capacity integer not null default 1 check(capacity between 1 and 50),
  notes text,
  active boolean not null default true,
  created_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id,room_name)
);
create table if not exists public.housing_assignments(
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  room_id uuid not null references public.housing_rooms(id) on delete restrict,
  participant_id uuid references public.participants(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete cascade,
  bed_label text,
  active boolean not null default true,
  assigned_by uuid references public.profiles(user_id) on delete set null,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  moved_from_id uuid references public.housing_assignments(id) on delete set null,
  constraint housing_assignment_person_check check((participant_id is not null)::int+(staff_id is not null)::int=1)
);
create unique index if not exists housing_active_participant_idx on public.housing_assignments(session_id,participant_id) where active and participant_id is not null;
create unique index if not exists housing_active_staff_idx on public.housing_assignments(session_id,staff_id) where active and staff_id is not null;
create index if not exists housing_room_active_idx on public.housing_assignments(room_id,active);

create or replace function public.save_housing_room(p_session_id uuid,p_room_id uuid,p_room_name text,p_building text default null,p_floor text default null,p_sex public.participant_sex default null,p_capacity integer default 1,p_notes text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 if not private.has_capability(p_session_id,'housing_manage') then raise exception 'Your account cannot manage Housing'; end if;
 if nullif(trim(coalesce(p_room_name,'')),'') is null then raise exception 'Room name is required'; end if;
 if p_capacity<1 or p_capacity>50 then raise exception 'Room capacity must be between 1 and 50'; end if;
 if p_room_id is null then
  insert into public.housing_rooms(session_id,room_name,building,floor,sex,capacity,notes,created_by)
  values(p_session_id,trim(p_room_name),nullif(trim(coalesce(p_building,'')),''),nullif(trim(coalesce(p_floor,'')),''),p_sex,p_capacity,nullif(trim(coalesce(p_notes,'')),''),(select auth.uid())) returning id into rid;
 else
  update public.housing_rooms set room_name=trim(p_room_name),building=nullif(trim(coalesce(p_building,'')),''),floor=nullif(trim(coalesce(p_floor,'')),''),sex=p_sex,capacity=p_capacity,notes=nullif(trim(coalesce(p_notes,'')),''),updated_at=now()
  where id=p_room_id and session_id=p_session_id returning id into rid;
  if rid is null then raise exception 'Housing room not found'; end if;
 end if;
 insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id)
 values(p_session_id,(select auth.uid()),case when p_room_id is null then 'housing_room_created' else 'housing_room_updated' end,'housing_room',rid::text);
 return rid;
end; $$;

create or replace function public.assign_housing_person(p_session_id uuid,p_person_type text,p_person_id uuid,p_room_id uuid,p_bed_label text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare room_row public.housing_rooms%rowtype; person_sex public.participant_sex; previous_id uuid; new_id uuid; occupancy integer;
begin
 if not private.has_capability(p_session_id,'housing_manage') then raise exception 'Your account cannot manage Housing'; end if;
 select * into room_row from public.housing_rooms where id=p_room_id and session_id=p_session_id and active for update;
 if room_row.id is null then raise exception 'Housing room not found'; end if;
 if p_person_type='participant' then
  select sex into person_sex from public.participants where id=p_person_id and session_id=p_session_id and is_current;
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

create or replace function public.clear_housing_assignment(p_session_id uuid,p_person_type text,p_person_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare target_id uuid;
begin
 if not private.has_capability(p_session_id,'housing_manage') then raise exception 'Your account cannot manage Housing'; end if;
 select id into target_id from public.housing_assignments where session_id=p_session_id and active and ((p_person_type='participant' and participant_id=p_person_id) or (p_person_type='staff' and staff_id=p_person_id)) for update;
 if target_id is null then raise exception 'Active housing assignment not found'; end if;
 update public.housing_assignments set active=false,ended_at=now() where id=target_id;
 insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
 values(p_session_id,(select auth.uid()),'housing_unassigned','housing_assignment',target_id::text,jsonb_build_object('person_type',p_person_type,'person_id',p_person_id));
end; $$;

create or replace function public.get_housing_rooms(p_session_id uuid)
returns table(id uuid,room_name text,building text,floor text,sex public.participant_sex,capacity integer,occupancy bigint,notes text)
language sql stable security definer set search_path='' as $$
 select r.id,r.room_name,r.building,r.floor,r.sex,r.capacity,count(a.id) filter(where a.active),r.notes
 from public.housing_rooms r left join public.housing_assignments a on a.room_id=r.id and a.active
 where r.session_id=p_session_id and r.active and private.has_capability(p_session_id,'housing_view')
 group by r.id order by coalesce(r.building,''),coalesce(r.floor,''),r.room_name;
$$;
create or replace function public.get_housing_assignments(p_session_id uuid)
returns table(assignment_id uuid,room_id uuid,room_name text,person_type text,person_id uuid,display_name text,sex public.participant_sex,group_name text,company_name text,bed_label text,assigned_at timestamptz)
language sql stable security definer set search_path='' as $$
 select a.id,a.room_id,r.room_name,'participant'::text,p.id,trim(concat_ws(' ',p.first_name,p.last_name)),p.sex,coalesce(nullif(g.custom_name,''),g.name),coalesce(nullif(c.custom_name,''),c.name),a.bed_label,a.assigned_at
 from public.housing_assignments a join public.housing_rooms r on r.id=a.room_id join public.participants p on p.id=a.participant_id left join public.counselor_groups g on g.id=p.group_id left join public.companies c on c.id=g.company_id
 where a.session_id=p_session_id and a.active and private.has_capability(p_session_id,'housing_view')
 union all
 select a.id,a.room_id,r.room_name,'staff'::text,s.id,s.full_name,s.sex,null::text,coalesce(nullif(c.custom_name,''),c.name),a.bed_label,a.assigned_at
 from public.housing_assignments a join public.housing_rooms r on r.id=a.room_id join public.staff s on s.id=a.staff_id left join public.companies c on c.id=s.assigned_company_id
 where a.session_id=p_session_id and a.active and private.has_capability(p_session_id,'housing_view')
 order by 3,6;
$$;

alter table public.housing_rooms enable row level security;
alter table public.housing_assignments enable row level security;
revoke all on public.housing_rooms,public.housing_assignments from anon,authenticated;
grant select on public.housing_rooms,public.housing_assignments to authenticated;
create policy "housing team reads rooms" on public.housing_rooms for select to authenticated using(private.has_capability(session_id,'housing_view'));
create policy "housing team reads assignments" on public.housing_assignments for select to authenticated using(private.has_capability(session_id,'housing_view'));
grant execute on function public.save_housing_room(uuid,uuid,text,text,text,public.participant_sex,integer,text) to authenticated;
grant execute on function public.assign_housing_person(uuid,text,uuid,uuid,text) to authenticated;
grant execute on function public.clear_housing_assignment(uuid,text,uuid) to authenticated;
grant execute on function public.get_housing_rooms(uuid) to authenticated;
grant execute on function public.get_housing_assignments(uuid) to authenticated;
