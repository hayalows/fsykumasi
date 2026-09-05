-- Unified Registration & Check-in permissions.
-- Registration Committee members are trusted day-one operators: they can resolve
-- on-site participant verification, counselor-group placement, housing, arrival,
-- identity/replacement, and check-in without receiving access-administration powers.

update public.operational_teams
set capabilities = (
  select array_agg(distinct capability order by capability)
  from unnest(capabilities || array[
    'people_lookup','groups_view','registration_view','registration_manage','checkin_record',
    'identity_manage','arrival_manage','housing_view','housing_manage','reports_export'
  ]::text[]) capability
), updated_at = now()
where team_key = 'registration';

create or replace function private.seed_default_operational_teams(target_session uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.operational_teams(session_id,team_key,display_name,description,preset_key,capabilities) values
 (target_session,'housing','Housing','Room assignments, occupancy, keys, and housing changes.','housing',array['people_lookup','groups_view','housing_view','housing_manage','housing_export','reports_export']),
 (target_session,'wellness','Wellness','Health support and confidential wellness encounters.','wellness',array['people_lookup','wellness_status','wellness_private','wellness_manage']),
 (target_session,'food','Food','Meal planning and dietary accommodation operations.','food',array['people_lookup','groups_view','food_view','food_manage','food_export','reports_export']),
 (target_session,'registration','Registration','Registration, day-one check-in, on-site resolution, participant placement, and housing.','registration',array['people_lookup','groups_view','registration_view','registration_manage','checkin_record','identity_manage','arrival_manage','housing_view','housing_manage','reports_export']),
 (target_session,'staff','Staff Administration','Staffing, assignments, and staff readiness.','staff',array['staff_view','staff_manage','groups_view','reports_export']),
 (target_session,'inclusion','Inclusion','Accommodation and accessibility coordination.','inclusion',array['people_lookup','inclusion_view','housing_view']),
 (target_session,'facilities','Facilities','Venue, rooms, spaces, and facility coordination.','facilities',array['facilities_view','housing_view']),
 (target_session,'materials','Materials','Materials preparation and distribution.','materials',array['materials_view']),
 (target_session,'financial','Financial','FSY financial administration.','financial',array['financial_view']),
 (target_session,'publicity','Publicity','Approved session publicity and communications.','publicity',array['publicity_view']),
 (target_session,'logistics','Logistical Administration','Cross-functional logistical coordination without confidential Wellness narrative.','logistics',array['people_lookup','groups_view','checkin_record','headcount_view','headcount_record','housing_view','housing_manage','housing_export','food_view','food_manage','food_export','registration_view','registration_manage','identity_manage','arrival_manage','staff_view','staff_manage','inclusion_view','facilities_view','materials_view','reports_export'])
 on conflict(session_id,team_key) do nothing;
end; $$;
revoke all on function private.seed_default_operational_teams(uuid) from public;

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
  if not (
    private.has_capability(p_session_id,'registration_manage')
    or private.has_session_role(p_session_id,array['coordinator','logistics_admin','session_director']::public.app_role[])
  ) then raise exception 'Registration management access required'; end if;
  if not p_search_confirmed then raise exception 'Search the existing registration list before adding someone'; end if;

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
  ) then raise exception 'A person with this name and date of birth is already in the session. Search again before adding'; end if;

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
  values (p_session_id,(select auth.uid()),'on_site_participant_added_v2','participant',next_id::text,
    jsonb_build_object('age_at_session_start',calculated_age,'unit_name',trim(p_unit_name),'has_contact',true,'workflow','registration_checkin_desk'));
  return next_id;
end;
$$;
revoke all on function public.add_on_site_participant_v2(uuid,text,text,text,public.participant_sex,date,text,text,text,text,text,text,text,text,boolean) from public, anon;
grant execute on function public.add_on_site_participant_v2(uuid,text,text,text,public.participant_sex,date,text,text,text,text,text,text,text,text,boolean) to authenticated;

create or replace function public.verify_on_site_participant(
  p_participant_id uuid,
  p_approved boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target public.participants%rowtype;
begin
  select * into target from public.participants where id = p_participant_id for update;
  if target.id is null or target.source_kind <> 'on_site' then raise exception 'On-site participant not found'; end if;
  if not (private.has_capability(target.session_id,'registration_manage') or private.can_manage_access(target.session_id)) then
    raise exception 'Registration management access required';
  end if;
  update public.participants set
    verification_status = case when p_approved then 'verified' else 'rejected' end,
    is_current = p_approved,
    verified_by = (select auth.uid()), verified_at = now(), updated_at = now()
  where id = target.id;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (target.session_id,(select auth.uid()),
    case when p_approved then 'on_site_participant_verified' else 'on_site_participant_rejected' end,
    'participant',target.id::text,jsonb_build_object('note',nullif(trim(coalesce(p_note,'')),''),'workflow','registration_checkin_desk'));
end;
$$;
revoke all on function public.verify_on_site_participant(uuid,boolean,text) from public, anon;
grant execute on function public.verify_on_site_participant(uuid,boolean,text) to authenticated;

create or replace function public.assign_participant_to_group(p_participant_id uuid, p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target public.participants%rowtype; target_group public.counselor_groups%rowtype; max_size integer; avoid_units boolean;
begin
  select * into target from public.participants where id=p_participant_id for update;
  select * into target_group from public.counselor_groups where id=p_group_id;
  if target.id is null or target_group.id is null or target.session_id<>target_group.session_id then raise exception 'Participant and group must belong to the same session'; end if;
  if not (
    private.has_capability(target.session_id,'registration_manage')
    or private.has_session_role(target.session_id,array['coordinator','logistics_admin','session_director']::public.app_role[])
  ) then raise exception 'Registration management access required to assign participants'; end if;
  if not private.operational_participant_is_eligible(target.session_id,target.id) then raise exception 'This record is not currently eligible for youth operations. Review registration status, verification and age first'; end if;
  if target.sex<>target_group.sex then raise exception 'Participant sex does not match the selected group'; end if;
  select group_max_size,avoid_same_unit into max_size,avoid_units from public.session_structure_settings where session_id=target.session_id;
  max_size:=coalesce(max_size,10); avoid_units:=coalesce(avoid_units,true);
  if (select count(*) from public.participants p where p.group_id=target_group.id and p.id<>target.id)>=max_size then raise exception 'This counselor group is already at its configured maximum size'; end if;
  if avoid_units and exists(select 1 from public.participants peer where peer.group_id=target_group.id and peer.id<>target.id and lower(trim(peer.unit_name))=lower(trim(target.unit_name))) then raise exception 'This group already contains someone from the same unit'; end if;
  update public.participants set group_id=target_group.id,updated_at=now() where id=target.id;
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(target.session_id,(select auth.uid()),'participant_group_assigned','participant',target.id::text,jsonb_build_object('group_id',target_group.id,'workflow','registration_checkin_desk'));
end;
$$;
revoke all on function public.assign_participant_to_group(uuid,uuid) from public, anon;
grant execute on function public.assign_participant_to_group(uuid,uuid) to authenticated;
