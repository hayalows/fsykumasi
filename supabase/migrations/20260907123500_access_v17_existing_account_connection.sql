-- Access v17: existing website accounts are identities to keep, not duplicate-email errors.
-- If an old account email already matches one current unlinked Staff record, connect it automatically.
-- Staff remains authoritative for responsibility and company scope after the link is created.

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
  email_match_count integer := 0;
  existing_link_user uuid;
begin
  if (select auth.uid()) is null or not private.can_manage_access(p_session_id) then
    raise exception 'Website access administration required';
  end if;

  if exists(
    select 1 from public.staff_account_links sal
    where sal.session_id = p_session_id and sal.user_id = p_user_id
  ) then
    raise exception 'This sign-in is already connected to Staff';
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
    raise exception 'No active existing staff-level website access was found for this account';
  end if;

  select * into profile_row
  from public.profiles p
  where p.user_id = p_user_id;

  if profile_row.user_id is null then
    raise exception 'The website profile for this sign-in could not be found';
  end if;

  normalized_email := nullif(lower(trim(coalesce(profile_row.email,''))), '');
  normalized_name := nullif(regexp_replace(trim(coalesce(profile_row.display_name, profile_row.email, '')), '\s+', ' ', 'g'), '');

  if p_staff_id is not null then
    select * into target
    from public.staff s
    where s.id = p_staff_id
    for update;

    if target.id is null or target.session_id <> p_session_id then
      raise exception 'Choose a current Staff record from this FSY session';
    end if;
    if not target.is_current or target.registration_status <> 'approved'
       or private.staff_role_to_app_role(target.operational_role) is null then
      raise exception 'Choose a current approved Staff record with website access responsibility';
    end if;

    select sal.user_id into existing_link_user
    from public.staff_account_links sal
    where sal.session_id = p_session_id and sal.staff_id = target.id
    limit 1;

    if existing_link_user is not null then
      raise exception 'This Staff record is already connected to another sign-in. Review the two accounts before changing anything.';
    end if;
  else
    -- Existing-account migration should treat an exact email match as evidence of identity,
    -- not as a reason to create a second account or stop the administrator.
    if normalized_email is not null then
      select count(*) into email_match_count
      from public.staff s
      left join public.staff_private_details spd on spd.staff_id = s.id
      where s.session_id = p_session_id
        and s.is_current
        and s.registration_status = 'approved'
        and private.staff_role_to_app_role(s.operational_role) is not null
        and lower(trim(coalesce(spd.email, s.email, ''))) = normalized_email;

      if email_match_count > 1 then
        raise exception 'More than one current Staff record uses this email. Choose the correct Staff record before connecting the account.';
      elsif email_match_count = 1 then
        select s.* into target
        from public.staff s
        left join public.staff_private_details spd on spd.staff_id = s.id
        where s.session_id = p_session_id
          and s.is_current
          and s.registration_status = 'approved'
          and private.staff_role_to_app_role(s.operational_role) is not null
          and lower(trim(coalesce(spd.email, s.email, ''))) = normalized_email
        limit 1
        for update of s;

        select sal.user_id into existing_link_user
        from public.staff_account_links sal
        where sal.session_id = p_session_id and sal.staff_id = target.id
        limit 1;

        if existing_link_user is not null then
          raise exception 'The matching Staff record is already connected to another sign-in. Review the two accounts before changing anything.';
        end if;
      end if;
    end if;

    if target.id is null then
      if normalized_name is null or length(normalized_name) < 2 then
        raise exception 'This account needs a recognizable name before a Staff record can be created';
      end if;

      if exists(
        select 1
        from public.staff s
        where s.session_id = p_session_id
          and s.is_current
          and s.registration_status = 'approved'
          and private.staff_role_to_app_role(s.operational_role) is not null
          and regexp_replace(lower(trim(s.full_name)), '[^a-z0-9]+', '', 'g')
              = regexp_replace(lower(normalized_name), '[^a-z0-9]+', '', 'g')
      ) then
        raise exception 'A matching current Staff record already exists. Choose that Staff record instead of creating a duplicate.';
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
          raise exception 'This Assistant Coordinator account has no company scope. Create or choose the correct Staff assignment first.';
        end if;

        if exists(
          select 1
          from unnest(legacy.company_ids) requested(company_id)
          left join public.companies c on c.id = requested.company_id
          where c.id is null or c.session_id <> p_session_id
        ) then
          raise exception 'One or more existing company assignments no longer belong to this session';
        end if;

        select coalesce(ss.companies_per_assistant_coordinator, 4)
          into max_load
        from public.session_structure_settings ss
        where ss.session_id = p_session_id;
        max_load := coalesce(max_load, 4);

        if cardinality(legacy.company_ids) > max_load then
          raise exception 'The existing company scope is larger than the current Assistant Coordinator limit';
        end if;

        if exists(
          select 1
          from public.staff_company_assignments sca
          where sca.session_id = p_session_id
            and sca.company_id = any(legacy.company_ids)
        ) then
          raise exception 'One or more companies are already assigned in Staff. Choose the correct existing Staff record instead of creating a duplicate.';
        end if;

        insert into public.staff_company_assignments(session_id, staff_id, company_id, assigned_by)
        select p_session_id, target.id, company_id, (select auth.uid())
        from unnest(legacy.company_ids) company_id;

        update public.staff
        set assigned_company_id = legacy.company_ids[1]
        where id = target.id;
      end if;
    end if;
  end if;

  insert into public.staff_account_links(
    session_id, staff_id, user_id, access_enabled, link_method, linked_by
  ) values (
    p_session_id, target.id, p_user_id, true, 'admin_link', (select auth.uid())
  );

  -- Preserve any old committee memberships while Staff becomes authoritative for role/scope.
  insert into public.team_memberships(session_id, team_id, user_id, active, assigned_by)
  select p_session_id, ot.id, p_user_id, true, (select auth.uid())
  from public.operational_teams ot
  where ot.session_id = p_session_id
    and ot.active
    and ot.team_key = any(coalesce(legacy.committee_scope, '{}'::text[]))
  on conflict(session_id, team_id, user_id)
  do update set active = true, assigned_by = excluded.assigned_by, updated_at = now();

  -- Old onboarding links for this same identity are cleanup records, not separate people.
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
      'created_staff', created,
      'matched_by_email', (not created and p_staff_id is null and email_match_count = 1)
    )
  );

  return query select target.id, target.full_name, target.operational_role, created;
end;
$$;

revoke all on function public.adopt_legacy_access_account(uuid, uuid, uuid) from public, anon;
grant execute on function public.adopt_legacy_access_account(uuid, uuid, uuid) to authenticated;
