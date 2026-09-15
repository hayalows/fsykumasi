-- Fix the staff website-access email validator introduced by v79.
--
-- v79 accidentally escaped the domain dot twice (`\\.`), which makes PostgreSQL
-- look for a literal backslash before the dot. Normal addresses such as
-- person@gmail.com were therefore rejected even though they are valid.
--
-- Keep the existing account path unchanged: a valid email may already belong to
-- an FSY profile. In that case the invite is still created with
-- existing_account=true so the leader can connect this session to that sign-in.

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

  -- One backslash is intentional. It makes the regex match the literal dot in
  -- the domain instead of requiring a backslash in the submitted address.
  if normalized_email is null or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
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
