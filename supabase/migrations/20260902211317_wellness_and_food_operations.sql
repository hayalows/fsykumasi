create table if not exists public.wellness_encounters(
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete cascade,
  concern text,
  care_provided text,
  medicine_provided text,
  outcome text not null default 'receiving_support',
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  recorded_by uuid not null references public.profiles(user_id),
  updated_by uuid references public.profiles(user_id),
  updated_at timestamptz not null default now(),
  constraint wellness_person_check check((participant_id is not null)::int+(staff_id is not null)::int=1),
  constraint wellness_outcome_check check(outcome in ('receiving_support','returned_to_activity','follow_up_needed','sent_home','referred_off_site','emergency_escalation'))
);
create index if not exists wellness_session_started_idx on public.wellness_encounters(session_id,started_at desc);

create or replace function public.create_wellness_encounter(p_session_id uuid,p_person_type text,p_person_id uuid,p_concern text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare eid uuid;
begin
 if not private.has_capability(p_session_id,'wellness_manage') then raise exception 'Your account cannot record Wellness visits'; end if;
 if p_person_type='participant' then
  if not exists(select 1 from public.participants where id=p_person_id and session_id=p_session_id) then raise exception 'Participant not found'; end if;
  insert into public.wellness_encounters(session_id,participant_id,concern,recorded_by) values(p_session_id,p_person_id,nullif(trim(coalesce(p_concern,'')),''),(select auth.uid())) returning id into eid;
 elsif p_person_type='staff' then
  if not exists(select 1 from public.staff where id=p_person_id and session_id=p_session_id) then raise exception 'Staff member not found'; end if;
  insert into public.wellness_encounters(session_id,staff_id,concern,recorded_by) values(p_session_id,p_person_id,nullif(trim(coalesce(p_concern,'')),''),(select auth.uid())) returning id into eid;
 else raise exception 'Person type must be participant or staff'; end if;
 insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
 values(p_session_id,(select auth.uid()),'wellness_visit_started','wellness_encounter',eid::text,jsonb_build_object('person_type',p_person_type,'person_id',p_person_id));
 return eid;
end; $$;

create or replace function public.update_wellness_encounter(p_encounter_id uuid,p_concern text,p_care_provided text,p_medicine_provided text,p_outcome text,p_close boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare target_session uuid;
begin
 select session_id into target_session from public.wellness_encounters where id=p_encounter_id for update;
 if target_session is null then raise exception 'Wellness visit not found'; end if;
 if not private.has_capability(target_session,'wellness_manage') then raise exception 'Your account cannot update Wellness visits'; end if;
 if p_outcome not in ('receiving_support','returned_to_activity','follow_up_needed','sent_home','referred_off_site','emergency_escalation') then raise exception 'Invalid Wellness outcome'; end if;
 update public.wellness_encounters set concern=nullif(trim(coalesce(p_concern,'')),''),care_provided=nullif(trim(coalesce(p_care_provided,'')),''),medicine_provided=nullif(trim(coalesce(p_medicine_provided,'')),''),outcome=p_outcome,
   closed_at=case when p_close or p_outcome in ('returned_to_activity','sent_home','referred_off_site','emergency_escalation') then coalesce(closed_at,now()) else null end,
   updated_by=(select auth.uid()),updated_at=now() where id=p_encounter_id;
 insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
 values(target_session,(select auth.uid()),'wellness_visit_updated','wellness_encounter',p_encounter_id::text,jsonb_build_object('outcome',p_outcome,'closed',p_close));
end; $$;

create or replace function public.get_wellness_encounters(p_session_id uuid)
returns table(encounter_id uuid,person_type text,person_id uuid,display_name text,concern text,care_provided text,medicine_provided text,outcome text,started_at timestamptz,closed_at timestamptz,recorded_by_name text)
language sql stable security definer set search_path='' as $$
 select w.id,'participant'::text,p.id,trim(concat_ws(' ',p.first_name,p.last_name)),w.concern,w.care_provided,w.medicine_provided,w.outcome,w.started_at,w.closed_at,pr.display_name
 from public.wellness_encounters w join public.participants p on p.id=w.participant_id left join public.profiles pr on pr.user_id=w.recorded_by
 where w.session_id=p_session_id and private.has_capability(p_session_id,'wellness_private')
 union all
 select w.id,'staff'::text,s.id,s.full_name,w.concern,w.care_provided,w.medicine_provided,w.outcome,w.started_at,w.closed_at,pr.display_name
 from public.wellness_encounters w join public.staff s on s.id=w.staff_id left join public.profiles pr on pr.user_id=w.recorded_by
 where w.session_id=p_session_id and private.has_capability(p_session_id,'wellness_private')
 order by 9 desc;
$$;

create or replace function public.get_wellness_person_details(p_session_id uuid,p_person_type text,p_person_id uuid)
returns table(medical_information text,dietary_information text,phone text,emergency_contact_name text,emergency_contact_phone text)
language sql stable security definer set search_path='' as $$
 select d.medical_information,d.dietary_information,d.phone,d.contact_1_name,d.contact_1_phone
 from public.participant_private_details d where p_person_type='participant' and d.session_id=p_session_id and d.participant_id=p_person_id and private.has_capability(p_session_id,'wellness_private')
 union all
 select d.medical_information,d.dietary_information,d.phone,d.contact_1_name,d.contact_1_phone
 from public.staff_private_details d where p_person_type='staff' and d.session_id=p_session_id and d.staff_id=p_person_id and private.has_capability(p_session_id,'wellness_private');
$$;

create table if not exists public.food_acknowledgements(
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete cascade,
  acknowledged_by uuid not null references public.profiles(user_id),
  acknowledged_at timestamptz not null default now(),
  note text,
  constraint food_ack_person_check check((participant_id is not null)::int+(staff_id is not null)::int=1)
);
create unique index if not exists food_ack_participant_idx on public.food_acknowledgements(session_id,participant_id) where participant_id is not null;
create unique index if not exists food_ack_staff_idx on public.food_acknowledgements(session_id,staff_id) where staff_id is not null;

create or replace function public.get_food_needs(p_session_id uuid)
returns table(person_type text,person_id uuid,display_name text,dietary_information text,group_name text,company_name text,acknowledged boolean,acknowledged_at timestamptz)
language sql stable security definer set search_path='' as $$
 select 'participant'::text,p.id,trim(concat_ws(' ',p.first_name,p.last_name)),d.dietary_information,coalesce(nullif(g.custom_name,''),g.name),coalesce(nullif(c.custom_name,''),c.name),(fa.id is not null),fa.acknowledged_at
 from public.participants p join public.participant_private_details d on d.participant_id=p.id
 left join public.counselor_groups g on g.id=p.group_id left join public.companies c on c.id=g.company_id
 left join public.food_acknowledgements fa on fa.session_id=p_session_id and fa.participant_id=p.id
 where p.session_id=p_session_id and p.is_current and p.registration_status='approved'
   and nullif(trim(coalesce(d.dietary_information,'')),'') is not null and private.has_capability(p_session_id,'food_view')
 union all
 select 'staff'::text,s.id,s.full_name,d.dietary_information,null::text,coalesce(nullif(c.custom_name,''),c.name),(fa.id is not null),fa.acknowledged_at
 from public.staff s join public.staff_private_details d on d.staff_id=s.id left join public.companies c on c.id=s.assigned_company_id
 left join public.food_acknowledgements fa on fa.session_id=p_session_id and fa.staff_id=s.id
 where s.session_id=p_session_id and s.is_current and s.registration_status='approved'
   and nullif(trim(coalesce(d.dietary_information,'')),'') is not null and private.has_capability(p_session_id,'food_view')
 order by 7,3;
$$;

create or replace function public.set_food_acknowledgement(p_session_id uuid,p_person_type text,p_person_id uuid,p_acknowledged boolean,p_note text default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_capability(p_session_id,'food_manage') then raise exception 'Your account cannot manage Food'; end if;
 if p_person_type='participant' then
  if p_acknowledged then
   insert into public.food_acknowledgements(session_id,participant_id,acknowledged_by,note)
   values(p_session_id,p_person_id,(select auth.uid()),nullif(trim(coalesce(p_note,'')),''))
   on conflict (session_id,participant_id) where participant_id is not null do update set acknowledged_by=excluded.acknowledged_by,acknowledged_at=now(),note=excluded.note;
  else delete from public.food_acknowledgements where session_id=p_session_id and participant_id=p_person_id; end if;
 elsif p_person_type='staff' then
  if p_acknowledged then
   insert into public.food_acknowledgements(session_id,staff_id,acknowledged_by,note)
   values(p_session_id,p_person_id,(select auth.uid()),nullif(trim(coalesce(p_note,'')),''))
   on conflict (session_id,staff_id) where staff_id is not null do update set acknowledged_by=excluded.acknowledged_by,acknowledged_at=now(),note=excluded.note;
  else delete from public.food_acknowledgements where session_id=p_session_id and staff_id=p_person_id; end if;
 else raise exception 'Person type must be participant or staff'; end if;
 insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
 values(p_session_id,(select auth.uid()),case when p_acknowledged then 'food_need_acknowledged' else 'food_need_reopened' end,'person',p_person_id::text,jsonb_build_object('person_type',p_person_type));
end; $$;

alter table public.wellness_encounters enable row level security;
alter table public.food_acknowledgements enable row level security;
revoke all on public.wellness_encounters,public.food_acknowledgements from anon,authenticated;
grant select on public.wellness_encounters,public.food_acknowledgements to authenticated;
create policy "wellness team reads encounters" on public.wellness_encounters for select to authenticated using(private.has_capability(session_id,'wellness_private'));
create policy "food team reads acknowledgements" on public.food_acknowledgements for select to authenticated using(private.has_capability(session_id,'food_view'));

grant execute on function public.create_wellness_encounter(uuid,text,uuid,text) to authenticated;
grant execute on function public.update_wellness_encounter(uuid,text,text,text,text,boolean) to authenticated;
grant execute on function public.get_wellness_encounters(uuid) to authenticated;
grant execute on function public.get_wellness_person_details(uuid,text,uuid) to authenticated;
grant execute on function public.get_food_needs(uuid) to authenticated;
grant execute on function public.set_food_acknowledgement(uuid,text,uuid,boolean,text) to authenticated;