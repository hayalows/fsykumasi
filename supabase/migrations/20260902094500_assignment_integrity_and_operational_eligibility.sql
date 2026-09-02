-- Centralize youth operational eligibility and make staff assignments explicit and safe.
-- Source registration data remains preserved; only operational use is constrained.

alter table public.session_structure_settings
  add column if not exists participant_min_age integer not null default 13,
  add column if not exists participant_max_age integer not null default 20,
  add column if not exists companies_per_assistant_coordinator integer not null default 4;

alter table public.session_structure_settings drop constraint if exists session_structure_settings_participant_age_check;
alter table public.session_structure_settings add constraint session_structure_settings_participant_age_check
  check (participant_min_age between 10 and 20 and participant_max_age between participant_min_age and 21);
alter table public.session_structure_settings drop constraint if exists session_structure_settings_ac_load_check;
alter table public.session_structure_settings add constraint session_structure_settings_ac_load_check
  check (companies_per_assistant_coordinator between 1 and 8);

create unique index if not exists staff_company_one_ac_per_company_idx
  on public.staff_company_assignments(session_id, company_id);

create or replace function private.operational_participant_is_eligible(
  target_session uuid,
  target_participant uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.participants p
    left join public.session_structure_settings s on s.session_id = p.session_id
    where p.id = target_participant
      and p.session_id = target_session
      and p.is_current
      and p.registration_status = 'approved'
      and p.verification_status = 'verified'
      and p.age between coalesce(s.participant_min_age, 13) and coalesce(s.participant_max_age, 20)
  );
$$;
revoke all on function private.operational_participant_is_eligible(uuid,uuid) from public;
grant execute on function private.operational_participant_is_eligible(uuid,uuid) to authenticated;

-- Replace the settings RPC so age eligibility and AC load are managed from the same admin surface.
drop function if exists public.save_session_structure_settings(uuid,integer,integer,integer,boolean,boolean,boolean);
create function public.save_session_structure_settings(
  p_session_id uuid,
  p_group_min_size integer,
  p_group_max_size integer,
  p_groups_per_company integer,
  p_use_age_bands boolean,
  p_avoid_same_unit boolean,
  p_balance_sexes boolean,
  p_participant_min_age integer,
  p_participant_max_age integer,
  p_companies_per_assistant_coordinator integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_manage_access(p_session_id) then raise exception 'Administrative access is required'; end if;
  if p_group_min_size < 6 or p_group_max_size > 15 or p_group_min_size > p_group_max_size then
    raise exception 'Counselor group size must be between 6 and 15';
  end if;
  if p_groups_per_company < 1 or p_groups_per_company > 6 then raise exception 'Choose between 1 and 6 counselor groups per company'; end if;
  if p_participant_min_age < 10 or p_participant_max_age > 21 or p_participant_min_age > p_participant_max_age then
    raise exception 'Operational youth ages must stay between 10 and 21';
  end if;
  if p_companies_per_assistant_coordinator < 1 or p_companies_per_assistant_coordinator > 8 then
    raise exception 'Assistant Coordinator load must be between 1 and 8 companies';
  end if;

  insert into public.session_structure_settings(
    session_id, group_min_size, group_max_size, groups_per_company, use_age_bands,
    avoid_same_unit, balance_sexes, participant_min_age, participant_max_age,
    companies_per_assistant_coordinator, updated_by, updated_at
  ) values (
    p_session_id, p_group_min_size, p_group_max_size, p_groups_per_company, p_use_age_bands,
    p_avoid_same_unit, p_balance_sexes, p_participant_min_age, p_participant_max_age,
    p_companies_per_assistant_coordinator, (select auth.uid()), now()
  ) on conflict (session_id) do update set
    group_min_size = excluded.group_min_size,
    group_max_size = excluded.group_max_size,
    groups_per_company = excluded.groups_per_company,
    use_age_bands = excluded.use_age_bands,
    avoid_same_unit = excluded.avoid_same_unit,
    balance_sexes = excluded.balance_sexes,
    participant_min_age = excluded.participant_min_age,
    participant_max_age = excluded.participant_max_age,
    companies_per_assistant_coordinator = excluded.companies_per_assistant_coordinator,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_session_id, (select auth.uid()), 'session_structure_settings_updated', 'session', p_session_id::text,
    jsonb_build_object(
      'group_min_size', p_group_min_size, 'group_max_size', p_group_max_size,
      'groups_per_company', p_groups_per_company, 'participant_min_age', p_participant_min_age,
      'participant_max_age', p_participant_max_age,
      'companies_per_assistant_coordinator', p_companies_per_assistant_coordinator
    ));
end;
$$;
revoke all on function public.save_session_structure_settings(uuid,integer,integer,integer,boolean,boolean,boolean,integer,integer,integer) from public, anon;
grant execute on function public.save_session_structure_settings(uuid,integer,integer,integer,boolean,boolean,boolean,integer,integer,integer) to authenticated;

-- Role changes no longer silently erase operational assignments.
create or replace function public.set_staff_operational_role(p_staff_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target public.staff%rowtype;
begin
  select * into target from public.staff where id = p_staff_id for update;
  if target.id is null then raise exception 'Staff member not found'; end if;
  if not private.can_manage_access(target.session_id) then raise exception 'Administrative access is required'; end if;
  if p_role not in ('counselor','assistant_coordinator','coordinator','committee_member','logistics_admin','session_director','other') then
    raise exception 'Choose a supported staff role';
  end if;
  if p_role = target.operational_role then return; end if;

  if target.operational_role = 'counselor' and exists (
    select 1 from public.counselor_groups g where g.session_id=target.session_id and g.counselor_id=target.id
  ) then raise exception 'Unassign this Counselor from their counselor group before changing their role'; end if;

  if target.operational_role = 'assistant_coordinator' and exists (
    select 1 from public.staff_company_assignments sca where sca.session_id=target.session_id and sca.staff_id=target.id
  ) then raise exception 'Remove this Assistant Coordinator from their companies before changing their role'; end if;

  update public.staff set operational_role = p_role where id = target.id;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (target.session_id, (select auth.uid()), 'staff_operational_role_updated', 'staff', target.id::text,
    jsonb_build_object('from_role', target.operational_role, 'to_role', p_role));
end;
$$;
revoke all on function public.set_staff_operational_role(uuid,text) from public, anon;
grant execute on function public.set_staff_operational_role(uuid,text) to authenticated;

-- A counselor cannot silently replace another counselor or appear in multiple groups.
create or replace function public.assign_counselor_to_group(p_staff_id uuid, p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target_staff public.staff%rowtype; target_group public.counselor_groups%rowtype; occupied_name text;
begin
  select * into target_staff from public.staff where id = p_staff_id for update;
  select * into target_group from public.counselor_groups where id = p_group_id for update;
  if target_staff.id is null or target_group.id is null or target_staff.session_id <> target_group.session_id then
    raise exception 'Staff member and group must belong to the same session';
  end if;
  if not private.can_manage_access(target_staff.session_id) then raise exception 'Administrative access is required'; end if;
  if not target_staff.is_current or target_staff.registration_status <> 'approved' then raise exception 'Only current approved staff can be assigned'; end if;
  if target_staff.operational_role <> 'counselor' then raise exception 'Set this staff member as a Counselor first'; end if;
  if target_staff.sex is not null and target_staff.sex <> target_group.sex then raise exception 'Counselor sex must match the counselor group'; end if;
  if exists(select 1 from public.counselor_groups g where g.session_id=target_staff.session_id and g.counselor_id=target_staff.id and g.id<>target_group.id) then
    raise exception 'This Counselor is already assigned to another counselor group';
  end if;
  if target_group.counselor_id is not null and target_group.counselor_id <> target_staff.id then
    select full_name into occupied_name from public.staff where id=target_group.counselor_id;
    raise exception 'This counselor group already has a Counselor: %', coalesce(occupied_name,'another staff member');
  end if;

  update public.counselor_groups set counselor_id = target_staff.id where id = target_group.id;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_staff.session_id, (select auth.uid()), 'counselor_group_staff_assigned', 'counselor_group', target_group.id::text,
    jsonb_build_object('staff_id', target_staff.id));
end;
$$;
revoke all on function public.assign_counselor_to_group(uuid,uuid) from public, anon;
grant execute on function public.assign_counselor_to_group(uuid,uuid) to authenticated;

-- Company supervision is explicit: one AC per company, with a configurable load cap.
create or replace function public.set_staff_company_assignment(p_staff_id uuid, p_company_id uuid, p_assigned boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_staff public.staff%rowtype;
  target_company public.companies%rowtype;
  existing_staff uuid;
  existing_name text;
  current_load integer;
  max_load integer;
  staff_email text;
  linked_user uuid;
begin
  select * into target_staff from public.staff where id = p_staff_id for update;
  select * into target_company from public.companies where id = p_company_id for update;
  if target_staff.id is null or target_company.id is null or target_staff.session_id <> target_company.session_id then
    raise exception 'Staff member and company must belong to the same session';
  end if;
  if not private.can_manage_access(target_staff.session_id) then raise exception 'Administrative access is required'; end if;
  if target_staff.operational_role <> 'assistant_coordinator' then raise exception 'Set this staff member as an Assistant Coordinator first'; end if;
  if not target_staff.is_current or target_staff.registration_status <> 'approved' then raise exception 'Only current approved Assistant Coordinators can be assigned'; end if;

  if p_assigned then
    select sca.staff_id into existing_staff from public.staff_company_assignments sca
      where sca.session_id=target_staff.session_id and sca.company_id=target_company.id limit 1;
    if existing_staff is not null and existing_staff <> target_staff.id then
      select full_name into existing_name from public.staff where id=existing_staff;
      raise exception 'This company is already supervised by %', coalesce(existing_name,'another Assistant Coordinator');
    end if;
    select count(*) into current_load from public.staff_company_assignments sca
      where sca.session_id=target_staff.session_id and sca.staff_id=target_staff.id;
    select coalesce(s.companies_per_assistant_coordinator,4) into max_load
      from public.session_structure_settings s where s.session_id=target_staff.session_id;
    max_load := coalesce(max_load,4);
    if existing_staff is null and current_load >= max_load then
      raise exception 'This Assistant Coordinator already supervises the configured maximum of % companies', max_load;
    end if;
    insert into public.staff_company_assignments(session_id, staff_id, company_id, assigned_by)
    values (target_staff.session_id, target_staff.id, target_company.id, (select auth.uid()))
    on conflict (staff_id, company_id) do nothing;
  else
    delete from public.staff_company_assignments where staff_id=target_staff.id and company_id=target_company.id;
  end if;

  update public.staff s set assigned_company_id = (
    select sca.company_id from public.staff_company_assignments sca where sca.staff_id=s.id
    order by sca.assigned_at, sca.company_id limit 1
  ) where s.id=target_staff.id;

  select lower(trim(spd.email)) into staff_email from public.staff_private_details spd where spd.staff_id=target_staff.id;
  if staff_email is not null then select p.user_id into linked_user from public.profiles p where lower(trim(p.email))=staff_email limit 1; end if;
  if linked_user is not null then
    update public.access_assignments aa set company_ids=coalesce((
      select array_agg(sca.company_id order by sca.assigned_at, sca.company_id)
      from public.staff_company_assignments sca where sca.staff_id=target_staff.id
    ),'{}'::uuid[])
    where aa.session_id=target_staff.session_id and aa.user_id=linked_user and aa.role='assistant_coordinator' and aa.active;
  end if;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_staff.session_id,(select auth.uid()),case when p_assigned then 'assistant_coordinator_company_assigned' else 'assistant_coordinator_company_unassigned' end,
    'company',target_company.id::text,jsonb_build_object('staff_id',target_staff.id,'login_scope_synced',linked_user is not null));
end;
$$;
revoke all on function public.set_staff_company_assignment(uuid,uuid,boolean) from public, anon;
grant execute on function public.set_staff_company_assignment(uuid,uuid,boolean) to authenticated;

-- Replace the bulk helper: suggestions can never exceed AC load or overwrite a company/counselor.
create or replace function public.apply_staff_assignment_plan(
  p_session_id uuid,
  p_counselor_assignments jsonb default '[]'::jsonb,
  p_assistant_assignments jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  target_staff public.staff%rowtype;
  target_group public.counselor_groups%rowtype;
  target_company public.companies%rowtype;
  max_load integer;
  counselor_count integer := 0;
  assistant_count integer := 0;
begin
  if not private.can_manage_access(p_session_id) then raise exception 'Administrative access is required to assign staff'; end if;
  if jsonb_typeof(coalesce(p_counselor_assignments,'[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_assistant_assignments,'[]'::jsonb)) <> 'array' then
    raise exception 'Staff assignment plans must be arrays';
  end if;
  select coalesce(companies_per_assistant_coordinator,4) into max_load from public.session_structure_settings where session_id=p_session_id;
  max_load := coalesce(max_load,4);

  if exists(select 1 from (select value->>'staff_id' staff_id,count(*) uses from jsonb_array_elements(coalesce(p_counselor_assignments,'[]'::jsonb)) group by value->>'staff_id') x where uses>1) then
    raise exception 'A Counselor can only appear once in an assignment plan';
  end if;
  if exists(select 1 from (select value->>'company_id' company_id,count(*) uses from jsonb_array_elements(coalesce(p_assistant_assignments,'[]'::jsonb)) group by value->>'company_id') x where uses>1) then
    raise exception 'A company can only have one Assistant Coordinator in an assignment plan';
  end if;

  for item in select value from jsonb_array_elements(coalesce(p_counselor_assignments,'[]'::jsonb)) loop
    select * into target_staff from public.staff where id=(item->>'staff_id')::uuid;
    select * into target_group from public.counselor_groups where id=(item->>'group_id')::uuid;
    if target_staff.id is null or target_group.id is null or target_staff.session_id<>p_session_id or target_group.session_id<>p_session_id then raise exception 'Counselor suggestion does not belong to this session'; end if;
    if target_staff.operational_role<>'counselor' or target_staff.registration_status<>'approved' or not target_staff.is_current then raise exception 'Only current approved Counselors can be assigned'; end if;
    if target_staff.sex is not null and target_staff.sex<>target_group.sex then raise exception 'Counselor sex must match the counselor group'; end if;
    if target_group.counselor_id is not null then raise exception 'Bulk staffing will not overwrite an existing counselor assignment'; end if;
    if exists(select 1 from public.counselor_groups existing where existing.session_id=p_session_id and existing.counselor_id=target_staff.id) then raise exception 'A suggested Counselor is already assigned to another group'; end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(p_assistant_assignments,'[]'::jsonb)) loop
    select * into target_staff from public.staff where id=(item->>'staff_id')::uuid;
    select * into target_company from public.companies where id=(item->>'company_id')::uuid;
    if target_staff.id is null or target_company.id is null or target_staff.session_id<>p_session_id or target_company.session_id<>p_session_id then raise exception 'Assistant Coordinator suggestion does not belong to this session'; end if;
    if target_staff.operational_role<>'assistant_coordinator' or target_staff.registration_status<>'approved' or not target_staff.is_current then raise exception 'Only current approved Assistant Coordinators can be assigned'; end if;
    if exists(select 1 from public.staff_company_assignments existing where existing.session_id=p_session_id and existing.company_id=target_company.id) then raise exception 'Bulk staffing will not overwrite an existing company Assistant Coordinator'; end if;
  end loop;

  if exists(
    select 1 from (
      select proposed.staff_id,
             (select count(*) from public.staff_company_assignments current where current.session_id=p_session_id and current.staff_id=proposed.staff_id::uuid) + proposed.uses as resulting_load
      from (select value->>'staff_id' staff_id,count(*) uses from jsonb_array_elements(coalesce(p_assistant_assignments,'[]'::jsonb)) group by value->>'staff_id') proposed
    ) loads where loads.resulting_load > max_load
  ) then raise exception 'An Assistant Coordinator assignment would exceed the configured company load'; end if;

  for item in select value from jsonb_array_elements(coalesce(p_counselor_assignments,'[]'::jsonb)) loop
    update public.counselor_groups set counselor_id=(item->>'staff_id')::uuid where id=(item->>'group_id')::uuid and session_id=p_session_id and counselor_id is null;
    counselor_count:=counselor_count+1;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(p_assistant_assignments,'[]'::jsonb)) loop
    insert into public.staff_company_assignments(session_id,staff_id,company_id,assigned_by)
    values(p_session_id,(item->>'staff_id')::uuid,(item->>'company_id')::uuid,(select auth.uid()));
    assistant_count:=assistant_count+1;
  end loop;

  update public.staff staff_member set assigned_company_id=(
    select assignment.company_id from public.staff_company_assignments assignment where assignment.staff_id=staff_member.id order by assignment.assigned_at,assignment.company_id limit 1
  ) where staff_member.session_id=p_session_id and staff_member.id in (
    select (value->>'staff_id')::uuid from jsonb_array_elements(coalesce(p_assistant_assignments,'[]'::jsonb))
  );

  -- Keep login company scope aligned when staff email maps to a signed-in Assistant Coordinator.
  update public.access_assignments aa
  set company_ids = coalesce((
    select array_agg(sca.company_id order by sca.assigned_at,sca.company_id)
    from public.staff_company_assignments sca
    join public.staff_private_details spd on spd.staff_id=sca.staff_id
    join public.profiles pr on lower(trim(pr.email))=lower(trim(spd.email))
    where pr.user_id=aa.user_id and sca.session_id=aa.session_id
  ),'{}'::uuid[])
  where aa.session_id=p_session_id and aa.role='assistant_coordinator' and aa.active;

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_session_id,(select auth.uid()),'staff_assignment_plan_applied','session',p_session_id::text,
    jsonb_build_object('counselor_assignments',counselor_count,'assistant_coordinator_assignments',assistant_count,'ac_company_limit',max_load));
  return jsonb_build_object('counselor_assignments',counselor_count,'assistant_coordinator_assignments',assistant_count);
end;
$$;
revoke all on function public.apply_staff_assignment_plan(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.apply_staff_assignment_plan(uuid,jsonb,jsonb) to authenticated;

-- Group assignment uses the central operational eligibility boundary.
create or replace function public.assign_participant_to_group(p_participant_id uuid, p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target public.participants%rowtype; target_group public.counselor_groups%rowtype; max_size integer; avoid_units boolean;
begin
  select * into target from public.participants where id=p_participant_id for update;
  select * into target_group from public.counselor_groups where id=p_group_id;
  if target.id is null or target_group.id is null or target.session_id<>target_group.session_id then raise exception 'Participant and group must belong to the same session'; end if;
  if not private.has_session_role(target.session_id,array['coordinator','logistics_admin','session_director']::public.app_role[]) then raise exception 'Your role cannot assign participants'; end if;
  if not private.operational_participant_is_eligible(target.session_id,target.id) then raise exception 'This record is not currently eligible for youth operations. Review registration status, verification and age first'; end if;
  if target.sex<>target_group.sex then raise exception 'Participant sex does not match the selected group'; end if;
  select group_max_size,avoid_same_unit into max_size,avoid_units from public.session_structure_settings where session_id=target.session_id;
  max_size:=coalesce(max_size,10); avoid_units:=coalesce(avoid_units,true);
  if (select count(*) from public.participants p where p.group_id=target_group.id and p.id<>target.id)>=max_size then raise exception 'This counselor group is already at its configured maximum size'; end if;
  if avoid_units and exists(select 1 from public.participants peer where peer.group_id=target_group.id and peer.id<>target.id and lower(trim(peer.unit_name))=lower(trim(target.unit_name))) then raise exception 'This group already contains someone from the same unit'; end if;
  update public.participants set group_id=target_group.id,updated_at=now() where id=target.id;
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(target.session_id,(select auth.uid()),'participant_group_assigned','participant',target.id::text,jsonb_build_object('group_id',target_group.id));
end;
$$;
revoke all on function public.assign_participant_to_group(uuid,uuid) from public, anon;
grant execute on function public.assign_participant_to_group(uuid,uuid) to authenticated;

-- Publishing includes only operationally eligible youth, never every imported participant record.
create or replace function public.publish_grouping_plan(p_session_id uuid, p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  company_item jsonb; group_item jsonb; new_company_id uuid; new_group_id uuid;
  participant_total integer; supplied_total integer; distinct_total integer; company_count integer; group_count integer:=0; company_index integer:=0;
  min_size integer; max_size integer; groups_target integer; use_bands boolean; avoid_units boolean; min_age integer; max_age integer;
  had_plan boolean:=false; session_status text; colors text[]:=array['#005175','#007DA5','#8DBF67','#FCB449'];
begin
  if not private.can_manage_access(p_session_id) then raise exception 'Administrative access is required to publish groups'; end if;
  if jsonb_typeof(p_plan)<>'array' then raise exception 'Grouping plan must be an array'; end if;
  select s.status into session_status from public.sessions s where s.id=p_session_id;
  if session_status is null then raise exception 'Session not found'; end if;
  select group_min_size,group_max_size,groups_per_company,use_age_bands,avoid_same_unit,participant_min_age,participant_max_age
    into min_size,max_size,groups_target,use_bands,avoid_units,min_age,max_age
    from public.session_structure_settings where session_id=p_session_id;
  min_size:=coalesce(min_size,8); max_size:=coalesce(max_size,10); groups_target:=coalesce(groups_target,2); use_bands:=coalesce(use_bands,false); avoid_units:=coalesce(avoid_units,true); min_age:=coalesce(min_age,13); max_age:=coalesce(max_age,20);
  company_count:=jsonb_array_length(p_plan); if company_count<1 or company_count>500 then raise exception 'Grouping plan must contain between 1 and 500 companies'; end if;
  select exists(select 1 from public.counselor_groups where session_id=p_session_id) or exists(select 1 from public.companies where session_id=p_session_id) into had_plan;
  if had_plan and session_status<>'planning' and exists(select 1 from public.check_ins where session_id=p_session_id and status='arrived') then raise exception 'Undo active check-ins before replacing the published structure'; end if;
  if had_plan and session_status<>'planning' and exists(select 1 from public.headcount_submissions hs join public.headcount_rounds hr on hr.id=hs.round_id where hr.session_id=p_session_id) then raise exception 'A head-count submission exists, so the published structure can no longer be replaced'; end if;
  if exists(select 1 from jsonb_array_elements(p_plan)c(item) where jsonb_typeof(c.item->'groups')<>'array' or jsonb_array_length(c.item->'groups')<1 or jsonb_array_length(c.item->'groups')>groups_target or nullif(trim(c.item->>'name'),'') is null) then raise exception 'Each company needs a name and no more than the configured number of counselor groups'; end if;
  if exists(select 1 from jsonb_array_elements(p_plan)c(item) cross join lateral jsonb_array_elements(c.item->'groups')g(item) where nullif(trim(g.item->>'name'),'') is null or lower(g.item->>'sex') not in('female','male') or jsonb_typeof(g.item->'participant_ids')<>'array' or jsonb_array_length(g.item->'participant_ids') not between min_size and max_size) then raise exception 'A counselor group does not match the current group-size rules'; end if;

  select count(*) into participant_total from public.participants p
    where p.session_id=p_session_id and p.is_current and p.registration_status='approved' and p.verification_status='verified' and p.age between min_age and max_age;
  with supplied as(
    select (jsonb_array_elements_text(g.item->'participant_ids'))::uuid participant_id
    from jsonb_array_elements(p_plan)c(item) cross join lateral jsonb_array_elements(c.item->'groups')g(item)
  ) select count(*),count(distinct participant_id) into supplied_total,distinct_total from supplied;
  if participant_total=0 or supplied_total<>participant_total or distinct_total<>participant_total then
    raise exception 'Every operationally eligible youth participant must be assigned exactly once';
  end if;
  if exists(
    with supplied as(select (jsonb_array_elements_text(g.item->'participant_ids'))::uuid participant_id from jsonb_array_elements(p_plan)c(item) cross join lateral jsonb_array_elements(c.item->'groups')g(item))
    select 1 from supplied s left join public.participants p on p.id=s.participant_id and p.session_id=p_session_id
    where p.id is null or not p.is_current or p.registration_status<>'approved' or p.verification_status<>'verified' or p.age not between min_age and max_age
  ) then raise exception 'Grouping plan contains a participant outside the operational youth eligibility rules'; end if;
  if avoid_units and exists(select 1 from jsonb_array_elements(p_plan) with ordinality c(item,company_no) cross join lateral jsonb_array_elements(c.item->'groups') with ordinality g(item,group_no) cross join lateral jsonb_array_elements_text(g.item->'participant_ids') member(value) join public.participants p on p.id=member.value::uuid group by company_no,group_no,lower(trim(p.unit_name)) having count(*)>1) then raise exception 'A counselor group contains youth from the same unit'; end if;
  if exists(select 1 from jsonb_array_elements(p_plan)c(item) cross join lateral jsonb_array_elements(c.item->'groups')g(item) cross join lateral jsonb_array_elements_text(g.item->'participant_ids') member(value) join public.participants p on p.id=member.value::uuid where p.sex::text<>lower(g.item->>'sex')) then raise exception 'A counselor group mixes participant sexes'; end if;
  if use_bands and exists(select 1 from jsonb_array_elements(p_plan) with ordinality c(item,company_no) cross join lateral jsonb_array_elements(c.item->'groups')g(item) cross join lateral jsonb_array_elements_text(g.item->'participant_ids') member(value) join public.participants p on p.id=member.value::uuid group by company_no having count(distinct case when p.age between 14 and 15 then '14-15' when p.age between 16 and 18 then '16-18' else 'other' end)>1) then raise exception 'A company mixes configured age bands'; end if;

  if had_plan then
    delete from public.staff_company_assignments where session_id=p_session_id;
    update public.staff set assigned_company_id=null where session_id=p_session_id;
    update public.participants set group_id=null,updated_at=now() where session_id=p_session_id;
    delete from public.counselor_groups where session_id=p_session_id;
    delete from public.companies where session_id=p_session_id;
  end if;
  for company_item in select value from jsonb_array_elements(p_plan) loop
    company_index:=company_index+1; new_company_id:=extensions.gen_random_uuid();
    insert into public.companies(id,session_id,name,color,custom_name,scripture_reference,meeting_spot)
    values(new_company_id,p_session_id,trim(company_item->>'name'),colors[1+((company_index-1)%cardinality(colors))],nullif(trim(coalesce(company_item->>'custom_name','')),''),nullif(trim(coalesce(company_item->>'scripture_reference','')),''),nullif(trim(coalesce(company_item->>'meeting_spot','')),''));
    for group_item in select value from jsonb_array_elements(company_item->'groups') loop
      group_count:=group_count+1; new_group_id:=extensions.gen_random_uuid();
      insert into public.counselor_groups(id,session_id,company_id,name,sex,state,custom_name)
      values(new_group_id,p_session_id,new_company_id,trim(group_item->>'name'),lower(group_item->>'sex')::public.participant_sex,'published',nullif(trim(coalesce(group_item->>'custom_name','')),''));
      update public.participants p set group_id=new_group_id,updated_at=now()
        where p.session_id=p_session_id and p.id in(select value::uuid from jsonb_array_elements_text(group_item->'participant_ids'));
    end loop;
  end loop;
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_session_id,(select auth.uid()),case when had_plan then 'grouping_plan_republished' else 'grouping_plan_published' end,'session',p_session_id::text,
    jsonb_build_object('company_count',company_count,'group_count',group_count,'participant_count',participant_total,'groups_per_company',groups_target,'participant_min_age',min_age,'participant_max_age',max_age,'session_status',session_status));
  return jsonb_build_object('company_count',company_count,'group_count',group_count,'participant_count',participant_total,'replaced',had_plan);
end;
$$;
revoke all on function public.publish_grouping_plan(uuid,jsonb) from public, anon;
grant execute on function public.publish_grouping_plan(uuid,jsonb) to authenticated;

-- Check-in and head count use the exact same operational eligibility rule.
create or replace function public.record_participant_checkin(p_session_id uuid,p_participant_id uuid,p_status public.check_in_status,p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (
    private.has_session_role(p_session_id,array['coordinator','logistics_admin','session_director']::public.app_role[])
    or exists(select 1 from public.participants p join public.counselor_groups g on g.id=p.group_id where p.id=p_participant_id and p.session_id=p_session_id and private.can_access_company(p_session_id,g.company_id))
  ) then raise exception 'Your role cannot record check-in for this participant'; end if;
  if not private.operational_participant_is_eligible(p_session_id,p_participant_id) then raise exception 'This record is outside the current youth operational eligibility rules'; end if;
  if exists(select 1 from public.counselor_groups g where g.session_id=p_session_id and g.state='published')
     and not exists(select 1 from public.participants p where p.id=p_participant_id and p.session_id=p_session_id and p.group_id is not null) then
    raise exception 'Participant still needs a counselor group assignment';
  end if;
  insert into public.check_ins(session_id,participant_id,status,note,recorded_by,recorded_at)
  values(p_session_id,p_participant_id,p_status,nullif(trim(coalesce(p_note,'')),''),(select auth.uid()),now())
  on conflict(session_id,participant_id) do update set status=excluded.status,note=excluded.note,recorded_by=excluded.recorded_by,recorded_at=excluded.recorded_at;
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_session_id,(select auth.uid()),'participant_checkin_recorded','participant',p_participant_id::text,jsonb_build_object('status',p_status));
end;
$$;
revoke all on function public.record_participant_checkin(uuid,uuid,public.check_in_status,text) from public, anon;
grant execute on function public.record_participant_checkin(uuid,uuid,public.check_in_status,text) to authenticated;

create or replace function public.submit_company_headcount(p_round_id uuid,p_company_id uuid,p_accounted_count integer,p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target_session uuid; expected integer; min_age integer; max_age integer;
begin
  select r.session_id into target_session from public.headcount_rounds r where r.id=p_round_id and r.closes_at is null;
  if target_session is null then raise exception 'This head-count round is closed or unavailable'; end if;
  if not private.can_access_company(target_session,p_company_id) then raise exception 'You cannot submit for this company'; end if;
  if not exists(select 1 from public.companies c where c.id=p_company_id and c.session_id=target_session) then raise exception 'Company does not belong to this session'; end if;
  select coalesce(participant_min_age,13),coalesce(participant_max_age,20) into min_age,max_age from public.session_structure_settings where session_id=target_session;
  min_age:=coalesce(min_age,13); max_age:=coalesce(max_age,20);
  select count(*) into expected from public.participants p join public.counselor_groups g on g.id=p.group_id
    where g.company_id=p_company_id and p.session_id=target_session and p.is_current and p.registration_status='approved' and p.verification_status='verified' and p.age between min_age and max_age;
  if p_accounted_count is null or p_accounted_count<0 or p_accounted_count>expected then raise exception 'Accounted count must be between 0 and the expected company total'; end if;
  insert into public.headcount_submissions(round_id,company_id,expected_count,accounted_count,status,note,submitted_by,submitted_at)
  values(p_round_id,p_company_id,expected,p_accounted_count,case when p_accounted_count=expected then 'submitted'::public.submission_status else 'exception'::public.submission_status end,nullif(trim(coalesce(p_note,'')),''),(select auth.uid()),now())
  on conflict(round_id,company_id) do update set expected_count=excluded.expected_count,accounted_count=excluded.accounted_count,status=excluded.status,note=excluded.note,submitted_by=excluded.submitted_by,submitted_at=excluded.submitted_at;
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(target_session,(select auth.uid()),'company_headcount_submitted','company',p_company_id::text,jsonb_build_object('round_id',p_round_id,'expected',expected,'accounted',p_accounted_count));
end;
$$;
revoke all on function public.submit_company_headcount(uuid,uuid,integer,text) from public, anon;
grant execute on function public.submit_company_headcount(uuid,uuid,integer,text) to authenticated;

-- Reconcile existing published assignments once: keep source records, remove only records outside the new default operational range.
insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
select p.session_id,null,'operational_eligibility_reconciled','session',p.session_id::text,
       jsonb_build_object('unassigned_out_of_range',count(*),'participant_min_age',coalesce(s.participant_min_age,13),'participant_max_age',coalesce(s.participant_max_age,20))
from public.participants p
left join public.session_structure_settings s on s.session_id=p.session_id
where p.group_id is not null
  and (not p.is_current or p.registration_status<>'approved' or p.verification_status<>'verified'
       or p.age is null or p.age < coalesce(s.participant_min_age,13) or p.age > coalesce(s.participant_max_age,20))
group by p.session_id,coalesce(s.participant_min_age,13),coalesce(s.participant_max_age,20);

update public.participants p
set group_id=null,updated_at=now()
from public.session_structure_settings s
where p.session_id=s.session_id and p.group_id is not null
  and (not p.is_current or p.registration_status<>'approved' or p.verification_status<>'verified'
       or p.age is null or p.age<s.participant_min_age or p.age>s.participant_max_age);
