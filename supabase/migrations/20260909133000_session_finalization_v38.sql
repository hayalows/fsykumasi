-- Kumasi 2026 pre-session finalization.
-- Source registration fields remain unchanged. Local session decisions are additive,
-- auditable and reversible. Existing published participant/group/company assignments
-- are never moved by this workflow.

alter table public.participant_operation_decisions
  add column if not exists local_clearance boolean not null default false,
  add column if not exists decision_kind text,
  add column if not exists batch_id uuid;

alter table public.staff_operations
  add column if not exists clearance_authority text,
  add column if not exists clearance_reason text,
  add column if not exists clearance_recorded_by uuid,
  add column if not exists clearance_recorded_at timestamptz;

create table if not exists public.session_finalization_batches (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  status text not null default 'applied' check (status in ('applied','rolled_back')),
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
revoke all on public.session_finalization_batches from anon, authenticated;
grant select on public.session_finalization_batches to authenticated;
drop policy if exists "session leaders read finalization batches" on public.session_finalization_batches;
create policy "session leaders read finalization batches"
  on public.session_finalization_batches for select to authenticated
  using (private.has_session_role(session_id,array['logistics_admin','coordinator','session_director']::public.app_role[]));

create or replace function private.session_finalization_leader(target_session uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.has_session_role(target_session,array['logistics_admin','coordinator','session_director']::public.app_role[]);
$$;

create or replace function private.session_finalization_age(target_session uuid,target_participant uuid)
returns integer language sql stable security definer set search_path='' as $$
  select coalesce(
    extract(year from age(s.starts_on,d.date_of_birth))::integer,
    p.age
  )
  from public.participants p
  join public.sessions s on s.id=p.session_id
  left join public.participant_private_details d on d.participant_id=p.id
  where p.session_id=target_session and p.id=target_participant;
$$;

create or replace function private.session_finalization_queue(target_session uuid)
returns table(participant_id uuid, participant_sex text, participant_age integer, decision_kind text)
language sql stable security definer set search_path='' as $$
  select
    p.id,
    p.sex::text,
    coalesce(extract(year from age(s.starts_on,d.date_of_birth))::integer,p.age) as participant_age,
    case
      when p.registration_status='awaiting' then 'pending_approval'
      when coalesce(extract(year from age(s.starts_on,d.date_of_birth))::integer,p.age) in (12,13,19) then 'age_exception'
      else 'placement_completion'
    end as decision_kind
  from public.participants p
  join public.sessions s on s.id=p.session_id
  left join public.participant_private_details d on d.participant_id=p.id
  where p.session_id=target_session
    and p.is_current
    and coalesce(p.operational_status,'active')='active'
    and p.registration_status<>'cancelled'
    and p.attendance_status<>'confirmed_not_attending'
    and p.verification_status='verified'
    and p.group_id is null
    and coalesce(extract(year from age(s.starts_on,d.date_of_birth))::integer,p.age) between 12 and 19;
$$;

-- Local clearance is explicitly separate from the imported/source approval evidence.
create or replace function private.operational_participant_is_eligible(target_session uuid,target_participant uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((
    select case
      when coalesce(p.operational_status,'active')<>'active' then false
      when o.cohort_state='excluded' then false
      when o.cohort_state='exception' then
        p.is_current
        and p.registration_status<>'cancelled'
        and p.attendance_status<>'confirmed_not_attending'
        and (coalesce(o.local_clearance,false) or (o.registration_confirmed and o.guardian_confirmed and o.leadership_confirmed))
      when coalesce(extract(year from age(s.starts_on,d.date_of_birth))::integer,p.age) >= 20 then false
      else private.operational_participant_is_eligible_v25(target_session,target_participant)
    end
    from public.participants p
    join public.sessions s on s.id=p.session_id
    left join public.participant_private_details d on d.participant_id=p.id
    left join public.participant_operation_decisions o on o.participant_id=p.id
    where p.id=target_participant and p.session_id=target_session
  ),false);
$$;

create or replace function public.record_participant_exception(
  p_participant_id uuid,
  p_allow boolean,
  p_authority text,
  p_reason text,
  p_registration_confirmed boolean,
  p_guardian_confirmed boolean,
  p_leadership_confirmed boolean
)
returns void language plpgsql security definer set search_path='' as $$
declare p public.participants%rowtype;
begin
  select * into p from public.participants where id=p_participant_id for update;
  if p.id is null or not private.session_finalization_leader(p.session_id) then
    raise exception 'Session leadership access is required';
  end if;
  if length(trim(coalesce(p_authority,'')))<3 or length(trim(coalesce(p_reason,'')))<5 then
    raise exception 'Record the confirming authority and reason';
  end if;
  if p.registration_status='cancelled' then raise exception 'Cancelled source registration must be resolved separately'; end if;
  if not p_allow and (p.group_id is not null or exists(select 1 from public.housing_assignments h where h.participant_id=p.id and h.active)) then
    raise exception 'Resolve current placement before excluding this participant';
  end if;

  insert into public.participant_operation_decisions(
    participant_id,cohort_state,registration_confirmed,guardian_confirmed,leadership_confirmed,
    local_clearance,decision_kind,authority,reason,recorded_by,recorded_at
  ) values(
    p.id,case when p_allow then 'exception' else 'excluded' end,
    coalesce(p_registration_confirmed,false),coalesce(p_guardian_confirmed,false),coalesce(p_leadership_confirmed,false),
    p_allow,'manual_session_decision',trim(p_authority),trim(p_reason),auth.uid(),now()
  )
  on conflict(participant_id) do update set
    cohort_state=excluded.cohort_state,
    registration_confirmed=excluded.registration_confirmed,
    guardian_confirmed=excluded.guardian_confirmed,
    leadership_confirmed=excluded.leadership_confirmed,
    local_clearance=excluded.local_clearance,
    decision_kind=excluded.decision_kind,
    authority=excluded.authority,
    reason=excluded.reason,
    recorded_by=auth.uid(),recorded_at=now(),revision=participant_operation_decisions.revision+1;

  if p_allow then
    update public.participants set is_current=true,attendance_status='expected' where id=p.id;
  end if;
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(p.session_id,auth.uid(),'participant_exception_recorded','participant',p.id::text,
    jsonb_build_object('allowed',p_allow,'authority',trim(p_authority),'reason',trim(p_reason),'source_registration_status',p.registration_status,'local_clearance',p_allow));
end $$;
revoke all on function public.record_participant_exception(uuid,boolean,text,text,boolean,boolean,boolean) from public,anon;
grant execute on function public.record_participant_exception(uuid,boolean,text,text,boolean,boolean,boolean) to authenticated;

-- Logistics administrators, coordinators and the session directing couple may make
-- pre-session service-clearance decisions. The imported registration status is preserved.
create or replace function public.update_staff_operations(
  p_staff_id uuid,p_revision integer,p_planning text,p_arrival text,p_clearance text,
  p_authority text default '',p_reason text default '',p_duties text[] default null
)
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

  update public.staff_operations set
    planning_state=p_planning,arrival_state=p_arrival,service_clearance=p_clearance,
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
declare
  participants_to_place integer:=0; adults_to_exclude integer:=0; adults_with_live_work integer:=0;
  awaiting_participants integer:=0; age_exceptions integer:=0; staff_to_clear integer:=0;
  open_groups integer:=0; female_new integer:=0; male_new integer:=0; new_groups integer:=0; new_companies integer:=0;
  active_participants integer:=0; current_companies integer:=0; current_groups integer:=0;
begin
  if not private.session_finalization_leader(p_session_id) then raise exception 'Session leadership access is required'; end if;

  select count(*) into active_participants from public.participants p where p.session_id=p_session_id and p.is_current and coalesce(p.operational_status,'active')='active';
  select count(*) into participants_to_place from private.session_finalization_queue(p_session_id);
  select count(*) filter(where decision_kind='pending_approval'),count(*) filter(where decision_kind='age_exception')
    into awaiting_participants,age_exceptions from private.session_finalization_queue(p_session_id);
  select count(*) filter(where participant_sex='female'),count(*) filter(where participant_sex='male')
    into female_new,male_new from private.session_finalization_queue(p_session_id);
  new_groups:=ceil(female_new/10.0)::integer+ceil(male_new/10.0)::integer;
  new_companies:=case when new_groups=0 then 0 else ceil(new_groups/3.0)::integer end;

  select count(*) into adults_to_exclude
  from public.participants p join public.sessions s on s.id=p.session_id left join public.participant_private_details d on d.participant_id=p.id
  where p.session_id=p_session_id and p.is_current and coalesce(p.operational_status,'active')='active'
    and coalesce(extract(year from age(s.starts_on,d.date_of_birth))::integer,p.age)>=20;

  select count(*) into adults_with_live_work
  from public.participants p join public.sessions s on s.id=p.session_id left join public.participant_private_details d on d.participant_id=p.id
  where p.session_id=p_session_id and p.is_current and coalesce(p.operational_status,'active')='active'
    and coalesce(extract(year from age(s.starts_on,d.date_of_birth))::integer,p.age)>=20
    and (p.group_id is not null
      or exists(select 1 from public.housing_assignments h where h.participant_id=p.id and h.active)
      or exists(select 1 from public.check_ins c where c.participant_id=p.id and c.status='arrived'));

  select count(*) into staff_to_clear from public.staff s
  where s.session_id=p_session_id and s.is_current and s.registration_status='awaiting';
  select count(*) into open_groups from public.counselor_groups g where g.session_id=p_session_id and g.counselor_id is null;
  select count(*) into current_companies from public.companies c where c.session_id=p_session_id;
  select count(*) into current_groups from public.counselor_groups g where g.session_id=p_session_id;

  return jsonb_build_object(
    'readyToApply',adults_with_live_work=0,
    'activeParticipants',active_participants,
    'participantsToPlace',participants_to_place,
    'awaitingParticipants',awaiting_participants,
    'ageExceptions',age_exceptions,
    'adultsToExclude',adults_to_exclude,
    'adultsWithLiveWork',adults_with_live_work,
    'staffToClear',staff_to_clear,
    'existingGroupsMissingCounselor',open_groups,
    'femaleParticipantsToPlace',female_new,
    'maleParticipantsToPlace',male_new,
    'suggestedNewGroups',new_groups,
    'suggestedNewCompanies',new_companies,
    'currentCompanies',current_companies,
    'currentGroups',current_groups,
    'existingAssignmentsMoved',0
  );
end $$;
revoke all on function public.preview_session_finalization_v1(uuid) from public,anon;
grant execute on function public.preview_session_finalization_v1(uuid) to authenticated;

create or replace function public.apply_session_finalization_v1(
  p_session_id uuid,
  p_authority text default 'Kumasi session leadership',
  p_reason text default 'Pre-session local roster finalization'
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  preview jsonb; batch_id uuid; sx text; q record; g record; c record;
  total_for_sex integer; group_count integer; group_index integer; group_number integer; company_number integer;
  group_id uuid; counselor_id uuid; assistant_id uuid; max_load integer;
  new_group_count integer:=0; new_company_count integer:=0; participant_count integer:=0;
  adult_count integer:=0; staff_count integer:=0; counselor_count integer:=0; assistant_count integer:=0; id_count integer:=0;
begin
  if not private.session_finalization_leader(p_session_id) then raise exception 'Session leadership access is required'; end if;
  if length(trim(coalesce(p_authority,'')))<3 or length(trim(coalesce(p_reason,'')))<5 then raise exception 'Authority and reason are required'; end if;
  if not exists(select 1 from public.sessions where id=p_session_id and status='planning') then raise exception 'This workflow is available only while the session is in planning'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text,38));
  preview:=public.preview_session_finalization_v1(p_session_id);
  if coalesce((preview->>'adultsWithLiveWork')::integer,0)>0 then raise exception 'One or more 20+ participant records have live work. Review them individually before finalizing.'; end if;

  insert into public.session_finalization_batches(session_id,authority,reason,summary,created_by)
  values(p_session_id,trim(p_authority),trim(p_reason),preview,auth.uid()) returning id into batch_id;

  -- Retire 20+ people from active participant operations. Source registration stays intact.
  insert into public.participant_operation_decisions(participant_id,cohort_state,local_clearance,decision_kind,authority,reason,batch_id,recorded_by,recorded_at)
  select p.id,'excluded',false,'adult_to_staff_path',trim(p_authority),trim(p_reason)||' · age 20+',batch_id,auth.uid(),now()
  from public.participants p join public.sessions s on s.id=p.session_id left join public.participant_private_details d on d.participant_id=p.id
  where p.session_id=p_session_id and p.is_current and coalesce(p.operational_status,'active')='active'
    and coalesce(extract(year from age(s.starts_on,d.date_of_birth))::integer,p.age)>=20
  on conflict(participant_id) do update set cohort_state='excluded',local_clearance=false,decision_kind='adult_to_staff_path',authority=excluded.authority,reason=excluded.reason,batch_id=excluded.batch_id,recorded_by=auth.uid(),recorded_at=now(),revision=participant_operation_decisions.revision+1;
  get diagnostics adult_count=row_count;

  update public.participants p set operational_status='withdrawn',operational_note='Removed from active participant roster at pre-session finalization; source identity preserved for staff/on-site follow-up',operational_revision=operational_revision+1,operational_updated_by=auth.uid(),operational_updated_at=now()
  from public.sessions s left join public.participant_private_details d on true
  where p.session_id=p_session_id and s.id=p.session_id and d.participant_id=p.id
    and p.is_current and coalesce(p.operational_status,'active')='active'
    and coalesce(extract(year from age(s.starts_on,d.date_of_birth))::integer,p.age)>=20;

  -- Locally clear every verified, expected, ungrouped participant under 20 that is part of this final roster.
  insert into public.participant_operation_decisions(participant_id,cohort_state,local_clearance,decision_kind,authority,reason,batch_id,recorded_by,recorded_at)
  select q.participant_id,'exception',true,q.decision_kind,trim(p_authority),trim(p_reason),batch_id,auth.uid(),now()
  from private.session_finalization_queue(p_session_id) q
  on conflict(participant_id) do update set cohort_state='exception',local_clearance=true,decision_kind=excluded.decision_kind,authority=excluded.authority,reason=excluded.reason,batch_id=excluded.batch_id,recorded_by=auth.uid(),recorded_at=now(),revision=participant_operation_decisions.revision+1;
  get diagnostics participant_count=row_count;

  update public.participants p set attendance_status='expected'
  where p.id in(select participant_id from private.session_finalization_queue(p_session_id));

  -- Clear pending staff for local planning without changing the imported Awaiting value.
  update public.staff_operations o set
    service_clearance='cleared',
    planning_state=case when exists(select 1 from public.counselor_groups g where g.counselor_id=o.staff_id)
      or exists(select 1 from public.staff_company_assignments a where a.staff_id=o.staff_id) then 'primary' else 'reserve' end,
    clearance_authority=trim(p_authority),clearance_reason=trim(p_reason),clearance_recorded_by=auth.uid(),clearance_recorded_at=now(),
    revision=revision+1,updated_by=auth.uid(),updated_at=now()
  from public.staff s
  where s.id=o.staff_id and s.session_id=p_session_id and s.is_current and s.registration_status='awaiting';
  get diagnostics staff_count=row_count;

  create temporary table if not exists session_finalization_groups_v38(
    group_id uuid primary key, participant_sex text not null, group_index integer not null, company_seq integer
  ) on commit drop;
  truncate session_finalization_groups_v38;

  -- New groups are additive. Current participant assignments are never touched.
  foreach sx in array array['female','male'] loop
    select count(*) into total_for_sex from private.session_finalization_queue(p_session_id) q where q.participant_sex=sx;
    if total_for_sex>0 then
      group_count:=ceil(total_for_sex/10.0)::integer;
      select coalesce(max(nullif(substring(name from '([0-9]+)$'), '')::integer),0) into group_number
      from public.counselor_groups where session_id=p_session_id and sex::text=sx;
      for group_index in 1..group_count loop
        insert into public.counselor_groups(session_id,name,sex,state,operational_number)
        values(p_session_id,case when sx='female' then 'YW Group ' else 'YM Group ' end||(group_number+group_index),sx::public.sex_type,'published',group_number+group_index)
        returning id into group_id;
        insert into session_finalization_groups_v38(group_id,participant_sex,group_index) values(group_id,sx,group_index);
        new_group_count:=new_group_count+1;
      end loop;

      with ranked as (
        select q.participant_id,row_number() over(order by q.participant_age,p.unit_name,p.last_name,p.first_name,p.id) rn,
          count(*) over() total_count
        from private.session_finalization_queue(p_session_id) q join public.participants p on p.id=q.participant_id
        where q.participant_sex=sx
      ), placed as (
        select r.participant_id,1+floor((r.rn-1)*group_count::numeric/r.total_count)::integer as target_index from ranked r
      )
      update public.participants p set group_id=t.group_id,updated_at=now()
      from placed x join session_finalization_groups_v38 t on t.participant_sex=sx and t.group_index=x.target_index
      where p.id=x.participant_id and p.group_id is null;
    end if;
  end loop;

  -- Create the fewest new companies while keeping each new company to at most three new groups.
  if new_group_count>0 then
    new_company_count:=ceil(new_group_count/3.0)::integer;
    create temporary table if not exists session_finalization_companies_v38(seq integer primary key,company_id uuid not null) on commit drop;
    truncate session_finalization_companies_v38;
    select coalesce(max(nullif(substring(name from '([0-9]+)$'), '')::integer),0) into company_number from public.companies where session_id=p_session_id;
    for group_index in 1..new_company_count loop
      insert into public.companies(session_id,name,operational_number)
      values(p_session_id,'Company '||(company_number+group_index),company_number+group_index)
      returning id into group_id;
      insert into session_finalization_companies_v38(seq,company_id) values(group_index,group_id);
    end loop;

    -- Round-robin by sex produces mixed companies whenever the extension cohort permits it.
    with ordered as (
      select t.group_id,t.participant_sex,row_number() over(partition by t.participant_sex order by t.group_index) rn
      from session_finalization_groups_v38 t
    )
    update public.counselor_groups g set company_id=cc.company_id
    from ordered o join session_finalization_companies_v38 cc on cc.seq=1+((o.rn-1)%new_company_count)
    where g.id=o.group_id;
  end if;

  -- Fill every counselor vacancy, old or new, without moving a valid existing counselor.
  for g in select * from public.counselor_groups where session_id=p_session_id and counselor_id is null order by created_at,id loop
    counselor_id:=null;
    select s.id into counselor_id
    from public.staff s join public.staff_operations o on o.staff_id=s.id
    where s.session_id=p_session_id and s.is_current and s.registration_status<>'cancelled'
      and s.operational_role='counselor' and s.sex=g.sex
      and o.service_clearance='cleared' and o.planning_state<>'excluded' and o.arrival_state not in ('no_show','left')
      and not exists(select 1 from public.counselor_groups gx where gx.counselor_id=s.id)
    order by case when s.registration_status='approved' then 0 else 1 end,s.full_name,s.id limit 1;
    if counselor_id is null then raise exception 'Not enough cleared % counselors to cover every group',g.sex::text; end if;
    update public.counselor_groups set counselor_id=counselor_id where id=g.id;
    update public.staff_operations set planning_state='primary',revision=revision+1,updated_by=auth.uid(),updated_at=now() where staff_id=counselor_id;
    counselor_count:=counselor_count+1;
  end loop;

  -- Assign an Assistant Coordinator to each newly-created company. Existing company assignments stay unchanged.
  select coalesce(companies_per_assistant_coordinator,4) into max_load from public.session_structure_settings where session_id=p_session_id;
  max_load:=coalesce(max_load,4);
  if new_company_count>0 then
    for c in select company_id from session_finalization_companies_v38 order by seq loop
      assistant_id:=null;
      select s.id into assistant_id
      from public.staff s join public.staff_operations o on o.staff_id=s.id
      where s.session_id=p_session_id and s.is_current and s.registration_status<>'cancelled'
        and s.operational_role='assistant_coordinator' and o.service_clearance='cleared'
        and o.planning_state<>'excluded' and o.arrival_state not in ('no_show','left')
        and (select count(*) from public.staff_company_assignments a where a.staff_id=s.id)<max_load
      order by (select count(*) from public.staff_company_assignments a where a.staff_id=s.id),case when s.registration_status='approved' then 0 else 1 end,s.full_name,s.id limit 1;
      if assistant_id is null then raise exception 'Not enough cleared Assistant Coordinators for the new companies'; end if;
      insert into public.staff_company_assignments(session_id,staff_id,company_id,assignment_role,assigned_by)
      values(p_session_id,assistant_id,c.company_id,'assistant_coordinator',auth.uid()) on conflict do nothing;
      update public.staff set assigned_company_id=coalesce(assigned_company_id,c.company_id) where id=assistant_id;
      update public.staff_operations set planning_state='primary',revision=revision+1,updated_by=auth.uid(),updated_at=now() where staff_id=assistant_id;
      assistant_count:=assistant_count+1;
    end loop;
  end if;

  -- Issue permanent IDs only for the newly-placed participants. Existing finalized IDs are not changed.
  insert into public.participant_badge_assignments(
    session_id,participant_id,company_id,group_id,slot_number,origin_code,fsy_id,badge_name,state,assigned_by,note,finalized_by,finalized_at
  )
  select
    p.session_id,p.id,g.company_id,p.group_id,
    row_number() over(partition by g.company_id order by g.operational_number,lower(p.last_name),lower(p.first_name),p.id)::integer,
    coalesce(private.origin_code_for_participant(p),'KUM'),'pending',trim(concat_ws(' ',p.first_name,p.last_name)),'finalized',auth.uid(),
    case when private.origin_code_for_participant(p) is null then 'Kumasi local session finalization · origin unavailable, local KUM code used' else 'Kumasi local session finalization' end,
    auth.uid(),now()
  from public.participants p join public.counselor_groups g on g.id=p.group_id
  where p.session_id=p_session_id and private.operational_participant_is_eligible(p_session_id,p.id)
    and not exists(select 1 from public.participant_badge_assignments b where b.session_id=p.session_id and b.participant_id=p.id and b.state<>'retired')
  order by g.company_id,g.operational_number,lower(p.last_name),lower(p.first_name),p.id;
  get diagnostics id_count=row_count;

  update public.session_finalization_batches set summary=summary||jsonb_build_object(
    'participantsLocallyCleared',participant_count,'adultsExcluded',adult_count,'staffLocallyCleared',staff_count,
    'newGroups',new_group_count,'newCompanies',new_company_count,'counselorVacanciesFilled',counselor_count,
    'assistantCoordinatorAssignments',assistant_count,'newFsyIds',id_count,'existingAssignmentsMoved',0
  ) where id=batch_id;

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_session_id,auth.uid(),'session_roster_finalized','session',p_session_id::text,
    jsonb_build_object('batch_id',batch_id,'authority',trim(p_authority),'reason',trim(p_reason),'participants_locally_cleared',participant_count,
      'adults_excluded',adult_count,'staff_locally_cleared',staff_count,'new_groups',new_group_count,'new_companies',new_company_count,
      'counselor_vacancies_filled',counselor_count,'assistant_coordinator_assignments',assistant_count,'new_fsy_ids',id_count,'existing_assignments_moved',0));

  return (select summary||jsonb_build_object('batchId',id,'appliedAt',created_at) from public.session_finalization_batches where id=batch_id);
end $$;
revoke all on function public.apply_session_finalization_v1(uuid,text,text) from public,anon;
grant execute on function public.apply_session_finalization_v1(uuid,text,text) to authenticated;
