-- Day 2 Assistant Coordinator reassignment.
-- The source registration status remains history. For live staffing, an authorized
-- administrator can assign a current, operationally available staff member even
-- when the imported source row is still awaiting approval. Website access remains
-- a separate explicit action and cancelled/unavailable staff stay blocked.

create or replace function public.set_assistant_coordinator_companies(
  p_staff_id uuid,
  p_company_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.staff%rowtype;
  desired uuid[] := '{}'::uuid[];
  previous uuid[] := '{}'::uuid[];
  donor_ids uuid[] := '{}'::uuid[];
  max_load integer := 4;
  donor_without_scope text;
  target_has_active_access boolean := false;
begin
  select * into target from public.staff where id = p_staff_id for update;
  if target.id is null then raise exception 'Staff member not found'; end if;
  if not private.can_manage_access(target.session_id) then raise exception 'Administrative access is required'; end if;
  if target.operational_role <> 'assistant_coordinator'
     or not target.is_current
     or target.registration_status = 'cancelled'
     or not private.staff_can_plan(target.id) then
    raise exception 'Only current available Assistant Coordinators can be assigned to companies';
  end if;

  select coalesce(array_agg(distinct company_id order by company_id), '{}'::uuid[])
    into desired
  from unnest(coalesce(p_company_ids, '{}'::uuid[])) company_id;

  if exists (
    select 1
    from unnest(desired) requested(company_id)
    left join public.companies c on c.id = requested.company_id
    where c.id is null or c.session_id <> target.session_id
  ) then
    raise exception 'Every selected company must belong to this FSY session';
  end if;

  select coalesce(ss.companies_per_assistant_coordinator, 4) into max_load
  from public.session_structure_settings ss
  where ss.session_id = target.session_id;
  max_load := coalesce(max_load, 4);
  if cardinality(desired) > max_load then
    raise exception 'An Assistant Coordinator can supervise at most % companies', max_load;
  end if;

  select exists(
    select 1
    from public.staff_account_links sal
    where sal.session_id = target.session_id
      and sal.staff_id = target.id
      and sal.access_enabled
  ) into target_has_active_access;
  if target_has_active_access and cardinality(desired) = 0 then
    raise exception 'An Assistant Coordinator with active website access must keep at least one company';
  end if;

  select coalesce(array_agg(sca.company_id order by sca.assigned_at, sca.company_id), '{}'::uuid[])
    into previous
  from public.staff_company_assignments sca
  where sca.session_id = target.session_id and sca.staff_id = target.id;

  select coalesce(array_agg(distinct sca.staff_id), '{}'::uuid[])
    into donor_ids
  from public.staff_company_assignments sca
  where sca.session_id = target.session_id
    and sca.company_id = any(desired)
    and sca.staff_id <> target.id;

  select s.full_name into donor_without_scope
  from unnest(donor_ids) donor(staff_id)
  join public.staff s on s.id = donor.staff_id
  join public.staff_account_links sal
    on sal.session_id = target.session_id
    and sal.staff_id = donor.staff_id
    and sal.access_enabled
  where not exists (
    select 1
    from public.staff_company_assignments remaining
    where remaining.session_id = target.session_id
      and remaining.staff_id = donor.staff_id
      and not (remaining.company_id = any(desired))
  )
  limit 1;

  if donor_without_scope is not null then
    raise exception 'That move would leave % with active website access but no company. Assign their correct next company first, then return here.', donor_without_scope;
  end if;

  delete from public.staff_company_assignments sca
  where sca.session_id = target.session_id
    and sca.staff_id = target.id
    and not (sca.company_id = any(desired));

  delete from public.staff_company_assignments sca
  where sca.session_id = target.session_id
    and sca.company_id = any(desired)
    and sca.staff_id <> target.id;

  insert into public.staff_company_assignments(session_id, staff_id, company_id, assigned_by)
  select target.session_id, target.id, requested.company_id, (select auth.uid())
  from unnest(desired) requested(company_id)
  on conflict(staff_id, company_id) do nothing;

  update public.staff s
  set assigned_company_id = (
    select sca.company_id
    from public.staff_company_assignments sca
    where sca.staff_id = s.id
    order by sca.assigned_at, sca.company_id
    limit 1
  )
  where s.id = target.id or s.id = any(donor_ids);

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(
    target.session_id,
    (select auth.uid()),
    'assistant_coordinator_companies_set',
    'staff',
    target.id::text,
    jsonb_build_object(
      'previous_company_ids', previous,
      'company_ids', desired,
      'transferred_from_staff_ids', donor_ids,
      'website_scope_synced', exists(
        select 1 from public.staff_account_links sal
        where sal.session_id = target.session_id and sal.staff_id = target.id
      ),
      'source_registration_status_preserved', target.registration_status,
      'live_reassignment', true
    )
  );

  return jsonb_build_object('staff_id', target.id, 'company_ids', desired, 'company_limit', max_load);
end;
$$;

create or replace function public.create_staff_leader_invite(
  p_staff_id uuid,
  p_email text default null
)
returns table(invite_id uuid, invite_code text, expires_at timestamptz, existing_account boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.staff%rowtype;
  desired_role public.app_role;
  desired_companies uuid[] := '{}'::uuid[];
  normalized_email text;
  formatted_code text;
  code_hash_value text;
  code_prefix text;
  new_id uuid;
  new_expiry timestamptz := now() + interval '72 hours';
  account_exists boolean := false;
  attempt integer;
begin
  select * into target from public.staff where id = p_staff_id for update;
  if target.id is null then raise exception 'Staff member not found'; end if;
  if not private.can_manage_access(target.session_id) then raise exception 'Your account cannot give website access'; end if;
  if not target.is_current
     or target.registration_status = 'cancelled'
     or not private.staff_can_plan(target.id) then
    raise exception 'Only current available staff can receive website access';
  end if;
  desired_role := private.staff_role_to_app_role(target.operational_role);
  if desired_role is null then raise exception 'Assign an account-enabled FSY role first'; end if;

  if exists(select 1 from public.staff_account_links sal where sal.session_id = target.session_id and sal.staff_id = target.id) then
    if exists(select 1 from public.staff_account_links sal where sal.session_id = target.session_id and sal.staff_id = target.id and sal.access_enabled) then
      raise exception 'Website access is already linked for this staff member';
    end if;
    raise exception 'This staff member already has an account. Re-enable website access instead of creating another invite.';
  end if;

  if desired_role::text = 'assistant_coordinator' then
    select coalesce(array_agg(sca.company_id order by sca.assigned_at, sca.company_id), '{}'::uuid[])
      into desired_companies
    from public.staff_company_assignments sca
    where sca.session_id = target.session_id and sca.staff_id = target.id;
    if cardinality(desired_companies) = 0 then
      raise exception 'Assign at least one company before giving this Assistant Coordinator website access';
    end if;
  end if;

  select lower(trim(coalesce(nullif(p_email,''), nullif(spd.email,''), nullif(target.email,''))))
    into normalized_email
  from (select 1) one
  left join public.staff_private_details spd on spd.staff_id = target.id;
  if normalized_email is null or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address for this leader';
  end if;

  update public.staff set email = normalized_email where id = target.id;
  insert into public.staff_private_details(staff_id, session_id, email)
  values(target.id, target.session_id, normalized_email)
  on conflict(staff_id) do update set email = excluded.email, updated_at = now();

  select exists(select 1 from public.profiles p where lower(trim(coalesce(p.email,''))) = normalized_email)
    into account_exists;

  update public.leader_invites set status = 'revoked', revoked_at = now()
  where session_id = target.session_id and purpose = 'onboarding'
    and status in ('pending','activating')
    and (staff_id = target.id or lower(email) = normalized_email);

  code_prefix := private.setup_invite_prefix(target.session_id, desired_role, desired_companies, '{}'::text[]);
  for attempt in 1..5 loop
    formatted_code := private.make_short_setup_code(code_prefix);
    code_hash_value := encode(extensions.digest(replace(upper(formatted_code),'-',''),'sha256'),'hex');
    exit when not exists(select 1 from public.leader_invites li where li.code_hash = code_hash_value);
  end loop;
  if exists(select 1 from public.leader_invites li where li.code_hash = code_hash_value) then
    raise exception 'A unique setup code could not be prepared. Try again.';
  end if;

  insert into public.leader_invites(
    session_id, staff_id, email, display_name, role, company_ids, committee_scope,
    purpose, code_hash, created_by, expires_at
  ) values (
    target.session_id, target.id, normalized_email, target.full_name, desired_role,
    case when desired_role::text = 'assistant_coordinator' then desired_companies else '{}'::uuid[] end,
    '{}'::text[], 'onboarding', code_hash_value, (select auth.uid()), new_expiry
  ) returning id into new_id;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(target.session_id, (select auth.uid()), 'staff_website_access_invited', 'staff', target.id::text,
    jsonb_build_object(
      'invite_id', new_id,
      'role', desired_role,
      'existing_account', account_exists,
      'code_prefix', code_prefix,
      'expires_in_hours', 72,
      'source_registration_status_preserved', target.registration_status,
      'live_reassignment', true
    ));
  return query select new_id, formatted_code, new_expiry, account_exists;
end;
$$;
