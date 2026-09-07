create or replace function private.final_roster_norm(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(trim(coalesce(p_value,'')), '[[:space:]]+', ' ', 'g'));
$$;

create or replace function private.final_roster_identity_key(
  p_type text,
  p_first text,
  p_last text,
  p_birthday date,
  p_sex text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select private.final_roster_norm(p_type) || '|' ||
         private.final_roster_norm(p_first) || '|' ||
         private.final_roster_norm(p_last) || '|' ||
         coalesce(p_birthday::text,'') || '|' ||
         private.final_roster_norm(p_sex);
$$;

create or replace function private.stage_final_registration_roster(
  p_session_id uuid,
  p_records jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_start date;
  session_end date;
  total_count integer;
  participant_count integer;
  staff_count integer;
begin
  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'Final registration payload must be an array';
  end if;

  total_count := jsonb_array_length(p_records);
  if total_count < 1 or total_count > 5000 then
    raise exception 'Final registration roster must contain between 1 and 5000 rows';
  end if;

  select s.starts_on, s.ends_on
  into session_start, session_end
  from public.sessions s
  where s.id = p_session_id;

  if session_start is null or session_end is null then
    raise exception 'FSY session dates are required before the final roster can be applied';
  end if;

  create temporary table if not exists final_registration_stage (
    source_record_key text primary key,
    person_type text not null,
    first_name text,
    last_name text,
    preferred_name text,
    birthday date not null,
    sex text not null,
    age integer,
    unit_name text,
    stake_name text,
    registration_status text not null,
    source_registered_at timestamp not null,
    email text,
    phone text,
    medical_information text,
    dietary_information text,
    tshirt_size text,
    contact_1_name text,
    contact_1_email text,
    contact_1_phone text,
    contact_2_name text,
    contact_2_email text,
    contact_2_phone text,
    bishop_name text,
    bishop_email text,
    identity_key text not null
  ) on commit drop;
  truncate pg_temp.final_registration_stage;

  insert into pg_temp.final_registration_stage(
    source_record_key, person_type, first_name, last_name, preferred_name,
    birthday, sex, age, unit_name, stake_name, registration_status,
    source_registered_at, email, phone, medical_information,
    dietary_information, tshirt_size, contact_1_name, contact_1_email,
    contact_1_phone, contact_2_name, contact_2_email, contact_2_phone,
    bishop_name, bishop_email, identity_key
  )
  select
    lower(trim(x.source_record_key)),
    lower(trim(x.person_type)),
    nullif(trim(coalesce(x.first_name,'')), ''),
    nullif(trim(coalesce(x.last_name,'')), ''),
    nullif(trim(coalesce(x.preferred_name,'')), ''),
    x.birthday,
    lower(trim(x.sex)),
    extract(year from age(session_start, x.birthday))::integer,
    nullif(trim(coalesce(x.unit_name,'')), ''),
    nullif(trim(coalesce(x.stake_name,'')), ''),
    lower(trim(x.registration_status)),
    x.source_registered_at,
    nullif(trim(coalesce(x.email,'')), ''),
    nullif(trim(coalesce(x.phone,'')), ''),
    nullif(trim(coalesce(x.medical_information,'')), ''),
    nullif(trim(coalesce(x.dietary_information,'')), ''),
    nullif(trim(coalesce(x.tshirt_size,'')), ''),
    nullif(trim(coalesce(x.contact_1_name,'')), ''),
    nullif(trim(coalesce(x.contact_1_email,'')), ''),
    nullif(trim(coalesce(x.contact_1_phone,'')), ''),
    nullif(trim(coalesce(x.contact_2_name,'')), ''),
    nullif(trim(coalesce(x.contact_2_email,'')), ''),
    nullif(trim(coalesce(x.contact_2_phone,'')), ''),
    nullif(trim(coalesce(x.bishop_name,'')), ''),
    nullif(trim(coalesce(x.bishop_email,'')), ''),
    private.final_roster_identity_key(
      lower(trim(x.person_type)),
      x.first_name,
      x.last_name,
      x.birthday,
      lower(trim(x.sex))
    )
  from jsonb_to_recordset(p_records) as x(
    source_record_key text,
    person_type text,
    first_name text,
    last_name text,
    preferred_name text,
    birthday date,
    sex text,
    age integer,
    unit_name text,
    stake_name text,
    registration_status text,
    source_registered_at timestamp,
    email text,
    phone text,
    medical_information text,
    dietary_information text,
    tshirt_size text,
    contact_1_name text,
    contact_1_email text,
    contact_1_phone text,
    contact_2_name text,
    contact_2_email text,
    contact_2_phone text,
    bishop_name text,
    bishop_email text
  );

  if (select count(*) from pg_temp.final_registration_stage) <> total_count then
    raise exception 'One or more final roster rows could not be staged';
  end if;

  if exists (
    select 1
    from pg_temp.final_registration_stage s
    where s.source_record_key !~ '^[0-9a-f]{64}$'
       or s.person_type not in ('participant','counselor')
       or s.sex not in ('female','male')
       or s.registration_status not in ('approved','awaiting','cancelled')
       or s.birthday is null
       or s.source_registered_at is null
       or s.age is null or s.age not between 1 and 120
       or (
         nullif(trim(coalesce(s.first_name,'')), '') is null
         and nullif(trim(coalesce(s.last_name,'')), '') is null
         and nullif(trim(coalesce(s.preferred_name,'')), '') is null
       )
  ) then
    raise exception 'One or more rows failed final registration validation';
  end if;

  select
    count(*) filter (where person_type='participant'),
    count(*) filter (where person_type='counselor')
  into participant_count, staff_count
  from pg_temp.final_registration_stage;

  return jsonb_build_object(
    'record_count', total_count,
    'participant_count', participant_count,
    'staff_count', staff_count,
    'starts_on', session_start,
    'ends_on', session_end
  );
end;
$$;

revoke all on function private.final_roster_norm(text) from public, anon, authenticated;
revoke all on function private.final_roster_identity_key(text,text,text,date,text) from public, anon, authenticated;
revoke all on function private.stage_final_registration_roster(uuid,jsonb) from public, anon, authenticated;

create or replace function public.preview_final_registration_baseline(
  p_session_id uuid,
  p_records jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  staged jsonb;
  participant_count integer;
  staff_count integer;
  approved_count integer;
  awaiting_count integer;
  cancelled_count integer;
  matched_participants integer := 0;
  matched_staff integer := 0;
  manual_staff_preserved integer := 0;
  account_links_preserved integer := 0;
  companies_to_reset integer := 0;
  groups_to_reset integer := 0;
  badges_to_reset integer := 0;
  checkins_to_reset integer := 0;
  headcount_to_reset integer := 0;
  housing_assignments_to_reset integer := 0;
begin
  if not private.can_manage_access(p_session_id) then
    raise exception 'Administrative access is required to preview the final registration baseline';
  end if;

  if not exists (
    select 1 from public.sessions s
    where s.id=p_session_id and s.status='planning'
  ) then
    raise exception 'The final roster can only replace rehearsal data while the session is in planning';
  end if;

  staged := private.stage_final_registration_roster(p_session_id, p_records);

  select
    count(*) filter (where person_type='participant'),
    count(*) filter (where person_type='counselor'),
    count(*) filter (where registration_status='approved'),
    count(*) filter (where registration_status='awaiting'),
    count(*) filter (where registration_status='cancelled')
  into participant_count, staff_count, approved_count, awaiting_count, cancelled_count
  from pg_temp.final_registration_stage;

  with stage_counts as (
    select identity_key, count(*) as n
    from pg_temp.final_registration_stage
    where person_type='participant'
    group by identity_key
  ),
  existing_counts as (
    select private.final_roster_identity_key(
             'participant', p.first_name, p.last_name, ppd.date_of_birth, p.sex::text
           ) as identity_key,
           count(*) as n
    from public.participants p
    left join public.participant_private_details ppd on ppd.participant_id=p.id
    where p.session_id=p_session_id
      and p.source_record_key is not null
    group by 1
  )
  select count(*)
  into matched_participants
  from pg_temp.final_registration_stage s
  where s.person_type='participant'
    and (
      exists (
        select 1 from public.participants p
        where p.session_id=p_session_id and p.source_record_key=s.source_record_key
      )
      or (
        coalesce((select sc.n from stage_counts sc where sc.identity_key=s.identity_key),0)=1
        and coalesce((select ec.n from existing_counts ec where ec.identity_key=s.identity_key),0)=1
      )
    );

  with stage_counts as (
    select identity_key, count(*) as n
    from pg_temp.final_registration_stage
    where person_type='counselor'
    group by identity_key
  ),
  existing_counts as (
    select private.final_roster_identity_key(
             'counselor', st.first_name, st.last_name, spd.date_of_birth, st.sex::text
           ) as identity_key,
           count(*) as n
    from public.staff st
    left join public.staff_private_details spd on spd.staff_id=st.id
    where st.session_id=p_session_id
      and st.source_record_key is not null
    group by 1
  )
  select count(*)
  into matched_staff
  from pg_temp.final_registration_stage s
  where s.person_type='counselor'
    and (
      exists (
        select 1 from public.staff st
        where st.session_id=p_session_id and st.source_record_key=s.source_record_key
      )
      or (
        coalesce((select sc.n from stage_counts sc where sc.identity_key=s.identity_key),0)=1
        and coalesce((select ec.n from existing_counts ec where ec.identity_key=s.identity_key),0)=1
      )
    );

  select count(*) into manual_staff_preserved
  from public.staff st
  where st.session_id=p_session_id and st.source_record_key is null;

  select count(*) into account_links_preserved
  from public.staff_account_links sal
  where sal.session_id=p_session_id;

  select count(*) into companies_to_reset from public.companies c where c.session_id=p_session_id;
  select count(*) into groups_to_reset from public.counselor_groups g where g.session_id=p_session_id;
  select count(*) into badges_to_reset from public.participant_badge_assignments b where b.session_id=p_session_id;
  select count(*) into checkins_to_reset from public.check_ins ci where ci.session_id=p_session_id;
  select count(*) into headcount_to_reset from public.headcount_rounds hr where hr.session_id=p_session_id;
  select count(*) into housing_assignments_to_reset from public.housing_assignments ha where ha.session_id=p_session_id;

  return jsonb_build_object(
    'record_count', participant_count + staff_count,
    'participant_count', participant_count,
    'staff_count', staff_count,
    'approved_count', approved_count,
    'awaiting_count', awaiting_count,
    'cancelled_count', cancelled_count,
    'matched_participants', matched_participants,
    'new_participants', participant_count - matched_participants,
    'matched_staff', matched_staff,
    'new_staff', staff_count - matched_staff,
    'manual_staff_preserved', manual_staff_preserved,
    'account_links_preserved', account_links_preserved,
    'companies_to_reset', companies_to_reset,
    'groups_to_reset', groups_to_reset,
    'badges_to_reset', badges_to_reset,
    'checkins_to_reset', checkins_to_reset,
    'headcount_rounds_to_reset', headcount_to_reset,
    'housing_assignments_to_reset', housing_assignments_to_reset
  );
end;
$$;

revoke all on function public.preview_final_registration_baseline(uuid,jsonb) from public, anon;
grant execute on function public.preview_final_registration_baseline(uuid,jsonb) to authenticated, service_role;

create or replace function public.apply_final_registration_baseline(
  p_session_id uuid,
  p_source_filename text,
  p_source_sha256 text,
  p_records jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  staged jsonb;
  batch_id uuid;
  participant_count integer;
  staff_count integer;
  approved_count integer;
  awaiting_count integer;
  cancelled_count integer;
  matched_participants integer := 0;
  matched_staff integer := 0;
  manual_staff_before integer := 0;
  manual_staff_after integer := 0;
  account_links_before integer := 0;
  account_links_after integer := 0;
  active_access_before integer := 0;
  active_access_after integer := 0;
  companies_reset integer := 0;
  groups_reset integer := 0;
  badges_reset integer := 0;
  checkins_reset integer := 0;
  headcount_rounds_reset integer := 0;
  housing_assignments_reset integer := 0;
  retired_participants integer := 0;
  retired_staff integer := 0;
begin
  if not private.can_manage_access(p_session_id) then
    raise exception 'Administrative access is required to apply the final registration baseline';
  end if;

  if not exists (
    select 1 from public.sessions s
    where s.id=p_session_id and s.status='planning'
  ) then
    raise exception 'The final roster can only replace rehearsal data while the session is in planning';
  end if;

  if nullif(trim(coalesce(p_source_filename,'')), '') is null then
    raise exception 'A source filename is required';
  end if;

  if lower(coalesce(p_source_sha256,'')) !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid source file fingerprint is required';
  end if;

  if exists (
    select 1 from public.import_batches ib
    where ib.session_id=p_session_id
      and ib.source_sha256=lower(p_source_sha256)
      and ib.status='applied'
  ) then
    raise exception 'This exact registration file has already been applied';
  end if;

  perform 1 from public.sessions s where s.id=p_session_id for update;

  staged := private.stage_final_registration_roster(p_session_id, p_records);

  select
    count(*) filter (where person_type='participant'),
    count(*) filter (where person_type='counselor'),
    count(*) filter (where registration_status='approved'),
    count(*) filter (where registration_status='awaiting'),
    count(*) filter (where registration_status='cancelled')
  into participant_count, staff_count, approved_count, awaiting_count, cancelled_count
  from pg_temp.final_registration_stage;

  select count(*) into manual_staff_before
  from public.staff st
  where st.session_id=p_session_id and st.source_record_key is null;

  select count(*) into account_links_before
  from public.staff_account_links sal
  where sal.session_id=p_session_id;

  select count(*) into active_access_before
  from public.access_assignments aa
  where aa.session_id=p_session_id and aa.active;

  select count(*) into companies_reset from public.companies c where c.session_id=p_session_id;
  select count(*) into groups_reset from public.counselor_groups g where g.session_id=p_session_id;
  select count(*) into badges_reset from public.participant_badge_assignments b where b.session_id=p_session_id;
  select count(*) into checkins_reset from public.check_ins ci where ci.session_id=p_session_id;
  select count(*) into headcount_rounds_reset from public.headcount_rounds hr where hr.session_id=p_session_id;
  select count(*) into housing_assignments_reset from public.housing_assignments ha where ha.session_id=p_session_id;

  insert into public.import_batches(
    session_id, imported_by, source_filename, source_sha256, import_mode,
    record_count, participant_count, staff_count, status
  )
  values(
    p_session_id, auth.uid(), trim(p_source_filename), lower(p_source_sha256), 'final',
    participant_count + staff_count, participant_count, staff_count, 'validated'
  )
  returning id into batch_id;

  delete from public.participant_badge_id_history h where h.session_id=p_session_id;
  update public.participant_badge_assignments b set replacement_for=null where b.session_id=p_session_id;
  delete from public.participant_badge_assignments b where b.session_id=p_session_id;

  delete from public.headcount_person_statuses h where h.session_id=p_session_id;
  delete from public.headcount_round_people h where h.session_id=p_session_id;
  delete from public.headcount_submissions hs
    using public.headcount_rounds hr
    where hs.round_id=hr.id and hr.session_id=p_session_id;
  delete from public.headcount_rounds hr where hr.session_id=p_session_id;

  delete from public.check_ins ci where ci.session_id=p_session_id;
  delete from public.participant_arrival_events pae where pae.session_id=p_session_id;

  delete from public.meal_attendance ma where ma.session_id=p_session_id;
  delete from public.meal_services ms where ms.session_id=p_session_id;
  delete from public.food_acknowledgements fa where fa.session_id=p_session_id;
  delete from public.birthday_acknowledgements ba where ba.session_id=p_session_id;
  delete from public.staff_birthday_acknowledgements sba where sba.session_id=p_session_id;
  delete from public.wellness_encounters we where we.session_id=p_session_id;

  delete from public.housing_assignments ha where ha.session_id=p_session_id;

  delete from public.staff_company_assignments sca where sca.session_id=p_session_id;
  update public.staff st set assigned_company_id=null where st.session_id=p_session_id;
  update public.participants p set group_id=null, updated_at=now() where p.session_id=p_session_id;

  update public.access_assignments aa
    set company_ids='{}'::uuid[]
    where aa.session_id=p_session_id and cardinality(aa.company_ids)>0;
  update public.access_requests ar
    set company_ids='{}'::uuid[]
    where ar.session_id=p_session_id and cardinality(ar.company_ids)>0;
  update public.leader_invites li
    set company_ids='{}'::uuid[]
    where li.session_id=p_session_id and cardinality(li.company_ids)>0
      and li.status in ('pending','activating');

  delete from public.counselor_groups cg where cg.session_id=p_session_id;
  delete from public.companies c where c.session_id=p_session_id;

  create temporary table final_participant_map(
    source_record_key text primary key,
    target_id uuid unique not null,
    matched_existing boolean not null default false
  ) on commit drop;

  create temporary table final_staff_map(
    source_record_key text primary key,
    target_id uuid unique not null,
    matched_existing boolean not null default false
  ) on commit drop;

  insert into pg_temp.final_participant_map(source_record_key,target_id,matched_existing)
  select s.source_record_key, p.id, true
  from pg_temp.final_registration_stage s
  join public.participants p
    on p.session_id=p_session_id and p.source_record_key=s.source_record_key
  where s.person_type='participant';

  with stage_unique as (
    select identity_key, min(source_record_key) as source_record_key
    from pg_temp.final_registration_stage
    where person_type='participant'
    group by identity_key
    having count(*)=1
  ),
  existing_unique as (
    select private.final_roster_identity_key(
             'participant', p.first_name, p.last_name, ppd.date_of_birth, p.sex::text
           ) as identity_key,
           min(p.id) as target_id
    from public.participants p
    left join public.participant_private_details ppd on ppd.participant_id=p.id
    where p.session_id=p_session_id and p.source_record_key is not null
    group by 1
    having count(*)=1
  )
  insert into pg_temp.final_participant_map(source_record_key,target_id,matched_existing)
  select su.source_record_key, eu.target_id, true
  from stage_unique su
  join existing_unique eu on eu.identity_key=su.identity_key
  where not exists (
          select 1 from pg_temp.final_participant_map m where m.source_record_key=su.source_record_key
        )
    and not exists (
          select 1 from pg_temp.final_participant_map m where m.target_id=eu.target_id
        );

  insert into pg_temp.final_participant_map(source_record_key,target_id,matched_existing)
  select s.source_record_key, extensions.gen_random_uuid(), false
  from pg_temp.final_registration_stage s
  where s.person_type='participant'
    and not exists (
      select 1 from pg_temp.final_participant_map m where m.source_record_key=s.source_record_key
    );

  insert into pg_temp.final_staff_map(source_record_key,target_id,matched_existing)
  select s.source_record_key, st.id, true
  from pg_temp.final_registration_stage s
  join public.staff st
    on st.session_id=p_session_id and st.source_record_key=s.source_record_key
  where s.person_type='counselor';

  with stage_unique as (
    select identity_key, min(source_record_key) as source_record_key
    from pg_temp.final_registration_stage
    where person_type='counselor'
    group by identity_key
    having count(*)=1
  ),
  existing_unique as (
    select private.final_roster_identity_key(
             'counselor', st.first_name, st.last_name, spd.date_of_birth, st.sex::text
           ) as identity_key,
           min(st.id) as target_id
    from public.staff st
    left join public.staff_private_details spd on spd.staff_id=st.id
    where st.session_id=p_session_id and st.source_record_key is not null
    group by 1
    having count(*)=1
  )
  insert into pg_temp.final_staff_map(source_record_key,target_id,matched_existing)
  select su.source_record_key, eu.target_id, true
  from stage_unique su
  join existing_unique eu on eu.identity_key=su.identity_key
  where not exists (
          select 1 from pg_temp.final_staff_map m where m.source_record_key=su.source_record_key
        )
    and not exists (
          select 1 from pg_temp.final_staff_map m where m.target_id=eu.target_id
        );

  insert into pg_temp.final_staff_map(source_record_key,target_id,matched_existing)
  select s.source_record_key, extensions.gen_random_uuid(), false
  from pg_temp.final_registration_stage s
  where s.person_type='counselor'
    and not exists (
      select 1 from pg_temp.final_staff_map m where m.source_record_key=s.source_record_key
    );

  select count(*) into matched_participants
  from pg_temp.final_participant_map m where m.matched_existing;
  select count(*) into matched_staff
  from pg_temp.final_staff_map m where m.matched_existing;

  update public.participants p
  set
    import_batch_id=batch_id,
    last_seen_batch_id=batch_id,
    registration_id='FINAL-' || substr(s.source_record_key,1,24),
    source_record_key=s.source_record_key,
    first_name=coalesce(s.first_name,''),
    last_name=coalesce(s.last_name,''),
    preferred_name=s.preferred_name,
    sex=s.sex::public.participant_sex,
    age=s.age,
    unit_name=coalesce(s.unit_name,''),
    stake_name=s.stake_name,
    source_kind='imported',
    registration_status=s.registration_status,
    verification_status='verified',
    is_current=true,
    reconciliation_status='current',
    source_registered_at=s.source_registered_at,
    attendance_status='expected',
    attendance_note=null,
    attendance_updated_by=null,
    attendance_updated_at=null,
    group_id=null,
    updated_at=now()
  from pg_temp.final_registration_stage s
  join pg_temp.final_participant_map m on m.source_record_key=s.source_record_key
  where p.id=m.target_id and m.matched_existing;

  insert into public.participants(
    id, session_id, import_batch_id, last_seen_batch_id, registration_id,
    source_record_key, first_name, last_name, preferred_name, sex, age,
    unit_name, stake_name, source_kind, registration_status,
    verification_status, is_current, reconciliation_status, source_registered_at,
    attendance_status
  )
  select
    m.target_id, p_session_id, batch_id, batch_id,
    'FINAL-' || substr(s.source_record_key,1,24),
    s.source_record_key, coalesce(s.first_name,''), coalesce(s.last_name,''),
    s.preferred_name, s.sex::public.participant_sex, s.age,
    coalesce(s.unit_name,''), s.stake_name, 'imported', s.registration_status,
    'verified', true, 'current', s.source_registered_at, 'expected'
  from pg_temp.final_registration_stage s
  join pg_temp.final_participant_map m on m.source_record_key=s.source_record_key
  where s.person_type='participant' and not m.matched_existing;

  insert into public.participant_private_details(
    participant_id, session_id, date_of_birth, email, phone,
    medical_information, dietary_information, tshirt_size,
    contact_1_name, contact_1_email, contact_1_phone,
    contact_2_name, contact_2_email, contact_2_phone,
    bishop_name, bishop_email
  )
  select
    m.target_id, p_session_id, s.birthday, s.email, s.phone,
    s.medical_information, s.dietary_information, s.tshirt_size,
    s.contact_1_name, s.contact_1_email, s.contact_1_phone,
    s.contact_2_name, s.contact_2_email, s.contact_2_phone,
    s.bishop_name, s.bishop_email
  from pg_temp.final_registration_stage s
  join pg_temp.final_participant_map m on m.source_record_key=s.source_record_key
  where s.person_type='participant'
  on conflict(participant_id) do update set
    date_of_birth=excluded.date_of_birth,
    email=excluded.email,
    phone=excluded.phone,
    medical_information=excluded.medical_information,
    dietary_information=excluded.dietary_information,
    tshirt_size=excluded.tshirt_size,
    contact_1_name=excluded.contact_1_name,
    contact_1_email=excluded.contact_1_email,
    contact_1_phone=excluded.contact_1_phone,
    contact_2_name=excluded.contact_2_name,
    contact_2_email=excluded.contact_2_email,
    contact_2_phone=excluded.contact_2_phone,
    bishop_name=excluded.bishop_name,
    bishop_email=excluded.bishop_email,
    updated_at=now();

  update public.staff st
  set
    full_name=coalesce(
      nullif(trim(concat_ws(' ',s.first_name,s.last_name)),''),
      s.preferred_name,
      'Counselor'
    ),
    first_name=s.first_name,
    last_name=s.last_name,
    preferred_name=s.preferred_name,
    sex=s.sex::public.participant_sex,
    age=s.age,
    unit_name=s.unit_name,
    stake_name=s.stake_name,
    staff_role='counselor',
    source_record_key=s.source_record_key,
    source_kind='imported',
    registration_status=s.registration_status,
    is_current=true,
    source_registered_at=s.source_registered_at,
    last_seen_batch_id=batch_id,
    assigned_company_id=null
  from pg_temp.final_registration_stage s
  join pg_temp.final_staff_map m on m.source_record_key=s.source_record_key
  where st.id=m.target_id and m.matched_existing;

  insert into public.staff(
    id, session_id, full_name, first_name, last_name, preferred_name, sex, age,
    unit_name, stake_name, staff_role, operational_role, source_record_key,
    source_kind, registration_status, is_current, source_registered_at,
    last_seen_batch_id, assigned_company_id
  )
  select
    m.target_id, p_session_id,
    coalesce(nullif(trim(concat_ws(' ',s.first_name,s.last_name)),''),s.preferred_name,'Counselor'),
    s.first_name, s.last_name, s.preferred_name, s.sex::public.participant_sex, s.age,
    s.unit_name, s.stake_name, 'counselor', 'counselor', s.source_record_key,
    'imported', s.registration_status, true, s.source_registered_at, batch_id, null
  from pg_temp.final_registration_stage s
  join pg_temp.final_staff_map m on m.source_record_key=s.source_record_key
  where s.person_type='counselor' and not m.matched_existing;

  insert into public.staff_private_details(
    staff_id, session_id, date_of_birth, email, phone, medical_information,
    dietary_information, tshirt_size, contact_1_name, contact_1_email, contact_1_phone
  )
  select
    m.target_id, p_session_id, s.birthday, s.email, s.phone, s.medical_information,
    s.dietary_information, s.tshirt_size, s.contact_1_name, s.contact_1_email, s.contact_1_phone
  from pg_temp.final_registration_stage s
  join pg_temp.final_staff_map m on m.source_record_key=s.source_record_key
  where s.person_type='counselor'
  on conflict(staff_id) do update set
    date_of_birth=excluded.date_of_birth,
    email=excluded.email,
    phone=excluded.phone,
    medical_information=excluded.medical_information,
    dietary_information=excluded.dietary_information,
    tshirt_size=excluded.tshirt_size,
    contact_1_name=excluded.contact_1_name,
    contact_1_email=excluded.contact_1_email,
    contact_1_phone=excluded.contact_1_phone,
    updated_at=now();

  update public.participants p
  set is_current=false,
      reconciliation_status='omitted',
      group_id=null,
      attendance_status='expected',
      attendance_note=null,
      attendance_updated_by=null,
      attendance_updated_at=null,
      updated_at=now()
  where p.session_id=p_session_id
    and (
      (p.source_kind='imported' and p.source_record_key is not null)
      or p.source_kind='on_site'
    )
    and not exists (
      select 1 from pg_temp.final_participant_map m where m.target_id=p.id
    );
  get diagnostics retired_participants = row_count;

  update public.staff st
  set is_current=false,
      assigned_company_id=null
  where st.session_id=p_session_id
    and st.source_record_key is not null
    and not exists (
      select 1 from pg_temp.final_staff_map m where m.target_id=st.id
    );
  get diagnostics retired_staff = row_count;

  insert into public.session_structure_settings(
    session_id, group_min_size, group_max_size, groups_per_company,
    use_age_bands, avoid_same_unit, balance_sexes,
    participant_min_age, participant_max_age,
    companies_per_assistant_coordinator, updated_by, updated_at
  )
  values(
    p_session_id, 8, 10, 3, true, true, true, 13, 18, 4, auth.uid(), now()
  )
  on conflict(session_id) do update set
    group_min_size=excluded.group_min_size,
    group_max_size=excluded.group_max_size,
    groups_per_company=excluded.groups_per_company,
    use_age_bands=excluded.use_age_bands,
    avoid_same_unit=excluded.avoid_same_unit,
    balance_sexes=excluded.balance_sexes,
    participant_min_age=excluded.participant_min_age,
    participant_max_age=excluded.participant_max_age,
    companies_per_assistant_coordinator=excluded.companies_per_assistant_coordinator,
    updated_by=excluded.updated_by,
    updated_at=excluded.updated_at;

  update public.import_batches
  set status='applied',
      omitted_count=retired_participants + retired_staff,
      exception_count=0
  where id=batch_id;

  select count(*) into manual_staff_after
  from public.staff st
  where st.session_id=p_session_id and st.source_record_key is null;

  select count(*) into account_links_after
  from public.staff_account_links sal
  where sal.session_id=p_session_id;

  select count(*) into active_access_after
  from public.access_assignments aa
  where aa.session_id=p_session_id and aa.active;

  if manual_staff_after <> manual_staff_before then
    raise exception 'Safety check failed: manually created Staff changed during final roster import';
  end if;

  if account_links_after <> account_links_before then
    raise exception 'Safety check failed: Staff account links changed during final roster import';
  end if;

  if active_access_after <> active_access_before then
    raise exception 'Safety check failed: active Access accounts changed during final roster import';
  end if;

  if (
    select count(*)
    from public.participants p
    where p.session_id=p_session_id and p.is_current
      and p.source_kind='imported' and p.last_seen_batch_id=batch_id
  ) <> participant_count then
    raise exception 'Safety check failed: participant total does not match the resolved final roster';
  end if;

  if (
    select count(*)
    from public.staff st
    where st.session_id=p_session_id and st.is_current
      and st.source_record_key is not null and st.last_seen_batch_id=batch_id
  ) <> staff_count then
    raise exception 'Safety check failed: counselor total does not match the resolved final roster';
  end if;

  insert into public.audit_events(
    session_id, actor_id, action, entity_type, entity_id, metadata
  )
  values(
    p_session_id, auth.uid(), 'final_registration_baseline_applied',
    'import_batch', batch_id::text,
    jsonb_build_object(
      'source_sha256', lower(p_source_sha256),
      'record_count', participant_count + staff_count,
      'participant_count', participant_count,
      'staff_count', staff_count,
      'approved_count', approved_count,
      'awaiting_count', awaiting_count,
      'cancelled_count', cancelled_count,
      'matched_participants', matched_participants,
      'matched_staff', matched_staff,
      'retired_participants', retired_participants,
      'retired_staff', retired_staff,
      'manual_staff_preserved', manual_staff_after,
      'account_links_preserved', account_links_after,
      'companies_reset', companies_reset,
      'groups_reset', groups_reset,
      'badges_reset', badges_reset,
      'checkins_reset', checkins_reset,
      'headcount_rounds_reset', headcount_rounds_reset,
      'housing_assignments_reset', housing_assignments_reset
    )
  );

  return jsonb_build_object(
    'batch_id', batch_id,
    'record_count', participant_count + staff_count,
    'participant_count', participant_count,
    'staff_count', staff_count,
    'approved_count', approved_count,
    'awaiting_count', awaiting_count,
    'cancelled_count', cancelled_count,
    'matched_participants', matched_participants,
    'matched_staff', matched_staff,
    'retired_participants', retired_participants,
    'retired_staff', retired_staff,
    'manual_staff_preserved', manual_staff_after,
    'account_links_preserved', account_links_after,
    'companies_reset', companies_reset,
    'groups_reset', groups_reset,
    'badges_reset', badges_reset,
    'checkins_reset', checkins_reset,
    'headcount_rounds_reset', headcount_rounds_reset,
    'housing_assignments_reset', housing_assignments_reset
  );
end;
$$;

revoke all on function public.apply_final_registration_baseline(uuid,text,text,jsonb) from public, anon;
grant execute on function public.apply_final_registration_baseline(uuid,text,text,jsonb) to authenticated, service_role;

create or replace function public.publish_grouping_plan(p_session_id uuid, p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  company_item jsonb;
  group_item jsonb;
  new_company_id uuid;
  new_group_id uuid;
  participant_total integer;
  supplied_total integer;
  distinct_total integer;
  company_count integer;
  group_count integer:=0;
  company_index integer:=0;
  min_size integer;
  max_size integer;
  groups_target integer;
  use_bands boolean;
  avoid_units boolean;
  min_age integer;
  max_age integer;
  had_plan boolean:=false;
  session_status text;
  colors text[]:=array['#005175','#007DA5','#8DBF67','#FCB449'];
begin
  if not private.can_manage_access(p_session_id) then
    raise exception 'Administrative access is required to publish groups';
  end if;
  if jsonb_typeof(p_plan)<>'array' then
    raise exception 'Grouping plan must be an array';
  end if;

  select s.status into session_status from public.sessions s where s.id=p_session_id;
  if session_status is null then raise exception 'Session not found'; end if;

  select group_min_size,group_max_size,groups_per_company,use_age_bands,avoid_same_unit,
         participant_min_age,participant_max_age
  into min_size,max_size,groups_target,use_bands,avoid_units,min_age,max_age
  from public.session_structure_settings where session_id=p_session_id;

  min_size:=coalesce(min_size,8);
  max_size:=coalesce(max_size,10);
  groups_target:=coalesce(groups_target,2);
  use_bands:=coalesce(use_bands,false);
  avoid_units:=coalesce(avoid_units,true);
  min_age:=coalesce(min_age,13);
  max_age:=coalesce(max_age,18);

  company_count:=jsonb_array_length(p_plan);
  if company_count<1 or company_count>500 then
    raise exception 'Grouping plan must contain between 1 and 500 companies';
  end if;

  select exists(select 1 from public.counselor_groups where session_id=p_session_id)
      or exists(select 1 from public.companies where session_id=p_session_id)
  into had_plan;

  if had_plan and session_status<>'planning'
     and exists(select 1 from public.check_ins where session_id=p_session_id and status='arrived') then
    raise exception 'Undo active check-ins before replacing the published structure';
  end if;

  if had_plan and session_status<>'planning'
     and exists(
       select 1 from public.headcount_submissions hs
       join public.headcount_rounds hr on hr.id=hs.round_id
       where hr.session_id=p_session_id
     ) then
    raise exception 'A head-count submission exists, so the published structure can no longer be replaced';
  end if;

  if exists(
    select 1
    from jsonb_array_elements(p_plan)c(item)
    where jsonb_typeof(c.item->'groups')<>'array'
       or jsonb_array_length(c.item->'groups')<1
       or jsonb_array_length(c.item->'groups')>groups_target
       or nullif(trim(c.item->>'name'),'') is null
  ) then
    raise exception 'Each company needs a name and no more than the configured number of counselor groups';
  end if;

  if exists(
    select 1
    from jsonb_array_elements(p_plan)c(item)
    cross join lateral jsonb_array_elements(c.item->'groups')g(item)
    where nullif(trim(g.item->>'name'),'') is null
       or lower(g.item->>'sex') not in('female','male')
       or jsonb_typeof(g.item->'participant_ids')<>'array'
       or jsonb_array_length(g.item->'participant_ids') not between min_size and max_size
  ) then
    raise exception 'A counselor group does not match the current group-size rules';
  end if;

  select count(*) into participant_total
  from public.participants p
  where p.session_id=p_session_id
    and p.is_current
    and p.registration_status='approved'
    and p.verification_status='verified'
    and p.age between min_age and max_age;

  with supplied as(
    select (jsonb_array_elements_text(g.item->'participant_ids'))::uuid participant_id
    from jsonb_array_elements(p_plan)c(item)
    cross join lateral jsonb_array_elements(c.item->'groups')g(item)
  )
  select count(*),count(distinct participant_id)
  into supplied_total,distinct_total
  from supplied;

  if participant_total=0 or supplied_total<>participant_total or distinct_total<>participant_total then
    raise exception 'Every operationally eligible youth participant must be assigned exactly once';
  end if;

  if exists(
    with supplied as(
      select (jsonb_array_elements_text(g.item->'participant_ids'))::uuid participant_id
      from jsonb_array_elements(p_plan)c(item)
      cross join lateral jsonb_array_elements(c.item->'groups')g(item)
    )
    select 1
    from supplied s
    left join public.participants p
      on p.id=s.participant_id and p.session_id=p_session_id
    where p.id is null
       or not p.is_current
       or p.registration_status<>'approved'
       or p.verification_status<>'verified'
       or p.age not between min_age and max_age
  ) then
    raise exception 'Grouping plan contains a participant outside the operational youth eligibility rules';
  end if;

  if avoid_units and exists(
    select 1
    from jsonb_array_elements(p_plan) with ordinality c(item,company_no)
    cross join lateral jsonb_array_elements(c.item->'groups') with ordinality g(item,group_no)
    cross join lateral jsonb_array_elements_text(g.item->'participant_ids') member(value)
    join public.participants p on p.id=member.value::uuid
    group by company_no,group_no,lower(trim(p.unit_name))
    having count(*)>1
  ) then
    raise exception 'A counselor group contains youth from the same unit';
  end if;

  if exists(
    select 1
    from jsonb_array_elements(p_plan)c(item)
    cross join lateral jsonb_array_elements(c.item->'groups')g(item)
    cross join lateral jsonb_array_elements_text(g.item->'participant_ids') member(value)
    join public.participants p on p.id=member.value::uuid
    where p.sex::text<>lower(g.item->>'sex')
  ) then
    raise exception 'A counselor group mixes participant sexes';
  end if;

  if use_bands and exists(
    select 1
    from jsonb_array_elements(p_plan) with ordinality c(item,company_no)
    cross join lateral jsonb_array_elements(c.item->'groups')g(item)
    cross join lateral jsonb_array_elements_text(g.item->'participant_ids') member(value)
    join public.participants p on p.id=member.value::uuid
    group by company_no
    having count(distinct case
      when p.age between 13 and 15 then '13-15'
      when p.age between 16 and 18 then '16-18'
      else 'other'
    end)>1
  ) then
    raise exception 'A company mixes configured age bands';
  end if;

  if had_plan then
    delete from public.staff_company_assignments where session_id=p_session_id;
    update public.staff set assigned_company_id=null where session_id=p_session_id;
    update public.participants set group_id=null,updated_at=now() where session_id=p_session_id;
    delete from public.counselor_groups where session_id=p_session_id;
    delete from public.companies where session_id=p_session_id;
  end if;

  for company_item in select value from jsonb_array_elements(p_plan) loop
    company_index:=company_index+1;
    new_company_id:=extensions.gen_random_uuid();
    insert into public.companies(
      id,session_id,name,color,custom_name,scripture_reference,meeting_spot
    )
    values(
      new_company_id,p_session_id,trim(company_item->>'name'),
      colors[1+((company_index-1)%cardinality(colors))],
      nullif(trim(coalesce(company_item->>'custom_name','')),''),
      nullif(trim(coalesce(company_item->>'scripture_reference','')),''),
      nullif(trim(coalesce(company_item->>'meeting_spot','')),'')
    );

    for group_item in select value from jsonb_array_elements(company_item->'groups') loop
      group_count:=group_count+1;
      new_group_id:=extensions.gen_random_uuid();
      insert into public.counselor_groups(
        id,session_id,company_id,name,sex,state,custom_name
      )
      values(
        new_group_id,p_session_id,new_company_id,trim(group_item->>'name'),
        lower(group_item->>'sex')::public.participant_sex,'published',
        nullif(trim(coalesce(group_item->>'custom_name','')),'')
      );
      update public.participants p
      set group_id=new_group_id,updated_at=now()
      where p.session_id=p_session_id
        and p.id in(
          select value::uuid from jsonb_array_elements_text(group_item->'participant_ids')
        );
    end loop;
  end loop;

  insert into public.audit_events(
    session_id,actor_id,action,entity_type,entity_id,metadata
  )
  values(
    p_session_id,auth.uid(),
    case when had_plan then 'grouping_plan_republished' else 'grouping_plan_published' end,
    'session',p_session_id::text,
    jsonb_build_object(
      'company_count',company_count,
      'group_count',group_count,
      'participant_count',participant_total,
      'groups_per_company',groups_target,
      'participant_min_age',min_age,
      'participant_max_age',max_age,
      'session_status',session_status
    )
  );

  return jsonb_build_object(
    'company_count',company_count,
    'group_count',group_count,
    'participant_count',participant_total,
    'replaced',had_plan
  );
end;
$$;