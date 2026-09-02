-- Complete day-of capture for people who are absent from the imported snapshot.
-- Sensitive contact/health fields remain in the private-detail tables.

alter table public.staff
  add column if not exists source_kind text not null default 'imported';

alter table public.staff drop constraint if exists staff_source_kind_check;
alter table public.staff add constraint staff_source_kind_check
  check (source_kind in ('imported','on_site'));

create index if not exists staff_session_source_kind_idx
  on public.staff(session_id, source_kind, is_current);

create or replace function public.add_on_site_participant_v2(
  p_session_id uuid,
  p_first_name text,
  p_last_name text,
  p_preferred_name text,
  p_sex public.participant_sex,
  p_date_of_birth date,
  p_unit_name text,
  p_stake_name text default null,
  p_phone text default null,
  p_contact_name text default null,
  p_contact_phone text default null,
  p_tshirt_size text default null,
  p_medical_information text default null,
  p_dietary_information text default null,
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
begin
  if not private.has_session_role(p_session_id, array['coordinator','logistics_admin','session_director']::public.app_role[]) then
    raise exception 'Your role cannot add an on-site participant';
  end if;
  if not p_search_confirmed then
    raise exception 'Search the existing registration list before adding someone';
  end if;

  select starts_on into session_start from public.sessions where id = p_session_id;
  if session_start is null then raise exception 'Session start date is required'; end if;
  if p_date_of_birth is null or p_date_of_birth > session_start then raise exception 'A valid date of birth is required'; end if;
  calculated_age := extract(year from age(session_start, p_date_of_birth))::integer;

  if nullif(trim(coalesce(p_first_name,'')),'') is null
     or nullif(trim(coalesce(p_last_name,'')),'') is null
     or nullif(trim(coalesce(p_unit_name,'')),'') is null
     or calculated_age not between 1 and 120 then
    raise exception 'Name, date of birth, sex, and ward or branch are required';
  end if;
  if nullif(trim(coalesce(p_phone,'')),'') is null
     and nullif(trim(coalesce(p_contact_phone,'')),'') is null then
    raise exception 'Add the participant phone or a parent/guardian phone number';
  end if;

  if exists (
    select 1
    from public.participants participant
    join public.participant_private_details details on details.participant_id = participant.id
    where participant.session_id = p_session_id
      and participant.is_current
      and lower(trim(participant.first_name)) = lower(trim(p_first_name))
      and lower(trim(participant.last_name)) = lower(trim(p_last_name))
      and details.date_of_birth = p_date_of_birth
  ) then
    raise exception 'A person with this name and date of birth is already in the session. Search again before adding';
  end if;

  insert into public.participants(
    id, session_id, registration_id, first_name, last_name, preferred_name,
    sex, age, unit_name, stake_name, source_kind, registration_status,
    verification_status, is_current, reconciliation_status
  ) values (
    next_id, p_session_id,
    'ONSITE-' || upper(substr(replace(next_id::text,'-',''),1,12)),
    trim(p_first_name), trim(p_last_name), nullif(trim(coalesce(p_preferred_name,'')),''),
    p_sex, calculated_age, trim(p_unit_name), nullif(trim(coalesce(p_stake_name,'')),''),
    'on_site', 'approved', 'pending', true, 'current'
  );

  insert into public.participant_private_details(
    participant_id, session_id, date_of_birth, phone,
    contact_1_name, contact_1_phone, tshirt_size,
    medical_information, dietary_information, updated_at
  ) values (
    next_id, p_session_id, p_date_of_birth, nullif(trim(coalesce(p_phone,'')),''),
    nullif(trim(coalesce(p_contact_name,'')),''), nullif(trim(coalesce(p_contact_phone,'')),''),
    nullif(trim(coalesce(p_tshirt_size,'')),''), nullif(trim(coalesce(p_medical_information,'')),''),
    nullif(trim(coalesce(p_dietary_information,'')),''), now()
  );

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_session_id, (select auth.uid()), 'on_site_participant_added_v2', 'participant', next_id::text,
    jsonb_build_object('age_at_session_start', calculated_age, 'unit_name', trim(p_unit_name), 'has_contact', true)
  );

  return next_id;
end;
$$;

revoke all on function public.add_on_site_participant_v2(uuid,text,text,text,public.participant_sex,date,text,text,text,text,text,text,text,text,boolean) from public, anon;
grant execute on function public.add_on_site_participant_v2(uuid,text,text,text,public.participant_sex,date,text,text,text,text,text,text,text,text,boolean) to authenticated;

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
  if not private.has_session_role(p_session_id, array['coordinator','logistics_admin','session_director']::public.app_role[]) then
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
      and staff_member.is_current
      and lower(trim(coalesce(staff_member.first_name,''))) = lower(trim(p_first_name))
      and lower(trim(coalesce(staff_member.last_name,''))) = lower(trim(p_last_name))
      and details.date_of_birth = p_date_of_birth
  ) then
    raise exception 'A staff member with this name and date of birth is already in the session. Search again before adding';
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
    jsonb_build_object('operational_role', p_operational_role, 'age_at_session_start', calculated_age, 'unit_name', trim(p_unit_name))
  );

  return next_id;
end;
$$;

revoke all on function public.add_on_site_staff(uuid,text,text,text,public.participant_sex,date,text,text,text,text,text,text,text,text,boolean) from public, anon;
grant execute on function public.add_on_site_staff(uuid,text,text,text,public.participant_sex,date,text,text,text,text,text,text,text,text,boolean) to authenticated;
