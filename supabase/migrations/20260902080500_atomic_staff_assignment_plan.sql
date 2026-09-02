-- Apply reviewed counselor/Assistant Coordinator suggestions as one validated transaction.
-- Existing assignments are never overwritten by this bulk helper.

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
  counselor_count integer := 0;
  assistant_count integer := 0;
begin
  if not private.can_manage_access(p_session_id) then
    raise exception 'Administrative access is required to assign staff';
  end if;
  if jsonb_typeof(coalesce(p_counselor_assignments, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_assistant_assignments, '[]'::jsonb)) <> 'array' then
    raise exception 'Staff assignment plans must be JSON arrays';
  end if;
  if jsonb_array_length(coalesce(p_counselor_assignments, '[]'::jsonb)) > 500
     or jsonb_array_length(coalesce(p_assistant_assignments, '[]'::jsonb)) > 500 then
    raise exception 'Staff assignment plan is too large';
  end if;

  -- Validate every counselor suggestion before writing anything.
  for item in select value from jsonb_array_elements(coalesce(p_counselor_assignments, '[]'::jsonb)) loop
    select * into target_staff from public.staff where id = (item->>'staff_id')::uuid;
    select * into target_group from public.counselor_groups where id = (item->>'group_id')::uuid;
    if target_staff.id is null or target_group.id is null
       or target_staff.session_id <> p_session_id or target_group.session_id <> p_session_id then
      raise exception 'Counselor suggestion does not belong to this session';
    end if;
    if target_staff.operational_role <> 'counselor'
       or target_staff.registration_status <> 'approved' or not target_staff.is_current then
      raise exception 'Only current approved Counselors can be assigned';
    end if;
    if target_staff.sex is not null and target_staff.sex <> target_group.sex then
      raise exception 'Counselor sex must match the counselor group';
    end if;
    if target_group.counselor_id is not null then
      raise exception 'Bulk staffing will not overwrite an existing counselor assignment';
    end if;
    if exists (
      select 1 from public.counselor_groups existing
      where existing.session_id = p_session_id and existing.counselor_id = target_staff.id
    ) then
      raise exception 'A suggested Counselor is already assigned to another group';
    end if;
  end loop;

  if exists (
    select 1
    from (
      select value->>'staff_id' as staff_id, count(*) as uses
      from jsonb_array_elements(coalesce(p_counselor_assignments, '[]'::jsonb))
      group by value->>'staff_id'
    ) duplicates
    where duplicates.uses > 1
  ) then
    raise exception 'A Counselor can only appear once in a bulk assignment plan';
  end if;

  -- Validate every Assistant Coordinator suggestion before writing anything.
  for item in select value from jsonb_array_elements(coalesce(p_assistant_assignments, '[]'::jsonb)) loop
    select * into target_staff from public.staff where id = (item->>'staff_id')::uuid;
    select * into target_company from public.companies where id = (item->>'company_id')::uuid;
    if target_staff.id is null or target_company.id is null
       or target_staff.session_id <> p_session_id or target_company.session_id <> p_session_id then
      raise exception 'Assistant Coordinator suggestion does not belong to this session';
    end if;
    if target_staff.operational_role <> 'assistant_coordinator'
       or target_staff.registration_status <> 'approved' or not target_staff.is_current then
      raise exception 'Only current approved Assistant Coordinators can be assigned';
    end if;
    if exists (
      select 1 from public.staff_company_assignments existing
      where existing.session_id = p_session_id and existing.company_id = target_company.id
    ) then
      raise exception 'Bulk staffing will not overwrite an existing company Assistant Coordinator assignment';
    end if;
  end loop;

  -- Apply counselor suggestions after all validation succeeds.
  for item in select value from jsonb_array_elements(coalesce(p_counselor_assignments, '[]'::jsonb)) loop
    update public.counselor_groups
    set counselor_id = (item->>'staff_id')::uuid
    where id = (item->>'group_id')::uuid and session_id = p_session_id and counselor_id is null;
    counselor_count := counselor_count + 1;
  end loop;

  -- Apply Assistant Coordinator suggestions. One AC may support multiple companies.
  for item in select value from jsonb_array_elements(coalesce(p_assistant_assignments, '[]'::jsonb)) loop
    insert into public.staff_company_assignments(session_id, staff_id, company_id, assigned_by)
    values (p_session_id, (item->>'staff_id')::uuid, (item->>'company_id')::uuid, (select auth.uid()))
    on conflict (staff_id, company_id) do nothing;
    assistant_count := assistant_count + 1;
  end loop;

  update public.staff staff_member
  set assigned_company_id = (
    select assignment.company_id
    from public.staff_company_assignments assignment
    where assignment.staff_id = staff_member.id
    order by assignment.assigned_at, assignment.company_id
    limit 1
  )
  where staff_member.session_id = p_session_id
    and staff_member.id in (
      select (value->>'staff_id')::uuid
      from jsonb_array_elements(coalesce(p_assistant_assignments, '[]'::jsonb))
    );

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_session_id,
    (select auth.uid()),
    'staff_assignment_plan_applied',
    'session',
    p_session_id::text,
    jsonb_build_object('counselor_assignments', counselor_count, 'assistant_coordinator_assignments', assistant_count)
  );

  return jsonb_build_object(
    'counselor_assignments', counselor_count,
    'assistant_coordinator_assignments', assistant_count
  );
end;
$$;

revoke all on function public.apply_staff_assignment_plan(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.apply_staff_assignment_plan(uuid,jsonb,jsonb) to authenticated;
