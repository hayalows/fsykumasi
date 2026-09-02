create or replace function public.set_participant_attendance_status(p_participant_id uuid,p_status text,p_note text default null)
returns void language plpgsql security definer set search_path='' as $$
declare target public.participants%rowtype;
begin
 select * into target from public.participants where id=p_participant_id for update;
 if target.id is null then raise exception 'Participant not found'; end if;
 if not (private.has_capability(target.session_id,'registration_manage') or private.has_session_role(target.session_id,array['coordinator','logistics_admin','session_director']::public.app_role[])) then raise exception 'Your account cannot change attendance status'; end if;
 if p_status not in ('expected','confirmed_not_attending') then raise exception 'Invalid attendance status'; end if;
 update public.participants set attendance_status=p_status,attendance_note=nullif(trim(coalesce(p_note,'')),''),attendance_updated_by=(select auth.uid()),attendance_updated_at=now(),updated_at=now() where id=target.id;
 insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
 values(target.session_id,(select auth.uid()),case when p_status='confirmed_not_attending' then 'participant_confirmed_not_attending' else 'participant_returned_to_expected' end,'participant',target.id::text,jsonb_build_object('note',nullif(trim(coalesce(p_note,'')),'')));
end; $$;

create or replace function private.operational_participant_is_eligible(target_session uuid,target_participant uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.participants p
  join public.sessions s on s.id=p.session_id
  join public.participant_private_details d on d.participant_id=p.id
  where p.id=target_participant and p.session_id=target_session and p.is_current
    and p.registration_status='approved' and p.verification_status='verified'
    and p.attendance_status<>'confirmed_not_attending'
    and d.date_of_birth is not null and s.starts_on is not null and s.ends_on is not null
    and extract(year from s.starts_on)::int-extract(year from d.date_of_birth)::int>=14
    and s.ends_on<(d.date_of_birth+interval '19 years')::date
 );
$$;

create or replace function public.get_participant_eligibility(p_session_id uuid)
returns table(participant_id uuid,eligible boolean,reason text)
language sql stable security definer set search_path='' as $$
 select p.id,
   private.operational_participant_is_eligible(p_session_id,p.id),
   case
    when p.attendance_status='confirmed_not_attending' then 'Confirmed not attending'
    when not p.is_current then 'Not current in latest registration snapshot'
    when p.registration_status<>'approved' then 'Registration is not approved'
    when p.verification_status<>'verified' then 'Needs verification'
    when d.date_of_birth is null then 'Date of birth is missing'
    when extract(year from s.starts_on)::int-extract(year from d.date_of_birth)::int<14 then 'Too young for this FSY year'
    when not(s.ends_on<(d.date_of_birth+interval '19 years')::date) then 'Turns 19 before or on the end of this session'
    else 'Eligible' end
 from public.participants p
 join public.sessions s on s.id=p.session_id
 left join public.participant_private_details d on d.participant_id=p.id
 where p.session_id=p_session_id and (
   private.has_session_role(p_session_id,array['coordinator','logistics_admin','session_director']::public.app_role[])
   or private.has_team_capability(p_session_id,'people_lookup')
   or exists(select 1 from public.counselor_groups g where g.id=p.group_id and private.can_access_company(p_session_id,g.company_id))
 );
$$;

create table if not exists public.staff_birthday_acknowledgements(
 session_id uuid not null references public.sessions(id) on delete cascade,
 staff_id uuid not null references public.staff(id) on delete cascade,
 acknowledged_by uuid not null references public.profiles(user_id),
 acknowledged_at timestamptz not null default now(),
 primary key(session_id,staff_id)
);

create or replace function public.get_staff_birthdays(p_session_id uuid)
returns table(staff_id uuid,display_name text,birthday_date date,staff_role text,company_name text,acknowledged boolean,acknowledged_at timestamptz)
language sql stable security definer set search_path='' as $$
 select s.id,s.full_name,private.birthday_in_year(d.date_of_birth,extract(year from se.starts_on)::int),s.operational_role,
   coalesce(nullif(c.custom_name,''),c.name),(ba.staff_id is not null),ba.acknowledged_at
 from public.sessions se
 join public.staff s on s.session_id=se.id
 join public.staff_private_details d on d.staff_id=s.id
 left join public.companies c on c.id=s.assigned_company_id
 left join public.staff_birthday_acknowledgements ba on ba.session_id=se.id and ba.staff_id=s.id
 where se.id=p_session_id and private.has_session_access(se.id)
   and s.is_current and s.registration_status='approved' and s.operational_role='counselor'
   and private.birthday_in_year(d.date_of_birth,extract(year from se.starts_on)::int) between se.starts_on and se.ends_on
 order by 3,2;
$$;

create or replace function public.set_staff_birthday_acknowledgement(p_session_id uuid,p_staff_id uuid,p_acknowledged boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.get_staff_birthdays(p_session_id) b where b.staff_id=p_staff_id) then raise exception 'Counselor birthday is not available in this session'; end if;
 if p_acknowledged then
  insert into public.staff_birthday_acknowledgements(session_id,staff_id,acknowledged_by)
  values(p_session_id,p_staff_id,(select auth.uid()))
  on conflict(session_id,staff_id) do update set acknowledged_by=excluded.acknowledged_by,acknowledged_at=now();
 else delete from public.staff_birthday_acknowledgements where session_id=p_session_id and staff_id=p_staff_id; end if;
 insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id)
 values(p_session_id,(select auth.uid()),case when p_acknowledged then 'staff_birthday_acknowledged' else 'staff_birthday_acknowledgement_undone' end,'staff',p_staff_id::text);
end; $$;

alter table public.staff_birthday_acknowledgements enable row level security;
revoke all on public.staff_birthday_acknowledgements from anon,authenticated;
grant select on public.staff_birthday_acknowledgements to authenticated;
create policy "session members read staff birthday acknowledgements" on public.staff_birthday_acknowledgements for select to authenticated using(private.has_session_access(session_id));

grant execute on function public.set_participant_attendance_status(uuid,text,text) to authenticated;
grant execute on function public.get_participant_eligibility(uuid) to authenticated;
grant execute on function public.get_staff_birthdays(uuid) to authenticated;
grant execute on function public.set_staff_birthday_acknowledgement(uuid,uuid,boolean) to authenticated;