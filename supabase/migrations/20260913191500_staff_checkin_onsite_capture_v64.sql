-- Staff check-in on-site capture v64.
-- Registration and staff-management operators can create a provisional staff
-- identity from the arrival desk when the person is physically present but is
-- absent from the roster. Arrival remains a separate write.

create or replace function public.add_on_site_staff_from_checkin_v1(
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

  if not p_search_confirmed then
    raise exception 'Search the existing staff list before adding someone';
  end if;

  if p_operational_role not in ('counselor','assistant_coordinator','committee_member','other') then
    raise exception 'Choose Counselor, Assistant Coordinator, Committee member, or Other';
  end if;

  select starts_on into session_start
  from public.sessions
  where id = p_session_id;

  if session_start is null then
    raise exception 'Session start date is required';
  end if;

  if p_date_of_birth is null or p_date_of_birth > session_start then
    raise exception 'A valid date of birth is required';
  end if;

  calculated_age := extract(year from age(session_start, p_date_of_birth))::integer;
  full_name_value := trim(coalesce(p_first_name,'')) || ' ' || trim(coalesce(p_last_name,''));

  if nullif(trim(coalesce(p_first_name,'')),'') is null
     or nullif(trim(coalesce(p_last_name,'')),'') is null
     or p_sex is null
     or nullif(trim(coalesce(p_unit_name,'')),'') is null
     or calculated_age not between 1 and 120 then
    raise exception 'Name, date of birth, sex, and ward or branch are required';
  end if;

  if nullif(trim(coalesce(p_phone,'')),'') is null
     and nullif(trim(coalesce(p_email,'')),'') is null then
    raise exception 'Add a phone number or email address for this staff member';
  end if;

  -- Search every historical/current staff identity, not only current rows. A
  -- cancelled or superseded record should be repaired rather than duplicated.
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
    id,
    session_id,
    full_name,
    staff_role,
    first_name,
    last_name,
    preferred_name,
    sex,
    age,
    unit_name,
    stake_name,
    registration_status,
    is_current,
    operational_role,
    source_kind
  ) values (
    next_id,
    p_session_id,
    trim(full_name_value),
    initcap(replace(p_operational_role,'_',' ')),
    trim(p_first_name),
    trim(p_last_name),
    nullif(trim(coalesce(p_preferred_name,'')),''),
    p_sex,
    calculated_age,
    trim(p_unit_name),
    nullif(trim(coalesce(p_stake_name,'')),''),
    'awaiting',
    true,
    p_operational_role,
    'on_site'
  );

  insert into public.staff_private_details(
    staff_id,
    session_id,
    date_of_birth,
    email,
    phone,
    medical_information,
    dietary_information,
    tshirt_size,
    updated_at
  ) values (
    next_id,
    p_session_id,
    p_date_of_birth,
    nullif(lower(trim(coalesce(p_email,''))),''),
    nullif(trim(coalesce(p_phone,'')),''),
    nullif(trim(coalesce(p_medical_information,'')),''),
    nullif(trim(coalesce(p_dietary_information,'')),''),
    nullif(trim(coalesce(p_tshirt_size,'')),''),
    now()
  );

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_session_id,
    auth.uid(),
    'staff_added_from_checkin',
    'staff',
    next_id::text,
    jsonb_build_object(
      'operational_role', p_operational_role,
      'age_at_session_start', calculated_age,
      'unit_name', trim(p_unit_name),
      'source', 'registration_staff_checkin'
    )
  );

  return next_id;
end;
$$;

revoke all on function public.add_on_site_staff_from_checkin_v1(uuid,text,text,text,public.participant_sex,date,text,text,text,text,text,text,text,text,boolean) from public, anon;
grant execute on function public.add_on_site_staff_from_checkin_v1(uuid,text,text,text,public.participant_sex,date,text,text,text,text,text,text,text,text,boolean) to authenticated;
