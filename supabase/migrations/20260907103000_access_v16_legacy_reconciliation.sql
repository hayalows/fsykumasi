-- Access v16: safely move older active website accounts into the staff-linked access model.
-- The current FSY staff assignment remains authoritative after a link is created.

create or replace function public.adopt_legacy_access_account(
  p_session_id uuid,
  p_user_id uuid,
  p_staff_id uuid default null
)
returns table(
  staff_id uuid,
  display_name text,
  operational_role text,
  created_staff boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  legacy public.access_assignments%rowtype;
  profile_row public.profiles%rowtype;
  target public.staff%rowtype;
  created boolean := false;
  normalized_email text;
  normalized_name text;
  max_load integer := 4;
begin
  if (select auth.uid()) is null or not private.can_manage_access(p_session_id) then
    raise exception 'Website access administration required';
  end if;

  if exists(
    select 1 from public.staff_account_links sal
    where sal.session_id = p_session_id and sal.user_id = p_user_id
  ) then
    raise exception 'This account is already linked to Staff';
  end if;

  select aa.* into legacy
  from public.access_assignments aa
  where aa.session_id = p_session_id
    and aa.user_id = p_user_id
    and aa.active
    and aa.role in ('assistant_coordinator','coordinator','logistics_admin','session_director')
  order by aa.created_at desc
  limit 1
  for update;

  if legacy.id is null then
    raise exception 'No older active staff-level website access was found for this account';
  end if;

  select * into profile_row from public.profiles p where p.user_id = p_user_id;
  if profile_row.user_id is null then
    raise exception 'The website profile for this account could not be found';
  end if;

  normalized_email := nullif(lower(trim(coalesce(profile_row.email,''))), '');
  normalized_name := nullif(regexp_replace(trim(coalesce(profile_row.display_name, profile_row.email, '')), '\s+', ' ', 'g'), '');

  if p_staff_id is not null then
    select * into target
    from public.staff s
    where s.id = p_staff_id
    for update;

    if target.id is null or target.session_id <> p_session_id then
      raise exception 'Choose a current staff record from this FSY session';
    end if;
    if not target.is_current or target.registration_status <> 'approved'
       or private.staff_role_to_app_role(target.operational_role) is null then
      raise exception 'Choose a current approved staff record with website access responsibility';
    end if;
    if exists(
      select 1 from public.staff_account_links sal
      where sal.session_id = p_session_id and sal.staff_id = target.id
    ) then
      raise exception 'That staff record already has a linked website account';
    end if;
  else
    if normalized_name is null or length(normalized_name) < 2 then
      raise exception 'This account needs a recognizable name before a Staff record can be created';
    end if;

    if exists(
      select 1
      from public.staff s
      where s.session_id = p_session_id
        and s.is_current
        and s.registration_status = 'approved'
        and regexp_replace(lower(trim(s.full_name)), '[^a-z0-9]+', '', 'g')
            = regexp_replace(lower(normalized_name), '[^a-z0-9]+', '', 'g')
    ) then
      raise exception 'A current Staff record already has this name. Connect this account to the existing record instead.';
    end if;

    if normalized_email is not null and exists(
      select 1
      from public.staff s
      left join public.staff_private_details spd on spd.staff_id = s.id
      where s.session_id = p_session_id
        and s.is_current
        and lower(trim(coalesce(spd.email, s.email, ''))) = normalized_email
    ) then
      raise exception 'A current Staff record already uses this email. Connect this account to that record instead.';
    end if;

    insert into public.staff(
      session_id, full_name, email, staff_role, registration_status,
      is_current, operational_role, source_kind
    ) values (
      p_session_id,
      normalized_name,
      normalized_email,
      'Session leadership',
      'approved',
      true,
      legacy.role::text,
      'on_site'
    ) returning * into target;
    created := true;

    if normalized_email is not null then
      insert into public.staff_private_details(staff_id, session_id, email)
      values(target.id, p_session_id, normalized_email)
      on conflict(staff_id) do update set email = excluded.email, updated_at = now();
    end if;

    if legacy.role = 'assistant_coordinator' then
      if coalesce(cardinality(legacy.company_ids), 0) = 0 then
        raise exception 'This older Assistant Coordinator account has no company scope. Create or choose the correct Staff assignment first.';
      end if;

      if exists(
        select 1
        from unnest(legacy.company_ids) requested(company_id)
        left join public.companies c on c.id = requested.company_id
        where c.id is null or c.session_id <> p_session_id
      ) then
        raise exception 'One or more older company assignments no longer belong to this session';
      end if;

      select coalesce(ss.companies_per_assistant_coordinator, 4)
        into max_load
      from public.session_structure_settings ss
      where ss.session_id = p_session_id;
      max_load := coalesce(max_load, 4);
      if cardinality(legacy.company_ids) > max_load then
        raise exception 'The older company scope is larger than the current Assistant Coordinator limit';
      end if;

      if exists(
        select 1
        from public.staff_company_assignments sca
        where sca.session_id = p_session_id
          and sca.company_id = any(legacy.company_ids)
      ) then
        raise exception 'One or more old companies are already assigned in Staff. Connect this account to the correct existing Staff record instead of creating a duplicate.';
      end if;

      insert into public.staff_company_assignments(session_id, staff_id, company_id, assigned_by)
      select p_session_id, target.id, company_id, (select auth.uid())
      from unnest(legacy.company_ids) company_id;

      update public.staff
      set assigned_company_id = legacy.company_ids[1]
      where id = target.id;
    end if;
  end if;

  insert into public.staff_account_links(
    session_id, staff_id, user_id, access_enabled, link_method, linked_by
  ) values (
    p_session_id, target.id, p_user_id, true, 'admin_link', (select auth.uid())
  );

  -- Carry forward any old committee scope into the responsibility-based team model.
  insert into public.team_memberships(session_id, team_id, user_id, active, assigned_by)
  select p_session_id, ot.id, p_user_id, true, (select auth.uid())
  from public.operational_teams ot
  where ot.session_id = p_session_id
    and ot.active
    and ot.team_key = any(coalesce(legacy.committee_scope, '{}'::text[]))
  on conflict(session_id, team_id, user_id)
  do update set active = true, assigned_by = excluded.assigned_by, updated_at = now();

  update public.leader_invites
  set status = 'revoked', revoked_at = coalesce(revoked_at, now())
  where session_id = p_session_id
    and purpose = 'onboarding'
    and status in ('pending','activating')
    and (
      staff_id = target.id
      or (normalized_email is not null and lower(trim(email)) = normalized_email)
    );

  perform private.sync_staff_login_access(target.id);

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(
    p_session_id,
    (select auth.uid()),
    'legacy_access_adopted',
    'staff',
    target.id::text,
    jsonb_build_object(
      'user_id', p_user_id,
      'legacy_role', legacy.role,
      'staff_role', target.operational_role,
      'created_staff', created
    )
  );

  return query select target.id, target.full_name, target.operational_role, created;
end;
$$;
revoke all on function public.adopt_legacy_access_account(uuid, uuid, uuid) from public, anon;
grant execute on function public.adopt_legacy_access_account(uuid, uuid, uuid) to authenticated;

create or replace function public.retire_legacy_access_account(
  p_session_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_email text;
begin
  if (select auth.uid()) is null or not private.can_manage_access(p_session_id) then
    raise exception 'Website access administration required';
  end if;

  if exists(
    select 1 from public.staff_account_links sal
    where sal.session_id = p_session_id and sal.user_id = p_user_id
  ) then
    raise exception 'Linked Staff accounts must be disabled from their Staff row';
  end if;

  if not exists(
    select 1 from public.access_assignments aa
    where aa.session_id = p_session_id and aa.user_id = p_user_id and aa.active
  ) then
    raise exception 'No active older access was found for this account';
  end if;

  if exists(
    select 1 from public.access_assignments aa
    where aa.session_id = p_session_id
      and aa.user_id = p_user_id
      and aa.active
      and aa.role in ('coordinator','logistics_admin','session_director')
  ) and private.full_session_admin_count(p_session_id, p_user_id) = 0 then
    raise exception 'You cannot retire the only Full Session Administrator. Give another leader full access first.';
  end if;

  select lower(trim(coalesce(p.email,''))) into profile_email
  from public.profiles p
  where p.user_id = p_user_id;

  update public.access_assignments
  set active = false
  where session_id = p_session_id and user_id = p_user_id and active;

  update public.team_memberships
  set active = false, updated_at = now()
  where session_id = p_session_id and user_id = p_user_id and active;

  update public.leader_invites
  set status = 'revoked', revoked_at = coalesce(revoked_at, now())
  where session_id = p_session_id
    and status in ('pending','activating')
    and profile_email <> ''
    and lower(trim(email)) = profile_email;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(
    p_session_id,
    (select auth.uid()),
    'legacy_access_retired',
    'profile',
    p_user_id::text,
    jsonb_build_object('user_id', p_user_id)
  );
end;
$$;
revoke all on function public.retire_legacy_access_account(uuid, uuid) from public, anon;
grant execute on function public.retire_legacy_access_account(uuid, uuid) to authenticated;
