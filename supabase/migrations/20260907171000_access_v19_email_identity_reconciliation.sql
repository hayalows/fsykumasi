-- Access v19: auth identity is the website identity; Staff is the operational assignment.
-- Existing staff-level accounts are reconciled by user_id + exact normalized email only.
-- Names remain display/search data and are never used to decide identity.

create or replace function private.reconcile_existing_staff_account(
  p_session_id uuid,
  p_user_id uuid,
  p_actor_id uuid default null
)
returns table(
  account_user_id uuid,
  resolved_staff_id uuid,
  outcome text,
  created_staff boolean,
  needs_company_review boolean,
  detail text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  legacy public.access_assignments%rowtype;
  target public.staff%rowtype;
  existing_staff_id uuid;
  existing_link_user uuid;
  profile_name text;
  normalized_email text;
  display_name text;
  exact_email_count integer := 0;
  created boolean := false;
  company_review boolean := false;
  safe_to_sync boolean := true;
  max_load integer := 4;
  current_company_ids uuid[] := '{}'::uuid[];
  conflicting_company_ids uuid[] := '{}'::uuid[];
begin
  select sal.staff_id
    into existing_staff_id
  from public.staff_account_links sal
  where sal.session_id = p_session_id
    and sal.user_id = p_user_id
  limit 1;

  if existing_staff_id is not null then
    return query select p_user_id, existing_staff_id, 'already_linked'::text, false, false, null::text;
    return;
  end if;

  select aa.*
    into legacy
  from public.access_assignments aa
  where aa.session_id = p_session_id
    and aa.user_id = p_user_id
    and aa.active
    and aa.role in ('assistant_coordinator','coordinator','logistics_admin','session_director')
  order by aa.created_at desc
  limit 1
  for update;

  if legacy.id is null then
    return query select p_user_id, null::uuid, 'not_staff_level'::text, false, false,
      'No active staff-level website access exists for this account.'::text;
    return;
  end if;

  select p.display_name,
         lower(trim(coalesce(nullif(p.email,''), nullif(u.email,''))))
    into profile_name, normalized_email
  from public.profiles p
  left join auth.users u on u.id = p.user_id
  where p.user_id = p_user_id;

  if normalized_email is null or normalized_email = '' then
    return query select p_user_id, null::uuid, 'missing_email'::text, false, false,
      'This account has no email address to use as its identity key.'::text;
    return;
  end if;

  display_name := nullif(regexp_replace(trim(coalesce(profile_name, '')), '\s+', ' ', 'g'), '');
  if display_name is null then
    display_name := normalized_email;
  end if;

  -- Only account-enabled leadership Staff participate in identity matching.
  -- Imported counselor emails are not unique enough to be identity keys.
  select count(*)
    into exact_email_count
  from public.staff s
  left join public.staff_private_details spd on spd.staff_id = s.id
  where s.session_id = p_session_id
    and s.is_current
    and s.registration_status = 'approved'
    and private.staff_role_to_app_role(s.operational_role) is not null
    and lower(trim(coalesce(nullif(spd.email,''), nullif(s.email,''), ''))) = normalized_email;

  if exact_email_count > 1 then
    return query select p_user_id, null::uuid, 'email_conflict'::text, false, false,
      'More than one account-enabled Staff record uses this email address.'::text;
    return;
  end if;

  if exact_email_count = 1 then
    select s.*
      into target
    from public.staff s
    left join public.staff_private_details spd on spd.staff_id = s.id
    where s.session_id = p_session_id
      and s.is_current
      and s.registration_status = 'approved'
      and private.staff_role_to_app_role(s.operational_role) is not null
      and lower(trim(coalesce(nullif(spd.email,''), nullif(s.email,''), ''))) = normalized_email
    limit 1
    for update of s;

    select sal.user_id
      into existing_link_user
    from public.staff_account_links sal
    where sal.session_id = p_session_id
      and sal.staff_id = target.id
    limit 1;

    if existing_link_user is not null and existing_link_user <> p_user_id then
      return query select p_user_id, target.id, 'staff_linked_elsewhere'::text, false, false,
        'The Staff record with this email is already connected to another sign-in.'::text;
      return;
    end if;
  else
    -- No Staff representation exists for this verified website account.
    -- Create the operational Staff row without comparing names.
    insert into public.staff(
      session_id, full_name, email, staff_role, registration_status,
      is_current, operational_role, source_kind
    ) values (
      p_session_id,
      display_name,
      normalized_email,
      'Session leadership',
      'approved',
      true,
      legacy.role::text,
      'on_site'
    )
    returning * into target;
    created := true;

    insert into public.staff_private_details(staff_id, session_id, email)
    values(target.id, p_session_id, normalized_email)
    on conflict(staff_id) do update
      set email = excluded.email,
          updated_at = now();
  end if;

  -- Assistant Coordinator identity and company assignment are separate questions.
  -- Link the account even if an old company is now owned by someone else, and keep
  -- the existing website scope until an administrator chooses current companies.
  if target.operational_role = 'assistant_coordinator' then
    select coalesce(array_agg(sca.company_id order by sca.assigned_at, sca.company_id), '{}'::uuid[])
      into current_company_ids
    from public.staff_company_assignments sca
    where sca.session_id = p_session_id
      and sca.staff_id = target.id;

    if cardinality(current_company_ids) = 0 then
      if legacy.role = 'assistant_coordinator' and coalesce(cardinality(legacy.company_ids), 0) > 0 then
        select coalesce(ss.companies_per_assistant_coordinator, 4)
          into max_load
        from public.session_structure_settings ss
        where ss.session_id = p_session_id;
        max_load := coalesce(max_load, 4);

        if cardinality(legacy.company_ids) <= max_load
           and not exists(
             select 1
             from unnest(legacy.company_ids) requested(company_id)
             left join public.companies c on c.id = requested.company_id
             where c.id is null or c.session_id <> p_session_id
           ) then
          select coalesce(array_agg(distinct sca.company_id), '{}'::uuid[])
            into conflicting_company_ids
          from public.staff_company_assignments sca
          where sca.session_id = p_session_id
            and sca.company_id = any(legacy.company_ids)
            and sca.staff_id <> target.id;

          if cardinality(conflicting_company_ids) = 0 then
            insert into public.staff_company_assignments(session_id, staff_id, company_id, assigned_by)
            select p_session_id, target.id, requested.company_id, p_actor_id
            from unnest(legacy.company_ids) requested(company_id)
            on conflict(staff_id, company_id) do nothing;

            update public.staff s
            set assigned_company_id = legacy.company_ids[1]
            where s.id = target.id;
          else
            company_review := true;
            safe_to_sync := false;
          end if;
        else
          company_review := true;
          safe_to_sync := false;
        end if;
      else
        company_review := true;
        safe_to_sync := false;
      end if;
    end if;
  end if;

  insert into public.staff_account_links(
    session_id, staff_id, user_id, access_enabled, link_method, linked_by
  ) values (
    p_session_id,
    target.id,
    p_user_id,
    true,
    'legacy_unique_email',
    p_actor_id
  );

  -- Preserve committee memberships that existed alongside the old staff role.
  insert into public.team_memberships(session_id, team_id, user_id, active, assigned_by)
  select p_session_id, ot.id, p_user_id, true, p_actor_id
  from public.operational_teams ot
  where ot.session_id = p_session_id
    and ot.active
    and ot.team_key = any(coalesce(legacy.committee_scope, '{}'::text[]))
  on conflict(session_id, team_id, user_id)
  do update set active = true,
                assigned_by = excluded.assigned_by,
                updated_at = now();

  -- Pending onboarding records for the same email are historical cleanup, not people.
  update public.leader_invites li
  set status = 'revoked',
      revoked_at = coalesce(li.revoked_at, now())
  where li.session_id = p_session_id
    and li.purpose = 'onboarding'
    and li.status in ('pending','activating')
    and (
      li.staff_id = target.id
      or lower(trim(li.email)) = normalized_email
    );

  if safe_to_sync then
    perform private.sync_staff_login_access(target.id);
  end if;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(
    p_session_id,
    p_actor_id,
    'existing_staff_account_reconciled',
    'staff',
    target.id::text,
    jsonb_build_object(
      'user_id', p_user_id,
      'email', normalized_email,
      'legacy_role', legacy.role,
      'staff_role', target.operational_role,
      'created_staff', created,
      'matched_by', case when created then 'created_from_account' else 'exact_email' end,
      'company_review_needed', company_review,
      'legacy_scope_preserved', not safe_to_sync
    )
  );

  return query select
    p_user_id,
    target.id,
    case when company_review then 'linked_company_review' else 'linked' end::text,
    created,
    company_review,
    case when company_review
      then 'Account identity is resolved. Choose current companies before Staff scope replaces the old website scope.'
      else null
    end::text;
end;
$$;

revoke all on function private.reconcile_existing_staff_account(uuid,uuid,uuid) from public, anon, authenticated;

create or replace function public.reconcile_existing_staff_accounts(p_session_id uuid)
returns table(
  account_user_id uuid,
  resolved_staff_id uuid,
  outcome text,
  created_staff boolean,
  needs_company_review boolean,
  detail text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
begin
  if (select auth.uid()) is null or not private.can_manage_access(p_session_id) then
    raise exception 'Website access administration required';
  end if;

  for candidate in
    select distinct aa.user_id
    from public.access_assignments aa
    where aa.session_id = p_session_id
      and aa.active
      and aa.role in ('assistant_coordinator','coordinator','logistics_admin','session_director')
    order by aa.user_id
  loop
    return query
      select r.account_user_id, r.resolved_staff_id, r.outcome, r.created_staff, r.needs_company_review, r.detail
      from private.reconcile_existing_staff_account(p_session_id, candidate.user_id, (select auth.uid())) r;
  end loop;
end;
$$;

revoke all on function public.reconcile_existing_staff_accounts(uuid) from public, anon;
grant execute on function public.reconcile_existing_staff_accounts(uuid) to authenticated;

-- Backward-compatible entry point for older clients. Explicit Staff selection is accepted
-- only when its normalized email equals the account email; names are never an identity key.
create or replace function public.adopt_legacy_access_account(
  p_session_id uuid,
  p_user_id uuid,
  p_staff_id uuid default null
)
returns table(staff_id uuid, display_name text, operational_role text, created_staff boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_email text;
  selected_email text;
  resolved record;
begin
  if (select auth.uid()) is null or not private.can_manage_access(p_session_id) then
    raise exception 'Website access administration required';
  end if;

  if p_staff_id is not null then
    select lower(trim(coalesce(nullif(p.email,''), nullif(u.email,''))))
      into account_email
    from public.profiles p
    left join auth.users u on u.id = p.user_id
    where p.user_id = p_user_id;

    select lower(trim(coalesce(nullif(spd.email,''), nullif(s.email,''))))
      into selected_email
    from public.staff s
    left join public.staff_private_details spd on spd.staff_id = s.id
    where s.id = p_staff_id
      and s.session_id = p_session_id;

    if account_email is null or selected_email is null or account_email <> selected_email then
      raise exception 'Existing accounts are matched to Staff by email. Retry automatic repair instead of matching by name.';
    end if;
  end if;

  select r.* into resolved
  from private.reconcile_existing_staff_account(p_session_id, p_user_id, (select auth.uid())) r;

  if resolved.resolved_staff_id is null then
    raise exception '%', coalesce(resolved.detail, 'This account could not be reconciled automatically.');
  end if;

  return query
  select s.id, s.full_name, s.operational_role, resolved.created_staff
  from public.staff s
  where s.id = resolved.resolved_staff_id;
end;
$$;

revoke all on function public.adopt_legacy_access_account(uuid,uuid,uuid) from public, anon;
grant execute on function public.adopt_legacy_access_account(uuid,uuid,uuid) to authenticated;

-- Keep website scope synchronized when Assistant Coordinator companies move.
create or replace function private.sync_staff_company_access_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.sync_staff_login_access(old.staff_id);
    return old;
  end if;

  perform private.sync_staff_login_access(new.staff_id);
  if tg_op = 'UPDATE' and old.staff_id is distinct from new.staff_id then
    perform private.sync_staff_login_access(old.staff_id);
  end if;
  return new;
end;
$$;

revoke all on function private.sync_staff_company_access_after_change() from public, anon, authenticated;

drop trigger if exists staff_company_access_sync on public.staff_company_assignments;
create trigger staff_company_access_sync
after insert or update or delete on public.staff_company_assignments
for each row execute function private.sync_staff_company_access_after_change();

-- Repair all existing staff-level website accounts at migration time. This is deterministic:
-- exact leadership email -> link; otherwise create one on-site Staff row -> link.
do $$
declare
  candidate record;
begin
  for candidate in
    select distinct aa.session_id, aa.user_id
    from public.access_assignments aa
    where aa.active
      and aa.role in ('assistant_coordinator','coordinator','logistics_admin','session_director')
    order by aa.session_id, aa.user_id
  loop
    begin
      perform 1
      from private.reconcile_existing_staff_account(candidate.session_id, candidate.user_id, null) r;
    exception when others then
      insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
      values(
        candidate.session_id,
        null,
        'existing_staff_account_reconciliation_failed',
        'profile',
        candidate.user_id::text,
        jsonb_build_object('error', sqlerrm)
      );
    end;
  end loop;
end;
$$;
