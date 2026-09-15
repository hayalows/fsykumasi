-- Day-of staff approval, Assistant Coordinator placement and simpler first sign-in.
-- Staff added by an authorized operator are trusted for this session. Staff remains
-- the source of truth for role and company scope; setup codes only prove identity.

create or replace function private.setup_invite_prefix(
  p_session_id uuid,
  p_role public.app_role,
  p_company_ids uuid[] default '{}'::uuid[],
  p_committee_scope text[] default '{}'::text[]
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  company_number integer;
  team_key text;
  team_letters text;
begin
  if p_role::text = 'assistant_coordinator' then
    select c.operational_number
      into company_number
    from public.companies c
    where c.session_id = p_session_id
      and c.id = any(coalesce(p_company_ids, '{}'::uuid[]))
    order by c.operational_number nulls last, c.name, c.id
    limit 1;
    return 'AC' || right('00' || coalesce(company_number::text, '1'), 2);
  end if;

  if p_role::text = 'committee_viewer' then
    select scope into team_key
    from unnest(coalesce(p_committee_scope, '{}'::text[])) scope
    where nullif(trim(scope), '') is not null
    order by scope
    limit 1;
    team_letters := upper(substr(regexp_replace(coalesce(team_key, 'team'), '[^a-zA-Z]', '', 'g'), 1, 2));
    return 'CM' || rpad(coalesce(nullif(team_letters, ''), 'TM'), 2, 'X');
  end if;

  return case p_role::text
    when 'coordinator' then 'CO01'
    when 'logistics_admin' then 'LA01'
    when 'session_director' then 'SD01'
    when 'area_advisory_couple' then 'AA01'
    else 'FS01'
  end;
end;
$$;

revoke all on function private.setup_invite_prefix(uuid, public.app_role, uuid[], text[]) from public;

create or replace function private.make_short_setup_code(p_prefix text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  clean_prefix text;
  raw_code text;
begin
  clean_prefix := upper(regexp_replace(coalesce(p_prefix, 'FS01'), '[^A-Z0-9]', '', 'g'));
  clean_prefix := rpad(substr(clean_prefix, 1, 4), 4, 'X');
  raw_code := upper(encode(extensions.gen_random_bytes(5), 'hex'));
  return clean_prefix || '-' || substr(raw_code, 1, 4) || '-' || substr(raw_code, 5, 4) || '-' || substr(raw_code, 9, 2);
end;
$$;

revoke all on function private.make_short_setup_code(text) from public;

-- The general on-site Staff action now follows the day-of rule: an authorized
-- operator adding someone to Staff means that person is approved to serve.
create or replace function public.add_on_site_staff(
  p_session_id uuid,
  p_first_name text,
  p_last_name text,
  p_preferred_name text,
  p_sex public.participant_sex,
  p_date_of_birth date,
  p_unit_name text,
  p_stake_name text default null,
  p_phone text default null,
  p_email text default null,
  p_tshirt_size text default null,
  p_medical_information text default null,
  p_dietary_information text default null,
  p_operational_role text default 'counselor',
  p_search_confirmed boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_id uuid := extensions.gen_random_uuid();
  session_start date;
  calculated_age integer;
  full_name_value text;
begin
  if not private.has_session_role(
    p_session_id,
    array['coordinator','logistics_admin','session_director']::public.app_role[]
  ) then
    raise exception 'Your role cannot add on-site staff';
  end if;
  if not p_search_confirmed then raise exception 'Search the existing people list before adding staff'; end if;
  if p_operational_role not in ('counselor','assistant_coordinator','committee_member','other') then
    raise exception 'Choose Counselor, Assistant Coordinator, Committee member, or Other';
  end if;

  select starts_on into session_start from public.sessions where id = p_session_id;
  if session_start is null then raise exception 'Session start date is required'; end if;
  if p_date_of_birth is null or p_date_of_birth > session_start then raise exception 'A valid date of birth is required'; end if;
  calculated_age := extract(year from age(session_start, p_date_of_birth))::integer;
  full_name_value := trim(coalesce(p_first_name,'')) || ' ' || trim(coalesce(p_last_name,''));

  if nullif(trim(coalesce(p_first_name,'')),'') is null
     or nullif(trim(coalesce(p_last_name,'')),'') is null
     or p_sex is null
     or nullif(trim(coalesce(p_unit_name,'')),'') is null
     or calculated_age not between 1 and 120 then
    raise exception 'Name, date of birth, sex, and ward or branch are required';
  end if;
  if nullif(trim(coalesce(p_phone,'')),'') is null and nullif(trim(coalesce(p_email,'')),'') is null then
    raise exception 'Add a phone number or email address for this staff member';
  end if;

  if exists (
    select 1
    from public.staff staff_member
    join public.staff_private_details details on details.staff_id = staff_member.id
    where staff_member.session_id = p_session_id
      and lower(trim(coalesce(staff_member.first_name,''))) = lower(trim(p_first_name))
      and lower(trim(coalesce(staff_member.last_name,''))) = lower(trim(p_last_name))
      and details.date_of_birth = p_date_of_birth
  ) then
    raise exception 'This staff member already has a record in the session. Review the existing record instead of adding another';
  end if;

  insert into public.staff(
    id, session_id, full_name, staff_role, first_name, last_name, preferred_name,
    sex, age, unit_name, stake_name, registration_status, is_current,
    operational_role, source_kind
  ) values (
    next_id, p_session_id, trim(full_name_value), initcap(replace(p_operational_role,'_',' ')),
    trim(p_first_name), trim(p_last_name), nullif(trim(coalesce(p_preferred_name,'')),''),
    p_sex, calculated_age, trim(p_unit_name), nullif(trim(coalesce(p_stake_name,'')),''),
    'approved', true, p_operational_role, 'on_site'
  );

  insert into public.staff_private_details(
    staff_id, session_id, date_of_birth, email, phone,
    medical_information, dietary_information, tshirt_size, updated_at
  ) values (
    next_id, p_session_id, p_date_of_birth, nullif(lower(trim(coalesce(p_email,''))),''),
    nullif(trim(coalesce(p_phone,'')),''), nullif(trim(coalesce(p_medical_information,'')),''),
    nullif(trim(coalesce(p_dietary_information,'')),''), nullif(trim(coalesce(p_tshirt_size,'')),''), now()
  );

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_session_id, (select auth.uid()), 'on_site_staff_added', 'staff', next_id::text,
    jsonb_build_object(
      'operational_role', p_operational_role,
      'age_at_session_start', calculated_age,
      'unit_name', trim(p_unit_name),
      'approved_to_serve', true
    )
  );

  return next_id;
end;
$$;

revoke all on function public.add_on_site_staff(uuid,text,text,text,public.participant_sex,date,text,text,text,text,text,text,text,text,boolean) from public, anon;
grant execute on function public.add_on_site_staff(uuid,text,text,text,public.participant_sex,date,text,text,text,text,text,text,text,text,boolean) to authenticated;

-- Arrival-desk creation is atomic. The person is approved, marked present and,
-- for an Assistant Coordinator, assigned to the chosen companies in one transaction.
create or replace function public.add_on_site_staff_from_checkin_v2(
  p_session_id uuid,
  p_first_name text,
  p_last_name text,
  p_preferred_name text,
  p_sex public.participant_sex,
  p_date_of_birth date,
  p_unit_name text,
  p_stake_name text default null,
  p_phone text default null,
  p_email text default null,
  p_tshirt_size text default null,
  p_medical_information text default null,
  p_dietary_information text default null,
  p_operational_role text default 'counselor',
  p_company_ids uuid[] default '{}'::uuid[],
  p_search_confirmed boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_id uuid := extensions.gen_random_uuid();
  session_start date;
  calculated_age integer;
  full_name_value text;
  normalized_email text := nullif(lower(trim(coalesce(p_email,''))), '');
begin
  if not (
    private.has_capability(p_session_id, 'registration_manage')
    or private.has_capability(p_session_id, 'staff_manage')
    or private.has_session_role(
      p_session_id,
      array['coordinator','logistics_admin','session_director']::public.app_role[]
    )
  ) then
    raise exception 'Registration or staff management access is required';
  end if;

  if not p_search_confirmed then raise exception 'Search the existing staff list before adding someone'; end if;
  if p_operational_role not in ('counselor','assistant_coordinator','committee_member','other') then
    raise exception 'Choose Counselor, Assistant Coordinator, Committee member, or Other';
  end if;

  if p_operational_role = 'assistant_coordinator' then
    if not private.can_manage_access(p_session_id) then
      raise exception 'A Full Session Administrator is required to add and place an Assistant Coordinator';
    end if;
    if cardinality(coalesce(p_company_ids, '{}'::uuid[])) = 0 then
      raise exception 'Choose at least one company for this Assistant Coordinator';
    end if;
    if normalized_email is null then
      raise exception 'Add an email address so this Assistant Coordinator can receive website access';
    end if;
  elsif cardinality(coalesce(p_company_ids, '{}'::uuid[])) > 0 then
    raise exception 'Company assignments are only used for Assistant Coordinators';
  end if;

  select starts_on into session_start from public.sessions where id = p_session_id;
  if session_start is null then raise exception 'Session start date is required'; end if;
  if p_date_of_birth is null or p_date_of_birth > session_start then raise exception 'A valid date of birth is required'; end if;
  calculated_age := extract(year from age(session_start, p_date_of_birth))::integer;
  full_name_value := trim(coalesce(p_first_name,'')) || ' ' || trim(coalesce(p_last_name,''));

  if nullif(trim(coalesce(p_first_name,'')),'') is null
    or nullif(trim(coalesce(p_last_name,'')),'') is null
    or p_sex is null
    or nullif(trim(coalesce(p_unit_name,'')),'') is null
    or calculated_age not between 1 and 120 then
    raise exception 'Name, date of birth, sex, and ward or branch are required';
  end if;
  if nullif(trim(coalesce(p_phone,'')),'') is null and normalized_email is null then
    raise exception 'Add a phone number or email address for this staff member';
  end if;

  if exists (
    select 1 from public.staff s
    join public.staff_private_details d on d.staff_id = s.id
    where s.session_id = p_session_id
      and lower(trim(coalesce(s.first_name,''))) = lower(trim(p_first_name))
      and lower(trim(coalesce(s.last_name,''))) = lower(trim(p_last_name))
      and d.date_of_birth = p_date_of_birth
  ) then
    raise exception 'This staff member already has a record in the session. Review the existing record instead of adding another';
  end if;

  insert into public.staff(
    id, session_id, full_name, staff_role, first_name, last_name, preferred_name,
    sex, age, unit_name, stake_name, registration_status, is_current,
    operational_role, source_kind
  ) values (
    next_id, p_session_id, trim(full_name_value), initcap(replace(p_operational_role,'_',' ')),
    trim(p_first_name), trim(p_last_name), nullif(trim(coalesce(p_preferred_name,'')),''),
    p_sex, calculated_age, trim(p_unit_name), nullif(trim(coalesce(p_stake_name,'')),''),
    'approved', true, p_operational_role, 'on_site'
  );

  insert into public.staff_private_details(
    staff_id, session_id, date_of_birth, email, phone,
    medical_information, dietary_information, tshirt_size, updated_at
  ) values (
    next_id, p_session_id, p_date_of_birth, normalized_email,
    nullif(trim(coalesce(p_phone,'')),''), nullif(trim(coalesce(p_medical_information,'')),''),
    nullif(trim(coalesce(p_dietary_information,'')),''), nullif(trim(coalesce(p_tshirt_size,'')),''), now()
  );

  -- initialize_staff_operations creates the row. Move the arrival desk record to
  -- its final state instead of inserting a competing second row.
  update public.staff_operations
  set planning_state = 'primary',
      arrival_state = 'arrived',
      service_clearance = 'cleared',
      revision = revision + 1,
      updated_by = (select auth.uid()),
      updated_at = now()
  where staff_id = next_id;

  if not found then
    insert into public.staff_operations(
      staff_id, planning_state, arrival_state, service_clearance, revision, updated_by, updated_at
    ) values (
      next_id, 'primary', 'arrived', 'cleared', 1, (select auth.uid()), now()
    );
  end if;

  if p_operational_role = 'assistant_coordinator' then
    perform public.set_assistant_coordinator_companies(next_id, coalesce(p_company_ids, '{}'::uuid[]));
  elsif p_operational_role = 'counselor' then
    perform private.place_ready_staff_if_open_v1(next_id);
  end if;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_session_id, (select auth.uid()), 'staff_added_from_checkin', 'staff', next_id::text,
    jsonb_build_object(
      'operational_role', p_operational_role,
      'age_at_session_start', calculated_age,
      'unit_name', trim(p_unit_name),
      'source', 'registration_staff_checkin',
      'ready_to_serve', true,
      'company_ids', coalesce(p_company_ids, '{}'::uuid[])
    )
  );

  return next_id;
end;
$$;

revoke all on function public.add_on_site_staff_from_checkin_v2(uuid,text,text,text,public.participant_sex,date,text,text,text,text,text,text,text,text,uuid[],boolean) from public, anon;
grant execute on function public.add_on_site_staff_from_checkin_v2(uuid,text,text,text,public.participant_sex,date,text,text,text,text,text,text,text,text,uuid[],boolean) to authenticated;

-- Staff-linked onboarding now uses a short semantic prefix plus 40 random bits.
-- Example: AC01-7F3A-9C2D-8B. The prefix is only a label; Staff assignments
-- continue to control permissions after activation.
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
  if not target.is_current or target.registration_status <> 'approved' then raise exception 'Only current approved staff can receive website access'; end if;
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
      'expires_in_hours', 72
    ));
  return query select new_id, formatted_code, new_expiry, account_exists;
end;
$$;

revoke all on function public.create_staff_leader_invite(uuid,text) from public, anon;
grant execute on function public.create_staff_leader_invite(uuid,text) to authenticated;

-- Committee and exceptional leader invitations use the same short-code pattern.
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
  normalized_name text := nullif(regexp_replace(trim(coalesce(p_display_name,'')),'\s+',' ','g'),'');
  formatted_code text;
  code_hash_value text;
  code_prefix text;
  new_id uuid;
  new_expiry timestamptz := now() + interval '72 hours';
  attempt integer;
begin
  if not private.can_manage_access(p_session_id) then raise exception 'Your account cannot invite leaders'; end if;
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address'; end if;
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
