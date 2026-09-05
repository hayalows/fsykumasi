create or replace function public.transition_staff_operational_role(
  p_staff_id uuid,
  p_role text,
  p_replacement_counselor_id uuid default null,
  p_counselor_group_id uuid default null,
  p_company_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  target public.staff%rowtype;
  current_group public.counselor_groups%rowtype;
  previous_company_ids uuid[] := '{}'::uuid[];
  desired_company_ids uuid[] := '{}'::uuid[];
  company_id uuid;
  linked_access_active boolean := false;
begin
  select * into target
  from public.staff
  where id = p_staff_id
  for update;

  if target.id is null then
    raise exception 'Staff member not found';
  end if;
  if not private.can_manage_access(target.session_id) then
    raise exception 'Administrative access is required';
  end if;
  if not target.is_current or target.registration_status <> 'approved' then
    raise exception 'Only current approved staff can change operational responsibility';
  end if;
  if p_role not in ('counselor','assistant_coordinator','coordinator','committee_member','logistics_admin','session_director','other') then
    raise exception 'Choose a supported staff role';
  end if;
  if p_replacement_counselor_id = target.id then
    raise exception 'Choose a different Counselor as the replacement';
  end if;

  select coalesce(array_agg(distinct requested.company_id order by requested.company_id), '{}'::uuid[])
    into desired_company_ids
  from unnest(coalesce(p_company_ids, '{}'::uuid[])) requested(company_id);

  if p_role <> 'assistant_coordinator' and cardinality(desired_company_ids) > 0 then
    raise exception 'Company scope can only be set for an Assistant Coordinator';
  end if;
  if p_role <> 'counselor' and p_counselor_group_id is not null then
    raise exception 'A counselor group can only be set for a Counselor';
  end if;

  select * into current_group
  from public.counselor_groups
  where session_id = target.session_id and counselor_id = target.id
  for update;

  select coalesce(array_agg(sca.company_id order by sca.assigned_at, sca.company_id), '{}'::uuid[])
    into previous_company_ids
  from public.staff_company_assignments sca
  where sca.session_id = target.session_id and sca.staff_id = target.id;

  select exists(
    select 1
    from public.staff_account_links sal
    where sal.session_id = target.session_id
      and sal.staff_id = target.id
      and sal.access_enabled
  ) into linked_access_active;

  if target.operational_role = 'counselor' and current_group.id is not null and p_role <> 'counselor' then
    perform public.unassign_counselor_from_group(current_group.id);
    if p_replacement_counselor_id is not null then
      perform public.assign_counselor_to_group(p_replacement_counselor_id, current_group.id);
    end if;
  end if;

  if target.operational_role = 'assistant_coordinator' and p_role <> 'assistant_coordinator' then
    for company_id in
      select sca.company_id
      from public.staff_company_assignments sca
      where sca.session_id = target.session_id and sca.staff_id = target.id
      order by sca.assigned_at, sca.company_id
    loop
      perform public.set_staff_company_assignment(target.id, company_id, false);
    end loop;
  end if;

  if p_role <> target.operational_role then
    perform public.set_staff_operational_role(target.id, p_role);
  end if;

  if p_role = 'assistant_coordinator' then
    if linked_access_active and cardinality(desired_company_ids) = 0 then
      raise exception 'Choose at least one company before moving an Assistant Coordinator with active website access';
    end if;
    perform public.set_assistant_coordinator_companies(target.id, desired_company_ids);
  elsif p_role = 'counselor' and p_counselor_group_id is not null then
    if current_group.id is null or current_group.id <> p_counselor_group_id or target.operational_role <> 'counselor' then
      perform public.assign_counselor_to_group(target.id, p_counselor_group_id);
    end if;
  end if;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(
    target.session_id,
    (select auth.uid()),
    'staff_operational_role_transitioned',
    'staff',
    target.id::text,
    jsonb_build_object(
      'from_role', target.operational_role,
      'to_role', p_role,
      'previous_group_id', current_group.id,
      'replacement_counselor_id', p_replacement_counselor_id,
      'new_counselor_group_id', p_counselor_group_id,
      'previous_company_ids', previous_company_ids,
      'company_ids', desired_company_ids,
      'linked_access_active', linked_access_active
    )
  );

  return jsonb_build_object(
    'staff_id', target.id,
    'from_role', target.operational_role,
    'to_role', p_role,
    'previous_group_id', current_group.id,
    'replacement_counselor_id', p_replacement_counselor_id,
    'company_ids', desired_company_ids
  );
end;
$function$;

revoke all on function public.transition_staff_operational_role(uuid,text,uuid,uuid,uuid[]) from public;
grant execute on function public.transition_staff_operational_role(uuid,text,uuid,uuid,uuid[]) to authenticated;
