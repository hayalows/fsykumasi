-- Explicit late/on-site overflow placement v55.
-- Verification remains separate from placement. This adds a reviewed, audited path only when
-- every compatible published counselor group is full, and prevents placement into a group
-- without a ready counselor.

create or replace function public.get_registration_placement_groups_v1(p_session_id uuid)
returns table(
  group_id uuid,
  group_name text,
  custom_name text,
  company_id uuid,
  company_name text,
  company_custom_name text,
  sex public.participant_sex,
  state text,
  member_count integer,
  max_size integer,
  counselor_id uuid,
  counselor_name text,
  counselor_ready boolean
)
language sql
stable
security definer
set search_path=''
as $$
  select
    g.id,
    g.name,
    g.custom_name,
    g.company_id,
    c.name,
    c.custom_name,
    g.sex,
    g.state,
    count(p.id) filter(
      where p.is_current
        and coalesce(p.operational_status,'active')='active'
        and p.attendance_status<>'confirmed_not_attending'
    )::integer,
    coalesce(ss.group_max_size,10),
    g.counselor_id,
    st.full_name,
    (
      g.counselor_id is not null
      and st.is_current
      and st.operational_role='counselor'
      and st.registration_status='approved'
      and coalesce(so.service_clearance,'confirmation_required')='cleared'
      and coalesce(so.arrival_state,'expected') in ('expected','arrived')
      and coalesce(so.planning_state,'reserve')<>'excluded'
    )
  from public.counselor_groups g
  left join public.companies c on c.id=g.company_id and c.session_id=g.session_id
  left join public.participants p on p.group_id=g.id and p.session_id=g.session_id
  left join public.staff st on st.id=g.counselor_id and st.session_id=g.session_id
  left join public.staff_operations so on so.staff_id=st.id
  left join public.session_structure_settings ss on ss.session_id=g.session_id
  where g.session_id=p_session_id
    and (
      private.has_capability(p_session_id,'registration_view')
      or private.has_capability(p_session_id,'registration_manage')
      or private.has_session_role(
        p_session_id,
        array['coordinator','logistics_admin','session_director','area_advisory_couple']::public.app_role[]
      )
    )
  group by g.id,c.id,ss.group_max_size,st.id,so.service_clearance,so.arrival_state,so.planning_state
  order by coalesce(c.operational_number,9999),c.name,g.sex,coalesce(g.operational_number,9999),g.name;
$$;

create or replace function public.assign_participant_to_group(p_participant_id uuid,p_group_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  target public.participants%rowtype;
  target_group public.counselor_groups%rowtype;
  counselor public.staff%rowtype;
  counselor_ops public.staff_operations%rowtype;
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

  if target_group.counselor_id is null then
    raise exception 'This counselor group has no counselor. Assign a ready counselor before placing a participant';
  end if;
  select * into counselor
  from public.staff st
  where st.id=target_group.counselor_id and st.session_id=target.session_id;
  select * into counselor_ops from public.staff_operations so where so.staff_id=target_group.counselor_id;
  if counselor.id is null
     or not counselor.is_current
     or counselor.operational_role<>'counselor'
     or counselor.registration_status<>'approved'
     or coalesce(counselor_ops.service_clearance,'confirmation_required')<>'cleared'
     or coalesce(counselor_ops.arrival_state,'expected') not in ('expected','arrived')
     or coalesce(counselor_ops.planning_state,'reserve')='excluded' then
    raise exception 'This counselor group does not have a ready counselor. Review Staff before placing a participant';
  end if;

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
      'workflow','registration_checkin_v55',
      'on_site_unit_rule_waived',target.source_kind='on_site',
      'counselor_id',target_group.counselor_id
    )
  );
end;
$$;

create or replace function public.preview_onsite_supplemental_placement_v1(p_participant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  target public.participants%rowtype;
  cohort text;
  max_group_size integer:=10;
  groups_per_company integer:=4;
  target_company_id uuid;
  target_company_name text;
  target_company_number integer;
  target_group_name text;
  counselor_id uuid;
  counselor_name text;
  counselor_planning text;
  assistant_id uuid;
  assistant_name text;
  assistant_planning text;
  regular_group_id uuid;
  regular_group_name text;
  regular_company_name text;
  regular_open integer;
  needs_company boolean:=false;
  next_company integer:=0;
  next_group integer:=0;
  assistant_companies_limit integer:=4;
begin
  select * into target from public.participants where id=p_participant_id;
  if target.id is null then raise exception 'Participant not found'; end if;
  if not (
    private.has_capability(target.session_id,'registration_manage')
    or private.has_session_role(
      target.session_id,
      array['coordinator','logistics_admin','session_director','area_advisory_couple']::public.app_role[]
    )
  ) then raise exception 'Registration management access required'; end if;
  if target.source_kind<>'on_site' then raise exception 'Overflow placement is only available for an on-site participant'; end if;
  if target.group_id is not null then
    return jsonb_build_object('ready',false,'reason','already_placed','message','This participant already has a counselor group');
  end if;
  if not private.operational_participant_is_eligible(target.session_id,target.id) then
    raise exception 'Complete on-site verification and eligibility before preparing overflow placement';
  end if;
  if target.sex is null then raise exception 'Record the participant sex before placement'; end if;

  select coalesce(ss.group_max_size,10),coalesce(ss.groups_per_company,4),coalesce(ss.companies_per_assistant_coordinator,4)
    into max_group_size,groups_per_company,assistant_companies_limit
  from public.session_structure_settings ss where ss.session_id=target.session_id;
  max_group_size:=greatest(coalesce(max_group_size,10),1);
  groups_per_company:=greatest(coalesce(groups_per_company,4),1);
  assistant_companies_limit:=greatest(coalesce(assistant_companies_limit,4),1);
  cohort:=private.session_finalization_cohort(target.session_id,target.id);

  -- If an ordinary ready group has space, do not create extra structure.
  select g.id,coalesce(nullif(g.custom_name,''),g.name),coalesce(nullif(c.custom_name,''),c.name),
         max_group_size-count(p.id) filter(
           where p.is_current and coalesce(p.operational_status,'active')='active' and p.attendance_status<>'confirmed_not_attending'
         )::integer
    into regular_group_id,regular_group_name,regular_company_name,regular_open
  from public.counselor_groups g
  join public.companies c on c.id=g.company_id
  join public.staff st on st.id=g.counselor_id and st.session_id=g.session_id
  join public.staff_operations so on so.staff_id=st.id
  left join public.participants p on p.group_id=g.id and p.session_id=g.session_id
  where g.session_id=target.session_id and g.state='published' and g.sex=target.sex
    and st.is_current and st.operational_role='counselor' and st.registration_status='approved'
    and so.service_clearance='cleared' and so.arrival_state in ('expected','arrived') and so.planning_state<>'excluded'
  group by g.id,c.id
  having count(p.id) filter(
    where p.is_current and coalesce(p.operational_status,'active')='active' and p.attendance_status<>'confirmed_not_attending'
  ) < max_group_size
  order by count(p.id) filter(
    where p.is_current and coalesce(p.operational_status,'active')='active' and p.attendance_status<>'confirmed_not_attending'
  ),coalesce(c.operational_number,9999),coalesce(g.operational_number,9999),g.name
  limit 1;
  if regular_group_id is not null then
    return jsonb_build_object(
      'ready',false,'reason','regular_space_available',
      'message','A regular counselor group has space. Use normal placement instead of creating overflow structure.',
      'regular_group_id',regular_group_id,'regular_group_name',regular_group_name,
      'regular_company_name',regular_company_name,'regular_open',regular_open
    );
  end if;

  -- Prefer a company in the same cohort that already has a ready Assistant Coordinator and room for another group.
  select c.id,coalesce(nullif(c.custom_name,''),c.name),c.operational_number
    into target_company_id,target_company_name,target_company_number
  from public.companies c
  where c.session_id=target.session_id
    and c.finalization_cohort=cohort
    and exists(
      select 1 from public.staff_company_assignments a
      join public.staff st on st.id=a.staff_id and st.session_id=a.session_id
      join public.staff_operations so on so.staff_id=st.id
      where a.session_id=target.session_id and a.company_id=c.id and a.assignment_role='assistant_coordinator'
        and st.is_current and st.operational_role='assistant_coordinator' and st.registration_status='approved'
        and so.service_clearance='cleared' and so.arrival_state in ('expected','arrived') and so.planning_state<>'excluded'
    )
    and (select count(*) from public.counselor_groups g where g.company_id=c.id and g.state<>'archived') < groups_per_company
  order by c.operational_number nulls last,c.name,c.id
  limit 1;

  if target_company_id is null then
    needs_company:=true;
    select coalesce(max(coalesce(c.operational_number,nullif(regexp_replace(c.name,'\D','','g'),'')::integer)),0)+1
      into next_company from public.companies c where c.session_id=target.session_id;
    target_company_name:=format('Supplemental %s Company %s',replace(initcap(cohort),'_',' '),lpad(next_company::text,2,'0'));
  end if;

  select st.id,st.full_name,coalesce(so.planning_state,'reserve')
    into counselor_id,counselor_name,counselor_planning
  from public.staff st
  join public.staff_operations so on so.staff_id=st.id
  where st.session_id=target.session_id and st.is_current and st.operational_role='counselor'
    and st.registration_status='approved' and st.sex=target.sex
    and so.service_clearance='cleared' and so.arrival_state in ('expected','arrived') and so.planning_state<>'excluded'
    and not exists(select 1 from public.counselor_groups g where g.session_id=target.session_id and g.counselor_id=st.id)
  order by case when so.planning_state='reserve' then 0 else 1 end,lower(st.full_name),st.id
  limit 1;

  if counselor_id is null then
    return jsonb_build_object('ready',false,'reason','no_counselor','message',format('No approved, cleared %s counselor is available for a new overflow group.',target.sex));
  end if;

  if needs_company then
    select st.id,st.full_name,coalesce(so.planning_state,'reserve')
      into assistant_id,assistant_name,assistant_planning
    from public.staff st
    join public.staff_operations so on so.staff_id=st.id
    where st.session_id=target.session_id and st.is_current and st.operational_role='assistant_coordinator'
      and st.registration_status='approved'
      and so.service_clearance='cleared' and so.arrival_state in ('expected','arrived') and so.planning_state<>'excluded'
      and (select count(*) from public.staff_company_assignments a where a.session_id=target.session_id and a.staff_id=st.id) < assistant_companies_limit
    order by case when so.planning_state='reserve' then 0 else 1 end,lower(st.full_name),st.id
    limit 1;
    if assistant_id is null then
      return jsonb_build_object('ready',false,'reason','no_assistant','message','No approved, cleared Assistant Coordinator is available for a new overflow company.');
    end if;
  end if;

  select coalesce(max(coalesce(g.operational_number,nullif(regexp_replace(g.name,'\D','','g'),'')::integer)),0)+1
    into next_group from public.counselor_groups g where g.session_id=target.session_id;
  target_group_name:=format('Supplemental %s %s %s',case when target.sex::text='female' then 'YW' else 'YM' end,replace(initcap(cohort),'_',' '),lpad(next_group::text,2,'0'));

  return jsonb_build_object(
    'ready',true,'mode',case when needs_company then 'new_company' else 'new_group' end,'cohort',cohort,
    'company_id',target_company_id,'company_name',target_company_name,'company_number',coalesce(target_company_number,next_company),
    'group_name',target_group_name,'group_number',next_group,
    'counselor_id',counselor_id,'counselor_name',counselor_name,'counselor_planning_state',counselor_planning,
    'assistant_id',assistant_id,'assistant_name',assistant_name,'assistant_planning_state',assistant_planning,
    'message',case when needs_company then 'Create one supplemental company and counselor group, then place this participant.' else 'Add one supplemental counselor group to an existing company, then place this participant.' end
  );
end;
$$;

create or replace function public.apply_onsite_supplemental_placement_v1(
  p_participant_id uuid,
  p_expected_counselor_id uuid default null,
  p_expected_assistant_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  target public.participants%rowtype;
  preview jsonb;
  mode text;
  cohort text;
  target_company_id uuid;
  target_group_id uuid;
  target_company_name text;
  target_group_name text;
  target_company_number integer;
  target_group_number integer;
  counselor_id uuid;
  assistant_id uuid;
  badge_id text;
  created_company boolean:=false;
  created_group boolean:=false;
  assistant_load integer:=0;
  assistant_max_load integer:=4;
begin
  select * into target from public.participants where id=p_participant_id for update;
  if target.id is null then raise exception 'Participant not found'; end if;
  if not (
    private.has_capability(target.session_id,'registration_manage')
    or private.has_session_role(
      target.session_id,
      array['coordinator','logistics_admin','session_director','area_advisory_couple']::public.app_role[]
    )
  ) then raise exception 'Registration management access required'; end if;
  if target.source_kind<>'on_site' then raise exception 'Overflow placement is only available for an on-site participant'; end if;
  if target.group_id is not null then raise exception 'This participant already has a counselor group'; end if;
  if not private.operational_participant_is_eligible(target.session_id,target.id) then
    raise exception 'Complete on-site verification and eligibility before overflow placement';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target.session_id::text,155));
  preview:=public.preview_onsite_supplemental_placement_v1(target.id);
  if coalesce((preview->>'ready')::boolean,false)=false then
    raise exception '%',coalesce(preview->>'message','Overflow placement is not ready');
  end if;
  mode:=preview->>'mode';
  cohort:=preview->>'cohort';
  counselor_id:=(preview->>'counselor_id')::uuid;
  if p_expected_counselor_id is null or counselor_id is distinct from p_expected_counselor_id then
    raise exception 'The suggested counselor changed. Review the overflow plan again before saving';
  end if;
  target_company_name:=preview->>'company_name';
  target_company_number:=(preview->>'company_number')::integer;
  target_group_name:=preview->>'group_name';
  target_group_number:=(preview->>'group_number')::integer;

  if mode='new_company' then
    assistant_id:=(preview->>'assistant_id')::uuid;
    if p_expected_assistant_id is null or assistant_id is distinct from p_expected_assistant_id then
      raise exception 'The suggested Assistant Coordinator changed. Review the overflow plan again before saving';
    end if;
    select st.id into assistant_id
    from public.staff st
    where st.id=assistant_id and st.session_id=target.session_id
    for update;
    if assistant_id is null then raise exception 'The suggested Assistant Coordinator is no longer available'; end if;
    select count(*) into assistant_load
    from public.staff_company_assignments a
    where a.session_id=target.session_id and a.staff_id=assistant_id;
    select coalesce(ss.companies_per_assistant_coordinator,4) into assistant_max_load
    from public.session_structure_settings ss
    where ss.session_id=target.session_id;
    assistant_max_load:=greatest(coalesce(assistant_max_load,4),1);
    if assistant_load>=assistant_max_load then
      raise exception 'The suggested Assistant Coordinator already supervises the configured maximum of % companies',assistant_max_load;
    end if;
    insert into public.companies(session_id,name,operational_number,finalization_cohort,finalization_batch_id)
    values(target.session_id,target_company_name,target_company_number,cohort,extensions.gen_random_uuid())
    returning id into target_company_id;
    created_company:=true;
    insert into public.staff_company_assignments(session_id,staff_id,company_id,assignment_role,assigned_by,assigned_at)
    values(target.session_id,assistant_id,target_company_id,'assistant_coordinator',(select auth.uid()),now());
    update public.staff s set assigned_company_id=(
      select a.company_id
      from public.staff_company_assignments a
      where a.session_id=target.session_id and a.staff_id=assistant_id
      order by a.assigned_at,a.company_id
      limit 1
    ) where s.id=assistant_id and s.session_id=target.session_id;
  elsif mode='new_group' then
    target_company_id:=(preview->>'company_id')::uuid;
    if target_company_id is null then raise exception 'The overflow company is no longer available'; end if;
  else
    raise exception 'The overflow plan is no longer valid. Review it again before saving';
  end if;

  insert into public.counselor_groups(
    session_id,company_id,name,sex,state,counselor_id,operational_number,finalization_cohort,finalization_batch_id
  ) values(
    target.session_id,target_company_id,target_group_name,target.sex,'published',counselor_id,target_group_number,cohort,extensions.gen_random_uuid()
  ) returning id into target_group_id;
  created_group:=true;

  perform public.assign_participant_to_group(target.id,target_group_id);
  select b.fsy_id into badge_id
  from public.participant_badge_assignments b
  where b.session_id=target.session_id and b.participant_id=target.id and b.state<>'retired'
  order by b.assigned_at desc limit 1;

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(target.session_id,(select auth.uid()),'onsite_overflow_placement_applied','participant',target.id::text,
    jsonb_build_object(
      'workflow','registration_checkin_v55','mode',mode,'cohort',cohort,
      'group_id',target_group_id,'company_id',target_company_id,'counselor_id',counselor_id,
      'assistant_id',assistant_id,'created_group',created_group,'created_company',created_company,'fsy_id',badge_id
    ));

  return jsonb_build_object(
    'participant_id',target.id,'mode',mode,'group_id',target_group_id,'group_name',target_group_name,
    'company_id',target_company_id,'company_name',target_company_name,'fsy_id',badge_id,
    'created_group',created_group,'created_company',created_company
  );
end;
$$;

revoke all on function public.get_registration_placement_groups_v1(uuid) from public,anon;
revoke all on function public.preview_onsite_supplemental_placement_v1(uuid) from public,anon;
revoke all on function public.apply_onsite_supplemental_placement_v1(uuid,uuid,uuid) from public,anon;
grant execute on function public.get_registration_placement_groups_v1(uuid) to authenticated;
grant execute on function public.preview_onsite_supplemental_placement_v1(uuid) to authenticated;
grant execute on function public.apply_onsite_supplemental_placement_v1(uuid,uuid,uuid) to authenticated;

comment on function public.preview_onsite_supplemental_placement_v1(uuid)
is 'Read-only overflow preview for a verified on-site participant. It never creates groups, companies, staff assignments, or badges.';
comment on function public.apply_onsite_supplemental_placement_v1(uuid,uuid,uuid)
is 'Explicit audited on-site overflow placement. Rechecks capacity and staff, creates only the minimum supplemental structure needed, then assigns the participant and FSY ID atomically.';
