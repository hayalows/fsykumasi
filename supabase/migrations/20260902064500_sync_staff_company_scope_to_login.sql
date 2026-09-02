-- When an imported staff record and an authenticated leader share the same
-- email, keep an Assistant Coordinator's login scope aligned with the
-- companies assigned in the operations workbench.
create or replace function public.set_staff_company_assignment(p_staff_id uuid, p_company_id uuid, p_assigned boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_staff public.staff%rowtype;
  target_company public.companies%rowtype;
  staff_email text;
  linked_user uuid;
begin
  select * into target_staff from public.staff where id = p_staff_id for update;
  select * into target_company from public.companies where id = p_company_id;
  if target_staff.id is null or target_company.id is null or target_staff.session_id <> target_company.session_id then
    raise exception 'Staff member and company must belong to the same session';
  end if;
  if not private.can_manage_access(target_staff.session_id) then raise exception 'Administrative access is required'; end if;
  if target_staff.operational_role <> 'assistant_coordinator' then raise exception 'Set this staff member as an Assistant Coordinator first'; end if;

  if p_assigned then
    insert into public.staff_company_assignments(session_id, staff_id, company_id, assigned_by)
    values (target_staff.session_id, target_staff.id, target_company.id, (select auth.uid()))
    on conflict (staff_id, company_id) do nothing;
  else
    delete from public.staff_company_assignments where staff_id = target_staff.id and company_id = target_company.id;
  end if;

  update public.staff s set assigned_company_id = (
    select sca.company_id from public.staff_company_assignments sca
    where sca.staff_id = s.id order by sca.assigned_at, sca.company_id limit 1
  ) where s.id = target_staff.id;

  select lower(trim(spd.email)) into staff_email
  from public.staff_private_details spd where spd.staff_id = target_staff.id;
  if staff_email is not null then
    select p.user_id into linked_user from public.profiles p
    where lower(trim(p.email)) = staff_email limit 1;
  end if;

  if linked_user is not null then
    update public.access_assignments aa
    set company_ids = coalesce((
      select array_agg(sca.company_id order by sca.assigned_at, sca.company_id)
      from public.staff_company_assignments sca where sca.staff_id = target_staff.id
    ), '{}'::uuid[])
    where aa.session_id = target_staff.session_id
      and aa.user_id = linked_user
      and aa.role = 'assistant_coordinator'
      and aa.active;
  end if;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_staff.session_id, (select auth.uid()),
    case when p_assigned then 'assistant_coordinator_company_assigned' else 'assistant_coordinator_company_unassigned' end,
    'company', target_company.id::text,
    jsonb_build_object('staff_id', target_staff.id, 'login_scope_synced', linked_user is not null));
end;
$$;
revoke all on function public.set_staff_company_assignment(uuid,uuid,boolean) from public, anon;
grant execute on function public.set_staff_company_assignment(uuid,uuid,boolean) to authenticated;
