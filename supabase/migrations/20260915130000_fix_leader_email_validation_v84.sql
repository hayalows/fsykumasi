-- Fix valid leader emails being rejected during website access setup.
-- PostgreSQL runs with standard_conforming_strings=on. The previous pattern used
-- a double backslash before the dot, so the regex looked for a literal backslash
-- in the email domain. Using [.] avoids SQL/regex escaping ambiguity entirely.

create or replace function public.create_staff_leader_invite(p_staff_id uuid, p_email text default null)
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
  if normalized_email is null or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
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

revoke all on function public.create_staff_leader_invite(uuid,text) from public, anon;
grant execute on function public.create_staff_leader_invite(uuid,text) to authenticated;

create or replace function public.create_leader_invite(
  p_session_id uuid,
  p_email text,
  p_display_name text,
  p_role public.app_role,
  p_company_ids uuid[] default '{}',
  p_committee_scope text[] default '{}'
)
returns table(invite_id uuid, invite_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(p_email));
  normalized_name text := nullif(regexp_replace(trim(coalesce(p_display_name,'')),'\\s+',' ','g'),'');
  formatted_code text;
  code_hash_value text;
  code_prefix text;
  new_id uuid;
  new_expiry timestamptz := now() + interval '72 hours';
  attempt integer;
begin
  if not private.can_manage_access(p_session_id) then raise exception 'Your account cannot invite leaders'; end if;
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Enter a valid email address'; end if;
  if normalized_name is null or length(normalized_name) < 2 or length(normalized_name) > 80 then raise exception 'Enter the leader''s name'; end if;

  if p_role::text = 'assistant_coordinator' then
    if cardinality(coalesce(p_company_ids, '{}'::uuid[])) = 0 then raise exception 'Select at least one company for an Assistant Coordinator'; end if;
    if exists(
      select 1 from unnest(coalesce(p_company_ids, '{}'::uuid[])) company_id
      where not exists(select 1 from public.companies c where c.id = company_id and c.session_id = p_session_id)
    ) then raise exception 'One or more selected companies do not belong to this session'; end if;
  elsif p_role::text = 'committee_viewer' then
    if cardinality(coalesce(p_committee_scope, '{}'::text[])) = 0 then raise exception 'Choose at least one FSY team responsibility'; end if;
  elsif p_role::text not in ('coordinator','logistics_admin','session_director','area_advisory_couple') then
    raise exception 'Unsupported role';
  end if;

  if exists(
    select 1 from unnest(coalesce(p_committee_scope, '{}'::text[])) k
    where not exists(
      select 1 from public.operational_teams t
      where t.session_id = p_session_id and t.team_key = k and t.active
    )
  ) then raise exception 'Invalid committee assignment'; end if;

  update public.leader_invites set status = 'revoked', revoked_at = now()
  where session_id = p_session_id and lower(email) = normalized_email
    and status in ('pending','activating') and purpose = 'onboarding';

  code_prefix := private.setup_invite_prefix(p_session_id, p_role, p_company_ids, p_committee_scope);
  for attempt in 1..5 loop
    formatted_code := private.make_short_setup_code(code_prefix);
    code_hash_value := encode(extensions.digest(replace(upper(formatted_code),'-',''),'sha256'),'hex');
    exit when not exists(select 1 from public.leader_invites li where li.code_hash = code_hash_value);
  end loop;
  if exists(select 1 from public.leader_invites li where li.code_hash = code_hash_value) then
    raise exception 'A unique setup code could not be prepared. Try again.';
  end if;

  insert into public.leader_invites(
    session_id, email, display_name, role, company_ids, committee_scope,
    purpose, code_hash, created_by, expires_at
  ) values (
    p_session_id, normalized_email, normalized_name, p_role,
    case when p_role::text = 'assistant_coordinator' then coalesce(p_company_ids,'{}') else '{}'::uuid[] end,
    coalesce(p_committee_scope,'{}'), 'onboarding', code_hash_value, (select auth.uid()), new_expiry
  ) returning id into new_id;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(p_session_id, (select auth.uid()), 'leader_invite_created', 'leader_invite', new_id::text,
    jsonb_build_object(
      'email', normalized_email,
      'role', p_role,
      'purpose', 'onboarding',
      'code_prefix', code_prefix,
      'expires_in_hours', 72
    ));
  return query select new_id, formatted_code, new_expiry;
end;
$$;

revoke all on function public.create_leader_invite(uuid,text,text,public.app_role,uuid[],text[]) from public, anon;
grant execute on function public.create_leader_invite(uuid,text,text,public.app_role,uuid[],text[]) to authenticated;
