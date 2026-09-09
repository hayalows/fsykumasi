-- Kumasi pre-session decisions. Source registration values remain untouched.

alter table public.participant_operation_decisions
  add column if not exists local_clearance boolean not null default false,
  add column if not exists decision_kind text,
  add column if not exists batch_id uuid;

alter table public.staff_operations
  add column if not exists clearance_authority text,
  add column if not exists clearance_reason text,
  add column if not exists clearance_recorded_by uuid,
  add column if not exists clearance_recorded_at timestamptz,
  add column if not exists clearance_batch_id uuid;

alter table public.companies add column if not exists finalization_batch_id uuid;
alter table public.counselor_groups add column if not exists finalization_batch_id uuid;

create table if not exists public.session_finalization_batches (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  status text not null default 'applied' check(status in ('applied','rolled_back')),
  authority text not null,
  reason text not null,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  rolled_back_by uuid,
  rolled_back_at timestamptz,
  rollback_reason text
);
alter table public.session_finalization_batches enable row level security;
revoke all on public.session_finalization_batches from anon,authenticated;
grant select on public.session_finalization_batches to authenticated;
drop policy if exists "session leaders read finalization batches" on public.session_finalization_batches;
create policy "session leaders read finalization batches" on public.session_finalization_batches
for select to authenticated using(private.has_session_role(session_id,array['logistics_admin','coordinator','session_director']::public.app_role[]));

create or replace function private.session_finalization_leader(target_session uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select private.has_session_role(target_session,array['logistics_admin','coordinator','session_director']::public.app_role[]);
$$;

create or replace function private.session_finalization_age(target_session uuid,target_participant uuid)
returns integer language sql stable security definer set search_path='' as $$
 select coalesce(extract(year from age(s.starts_on,d.date_of_birth))::integer,p.age)
 from public.participants p join public.sessions s on s.id=p.session_id
 left join public.participant_private_details d on d.participant_id=p.id
 where p.session_id=target_session and p.id=target_participant;
$$;

create or replace function private.session_finalization_queue(target_session uuid)
returns table(participant_id uuid,participant_sex text,participant_age integer,decision_kind text)
language sql stable security definer set search_path='' as $$
 select p.id,p.sex::text,
   coalesce(extract(year from age(s.starts_on,d.date_of_birth))::integer,p.age),
   case when p.registration_status='awaiting' then 'pending_approval'
        when coalesce(extract(year from age(s.starts_on,d.date_of_birth))::integer,p.age) in (12,13,19) then 'age_exception'
        else 'placement_completion' end
 from public.participants p join public.sessions s on s.id=p.session_id
 left join public.participant_private_details d on d.participant_id=p.id
 where p.session_id=target_session and p.is_current
   and coalesce(p.operational_status,'active')='active'
   and p.registration_status<>'cancelled'
   and p.attendance_status<>'confirmed_not_attending'
   and p.verification_status='verified'
   and p.group_id is null
   and coalesce(extract(year from age(s.starts_on,d.date_of_birth))::integer,p.age) between 12 and 19;
$$;

-- Existing evidence fields stay evidence. local_clearance records the session-level exception separately.
create or replace function private.operational_participant_is_eligible(target_session uuid,target_participant uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select case
   when coalesce(p.operational_status,'active')<>'active' then false
   when o.cohort_state='excluded' then false
   when o.cohort_state='exception' then p.is_current and p.registration_status<>'cancelled'
     and p.attendance_status<>'confirmed_not_attending'
     and (coalesce(o.local_clearance,false) or (o.registration_confirmed and o.guardian_confirmed and o.leadership_confirmed))
   when coalesce(extract(year from age(s.starts_on,d.date_of_birth))::integer,p.age)>=20 then false
   else private.operational_participant_is_eligible_v25(target_session,target_participant) end
 from public.participants p join public.sessions s on s.id=p.session_id
 left join public.participant_private_details d on d.participant_id=p.id
 left join public.participant_operation_decisions o on o.participant_id=p.id
 where p.id=target_participant and p.session_id=target_session),false);
$$;

create or replace function public.record_participant_exception(
 p_participant_id uuid,p_allow boolean,p_authority text,p_reason text,
 p_registration_confirmed boolean,p_guardian_confirmed boolean,p_leadership_confirmed boolean)
returns void language plpgsql security definer set search_path='' as $$
declare p public.participants%rowtype;
begin
 select * into p from public.participants where id=p_participant_id for update;
 if p.id is null or not private.session_finalization_leader(p.session_id) then raise exception 'Session leadership access is required'; end if;
 if length(trim(coalesce(p_authority,'')))<3 or length(trim(coalesce(p_reason,'')))<5 then raise exception 'Record the confirming authority and reason'; end if;
 if p.registration_status='cancelled' then raise exception 'Cancelled source registration must be resolved separately'; end if;
 if not p_allow and (p.group_id is not null or exists(select 1 from public.housing_assignments h where h.participant_id=p.id and h.active)) then raise exception 'Resolve current placement before excluding this participant'; end if;
 insert into public.participant_operation_decisions(
   participant_id,cohort_state,registration_confirmed,guardian_confirmed,leadership_confirmed,
   local_clearance,decision_kind,authority,reason,recorded_by,recorded_at)
 values(p.id,case when p_allow then 'exception' else 'excluded' end,
   coalesce(p_registration_confirmed,false),coalesce(p_guardian_confirmed,false),coalesce(p_leadership_confirmed,false),
   p_allow,'manual_session_decision',trim(p_authority),trim(p_reason),auth.uid(),now())
 on conflict(participant_id) do update set cohort_state=excluded.cohort_state,
   registration_confirmed=excluded.registration_confirmed,guardian_confirmed=excluded.guardian_confirmed,
   leadership_confirmed=excluded.leadership_confirmed,local_clearance=excluded.local_clearance,
   decision_kind=excluded.decision_kind,authority=excluded.authority,reason=excluded.reason,
   recorded_by=auth.uid(),recorded_at=now(),revision=participant_operation_decisions.revision+1;
 if p_allow then update public.participants set is_current=true,attendance_status='expected' where id=p.id; end if;
 insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
 values(p.session_id,auth.uid(),'participant_exception_recorded','participant',p.id::text,
   jsonb_build_object('allowed',p_allow,'authority',trim(p_authority),'reason',trim(p_reason),'source_registration_status',p.registration_status,'local_clearance',p_allow));
end $$;
revoke all on function public.record_participant_exception(uuid,boolean,text,text,boolean,boolean,boolean) from public,anon;
grant execute on function public.record_participant_exception(uuid,boolean,text,text,boolean,boolean,boolean) to authenticated;

-- Logistics administrators have the same pre-session service-clearance control as session leadership.
create or replace function public.update_staff_operations(
 p_staff_id uuid,p_revision integer,p_planning text,p_arrival text,p_clearance text,
 p_authority text default '',p_reason text default '',p_duties text[] default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.staff%rowtype; old public.staff_operations%rowtype; result public.staff_operations%rowtype;
begin
 select * into s from public.staff where id=p_staff_id;
 if s.id is null or not private.has_capability(s.session_id,'staff_manage') then raise exception 'Staff management access is required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(s.session_id::text,38));
 select * into old from public.staff_operations where staff_id=s.id for update;
 if old.revision is distinct from p_revision then raise exception 'Staff record changed. Refresh and review again.'; end if;
 if p_clearance is distinct from old.service_clearance then
   if not private.session_finalization_leader(s.session_id) then raise exception 'Session leadership access is required to change service clearance'; end if;
   if length(trim(coalesce(p_authority,'')))<3 or length(trim(coalesce(p_reason,'')))<5 then raise exception 'Record the confirming authority and reason'; end if;
 end if;
 if p_arrival in ('no_show','left') and p_arrival is distinct from old.arrival_state and length(trim(coalesce(p_reason,'')))<5 then raise exception 'Record a reason for this arrival change'; end if;
 if p_duties is not null and cardinality(p_duties)>12 then raise exception 'Too many committee duties'; end if;
 update public.staff_operations set planning_state=p_planning,arrival_state=p_arrival,service_clearance=p_clearance,
   clearance_authority=case when p_clearance is distinct from old.service_clearance then nullif(trim(p_authority),'') else clearance_authority end,
   clearance_reason=case when p_clearance is distinct from old.service_clearance then nullif(trim(p_reason),'') else clearance_reason end,
   clearance_recorded_by=case when p_clearance is distinct from old.service_clearance then auth.uid() else clearance_recorded_by end,
   clearance_recorded_at=case when p_clearance is distinct from old.service_clearance then now() else clearance_recorded_at end,
   revision=revision+1,updated_by=auth.uid(),updated_at=now()
 where staff_id=s.id returning * into result;
 if p_duties is not null then
   delete from public.staff_committee_duties where staff_id=s.id;
   insert into public.staff_committee_duties(staff_id,duty,assigned_by)
   select s.id,trim(value),auth.uid() from unnest(p_duties) value where trim(value)<>'' on conflict do nothing;
 end if;
 insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
 values(s.session_id,auth.uid(),'staff_operations_updated','staff',s.id::text,
   jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(result),'authority',p_authority,'reason',p_reason,'duties',p_duties,'source_registration_status',s.registration_status));
 return to_jsonb(result);
end $$;
revoke all on function public.update_staff_operations(uuid,integer,text,text,text,text,text,text[]) from public,anon;
grant execute on function public.update_staff_operations(uuid,integer,text,text,text,text,text,text[]) to authenticated;

create or replace function public.preview_session_finalization_v1(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a integer:=0; live_a integer:=0; q integer:=0; wait_p integer:=0; age_p integer:=0; staff_p integer:=0;
 open_g integer:=0; f integer:=0; m integer:=0; ng integer:=0; nc integer:=0; active_p integer:=0; cc integer:=0; cg integer:=0;
begin
 if not private.session_finalization_leader(p_session_id) then raise exception 'Session leadership access is required'; end if;
 select count(*) into active_p from public.participants p where p.session_id=p_session_id and p.is_current and coalesce(p.operational_status,'active')='active';
 select count(*),count(*) filter(where decision_kind='pending_approval'),count(*) filter(where decision_kind='age_exception'),
   count(*) filter(where participant_sex='female'),count(*) filter(where participant_sex='male')
 into q,wait_p,age_p,f,m from private.session_finalization_queue(p_session_id);
 ng:=ceil(f/10.0)::integer+ceil(m/10.0)::integer; nc:=case when ng=0 then 0 else ceil(ng/3.0)::integer end;
 select count(*) into a from public.participants p join public.sessions s on s.id=p.session_id
 left join public.participant_private_details d on d.participant_id=p.id
 where p.session_id=p_session_id and p.is_current and coalesce(p.operational_status,'active')='active'
 and coalesce(extract(year from age(s.starts_on,d.date_of_birth))::integer,p.age)>=20;
 select count(*) into live_a from public.participants p join public.sessions s on s.id=p.session_id
 left join public.participant_private_details d on d.participant_id=p.id
 where p.session_id=p_session_id and p.is_current and coalesce(p.operational_status,'active')='active'
 and coalesce(extract(year from age(s.starts_on,d.date_of_birth))::integer,p.age)>=20
 and (p.group_id is not null or exists(select 1 from public.housing_assignments h where h.participant_id=p.id and h.active)
   or exists(select 1 from public.check_ins ci where ci.participant_id=p.id and ci.status='arrived'));
 select count(*) into staff_p from public.staff s where s.session_id=p_session_id and s.is_current and s.registration_status='awaiting';
 select count(*) into open_g from public.counselor_groups g where g.session_id=p_session_id and g.counselor_id is null;
 select count(*) into cc from public.companies c where c.session_id=p_session_id;
 select count(*) into cg from public.counselor_groups g where g.session_id=p_session_id;
 return jsonb_build_object('readyToApply',live_a=0,'activeParticipants',active_p,'participantsToPlace',q,
   'awaitingParticipants',wait_p,'ageExceptions',age_p,'adultsToExclude',a,'adultsWithLiveWork',live_a,
   'staffToClear',staff_p,'existingGroupsMissingCounselor',open_g,'femaleParticipantsToPlace',f,'maleParticipantsToPlace',m,
   'suggestedNewGroups',ng,'suggestedNewCompanies',nc,'currentCompanies',cc,'currentGroups',cg,'existingAssignmentsMoved',0);
end $$;
revoke all on function public.preview_session_finalization_v1(uuid) from public,anon;
grant execute on function public.preview_session_finalization_v1(uuid) to authenticated;
