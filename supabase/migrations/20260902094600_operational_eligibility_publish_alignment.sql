-- Keep grouping publish aligned with the same operational youth eligibility used by check-in and head count.
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
  if participant_total=0 or supplied_total<>participant_total or distinct_total<>participant_total then raise exception 'Every operationally eligible youth participant must be assigned exactly once'; end if;
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
revoke all on function public.publish_grouping_plan(uuid,jsonb) from public,anon;
grant execute on function public.publish_grouping_plan(uuid,jsonb) to authenticated;

-- One-time reconciliation for already-published structures. The source row stays; only the operational assignment is removed.
insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
select p.session_id,null,'operational_eligibility_reconciled','session',p.session_id::text,
       jsonb_build_object('unassigned_out_of_range',count(*),'participant_min_age',coalesce(s.participant_min_age,13),'participant_max_age',coalesce(s.participant_max_age,20))
from public.participants p
left join public.session_structure_settings s on s.session_id=p.session_id
where p.group_id is not null
  and (not p.is_current or p.registration_status<>'approved' or p.verification_status<>'verified'
       or p.age is null or p.age<coalesce(s.participant_min_age,13) or p.age>coalesce(s.participant_max_age,20))
group by p.session_id,coalesce(s.participant_min_age,13),coalesce(s.participant_max_age,20);

update public.participants p
set group_id=null,updated_at=now()
from public.session_structure_settings s
where p.session_id=s.session_id and p.group_id is not null
  and (not p.is_current or p.registration_status<>'approved' or p.verification_status<>'verified'
       or p.age is null or p.age<s.participant_min_age or p.age>s.participant_max_age);
