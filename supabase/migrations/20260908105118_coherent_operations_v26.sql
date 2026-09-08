-- Additive operational state. Source registration and published identities stay intact.
create table if not exists public.staff_operations (
 staff_id uuid primary key references public.staff(id) on delete cascade,
 planning_state text not null check(planning_state in ('primary','reserve','provisional','excluded')),
 arrival_state text not null default 'expected' check(arrival_state in ('expected','arrived','no_show','left')),
 service_clearance text not null check(service_clearance in ('cleared','confirmation_required','not_cleared')),
 revision integer not null default 0,
 updated_by uuid, updated_at timestamptz not null default now()
);
alter table public.staff_operations enable row level security;
revoke all on public.staff_operations from anon,authenticated;
grant select on public.staff_operations to authenticated;
drop policy if exists "read visible staff operations" on public.staff_operations;
create policy "read visible staff operations" on public.staff_operations for select to authenticated using(exists(select 1 from public.staff s where s.id=staff_id));

create table if not exists public.staff_committee_duties (
 staff_id uuid not null references public.staff(id) on delete cascade,
 duty text not null check(length(trim(duty)) between 2 and 100),
 assigned_by uuid, assigned_at timestamptz not null default now(),
 primary key(staff_id,duty)
);
alter table public.staff_committee_duties enable row level security;
revoke all on public.staff_committee_duties from anon,authenticated;
grant select on public.staff_committee_duties to authenticated;
drop policy if exists "read visible staff duties" on public.staff_committee_duties;
create policy "read visible staff duties" on public.staff_committee_duties for select to authenticated using(exists(select 1 from public.staff s where s.id=staff_id));

create table if not exists public.participant_operation_decisions (
 participant_id uuid primary key references public.participants(id) on delete cascade,
 cohort_state text not null default 'normal' check(cohort_state in ('normal','excluded','exception')),
 registration_confirmed boolean not null default false,
 guardian_confirmed boolean not null default false,
 leadership_confirmed boolean not null default false,
 authority text, reason text, revision integer not null default 0,
 recorded_by uuid, recorded_at timestamptz not null default now()
);
alter table public.participant_operation_decisions enable row level security;
revoke all on public.participant_operation_decisions from anon,authenticated;
-- Decision evidence is leadership-only. Broad screens receive eligibility, not evidence.
grant select on public.participant_operation_decisions to authenticated;
drop policy if exists "directors read decision evidence" on public.participant_operation_decisions;
create policy "directors read decision evidence" on public.participant_operation_decisions for select to authenticated using(exists(select 1 from public.participants p where p.id=participant_id and private.has_session_role(p.session_id,array['session_director']::public.app_role[])));

insert into public.staff_operations(staff_id,planning_state,service_clearance)
select s.id,case when not s.is_current or s.registration_status='cancelled' then 'excluded' when s.registration_status='awaiting' or s.source_kind='on_site' then 'provisional' when exists(select 1 from public.counselor_groups g where g.counselor_id=s.id) or exists(select 1 from public.staff_company_assignments a where a.staff_id=s.id) then 'primary' else 'reserve' end,
case when s.registration_status='approved' and s.source_kind<>'on_site' then 'cleared' else 'confirmation_required' end
from public.staff s on conflict(staff_id) do nothing;

create or replace function private.initialize_staff_operations() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.staff_operations(staff_id,planning_state,service_clearance) values(new.id,case when not new.is_current or new.registration_status='cancelled' then 'excluded' when new.registration_status='awaiting' or new.source_kind='on_site' then 'provisional' else 'reserve' end,case when new.registration_status='approved' and new.source_kind<>'on_site' then 'cleared' else 'confirmation_required' end) on conflict do nothing;
 return new;
end $$;
drop trigger if exists initialize_staff_operations on public.staff;
create trigger initialize_staff_operations after insert on public.staff for each row execute function private.initialize_staff_operations();

create or replace function private.staff_can_plan(target_staff uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.staff s join public.staff_operations o on o.staff_id=s.id where s.id=target_staff and s.is_current and s.registration_status<>'cancelled' and o.planning_state<>'excluded' and o.service_clearance<>'not_cleared' and o.arrival_state not in ('no_show','left'));
$$;

create or replace function public.update_staff_operations(p_staff_id uuid,p_revision integer,p_planning text,p_arrival text,p_clearance text,p_authority text default '',p_reason text default '',p_duties text[] default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.staff%rowtype; old public.staff_operations%rowtype; result public.staff_operations%rowtype;
begin
 select * into s from public.staff where id=p_staff_id;
 if s.id is null or not private.has_capability(s.session_id,'staff_manage') then raise exception 'Staff management access is required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(s.session_id::text,26));
 select * into old from public.staff_operations where staff_id=s.id for update;
 if old.revision is distinct from p_revision then raise exception 'Staff record changed. Refresh and review again.'; end if;
 if p_clearance is distinct from old.service_clearance then
  if not private.has_session_role(s.session_id,array['session_director']::public.app_role[]) then raise exception 'Only a Session Directing Couple may record service confirmation'; end if;
  if length(trim(coalesce(p_authority,'')))<3 or length(trim(coalesce(p_reason,'')))<5 then raise exception 'Record the confirming authority and reason'; end if;
 end if;
 if p_arrival in ('no_show','left') and p_arrival is distinct from old.arrival_state and length(trim(coalesce(p_reason,'')))<5 then raise exception 'Record a reason for this arrival change'; end if;
 if p_duties is not null and cardinality(p_duties)>12 then raise exception 'Too many committee duties'; end if;
 update public.staff_operations set planning_state=p_planning,arrival_state=p_arrival,service_clearance=p_clearance,revision=revision+1,updated_by=auth.uid(),updated_at=now() where staff_id=s.id returning * into result;
 if p_duties is not null then
  delete from public.staff_committee_duties where staff_id=s.id;
  insert into public.staff_committee_duties(staff_id,duty,assigned_by) select s.id,trim(value),auth.uid() from unnest(p_duties) value where trim(value)<>'' on conflict do nothing;
 end if;
 insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata) values(s.session_id,auth.uid(),'staff_operations_updated','staff',s.id::text,jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(result),'authority',p_authority,'reason',p_reason,'duties',p_duties));
 return to_jsonb(result);
end $$;
revoke all on function public.update_staff_operations(uuid,integer,text,text,text,text,text,text[]) from public,anon;
grant execute on function public.update_staff_operations(uuid,integer,text,text,text,text,text,text[]) to authenticated;

-- Keep the existing rule verbatim; exceptions wrap it instead of changing younger cases.
do $$ begin
 if to_regprocedure('private.operational_participant_is_eligible_v25(uuid,uuid)') is null then
  alter function private.operational_participant_is_eligible(uuid,uuid) rename to operational_participant_is_eligible_v25;
 end if;
end $$;
create or replace function private.operational_participant_is_eligible(target_session uuid,target_participant uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select case
 when o.cohort_state='excluded' then false
 when o.cohort_state='exception' then p.is_current and p.registration_status<>'cancelled' and p.attendance_status<>'confirmed_not_attending' and o.registration_confirmed and o.guardian_confirmed and o.leadership_confirmed
 when extract(year from age(s.starts_on,d.date_of_birth))>=20 then false
 else private.operational_participant_is_eligible_v25(target_session,target_participant) end
 from public.participants p join public.sessions s on s.id=p.session_id left join public.participant_private_details d on d.participant_id=p.id left join public.participant_operation_decisions o on o.participant_id=p.id where p.id=target_participant and p.session_id=target_session),false);
$$;

-- Eight adults were unassigned at investigation. Never silently detach later live work.
do $$ declare r record; begin
 for r in select p.id,p.session_id,p.group_id from public.participants p join public.sessions s on s.id=p.session_id join public.participant_private_details d on d.participant_id=p.id where p.is_current and extract(year from age(s.starts_on,d.date_of_birth))>=20 loop
  if r.group_id is not null or exists(select 1 from public.housing_assignments h where h.participant_id=r.id and h.active) or exists(select 1 from public.check_ins c where c.participant_id=r.id and c.status='arrived') then raise exception 'Adult cohort has live assignments; review before migration'; end if;
  insert into public.participant_operation_decisions(participant_id,cohort_state,reason) values(r.id,'excluded','Age 20 or above at session start; identity preserved') on conflict do nothing;
 end loop;
end $$;

create or replace function public.record_participant_exception(p_participant_id uuid,p_allow boolean,p_authority text,p_reason text,p_registration_confirmed boolean,p_guardian_confirmed boolean,p_leadership_confirmed boolean)
returns void language plpgsql security definer set search_path='' as $$
declare p public.participants%rowtype;
begin
 select * into p from public.participants where id=p_participant_id for update;
 if p.id is null or not private.has_session_role(p.session_id,array['session_director']::public.app_role[]) then raise exception 'Only a Session Directing Couple may record participant exceptions'; end if;
 if length(trim(coalesce(p_authority,'')))<3 or length(trim(coalesce(p_reason,'')))<5 then raise exception 'Record the confirming authority and reason'; end if;
 if p_allow and not (coalesce(p_registration_confirmed,false) and coalesce(p_guardian_confirmed,false) and coalesce(p_leadership_confirmed,false)) then raise exception 'Confirm registration requirements, guardian requirements and leadership approval'; end if;
 if p.registration_status='cancelled' then raise exception 'Cancelled source registration must be resolved at source first'; end if;
 if not p_allow and (p.group_id is not null or exists(select 1 from public.housing_assignments h where h.participant_id=p.id and h.active)) then raise exception 'Resolve current group and housing placement before retiring this exception'; end if;
 insert into public.participant_operation_decisions(participant_id,cohort_state,registration_confirmed,guardian_confirmed,leadership_confirmed,authority,reason,recorded_by)
 values(p.id,case when p_allow then 'exception' else 'excluded' end,p_registration_confirmed,p_guardian_confirmed,p_leadership_confirmed,p_authority,p_reason,auth.uid())
 on conflict(participant_id) do update set cohort_state=excluded.cohort_state,registration_confirmed=excluded.registration_confirmed,guardian_confirmed=excluded.guardian_confirmed,leadership_confirmed=excluded.leadership_confirmed,authority=excluded.authority,reason=excluded.reason,recorded_by=auth.uid(),recorded_at=now(),revision=participant_operation_decisions.revision+1;
 if p_allow then update public.participants set is_current=true,attendance_status='expected' where id=p.id; end if;
 insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata) values(p.session_id,auth.uid(),'participant_exception_recorded','participant',p.id::text,jsonb_build_object('allowed',p_allow,'authority',p_authority,'reason',p_reason,'registration',p_registration_confirmed,'guardian',p_guardian_confirmed,'leadership',p_leadership_confirmed));
end $$;
revoke all on function public.record_participant_exception(uuid,boolean,text,text,boolean,boolean,boolean) from public,anon;
grant execute on function public.record_participant_exception(uuid,boolean,text,text,boolean,boolean,boolean) to authenticated;

create or replace function public.apply_staff_plan_v26(p_session_id uuid,p_plan jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; s public.staff%rowtype; g public.counselor_groups%rowtype; c public.companies%rowtype; max_load integer; old_ids uuid[]; expected_ids uuid[]; nc integer:=0; na integer:=0;
begin
 if not private.has_capability(p_session_id,'staff_manage') then raise exception 'Staff management access required'; end if;
 if jsonb_typeof(p_plan->'counselors') is distinct from 'array' or jsonb_typeof(p_plan->'assistants') is distinct from 'array' then raise exception 'Invalid staffing plan'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_session_id::text,26));
 perform 1 from public.staff where session_id=p_session_id order by id for update;
 perform 1 from public.counselor_groups where session_id=p_session_id order by id for update;
 perform 1 from public.companies where session_id=p_session_id order by id for update;
 select companies_per_assistant_coordinator into max_load from public.session_structure_settings where session_id=p_session_id;
 if max_load is distinct from (p_plan->>'limit')::integer then raise exception 'Planning limit changed. Generate a new plan.'; end if;
 if exists(select 1 from jsonb_array_elements(p_plan->'counselors') x group by x->>'staffId' having count(*)>1) or exists(select 1 from jsonb_array_elements(p_plan->'counselors') x group by x->>'groupId' having count(*)>1) or exists(select 1 from jsonb_array_elements(p_plan->'assistants') x group by x->>'companyId' having count(*)>1) then raise exception 'Duplicate staffing target'; end if;
 for item in select value from jsonb_array_elements(p_plan->'counselors') loop
  select * into s from public.staff where id=(item->>'staffId')::uuid and session_id=p_session_id;
  select * into g from public.counselor_groups where id=(item->>'groupId')::uuid and session_id=p_session_id;
  if s.id is null or g.id is null or s.operational_role<>'counselor' or not private.staff_can_plan(s.id) then raise exception 'Counselor is no longer available'; end if;
  if s.sex is null or s.sex<>g.sex then raise exception 'Counselor sex must match the group'; end if;
  if g.counselor_id is distinct from (item->>'previousStaffId')::uuid then raise exception 'Group staffing changed. Generate a new plan.'; end if;
  if g.counselor_id is not null and private.staff_can_plan(g.counselor_id) then raise exception 'Valid assignments are preserved'; end if;
  if exists(select 1 from public.counselor_groups x where x.counselor_id=s.id and x.id<>g.id) then raise exception 'Counselor is already assigned'; end if;
  update public.counselor_groups set counselor_id=s.id where id=g.id;
  update public.staff_operations set planning_state=case when service_clearance='cleared' then 'primary' else 'provisional' end,revision=revision+1,updated_at=now(),updated_by=auth.uid() where staff_id=s.id;
  nc:=nc+1;
 end loop;
 for item in select value from jsonb_array_elements(p_plan->'assistants') loop
  select * into s from public.staff where id=(item->>'staffId')::uuid and session_id=p_session_id;
  select * into c from public.companies where id=(item->>'companyId')::uuid and session_id=p_session_id;
  if s.id is null or c.id is null or s.operational_role<>'assistant_coordinator' or not private.staff_can_plan(s.id) then raise exception 'Assistant Coordinator is no longer available'; end if;
  select coalesce(array_agg(staff_id order by staff_id),'{}'::uuid[]) into old_ids from public.staff_company_assignments where company_id=c.id;
  select coalesce(array_agg(value::uuid order by value::uuid),'{}'::uuid[]) into expected_ids from jsonb_array_elements_text(coalesce(item->'previousStaffIds','[]'));
  if old_ids is distinct from expected_ids then raise exception 'Company staffing changed. Generate a new plan.'; end if;
  if exists(select 1 from unnest(old_ids) id where private.staff_can_plan(id)) then raise exception 'Valid company assignments are preserved'; end if;
  if (select count(*) from public.staff_company_assignments where staff_id=s.id)>=max_load then raise exception 'Assistant Coordinator company limit exceeded'; end if;
  delete from public.staff_company_assignments where company_id=c.id;
  insert into public.staff_company_assignments(session_id,staff_id,company_id,assigned_by) values(p_session_id,s.id,c.id,auth.uid());
  update public.staff_operations set planning_state=case when service_clearance='cleared' then 'primary' else 'provisional' end,revision=revision+1,updated_at=now(),updated_by=auth.uid() where staff_id=s.id;
  na:=na+1;
 end loop;
 update public.staff s set assigned_company_id=(select a.company_id from public.staff_company_assignments a where a.staff_id=s.id order by a.company_id limit 1) where s.session_id=p_session_id and s.operational_role='assistant_coordinator';
 insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata) values(p_session_id,auth.uid(),'staff_plan_applied_v26','session',p_session_id::text,jsonb_build_object('plan',p_plan,'counselors',nc,'assistants',na));
 return jsonb_build_object('counselor_assignments',nc,'assistant_coordinator_assignments',na);
end $$;
revoke all on function public.apply_staff_plan_v26(uuid,jsonb) from public,anon;
grant execute on function public.apply_staff_plan_v26(uuid,jsonb) to authenticated;

create or replace function public.set_staff_company_limit(p_session_id uuid,p_limit integer) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_capability(p_session_id,'staff_manage') then raise exception 'Staff management access required'; end if;
 if p_limit not between 1 and 20 then raise exception 'Choose 1 to 20 companies'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_session_id::text,26));
 update public.session_structure_settings set companies_per_assistant_coordinator=p_limit,updated_by=auth.uid(),updated_at=now() where session_id=p_session_id;
 if not found then raise exception 'Session settings are missing'; end if;
 insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata) values(p_session_id,auth.uid(),'staff_company_limit_updated','session',p_session_id::text,jsonb_build_object('limit',p_limit));
end $$;
revoke all on function public.set_staff_company_limit(uuid,integer) from public,anon;
grant execute on function public.set_staff_company_limit(uuid,integer) to authenticated;

-- Existing individual entry points retain their authorization, auditing and identity links.
do $$ declare r record; body text; begin
 for r in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('assign_counselor_to_group','set_staff_company_assignment','transition_staff_operational_role') loop
  body:=pg_get_functiondef(r.oid);
  body:=replace(body,'not target_staff.is_current or target_staff.registration_status<>''approved''','not private.staff_can_plan(target_staff.id)');
  body:=replace(body,'not target.is_current or target.registration_status <> ''approved''','not private.staff_can_plan(target.id)');
  body:=replace(body,'target_staff.sex is not null and target_staff.sex<>target_group.sex','(target_staff.sex is null or target_staff.sex<>target_group.sex)');
  body:=replace(body,'Only current approved staff can be assigned','Staff is excluded, absent, cancelled or not cleared for planning');
  body:=replace(body,'Only current approved Assistant Coordinators can be assigned','Assistant Coordinator is unavailable for planning');
  execute body;
 end loop;
end $$;

-- These legacy RPCs must also respect clearance even when called by an older client.
create or replace function private.guard_staff_assignment_v26() returns trigger language plpgsql security definer set search_path='' as $$
declare target_staff uuid; target_sex public.participant_sex;
begin
 target_staff:=case when tg_table_name='counselor_groups' then (to_jsonb(new)->>'counselor_id')::uuid else (to_jsonb(new)->>'staff_id')::uuid end;
 if target_staff is null then return new; end if;
 if tg_op='UPDATE' and (to_jsonb(old)->>case when tg_table_name='counselor_groups' then 'counselor_id' else 'staff_id' end) is not distinct from target_staff::text then return new; end if;
 if not private.staff_can_plan(target_staff) then raise exception 'Staff is unavailable for planning'; end if;
 if tg_table_name='counselor_groups' then
  select sex into target_sex from public.staff where id=target_staff;
  if target_sex is null or target_sex::text<>(to_jsonb(new)->>'sex') then raise exception 'Counselor sex must match the group'; end if;
 end if;
 return new;
end $$;
drop trigger if exists guard_staff_assignment_v26 on public.counselor_groups;
create trigger guard_staff_assignment_v26 before insert or update of counselor_id on public.counselor_groups for each row execute function private.guard_staff_assignment_v26();
drop trigger if exists guard_staff_company_v26 on public.staff_company_assignments;
create trigger guard_staff_company_v26 before insert or update of staff_id on public.staff_company_assignments for each row execute function private.guard_staff_assignment_v26();

-- Correct reasons without broadening who can read participant eligibility.
do $$ declare body text; begin
 body:=pg_get_functiondef('public.get_participant_eligibility(uuid)'::regprocedure);
 body:=replace(body,'case'||chr(10),'case'||chr(10)||'    when private.operational_participant_is_eligible(p_session_id,p.id) then ''Eligible'''||chr(10)||'    when exists(select 1 from public.participant_operation_decisions od where od.participant_id=p.id and od.cohort_state=''excluded'') then ''Excluded from active youth operations'''||chr(10));
 execute body;
end $$;

-- Consolidate copied Food eligibility predicates, preserving each RPC's scope checks.
do $$ declare r record; body text; updated text; pattern text;
begin
 pattern:='and p\.is_current\s+and p\.registration_status = ''approved''\s+and p\.verification_status = ''verified''\s+and p\.attendance_status <> ''confirmed_not_attending''\s+and d\.date_of_birth is not null\s+and (s|session_row)\.starts_on is not null\s+and (s|session_row)\.ends_on is not null\s+and extract\(year from (s|session_row)\.starts_on\)::int - extract\(year from d\.date_of_birth\)::int >= 14\s+and (s|session_row)\.ends_on < \(d\.date_of_birth \+ interval ''19 years''\)::date';
 for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('get_meal_services_v2','get_meal_progress_v2','get_meal_roster_page_v2','set_participant_meal_served_v2') loop
  body:=pg_get_functiondef(r.oid);
  updated:=regexp_replace(body,pattern,'and private.operational_participant_is_eligible(p.session_id,p.id)','g');
  if updated=body and position('private.operational_participant_is_eligible(p.session_id,p.id)' in body)=0 then raise exception 'Food eligibility definition drift; review migration'; end if;
  execute updated;
 end loop;
 body:=pg_get_functiondef('public.get_food_needs_v2(uuid)'::regprocedure);
 body:=regexp_replace(body,'and p\.is_current\s+and p\.registration_status = ''approved''','and private.operational_participant_is_eligible(p.session_id,p.id)','g');
 body:=regexp_replace(body,'and s\.is_current\s+and s\.registration_status = ''approved''','and private.staff_can_plan(s.id)','g');
 execute body;
 body:=pg_get_functiondef('public.open_headcount_round_v3(uuid,text)'::regprocedure);
 body:=replace(body,'s.is_current and s.registration_status=''approved''','private.staff_can_plan(s.id) and exists(select 1 from public.staff_operations so where so.staff_id=s.id and so.arrival_state=''arrived'')');
 execute body;
end $$;

-- Imported exception identities use the same non-recycling badge allocator as on-site youth.
do $$ declare body text; begin
 body:=pg_get_functiondef('private.ensure_on_site_fsy_id(uuid,uuid)'::regprocedure);
 body:=replace(body,'if target.source_kind <> ''on_site'' then','if target.source_kind <> ''on_site'' and not exists(select 1 from public.participant_operation_decisions od where od.participant_id=target.id and od.cohort_state=''exception'') then');
 execute body;
 body:=pg_get_functiondef('public.assign_participant_to_group(uuid,uuid)'::regprocedure);
 body:=replace(body,'if target.source_kind = ''on_site'' then','if target.source_kind = ''on_site'' or exists(select 1 from public.participant_operation_decisions od where od.participant_id=target.id and od.cohort_state=''exception'') then');
 execute body;
 body:=pg_get_functiondef('public.record_participant_checkin(uuid,uuid,public.check_in_status,text)'::regprocedure);
 body:=replace(body,'and participant_source = ''on_site''','and (participant_source = ''on_site'' or exists(select 1 from public.participant_operation_decisions od where od.participant_id=p_participant_id and od.cohort_state=''exception''))');
 execute body;
 -- A newly captured staff member has no imported approval claim.
 select pg_get_functiondef(p.oid) into body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='add_on_site_staff';
 body:=replace(body,'''approved'', true, p_operational_role, ''on_site''','''awaiting'', true, p_operational_role, ''on_site''');
 execute body;
end $$;
