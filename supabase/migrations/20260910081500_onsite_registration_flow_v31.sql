-- Registration & check-in v31
-- Separate verification from placement, keep incremental arrivals inside the
-- existing structure whenever possible, and make the settled roster readable
-- without re-running the pre-session planner.

create or replace function public.add_on_site_participant_v3(
  p_session_id uuid,
  p_first_name text,
  p_last_name text,
  p_preferred_name text,
  p_sex public.participant_sex,
  p_date_of_birth date,
  p_unit_name text,
  p_stake_name text default null,
  p_phone text default null,
  p_contact_1_name text default null,
  p_contact_1_phone text default null,
  p_contact_2_name text default null,
  p_contact_2_phone text default null,
  p_tshirt_size text default null,
  p_medical_information text default null,
  p_dietary_information text default null,
  p_search_confirmed boolean default false
)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  next_id uuid := extensions.gen_random_uuid();
  session_start date;
  calculated_age integer;
  min_age integer := 12;
  max_age integer := 18;
  canonical_size text;
begin
  if not (
    private.has_capability(p_session_id,'registration_manage')
    or private.has_session_role(
      p_session_id,
      array['coordinator','logistics_admin','session_director','area_advisory_couple']::public.app_role[]
    )
  ) then
    raise exception 'Registration management access required';
  end if;
  if not p_search_confirmed then
    raise exception 'Search the existing registration list before adding someone';
  end if;

  select s.starts_on into session_start
  from public.sessions s
  where s.id=p_session_id;
  if session_start is null then raise exception 'Session start date is required'; end if;
  if p_date_of_birth is null or p_date_of_birth>session_start then
    raise exception 'Enter a valid date of birth';
  end if;

  select coalesce(ss.participant_min_age,12),coalesce(ss.participant_max_age,18)
    into min_age,max_age
  from public.session_structure_settings ss
  where ss.session_id=p_session_id;
  min_age:=coalesce(min_age,12);
  max_age:=coalesce(max_age,18);
  calculated_age:=extract(year from age(session_start,p_date_of_birth))::integer;

  if nullif(trim(coalesce(p_first_name,'')),'') is null
     or nullif(trim(coalesce(p_last_name,'')),'') is null
     or nullif(trim(coalesce(p_unit_name,'')),'') is null then
    raise exception 'First name, last name, date of birth, sex, and ward or branch are required';
  end if;
  if calculated_age not between min_age and max_age then
    raise exception 'This participant is outside the active youth age range of %-% for this session',min_age,max_age;
  end if;
  if nullif(trim(coalesce(p_contact_1_phone,'')),'') is null then
    raise exception 'Add a parent or guardian phone number';
  end if;
  if nullif(trim(coalesce(p_contact_2_name,'')),'') is not null
     and nullif(trim(coalesce(p_contact_2_phone,'')),'') is null then
    raise exception 'Add a phone number for the second parent or guardian';
  end if;

  if nullif(trim(coalesce(p_tshirt_size,'')),'') is not null then
    canonical_size:=case lower(trim(p_tshirt_size))
      when 'small' then 'Small'
      when 'medium' then 'Medium'
      when 'large' then 'Large'
      when 'extra large' then 'Extra Large'
      when 'extra extra large' then 'Extra Extra Large'
      else null
    end;
    if canonical_size is null then
      raise exception 'Choose a T-shirt size from Small, Medium, Large, Extra Large, or Extra Extra Large';
    end if;
  end if;

  if exists(
    select 1
    from public.participants participant
    join public.participant_private_details details on details.participant_id=participant.id
    where participant.session_id=p_session_id
      and participant.is_current
      and lower(trim(participant.first_name))=lower(trim(p_first_name))
      and lower(trim(participant.last_name))=lower(trim(p_last_name))
      and details.date_of_birth=p_date_of_birth
  ) then
    raise exception 'A person with this name and date of birth is already in the session. Search again before adding';
  end if;

  insert into public.participants(
    id,session_id,registration_id,first_name,last_name,preferred_name,
    sex,age,unit_name,stake_name,source_kind,registration_status,
    verification_status,is_current,reconciliation_status,attendance_status,operational_status
  ) values(
    next_id,p_session_id,
    'ONSITE-'||upper(substr(replace(next_id::text,'-',''),1,12)),
    trim(p_first_name),trim(p_last_name),nullif(trim(coalesce(p_preferred_name,'')),''),
    p_sex,calculated_age,trim(p_unit_name),nullif(trim(coalesce(p_stake_name,'')),''),
    'on_site','approved','pending',true,'current','expected','active'
  );

  insert into public.participant_private_details(
    participant_id,session_id,date_of_birth,phone,
    contact_1_name,contact_1_phone,contact_2_name,contact_2_phone,
    tshirt_size,medical_information,dietary_information,updated_at
  ) values(
    next_id,p_session_id,p_date_of_birth,nullif(trim(coalesce(p_phone,'')),''),
    nullif(trim(coalesce(p_contact_1_name,'')),''),trim(p_contact_1_phone),
    nullif(trim(coalesce(p_contact_2_name,'')),''),nullif(trim(coalesce(p_contact_2_phone,'')),''),
    canonical_size,nullif(trim(coalesce(p_medical_information,'')),''),
    nullif(trim(coalesce(p_dietary_information,'')),''),now()
  );

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(
    p_session_id,(select auth.uid()),'on_site_participant_added_v3','participant',next_id::text,
    jsonb_build_object(
      'age_at_session_start',calculated_age,
      'unit_name',trim(p_unit_name),
      'parent_phone_recorded',true,
      'second_parent_recorded',nullif(trim(coalesce(p_contact_2_phone,'')),'') is not null,
      'workflow','registration_checkin_v31',
      'next_step','verification'
    )
  );
  return next_id;
end;
$function$;

revoke all on function public.add_on_site_participant_v3(uuid,text,text,text,public.participant_sex,date,text,text,text,text,text,text,text,text,text,text,boolean) from public;
grant execute on function public.add_on_site_participant_v3(uuid,text,text,text,public.participant_sex,date,text,text,text,text,text,text,text,text,text,text,boolean) to authenticated;

-- Verification is one decision only. It never creates a group or company.
-- Placement and ID issuance happen in the next explicit step.
create or replace function public.verify_on_site_participant(
  p_participant_id uuid,
  p_approved boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $function$
declare
  target public.participants%rowtype;
  details public.participant_private_details%rowtype;
  age_on_start integer;
  min_age integer:=12;
  max_age integer:=18;
begin
  select * into target
  from public.participants
  where id=p_participant_id
  for update;
  if target.id is null or target.source_kind<>'on_site' then
    raise exception 'On-site participant not found';
  end if;
  if not (
    private.has_capability(target.session_id,'registration_manage')
    or private.can_manage_access(target.session_id)
  ) then raise exception 'Registration management access required'; end if;

  if p_approved then
    select * into details
    from public.participant_private_details d
    where d.participant_id=target.id;
    if nullif(trim(coalesce(details.contact_1_phone,'')),'') is null then
      raise exception 'Add a parent or guardian phone number before verification';
    end if;
    select coalesce(ss.participant_min_age,12),coalesce(ss.participant_max_age,18)
      into min_age,max_age
    from public.session_structure_settings ss
    where ss.session_id=target.session_id;
    age_on_start:=private.session_participant_age(target.session_id,target.id);
    if age_on_start is null or age_on_start not between coalesce(min_age,12) and coalesce(max_age,18) then
      raise exception 'This participant is outside the active youth age range for this session';
    end if;
  end if;

  update public.participants
  set verification_status=case when p_approved then 'verified' else 'rejected' end,
      is_current=p_approved,
      verified_by=(select auth.uid()),verified_at=now(),updated_at=now()
  where id=target.id;

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(
    target.session_id,(select auth.uid()),
    case when p_approved then 'on_site_participant_verified' else 'on_site_participant_rejected' end,
    'participant',target.id::text,
    jsonb_build_object(
      'note',nullif(trim(coalesce(p_note,'')),''),
      'workflow','registration_checkin_v31',
      'next_step',case when p_approved then 'placement' else 'closed' end
    )
  );
end;
$function$;

-- Keep the normal ward/branch protection for planned roster work, but waive it
-- for verified on-site arrivals. Capacity, sex and eligibility remain hard rules.
create or replace function public.assign_participant_to_group(p_participant_id uuid,p_group_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $function$
declare
  target public.participants%rowtype;
  target_group public.counselor_groups%rowtype;
  max_size integer;
  avoid_units boolean;
  active_members integer;
begin
  select * into target from public.participants where id=p_participant_id for update;
  select * into target_group from public.counselor_groups where id=p_group_id for update;

  if target.id is null or target_group.id is null or target.session_id<>target_group.session_id then
    raise exception 'Participant and group must belong to the same session';
  end if;
  if target_group.state<>'published' then raise exception 'Choose a published counselor group'; end if;
  if not (
    private.has_capability(target.session_id,'registration_manage')
    or private.has_session_role(
      target.session_id,
      array['coordinator','logistics_admin','session_director','area_advisory_couple']::public.app_role[]
    )
  ) then raise exception 'Registration management access required to assign participants'; end if;
  if not private.operational_participant_is_eligible(target.session_id,target.id) then
    raise exception 'This participant is not ready for placement. Complete verification and eligibility first';
  end if;
  if target.sex<>target_group.sex then raise exception 'Choose a counselor group for the participant sex'; end if;

  select coalesce(ss.group_max_size,10),coalesce(ss.avoid_same_unit,true)
    into max_size,avoid_units
  from public.session_structure_settings ss
  where ss.session_id=target.session_id;
  max_size:=coalesce(max_size,10);
  avoid_units:=coalesce(avoid_units,true);

  select count(*)::integer into active_members
  from public.participants p
  where p.group_id=target_group.id
    and p.id<>target.id
    and p.is_current
    and coalesce(p.operational_status,'active')='active'
    and p.attendance_status<>'confirmed_not_attending';
  if active_members>=max_size then
    raise exception 'That counselor group is full. Choose another available group';
  end if;

  if target.source_kind<>'on_site' and avoid_units and exists(
    select 1 from public.participants peer
    where peer.group_id=target_group.id
      and peer.id<>target.id
      and peer.is_current
      and coalesce(peer.operational_status,'active')='active'
      and peer.attendance_status<>'confirmed_not_attending'
      and lower(trim(coalesce(peer.unit_name,'')))=lower(trim(coalesce(target.unit_name,'')))
  ) then raise exception 'This group already contains someone from the same ward or branch'; end if;

  update public.participants
  set group_id=target_group.id,attendance_status='expected',updated_at=now()
  where id=target.id;

  if target.source_kind='on_site'
     or exists(select 1 from public.participant_operation_decisions od where od.participant_id=target.id and od.cohort_state='exception') then
    perform private.ensure_on_site_fsy_id(target.id,(select auth.uid()));
  end if;

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(
    target.session_id,(select auth.uid()),'participant_group_assigned','participant',target.id::text,
    jsonb_build_object(
      'group_id',target_group.id,
      'company_id',target_group.company_id,
      'workflow','registration_checkin_v31',
      'on_site_unit_rule_waived',target.source_kind='on_site'
    )
  );
end;
$function$;

-- Operational Registration should show work that can still be acted on. Resolved
-- age-policy exclusions remain available in source/history views, not in this queue.
create or replace function public.get_registration_workspace_v29(p_session_id uuid)
returns table(
  participant_id uuid,fsy_id text,full_name text,preferred_name text,sex text,age integer,
  stake_name text,unit_name text,company_id uuid,company_name text,group_id uuid,group_name text,
  slot_number integer,badge_state text,attendance_status text,checkin_status text,source_kind text,
  verification_status text,registration_status text,is_current boolean,eligible boolean,
  eligibility_reason text,room_id uuid,room_name text,bed_label text,housing_assigned_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  can_registration boolean;
  can_checkin boolean;
  caller_companies uuid[];
begin
  can_registration:=private.has_capability(p_session_id,'registration_view')
    or private.has_capability(p_session_id,'registration_manage');
  can_checkin:=private.has_capability(p_session_id,'checkin_record');
  if not can_registration and not can_checkin then raise exception 'Registration or check-in access required'; end if;

  if not can_registration then
    select coalesce(aa.company_ids,'{}'::uuid[]) into caller_companies
    from public.access_assignments aa
    where aa.session_id=p_session_id and aa.user_id=(select auth.uid()) and aa.active
    limit 1;
    caller_companies:=coalesce(caller_companies,'{}'::uuid[]);
  end if;

  return query
  select
    p.id,b.fsy_id,trim(concat_ws(' ',p.first_name,p.last_name)),p.preferred_name,p.sex::text,p.age,
    p.stake_name,p.unit_name,coalesce(b.company_id,g.company_id),c.name,
    coalesce(b.group_id,p.group_id),g.name,b.slot_number,b.state::text,
    coalesce(p.attendance_status,'expected'),ci.status::text,p.source_kind,p.verification_status,
    case when e.eligible and p.registration_status='awaiting' then 'approved' else p.registration_status end,
    p.is_current,e.eligible,e.reason,hr.id,hr.room_name,ha.bed_label,ha.assigned_at
  from public.participants p
  join private.participant_eligibility_projection(p_session_id) e on e.participant_id=p.id
  left join public.participant_badge_assignments b
    on b.participant_id=p.id and b.session_id=p.session_id and b.state<>'retired'
  left join public.counselor_groups g on g.id=coalesce(b.group_id,p.group_id)
  left join public.companies c on c.id=coalesce(b.company_id,g.company_id)
  left join public.check_ins ci on ci.session_id=p.session_id and ci.participant_id=p.id
  left join public.housing_assignments ha on ha.session_id=p.session_id and ha.participant_id=p.id and ha.active
  left join public.housing_rooms hr on hr.id=ha.room_id and hr.session_id=ha.session_id
  where p.session_id=p_session_id
    and not exists(
      select 1 from public.participant_operation_decisions od
      where od.participant_id=p.id and od.cohort_state='excluded'
    )
    and (can_registration or coalesce(b.company_id,g.company_id)=any(caller_companies))
  order by lower(coalesce(p.stake_name,'')),lower(coalesce(p.unit_name,'')),lower(p.last_name),lower(p.first_name),p.id;
end;
$function$;

-- Once finalized, the Final roster screen should read the settled result rather
-- than re-running a planner whose job is already complete.
create or replace function public.get_controlled_final_roster_preview_v3(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  plan jsonb;
  final_row public.session_roster_finalizations%rowtype;
  latest_version jsonb;
begin
  if not private.can_finalize_session(p_session_id) then raise exception 'Final roster access required'; end if;
  if not exists(select 1 from public.sessions s where s.id=p_session_id) then raise exception 'Session not found'; end if;

  select * into final_row
  from public.session_roster_finalizations f
  where f.session_id=p_session_id;
  select jsonb_build_object('id',v.id,'label',v.label,'created_at',v.created_at,'summary',v.summary)
    into latest_version
  from public.session_roster_versions v
  where v.session_id=p_session_id
  order by v.created_at desc limit 1;

  if final_row.id is not null then
    return jsonb_build_object(
      'already_finalized',true,
      'finalized_at',final_row.finalized_at,
      'final_summary',coalesce(final_row.summary,'{}'::jsonb),
      'final_participants',coalesce((final_row.summary->>'final_participants')::integer,0),
      'new_groups',coalesce((final_row.summary->>'new_groups')::integer,0),
      'new_companies',coalesce((final_row.summary->>'new_companies')::integer,0),
      'badge_ids_preserved',coalesce((final_row.summary->>'badge_ids_preserved')::integer,0),
      'badge_ids_changed',coalesce((final_row.summary->>'badge_ids_changed')::integer,0),
      'new_ids_issued',coalesce((final_row.summary->>'new_ids_issued')::integer,0),
      'safe_to_apply',false,
      'latest_saved_version',coalesce(latest_version,'{}'::jsonb)
    );
  end if;

  plan:=private.controlled_final_roster_plan_v3(p_session_id);
  return plan||jsonb_build_object(
    'already_finalized',false,
    'finalized_at',null,
    'final_summary','{}'::jsonb,
    'latest_saved_version',coalesce(latest_version,'{}'::jsonb)
  );
end;
$function$;

revoke all on function public.get_controlled_final_roster_preview_v3(uuid) from public;
grant execute on function public.get_controlled_final_roster_preview_v3(uuid) to authenticated;
