-- Keep people visible in Access even when an operational status needs review.
-- Staff responsibility is the source of truth for who belongs in the directory;
-- operational readiness decides whether that person can receive or keep sign-in access.

-- Older Staff rows can predate the initializer trigger. Give those rows the same
-- safe default state used for newly created Staff records.
insert into public.staff_operations(staff_id, planning_state, arrival_state, service_clearance)
select
  s.id,
  case
    when not s.is_current or s.registration_status = 'cancelled' then 'excluded'
    when s.registration_status = 'awaiting' or s.source_kind = 'on_site' then 'provisional'
    else 'reserve'
  end,
  'expected',
  case
    when s.registration_status = 'approved' and s.source_kind <> 'on_site' then 'cleared'
    else 'confirmation_required'
  end
from public.staff s
where not exists (select 1 from public.staff_operations o where o.staff_id = s.id);

-- A missing operational row is an incomplete record, not proof that a current
-- staff member cannot be planned. The client has always used the same fallback.
create or replace function private.staff_can_plan(target_staff uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.staff s
    left join public.staff_operations o on o.staff_id = s.id
    where s.id = target_staff
      and s.is_current
      and s.registration_status <> 'cancelled'
      and coalesce(
        o.planning_state,
        case when s.registration_status = 'awaiting' or s.source_kind = 'on_site' then 'provisional' else 'reserve' end
      ) <> 'excluded'
      and coalesce(
        o.service_clearance,
        case when s.registration_status = 'approved' and s.source_kind <> 'on_site' then 'cleared' else 'confirmation_required' end
      ) <> 'not_cleared'
      and coalesce(o.arrival_state, 'expected') not in ('no_show', 'left')
  );
$$;

-- Keep linked website identities synchronized when Staff readiness changes.
create or replace function private.sync_staff_operations_login_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_staff_login_access(new.staff_id);
  return new;
end;
$$;

revoke all on function private.sync_staff_operations_login_access() from public, anon, authenticated;
drop trigger if exists staff_operations_sync_login_access on public.staff_operations;
create trigger staff_operations_sync_login_access
after insert or update of planning_state, arrival_state, service_clearance on public.staff_operations
for each row execute function private.sync_staff_operations_login_access();

-- The existing account synchronization also protects against an Assistant
-- Coordinator temporarily having no company scope.
create or replace function private.sync_staff_login_access(p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.staff%rowtype;
  link_row public.staff_account_links%rowtype;
  desired_role public.app_role;
  desired_companies uuid[] := '{}'::uuid[];
  current_is_full boolean := false;
  desired_is_full boolean := false;
  desired_access boolean := false;
begin
  select * into target from public.staff where id = p_staff_id;
  if target.id is null then return; end if;

  if target.is_current
     and target.registration_status <> 'cancelled'
     and private.staff_can_plan(target.id) then
    desired_role := private.staff_role_to_app_role(target.operational_role);
  else
    desired_role := null;
  end if;

  if desired_role = 'assistant_coordinator' then
    select coalesce(array_agg(sca.company_id order by sca.assigned_at, sca.company_id), '{}'::uuid[])
      into desired_companies
    from public.staff_company_assignments sca
    where sca.session_id = target.session_id and sca.staff_id = target.id;
  end if;

  if desired_role is null then
    update public.leader_invites
      set status = 'revoked', revoked_at = coalesce(revoked_at, now())
    where session_id = target.session_id and staff_id = target.id
      and purpose = 'onboarding' and status in ('pending', 'activating');
  else
    update public.leader_invites
      set role = desired_role,
          company_ids = case when desired_role = 'assistant_coordinator' then desired_companies else '{}'::uuid[] end,
          display_name = target.full_name
    where session_id = target.session_id and staff_id = target.id
      and purpose = 'onboarding' and status in ('pending', 'activating');
  end if;

  select * into link_row
  from public.staff_account_links sal
  where sal.session_id = target.session_id and sal.staff_id = target.id
  for update;
  if link_row.staff_id is null then return; end if;

  select exists(
    select 1 from public.access_assignments aa
    where aa.session_id = target.session_id and aa.user_id = link_row.user_id and aa.active
      and aa.role in ('coordinator', 'logistics_admin', 'session_director', 'area_advisory_couple')
  ) into current_is_full;
  desired_is_full := link_row.access_enabled
    and desired_role in ('coordinator', 'logistics_admin', 'session_director', 'area_advisory_couple');
  desired_access := link_row.access_enabled and desired_role is not null
    and (desired_role <> 'assistant_coordinator' or cardinality(desired_companies) > 0);

  if current_is_full and not desired_is_full
     and private.full_session_admin_count(target.session_id, link_row.user_id) = 0 then
    raise exception 'You cannot remove the only Full Session Administrator. Give another leader full access first.';
  end if;

  update public.access_assignments
    set active = false
  where session_id = target.session_id and user_id = link_row.user_id and active;

  if desired_access then
    insert into public.access_assignments(session_id, user_id, role, company_ids, committee_scope, capabilities, active)
    values(
      target.session_id,
      link_row.user_id,
      desired_role,
      case when desired_role = 'assistant_coordinator' then desired_companies else '{}'::uuid[] end,
      '{}'::text[],
      '{}'::text[],
      true
    )
    on conflict(session_id, user_id, role) do update
      set company_ids = excluded.company_ids,
          committee_scope = excluded.committee_scope,
          capabilities = excluded.capabilities,
          active = true;
  end if;

  update public.staff_account_links
    set updated_at = now()
  where session_id = target.session_id and staff_id = target.id;
end;
$$;

-- Access directory visibility is intentionally broader than operational
-- eligibility. A current leader who is excluded, absent, or awaiting review
-- must still be findable so an administrator can understand and repair them.
drop function if exists public.get_staff_access_directory(uuid);
create function public.get_staff_access_directory(p_session_id uuid)
returns table(
  staff_id uuid,
  display_name text,
  operational_role text,
  email text,
  company_ids uuid[],
  company_names text[],
  user_id uuid,
  account_email text,
  access_enabled boolean,
  access_state text,
  invite_id uuid,
  invite_expires_at timestamptz,
  account_role public.app_role
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_manage_access(p_session_id) then raise exception 'Website access administration required'; end if;
  return query
  select
    s.id,
    s.full_name,
    s.operational_role,
    coalesce(nullif(trim(spd.email), ''), nullif(trim(s.email), '')),
    coalesce(scope.company_ids, '{}'::uuid[]),
    coalesce(scope.company_names, '{}'::text[]),
    sal.user_id,
    p.email,
    coalesce(sal.access_enabled, false),
    case
      when sal.staff_id is not null and not sal.access_enabled then 'disabled'
      when not private.staff_can_plan(s.id) then 'not_ready'
      when sal.staff_id is not null and aa.id is not null then 'active'
      when pending.id is not null then 'invited'
      else 'not_enabled'
    end,
    pending.id,
    pending.expires_at,
    aa.role
  from public.staff s
  left join public.staff_private_details spd on spd.staff_id = s.id
  left join lateral (
    select
      coalesce(array_agg(sca.company_id order by c.operational_number nulls last, c.name), '{}'::uuid[]) company_ids,
      coalesce(array_agg(coalesce(nullif(c.custom_name, ''), c.name) order by c.operational_number nulls last, c.name), '{}'::text[]) company_names
    from public.staff_company_assignments sca
    join public.companies c on c.id = sca.company_id
    where sca.session_id = p_session_id and sca.staff_id = s.id
  ) scope on true
  left join public.staff_account_links sal on sal.session_id = p_session_id and sal.staff_id = s.id
  left join public.profiles p on p.user_id = sal.user_id
  left join lateral (
    select a.id, a.role
    from public.access_assignments a
    where a.session_id = p_session_id and a.user_id = sal.user_id and a.active
    order by a.created_at desc limit 1
  ) aa on true
  left join lateral (
    select li.id, li.expires_at
    from public.leader_invites li
    where li.session_id = p_session_id and li.staff_id = s.id
      and li.purpose = 'onboarding' and li.status in ('pending', 'activating') and li.expires_at > now()
    order by li.created_at desc limit 1
  ) pending on true
  where s.session_id = p_session_id
    and s.is_current
    and s.registration_status <> 'cancelled'
    and private.staff_role_to_app_role(s.operational_role) is not null
  order by
    case s.operational_role
      when 'session_director' then 1
      when 'coordinator' then 2
      when 'logistics_admin' then 3
      when 'assistant_coordinator' then 4
      else 9
    end,
    lower(s.full_name), s.id;
end;
$$;

revoke all on function public.get_staff_access_directory(uuid) from public, anon;
grant execute on function public.get_staff_access_directory(uuid) to authenticated;

-- Enabling sign-in follows current Staff responsibility and operational state,
-- not the historical registration approval label. ACs also need a company scope.
create or replace function public.set_staff_website_access(p_staff_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.staff%rowtype;
  link_row public.staff_account_links%rowtype;
begin
  select * into target from public.staff where id = p_staff_id for update;
  if target.id is null then raise exception 'Staff member not found'; end if;
  if not private.can_manage_access(target.session_id) then raise exception 'Your account cannot manage website access'; end if;
  select * into link_row from public.staff_account_links sal
    where sal.session_id = target.session_id and sal.staff_id = target.id for update;
  if link_row.staff_id is null then raise exception 'This staff member does not have a linked account yet'; end if;
  if p_enabled and (
    not target.is_current
    or target.registration_status = 'cancelled'
    or not private.staff_can_plan(target.id)
    or private.staff_role_to_app_role(target.operational_role) is null
    or (
      target.operational_role = 'assistant_coordinator'
      and not exists(
        select 1 from public.staff_company_assignments sca
        where sca.session_id = target.session_id and sca.staff_id = target.id
      )
    )
  ) then
    raise exception 'This Staff record needs a current responsibility, available status, and company scope before access can be enabled';
  end if;
  update public.staff_account_links
    set access_enabled = p_enabled, updated_at = now()
  where session_id = target.session_id and staff_id = target.id;
  perform private.sync_staff_login_access(target.id);
  if not p_enabled then
    update public.leader_invites
      set status = 'revoked', revoked_at = coalesce(revoked_at, now())
    where session_id = target.session_id and staff_id = target.id
      and purpose = 'onboarding' and status in ('pending', 'activating');
  end if;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(
    target.session_id,
    (select auth.uid()),
    case when p_enabled then 'staff_website_access_enabled' else 'staff_website_access_disabled' end,
    'staff',
    target.id::text,
    jsonb_build_object('user_id', link_row.user_id)
  );
end;
$$;

revoke all on function public.set_staff_website_access(uuid, boolean) from public, anon;
grant execute on function public.set_staff_website_access(uuid, boolean) to authenticated;

-- The active assignment UI offers awaiting Staff records because the source
-- approval label is historical. Align the older assignment helpers with that
-- same rule while keeping unavailable staff out of new coverage.
do $patch$
declare
  body text;
  replaced text;
begin
  select pg_get_functiondef('public.set_staff_company_assignment(uuid,uuid,boolean)'::regprocedure) into body;
  if body is null then raise exception 'The staff company assignment function is missing'; end if;
  replaced := regexp_replace(
    body,
    'if not private[.]staff_can_plan[(]target_staff[.]id[)][[:space:]]+then[[:space:]]+raise exception ''Assistant Coordinator is unavailable for planning'';[[:space:]]+end if;',
    'if p_assigned and not private.staff_can_plan(target_staff.id) then raise exception ''Assistant Coordinator is unavailable for planning''; end if;',
    'g'
  );
  if replaced <> body then execute replaced; end if;

  select pg_get_functiondef('public.apply_staff_assignment_plan(uuid,jsonb,jsonb)'::regprocedure) into body;
  if body is null then raise exception 'The bulk staff assignment function is missing'; end if;
  replaced := regexp_replace(
    body,
    'if target_staff[.]operational_role[[:space:]]*<>[[:space:]]*''counselor''[[:space:]]+or target_staff[.]registration_status[[:space:]]*<>[[:space:]]*''approved''[[:space:]]+or not target_staff[.]is_current[[:space:]]+then[[:space:]]+raise exception ''Only current approved Counselors can be assigned'';[[:space:]]+end if;',
    'if target_staff.operational_role <> ''counselor'' or target_staff.registration_status = ''cancelled'' or not target_staff.is_current or not private.staff_can_plan(target_staff.id) then raise exception ''Only current available Counselors can be assigned''; end if;',
    'g'
  );
  replaced := regexp_replace(
    replaced,
    'if target_staff[.]operational_role[[:space:]]*<>[[:space:]]*''assistant_coordinator''[[:space:]]+or target_staff[.]registration_status[[:space:]]*<>[[:space:]]*''approved''[[:space:]]+or not target_staff[.]is_current[[:space:]]+then[[:space:]]+raise exception ''Only current approved Assistant Coordinators can be assigned'';[[:space:]]+end if;',
    'if target_staff.operational_role <> ''assistant_coordinator'' or target_staff.registration_status = ''cancelled'' or not target_staff.is_current or not private.staff_can_plan(target_staff.id) then raise exception ''Only current available Assistant Coordinators can be assigned''; end if;',
    'g'
  );
  if replaced = body then raise exception 'The bulk staff assignment guards could not be updated'; end if;
  execute replaced;
end;
$patch$;
