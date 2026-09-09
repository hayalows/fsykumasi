-- Verified on-site participants receive a supplemental placement in one
-- transaction. Existing baseline groups and companies are never used for this
-- path, so an arrival cannot silently change the published structure.

create or replace function private.provision_supplemental_participant(target_participant uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  target public.participants%rowtype;
  age_on_start integer;
  cohort text;
  max_group_size integer:=10;
  groups_per_company integer:=2;
  target_group_id uuid;
  target_company_id uuid;
  counselor_id uuid;
  assistant_id uuid;
  next_company integer:=0;
  next_group integer:=0;
  next_slot integer:=0;
  company_number integer;
  origin_code text;
  fsy_id text;
  created_company boolean:=false;
  created_group boolean:=false;
begin
  select * into target
  from public.participants
  where id=target_participant
  for update;
  if target.id is null then raise exception 'Participant not found'; end if;
  if not target.is_current or target.verification_status<>'verified' or target.registration_status='cancelled' then
    raise exception 'Only current, verified participants can receive a supplemental placement';
  end if;

  age_on_start:=private.session_participant_age(target.session_id,target.id);
  if age_on_start is null or age_on_start<12 or age_on_start>=20 then
    raise exception 'Only participants aged 12 through 19 can receive a youth roster placement';
  end if;
  if exists(
    select 1 from public.participant_badge_assignments b
    where b.session_id=target.session_id and b.participant_id=target.id and b.state<>'retired'
  ) then
    select b.group_id,b.company_id,b.fsy_id
      into target_group_id,target_company_id,fsy_id
    from public.participant_badge_assignments b
    where b.session_id=target.session_id and b.participant_id=target.id and b.state<>'retired'
    order by b.assigned_at desc limit 1;
    return jsonb_build_object('participant_id',target.id,'group_id',target_group_id,'company_id',target_company_id,'fsy_id',fsy_id,'created_company',false,'created_group',false);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target.session_id::text,71));
  cohort:=private.session_finalization_cohort(target.session_id,target.id);
  select coalesce(group_max_size,10),coalesce(groups_per_company,2)
    into max_group_size,groups_per_company
  from public.session_structure_settings
  where session_id=target.session_id;
  max_group_size:=greatest(coalesce(max_group_size,10),1);
  groups_per_company:=greatest(coalesce(groups_per_company,2),1);

  -- Reuse only an already-isolated supplemental group with the same sex and
  -- cohort. A baseline group is never a candidate here.
  select g.id,g.company_id
    into target_group_id,target_company_id
  from public.counselor_groups g
  where g.session_id=target.session_id
    and g.state='published'
    and g.sex=target.sex
    and g.finalization_cohort=cohort
    and g.counselor_id is not null
    and private.staff_can_plan(g.counselor_id)
    and exists(
      select 1 from public.staff_company_assignments a
      where a.session_id=target.session_id
        and a.company_id=g.company_id
        and a.assignment_role='assistant_coordinator'
    )
    and (select count(*) from public.participants p where p.group_id=g.id and p.is_current and p.attendance_status<>'confirmed_not_attending') < max_group_size
    and not exists(
      select 1 from public.participants peer
      where peer.group_id=g.id
        and peer.is_current
        and peer.attendance_status<>'confirmed_not_attending'
        and lower(trim(coalesce(peer.unit_name,'')))=lower(trim(coalesce(target.unit_name,'')))
    )
  order by (select count(*) from public.participants p where p.group_id=g.id and p.is_current),g.operational_number nulls last,g.name,g.id
  limit 1
  for update of g;

  if target_group_id is null then
    -- A new supplemental group needs a counselor of the matching sex and a
    -- currently available Assistant Coordinator for its company.
    select st.id into counselor_id
    from public.staff st
    left join public.staff_operations so on so.staff_id=st.id
    where st.session_id=target.session_id
      and st.is_current
      and st.registration_status<>'cancelled'
      and st.operational_role='counselor'
      and st.sex=target.sex
      and coalesce(so.planning_state,'reserve')<>'excluded'
      and coalesce(so.service_clearance,'confirmation_required')<>'not_cleared'
      and coalesce(so.arrival_state,'expected') not in ('no_show','left')
      and not exists(select 1 from public.counselor_groups g where g.session_id=target.session_id and g.counselor_id=st.id)
    order by case when st.registration_status='approved' then 0 else 1 end,lower(st.full_name),st.id
    limit 1;
    if counselor_id is null then
      raise exception 'No available % counselor exists for this supplemental participant',target.sex;
    end if;

    select c.id into target_company_id
    from public.companies c
    where c.session_id=target.session_id
      and c.finalization_cohort=cohort
      and exists(
        select 1 from public.staff_company_assignments a
        where a.session_id=target.session_id
          and a.company_id=c.id
          and a.assignment_role='assistant_coordinator'
      )
      and (select count(*) from public.counselor_groups g where g.company_id=c.id and g.state<>'archived') < groups_per_company
    order by c.operational_number nulls last,c.name,c.id
    limit 1
    for update of c;

    if target_company_id is null then
      select coalesce(max(coalesce(c.operational_number,nullif(regexp_replace(c.name,'\D','','g'),'')::integer)),0)
        into next_company
      from public.companies c
      where c.session_id=target.session_id;
      next_company:=next_company+1;
      insert into public.companies(session_id,name,operational_number,finalization_cohort,finalization_batch_id)
      values(
        target.session_id,
        format('Supplemental %s Company %s',replace(initcap(cohort),'_',' '),lpad(next_company::text,2,'0')),
        next_company,cohort,extensions.gen_random_uuid()
      ) returning id into target_company_id;
      created_company:=true;

      select st.id into assistant_id
      from public.staff st
      left join public.staff_operations so on so.staff_id=st.id
      where st.session_id=target.session_id
        and st.is_current
        and st.registration_status<>'cancelled'
        and st.operational_role='assistant_coordinator'
        and coalesce(so.planning_state,'reserve')<>'excluded'
        and coalesce(so.service_clearance,'confirmation_required')<>'not_cleared'
        and coalesce(so.arrival_state,'expected') not in ('no_show','left')
        and not exists(select 1 from public.staff_company_assignments a where a.session_id=target.session_id and a.staff_id=st.id)
      order by case when st.registration_status='approved' then 0 else 1 end,lower(st.full_name),st.id
      limit 1;
      if assistant_id is null then
        raise exception 'No available Assistant Coordinator exists for the supplemental company';
      end if;
      insert into public.staff_company_assignments(session_id,staff_id,company_id,assignment_role,assigned_by,assigned_at)
      values(target.session_id,assistant_id,target_company_id,'assistant_coordinator',(select auth.uid()),now())
      on conflict do nothing;
    end if;

    select coalesce(max(coalesce(g.operational_number,nullif(regexp_replace(g.name,'\D','','g'),'')::integer)),0)
      into next_group
    from public.counselor_groups g
    where g.session_id=target.session_id;
    next_group:=next_group+1;
    insert into public.counselor_groups(
      session_id,company_id,name,sex,state,counselor_id,operational_number,
      finalization_cohort,finalization_batch_id
    ) values(
      target.session_id,target_company_id,
      format('%s %s %s',case when target.sex::text='female' then 'YW' else 'YM' end,replace(initcap(cohort),'_',' '),lpad(next_group::text,2,'0')),
      target.sex,'published',counselor_id,next_group,cohort,extensions.gen_random_uuid()
    ) returning id into target_group_id;
    created_group:=true;
  end if;

  update public.participants
  set group_id=target_group_id,attendance_status='expected',operational_status='active',updated_at=now()
  where id=target.id;

  select private.origin_code_for_participant(target) into origin_code;
  origin_code:=coalesce(nullif(btrim(origin_code),''),'UNK');
  select coalesce(c.operational_number,nullif(regexp_replace(c.name,'\D','','g'),'')::integer)
    into company_number
  from public.companies c
  where c.id=target_company_id and c.session_id=target.session_id;
  if company_number is null then raise exception 'Supplemental company has no operational number'; end if;
  select coalesce(max(b.slot_number),0)+1 into next_slot
  from public.participant_badge_assignments b
  where b.session_id=target.session_id and b.company_id=target_company_id and b.state<>'retired';
  if next_slot>99 then raise exception 'Supplemental company identity slots are full'; end if;
  fsy_id:='C'||lpad(company_number::text,greatest(2,length(company_number::text)),'0')||'-'||lpad(next_slot::text,2,'0')||'-'||origin_code;
  insert into public.participant_badge_assignments(
    session_id,participant_id,company_id,group_id,slot_number,origin_code,fsy_id,badge_name,state,
    assigned_by,assigned_at,finalized_by,finalized_at,note
  ) values(
    target.session_id,target.id,target_company_id,target_group_id,next_slot,origin_code,fsy_id,
    trim(concat_ws(' ',target.first_name,target.last_name)),'finalized',
    (select auth.uid()),now(),(select auth.uid()),now(),'Verified on-site supplemental placement'
  );

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(target.session_id,(select auth.uid()),'participant_supplemental_provisioned','participant',target.id::text,
    jsonb_build_object('cohort',cohort,'group_id',target_group_id,'company_id',target_company_id,'fsy_id',fsy_id,'created_company',created_company,'created_group',created_group));
  return jsonb_build_object('participant_id',target.id,'group_id',target_group_id,'company_id',target_company_id,'fsy_id',fsy_id,'created_company',created_company,'created_group',created_group);
end;
$$;

revoke all on function private.provision_supplemental_participant(uuid) from public;
grant execute on function private.provision_supplemental_participant(uuid) to authenticated;

create or replace function public.verify_on_site_participant(
  p_participant_id uuid,
  p_approved boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  target public.participants%rowtype;
  provision jsonb:='{}'::jsonb;
begin
  select * into target from public.participants where id=p_participant_id for update;
  if target.id is null or target.source_kind<>'on_site' then raise exception 'On-site participant not found'; end if;
  if not (private.has_capability(target.session_id,'registration_manage') or private.can_manage_access(target.session_id)) then
    raise exception 'Registration management access required';
  end if;
  update public.participants
  set verification_status=case when p_approved then 'verified' else 'rejected' end,
      is_current=p_approved,
      verified_by=(select auth.uid()),verified_at=now(),updated_at=now()
  where id=target.id;
  if p_approved then
    provision:=private.provision_supplemental_participant(target.id);
  end if;
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(target.session_id,(select auth.uid()),
    case when p_approved then 'on_site_participant_verified' else 'on_site_participant_rejected' end,
    'participant',target.id::text,
    jsonb_build_object('note',nullif(trim(coalesce(p_note,'')),''),'workflow','registration_checkin_desk','provision',provision));
end;
$$;

revoke all on function public.verify_on_site_participant(uuid,boolean,text) from public,anon;
grant execute on function public.verify_on_site_participant(uuid,boolean,text) to authenticated;
