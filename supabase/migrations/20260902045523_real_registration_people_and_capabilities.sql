-- Real registration data, explicit coordinator capability overrides, birthdays,
-- and a safe day-of participant workflow.

alter table public.access_assignments
  add column if not exists capabilities text[] not null default '{}';

alter table public.access_assignments
  drop constraint if exists access_assignments_capabilities_check;
alter table public.access_assignments
  add constraint access_assignments_capabilities_check
  check (capabilities <@ array['access_admin']::text[]);

drop function if exists public.my_access_state();
create function public.my_access_state()
returns table (
  session_id uuid, session_name text, session_status text, role public.app_role,
  active boolean, capabilities text[], request_status public.access_request_status,
  requested_role public.app_role, requested_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select * from (
    select s.id as session_id, s.name as session_name, s.status as session_status,
      aa.role as role, aa.active as active, aa.capabilities as capabilities,
      null::public.access_request_status as request_status,
      null::public.app_role as requested_role, null::timestamptz as requested_at
    from public.access_assignments aa join public.sessions s on s.id=aa.session_id
    where aa.user_id=(select auth.uid()) and aa.active
    union all
    select s.id, s.name, s.status, null::public.app_role, false, '{}'::text[],
      ar.status, ar.requested_role, ar.requested_at
    from public.access_requests ar join public.sessions s on s.id=ar.session_id
    where ar.requested_by=(select auth.uid()) and ar.status='pending'
      and not exists (select 1 from public.access_assignments aa2
        where aa2.session_id=ar.session_id and aa2.user_id=(select auth.uid()) and aa2.active)
  ) access_state order by active desc, requested_at desc nulls last;
$$;
revoke all on function public.my_access_state() from public, anon;
grant execute on function public.my_access_state() to authenticated;

create or replace function private.has_session_role(target_session uuid, allowed public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.access_assignments aa
    where aa.session_id = target_session
      and aa.user_id = (select auth.uid())
      and aa.active
      and (
        aa.role = any(allowed)
        or (
          aa.role = 'coordinator'
          and 'access_admin' = any(aa.capabilities)
          and 'logistics_admin' = any(allowed)
        )
      )
  );
$$;

create or replace function private.can_manage_access(target_session uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.access_assignments aa
    where aa.session_id = target_session
      and aa.user_id = (select auth.uid())
      and aa.active
      and (
        aa.role in ('logistics_admin', 'session_director')
        or (aa.role = 'coordinator' and 'access_admin' = any(aa.capabilities))
      )
  );
$$;

create or replace function private.is_top_access_admin(target_session uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.access_assignments aa
    where aa.session_id = target_session
      and aa.user_id = (select auth.uid())
      and aa.active
      and aa.role in ('logistics_admin','session_director')
  );
$$;

create or replace function private.can_access_company(target_session uuid, target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.access_assignments aa
    where aa.session_id = target_session
      and aa.user_id = (select auth.uid())
      and aa.active
      and (
        aa.role in ('coordinator','logistics_admin','session_director')
        or target_company = any(aa.company_ids)
      )
  );
$$;

revoke all on function private.can_manage_access(uuid) from public;
revoke all on function private.is_top_access_admin(uuid) from public;
grant execute on function private.can_manage_access(uuid) to authenticated;
grant execute on function private.is_top_access_admin(uuid) to authenticated;

create or replace function public.set_coordinator_admin_override(
  p_assignment_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.access_assignments%rowtype;
begin
  select * into target
  from public.access_assignments
  where id = p_assignment_id
  for update;

  if target.id is null then
    raise exception 'Access assignment not found';
  end if;
  if not private.is_top_access_admin(target.session_id) then
    raise exception 'Only a logistical administrator or session directing couple can change this capability';
  end if;
  if target.role <> 'coordinator' then
    raise exception 'Administrative access can only be added to a Coordinator';
  end if;
  if target.user_id = (select auth.uid()) then
    raise exception 'You cannot change your own administrative capability';
  end if;

  update public.access_assignments
  set capabilities = case
    when p_enabled then array(select distinct unnest(capabilities || array['access_admin']))
    else array_remove(capabilities, 'access_admin')
  end
  where id = target.id;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target.session_id,
    (select auth.uid()),
    case when p_enabled then 'coordinator_admin_granted' else 'coordinator_admin_revoked' end,
    'access_assignment',
    target.id::text,
    jsonb_build_object('subject_user_id', target.user_id, 'displayed_role', target.role)
  );
end;
$$;

revoke all on function public.set_coordinator_admin_override(uuid, boolean) from public, anon;
grant execute on function public.set_coordinator_admin_override(uuid, boolean) to authenticated;
revoke insert, update, delete on public.access_assignments from authenticated;
revoke insert on public.audit_events from authenticated;

-- Source and reconciliation state. Existing synthetic/dev rows remain usable.
alter table public.participants drop constraint if exists participants_age_check;
alter table public.participants
  add constraint participants_age_check check (age is null or age between 0 and 120);
alter table public.participants
  add column if not exists preferred_name text,
  add column if not exists stake_name text,
  add column if not exists source_record_key text,
  add column if not exists source_kind text not null default 'imported',
  add column if not exists registration_status text not null default 'approved',
  add column if not exists verification_status text not null default 'verified',
  add column if not exists is_current boolean not null default true,
  add column if not exists reconciliation_status text not null default 'current',
  add column if not exists source_registered_at timestamp,
  add column if not exists last_seen_batch_id uuid references public.import_batches(id) on delete set null,
  add column if not exists verified_by uuid references public.profiles(user_id) on delete set null,
  add column if not exists verified_at timestamptz;

alter table public.participants
  drop constraint if exists participants_source_kind_check;
alter table public.participants add constraint participants_source_kind_check
  check (source_kind in ('imported','on_site'));
alter table public.participants
  drop constraint if exists participants_registration_status_check;
alter table public.participants add constraint participants_registration_status_check
  check (registration_status in ('approved','awaiting','cancelled'));
alter table public.participants
  drop constraint if exists participants_verification_status_check;
alter table public.participants add constraint participants_verification_status_check
  check (verification_status in ('verified','pending','rejected'));
alter table public.participants
  drop constraint if exists participants_reconciliation_status_check;
alter table public.participants add constraint participants_reconciliation_status_check
  check (reconciliation_status in ('current','missing_from_latest','omitted'));

alter table public.staff
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists preferred_name text,
  add column if not exists sex public.participant_sex,
  add column if not exists age integer check (age is null or age between 0 and 120),
  add column if not exists unit_name text,
  add column if not exists stake_name text,
  add column if not exists source_record_key text,
  add column if not exists registration_status text not null default 'approved',
  add column if not exists is_current boolean not null default true,
  add column if not exists source_registered_at timestamp,
  add column if not exists last_seen_batch_id uuid references public.import_batches(id) on delete set null;

alter table public.staff drop constraint if exists staff_registration_status_check;
alter table public.staff add constraint staff_registration_status_check
  check (registration_status in ('approved','awaiting','cancelled'));

alter table public.import_batches
  add column if not exists source_sha256 text,
  add column if not exists import_mode text not null default 'snapshot',
  add column if not exists participant_count integer not null default 0,
  add column if not exists staff_count integer not null default 0,
  add column if not exists omitted_count integer not null default 0,
  add column if not exists exception_count integer not null default 0;

create unique index if not exists participants_session_source_key_idx
  on public.participants(session_id, source_record_key)
  where source_record_key is not null;
create unique index if not exists staff_session_source_key_idx
  on public.staff(session_id, source_record_key)
  where source_record_key is not null;
create index if not exists participants_session_operational_idx
  on public.participants(session_id, is_current, registration_status, verification_status, group_id);
create index if not exists staff_session_current_idx
  on public.staff(session_id, is_current, registration_status);
create index if not exists leader_invites_created_by_idx on public.leader_invites(created_by);
create index if not exists leader_invites_redeemed_by_idx on public.leader_invites(redeemed_by);
create unique index if not exists import_batches_session_source_sha_applied_idx
  on public.import_batches(session_id, source_sha256)
  where source_sha256 is not null and status = 'applied';

-- Sensitive source fields are deliberately kept out of the broadly readable
-- people tables. Access admins can read them; all writes use narrow RPCs.
create table if not exists public.participant_private_details (
  participant_id uuid primary key references public.participants(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  date_of_birth date,
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
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_private_details (
  staff_id uuid primary key references public.staff(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  date_of_birth date,
  email text,
  phone text,
  medical_information text,
  dietary_information text,
  tshirt_size text,
  contact_1_name text,
  contact_1_email text,
  contact_1_phone text,
  updated_at timestamptz not null default now()
);

alter table public.participant_private_details enable row level security;
alter table public.staff_private_details enable row level security;
revoke all on public.participant_private_details, public.staff_private_details from anon, authenticated;
grant select on public.participant_private_details, public.staff_private_details to authenticated;

create policy "access admins read participant private details"
  on public.participant_private_details for select to authenticated
  using (private.can_manage_access(session_id));
create policy "access admins read staff private details"
  on public.staff_private_details for select to authenticated
  using (private.can_manage_access(session_id));

-- Coordinators are whole-session operational users. They can see unassigned
-- youth as well as assigned companies, but still cannot manage access unless a
-- top leader grants the explicit capability above.
drop policy if exists "members read scoped participants" on public.participants;
create policy "members read scoped participants" on public.participants for select to authenticated
  using (
    private.has_session_role(session_id, array['coordinator','logistics_admin','session_director']::public.app_role[])
    or exists (
      select 1 from public.counselor_groups g
      where g.id = participants.group_id
        and private.can_access_company(participants.session_id, g.company_id)
    )
  );

drop policy if exists "session access managers read invites" on public.leader_invites;
create policy "session access managers read invites" on public.leader_invites for select to authenticated
  using (private.can_manage_access(session_id));

drop policy if exists "top leaders read audit" on public.audit_events;
drop policy if exists "session-wide leaders read audit" on public.audit_events;
create policy "access managers read audit" on public.audit_events for select to authenticated
  using (private.can_manage_access(session_id));

-- Snapshot importer. The browser supplies only opaque source keys; raw source
-- identity material is never stored in the public people rows.
create or replace function public.apply_registration_snapshot(
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
  batch_id uuid;
  total_count integer;
  youth_count integer;
  leader_count integer;
  omitted integer := 0;
  exceptions integer := 0;
begin
  if not private.can_manage_access(p_session_id) then
    raise exception 'Only an access administrator can apply a registration snapshot';
  end if;
  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'Registration payload must be an array';
  end if;
  total_count := jsonb_array_length(p_records);
  if total_count < 1 or total_count > 5000 then
    raise exception 'Registration snapshot must contain between 1 and 5000 rows';
  end if;
  if p_source_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid source file fingerprint is required';
  end if;

  create temporary table if not exists registration_snapshot_stage (
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
  ) on commit drop;
  truncate registration_snapshot_stage;

  insert into registration_snapshot_stage
  select * from jsonb_to_recordset(p_records) as x(
    source_record_key text, person_type text, first_name text, last_name text,
    preferred_name text, birthday date, sex text, age integer, unit_name text,
    stake_name text, registration_status text, source_registered_at timestamp,
    email text, phone text, medical_information text, dietary_information text,
    tshirt_size text, contact_1_name text, contact_1_email text,
    contact_1_phone text, contact_2_name text, contact_2_email text,
    contact_2_phone text, bishop_name text, bishop_email text
  );

  if exists (
    select 1 from registration_snapshot_stage s
    where s.source_record_key !~ '^[0-9a-f]{64}$'
       or lower(trim(s.person_type)) not in ('participant','counselor')
       or lower(trim(s.sex)) not in ('female','male')
       or lower(trim(s.registration_status)) not in ('approved','awaiting','cancelled')
       or s.birthday is null
       or s.age is null or s.age not between 0 and 120
  ) then
    raise exception 'One or more rows failed registration validation';
  end if;
  if (select count(*) from registration_snapshot_stage)
     <> (select count(distinct source_record_key) from registration_snapshot_stage) then
    raise exception 'Duplicate source identities exist inside this snapshot';
  end if;

  select count(*) filter (where lower(trim(person_type)) = 'participant'),
         count(*) filter (where lower(trim(person_type)) = 'counselor')
  into youth_count, leader_count
  from registration_snapshot_stage;

  insert into public.import_batches(
    session_id, imported_by, source_filename, source_sha256, record_count,
    participant_count, staff_count, status
  ) values (
    p_session_id, (select auth.uid()),
    coalesce(nullif(trim(p_source_filename), ''), 'registration-snapshot'),
    lower(p_source_sha256), total_count, youth_count, leader_count, 'validated'
  ) returning id into batch_id;

  insert into public.participants(
    session_id, import_batch_id, last_seen_batch_id, registration_id,
    source_record_key, first_name, last_name, preferred_name, sex, age,
    unit_name, stake_name, source_kind, registration_status,
    verification_status, is_current, reconciliation_status, source_registered_at
  )
  select p_session_id, batch_id, batch_id,
    'SRC-' || substr(s.source_record_key, 1, 24), s.source_record_key,
    trim(coalesce(s.first_name, '')), trim(coalesce(s.last_name, '')),
    nullif(trim(coalesce(s.preferred_name, '')), ''),
    lower(trim(s.sex))::public.participant_sex, s.age,
    trim(coalesce(s.unit_name, '')), nullif(trim(coalesce(s.stake_name, '')), ''),
    'imported', lower(trim(s.registration_status)), 'verified', true, 'current',
    s.source_registered_at
  from registration_snapshot_stage s
  where lower(trim(s.person_type)) = 'participant'
  on conflict (session_id, source_record_key) where source_record_key is not null
  do update set
    import_batch_id = excluded.import_batch_id,
    last_seen_batch_id = excluded.last_seen_batch_id,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    preferred_name = excluded.preferred_name,
    sex = excluded.sex,
    age = excluded.age,
    unit_name = excluded.unit_name,
    stake_name = excluded.stake_name,
    registration_status = excluded.registration_status,
    is_current = true,
    reconciliation_status = 'current',
    source_registered_at = excluded.source_registered_at,
    updated_at = now();

  insert into public.staff(
    session_id, full_name, first_name, last_name, preferred_name, sex, age,
    unit_name, stake_name, staff_role, source_record_key, registration_status,
    is_current, source_registered_at, last_seen_batch_id
  )
  select p_session_id,
    trim(concat_ws(' ', nullif(trim(coalesce(s.first_name, '')), ''), nullif(trim(coalesce(s.last_name, '')), ''))),
    trim(coalesce(s.first_name, '')), trim(coalesce(s.last_name, '')),
    nullif(trim(coalesce(s.preferred_name, '')), ''),
    lower(trim(s.sex))::public.participant_sex, s.age,
    nullif(trim(coalesce(s.unit_name, '')), ''), nullif(trim(coalesce(s.stake_name, '')), ''),
    'counselor', s.source_record_key, lower(trim(s.registration_status)), true,
    s.source_registered_at, batch_id
  from registration_snapshot_stage s
  where lower(trim(s.person_type)) = 'counselor'
  on conflict (session_id, source_record_key) where source_record_key is not null
  do update set
    full_name = excluded.full_name,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    preferred_name = excluded.preferred_name,
    sex = excluded.sex,
    age = excluded.age,
    unit_name = excluded.unit_name,
    stake_name = excluded.stake_name,
    registration_status = excluded.registration_status,
    is_current = true,
    source_registered_at = excluded.source_registered_at,
    last_seen_batch_id = excluded.last_seen_batch_id;

  insert into public.participant_private_details(
    participant_id, session_id, date_of_birth, email, phone,
    medical_information, dietary_information, tshirt_size,
    contact_1_name, contact_1_email, contact_1_phone,
    contact_2_name, contact_2_email, contact_2_phone, bishop_name, bishop_email
  )
  select p.id, p_session_id, s.birthday, nullif(trim(coalesce(s.email, '')), ''),
    nullif(trim(coalesce(s.phone, '')), ''), nullif(trim(coalesce(s.medical_information, '')), ''),
    nullif(trim(coalesce(s.dietary_information, '')), ''), nullif(trim(coalesce(s.tshirt_size, '')), ''),
    nullif(trim(coalesce(s.contact_1_name, '')), ''), nullif(trim(coalesce(s.contact_1_email, '')), ''),
    nullif(trim(coalesce(s.contact_1_phone, '')), ''), nullif(trim(coalesce(s.contact_2_name, '')), ''),
    nullif(trim(coalesce(s.contact_2_email, '')), ''), nullif(trim(coalesce(s.contact_2_phone, '')), ''),
    nullif(trim(coalesce(s.bishop_name, '')), ''), nullif(trim(coalesce(s.bishop_email, '')), '')
  from registration_snapshot_stage s
  join public.participants p on p.session_id = p_session_id and p.source_record_key = s.source_record_key
  where lower(trim(s.person_type)) = 'participant'
  on conflict (participant_id) do update set
    date_of_birth = excluded.date_of_birth, email = excluded.email, phone = excluded.phone,
    medical_information = excluded.medical_information, dietary_information = excluded.dietary_information,
    tshirt_size = excluded.tshirt_size, contact_1_name = excluded.contact_1_name,
    contact_1_email = excluded.contact_1_email, contact_1_phone = excluded.contact_1_phone,
    contact_2_name = excluded.contact_2_name, contact_2_email = excluded.contact_2_email,
    contact_2_phone = excluded.contact_2_phone, bishop_name = excluded.bishop_name,
    bishop_email = excluded.bishop_email, updated_at = now();

  insert into public.staff_private_details(
    staff_id, session_id, date_of_birth, email, phone, medical_information,
    dietary_information, tshirt_size, contact_1_name, contact_1_email, contact_1_phone
  )
  select st.id, p_session_id, s.birthday, nullif(trim(coalesce(s.email, '')), ''),
    nullif(trim(coalesce(s.phone, '')), ''), nullif(trim(coalesce(s.medical_information, '')), ''),
    nullif(trim(coalesce(s.dietary_information, '')), ''), nullif(trim(coalesce(s.tshirt_size, '')), ''),
    nullif(trim(coalesce(s.contact_1_name, '')), ''), nullif(trim(coalesce(s.contact_1_email, '')), ''),
    nullif(trim(coalesce(s.contact_1_phone, '')), '')
  from registration_snapshot_stage s
  join public.staff st on st.session_id = p_session_id and st.source_record_key = s.source_record_key
  where lower(trim(s.person_type)) = 'counselor'
  on conflict (staff_id) do update set
    date_of_birth = excluded.date_of_birth, email = excluded.email, phone = excluded.phone,
    medical_information = excluded.medical_information, dietary_information = excluded.dietary_information,
    tshirt_size = excluded.tshirt_size, contact_1_name = excluded.contact_1_name,
    contact_1_email = excluded.contact_1_email, contact_1_phone = excluded.contact_1_phone,
    updated_at = now();

  update public.participants p
  set is_current = case when p.group_id is not null or exists (
        select 1 from public.check_ins ci where ci.participant_id = p.id
      ) then true else false end,
      reconciliation_status = case when p.group_id is not null or exists (
        select 1 from public.check_ins ci where ci.participant_id = p.id
      ) then 'missing_from_latest' else 'omitted' end,
      updated_at = now()
  where p.session_id = p_session_id
    and p.source_kind = 'imported'
    and p.last_seen_batch_id is distinct from batch_id;
  get diagnostics omitted = row_count;

  select count(*) into exceptions from public.participants p
  where p.session_id = p_session_id and p.reconciliation_status = 'missing_from_latest';

  update public.staff st set is_current = false
  where st.session_id = p_session_id and st.last_seen_batch_id is distinct from batch_id;

  update public.import_batches
  set status = 'applied', omitted_count = omitted, exception_count = exceptions
  where id = batch_id;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_session_id, (select auth.uid()), 'registration_snapshot_applied', 'import_batch', batch_id::text,
    jsonb_build_object('record_count', total_count, 'participant_count', youth_count,
      'staff_count', leader_count, 'omitted_count', omitted, 'exception_count', exceptions,
      'source_sha256', lower(p_source_sha256)));

  return jsonb_build_object('batch_id', batch_id, 'record_count', total_count,
    'participant_count', youth_count, 'staff_count', leader_count,
    'omitted_count', omitted, 'exception_count', exceptions);
end;
$$;

revoke all on function public.apply_registration_snapshot(uuid, text, text, jsonb) from public, anon;
grant execute on function public.apply_registration_snapshot(uuid, text, text, jsonb) to authenticated;

create or replace function public.add_on_site_participant(
  p_session_id uuid,
  p_first_name text,
  p_last_name text,
  p_preferred_name text,
  p_sex public.participant_sex,
  p_age integer,
  p_unit_name text,
  p_stake_name text default null,
  p_date_of_birth date default null,
  p_search_confirmed boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare next_id uuid := extensions.gen_random_uuid();
begin
  if not private.has_session_role(p_session_id, array['coordinator','logistics_admin','session_director']::public.app_role[]) then
    raise exception 'Your role cannot add an on-site participant';
  end if;
  if not p_search_confirmed then raise exception 'Search the existing registration list before adding someone'; end if;
  if nullif(trim(coalesce(p_first_name, '')), '') is null
     or nullif(trim(coalesce(p_last_name, '')), '') is null
     or nullif(trim(coalesce(p_unit_name, '')), '') is null
     or p_age is null or p_age not between 0 and 120 then
    raise exception 'Name, age, sex, and unit are required';
  end if;

  insert into public.participants(
    id, session_id, registration_id, first_name, last_name, preferred_name,
    sex, age, unit_name, stake_name, source_kind, registration_status,
    verification_status, is_current, reconciliation_status
  ) values (
    next_id, p_session_id, 'ONSITE-' || upper(substr(replace(next_id::text, '-', ''), 1, 12)),
    trim(p_first_name), trim(p_last_name), nullif(trim(coalesce(p_preferred_name, '')), ''),
    p_sex, p_age, trim(p_unit_name), nullif(trim(coalesce(p_stake_name, '')), ''),
    'on_site', 'approved', 'pending', true, 'current'
  );
  insert into public.participant_private_details(participant_id, session_id, date_of_birth)
  values (next_id, p_session_id, p_date_of_birth);
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_session_id, (select auth.uid()), 'on_site_participant_added', 'participant', next_id::text,
    jsonb_build_object('verification_status', 'pending'));
  return next_id;
end;
$$;

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
  if not private.can_manage_access(target.session_id) then raise exception 'Only an access administrator can verify on-site additions'; end if;
  update public.participants set
    verification_status = case when p_approved then 'verified' else 'rejected' end,
    is_current = p_approved,
    verified_by = (select auth.uid()), verified_at = now(), updated_at = now()
  where id = target.id;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (target.session_id, (select auth.uid()),
    case when p_approved then 'on_site_participant_verified' else 'on_site_participant_rejected' end,
    'participant', target.id::text, jsonb_build_object('note', nullif(trim(coalesce(p_note, '')), '')));
end;
$$;

create or replace function public.assign_participant_to_group(p_participant_id uuid, p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target public.participants%rowtype; target_group public.counselor_groups%rowtype;
begin
  select * into target from public.participants where id = p_participant_id for update;
  select * into target_group from public.counselor_groups where id = p_group_id;
  if target.id is null or target_group.id is null or target.session_id <> target_group.session_id then
    raise exception 'Participant and group must belong to the same session';
  end if;
  if not private.has_session_role(target.session_id, array['coordinator','logistics_admin','session_director']::public.app_role[]) then
    raise exception 'Your role cannot assign participants';
  end if;
  if not target.is_current or target.registration_status <> 'approved' or target.verification_status <> 'verified' then
    raise exception 'Only current, approved, verified participants can be assigned';
  end if;
  if target.sex <> target_group.sex then raise exception 'Participant sex does not match the selected group'; end if;
  if exists (
    select 1 from public.participants peer
    where peer.group_id = target_group.id and peer.id <> target.id
      and lower(trim(peer.unit_name)) = lower(trim(target.unit_name))
  ) then raise exception 'This group already contains someone from the same unit'; end if;
  update public.participants set group_id = target_group.id, updated_at = now() where id = target.id;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (target.session_id, (select auth.uid()), 'participant_group_assigned', 'participant', target.id::text,
    jsonb_build_object('group_id', target_group.id));
end;
$$;

revoke all on function public.add_on_site_participant(uuid,text,text,text,public.participant_sex,integer,text,text,date,boolean) from public, anon;
grant execute on function public.add_on_site_participant(uuid,text,text,text,public.participant_sex,integer,text,text,date,boolean) to authenticated;
revoke all on function public.verify_on_site_participant(uuid,boolean,text) from public, anon;
grant execute on function public.verify_on_site_participant(uuid,boolean,text) to authenticated;
revoke all on function public.assign_participant_to_group(uuid,uuid) from public, anon;
grant execute on function public.assign_participant_to_group(uuid,uuid) to authenticated;

create table if not exists public.birthday_acknowledgements (
  session_id uuid not null references public.sessions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  acknowledged_by uuid not null references public.profiles(user_id),
  acknowledged_at timestamptz not null default now(),
  primary key(session_id, participant_id)
);
alter table public.birthday_acknowledgements enable row level security;
revoke all on public.birthday_acknowledgements from anon, authenticated;
grant select on public.birthday_acknowledgements to authenticated;
create policy "leaders read scoped birthday acknowledgements"
  on public.birthday_acknowledgements for select to authenticated
  using (private.has_session_access(session_id));

create or replace function private.birthday_in_year(date_of_birth date, target_year integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.make_date(target_year, extract(month from date_of_birth)::integer, 1)
    + (least(
        extract(day from date_of_birth)::integer,
        extract(day from (
          pg_catalog.make_date(target_year, extract(month from date_of_birth)::integer, 1)
          + interval '1 month - 1 day'
        ))::integer
      ) - 1);
$$;
revoke all on function private.birthday_in_year(date,integer) from public;

create or replace function public.get_session_birthdays(p_session_id uuid)
returns table(
  participant_id uuid, display_name text, birthday_date date, turning_age integer,
  unit_name text, group_name text, company_name text, acknowledged boolean,
  acknowledged_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id as participant_id,
    coalesce(nullif(p.preferred_name, ''), trim(concat_ws(' ', p.first_name, p.last_name))) as display_name,
    private.birthday_in_year(d.date_of_birth, extract(year from s.starts_on)::integer) as birthday_date,
    (extract(year from s.starts_on)::integer - extract(year from d.date_of_birth)::integer)::integer as turning_age,
    p.unit_name as unit_name, g.name as group_name, c.name as company_name,
    (ba.participant_id is not null) as acknowledged, ba.acknowledged_at as acknowledged_at
  from public.sessions s
  join public.participants p on p.session_id = s.id
  join public.participant_private_details d on d.participant_id = p.id
  left join public.counselor_groups g on g.id = p.group_id
  left join public.companies c on c.id = g.company_id
  left join public.birthday_acknowledgements ba on ba.session_id = s.id and ba.participant_id = p.id
  where s.id = p_session_id
    and private.has_session_access(s.id)
    and p.is_current and p.registration_status = 'approved' and p.verification_status = 'verified'
    and private.birthday_in_year(d.date_of_birth, extract(year from s.starts_on)::integer)
      between s.starts_on and s.ends_on
    and (
      private.has_session_role(s.id, array['coordinator','logistics_admin','session_director']::public.app_role[])
      or (g.company_id is not null and private.can_access_company(s.id, g.company_id))
    )
  order by birthday_date, display_name;
$$;

create or replace function public.acknowledge_session_birthday(p_session_id uuid, p_participant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.get_session_birthdays(p_session_id) b where b.participant_id = p_participant_id) then
    raise exception 'Birthday is not available in your session scope';
  end if;
  insert into public.birthday_acknowledgements(session_id, participant_id, acknowledged_by)
  values (p_session_id, p_participant_id, (select auth.uid()))
  on conflict (session_id, participant_id) do update
    set acknowledged_by = excluded.acknowledged_by, acknowledged_at = now();
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id)
  values (p_session_id, (select auth.uid()), 'birthday_acknowledged', 'participant', p_participant_id::text);
end;
$$;

revoke all on function public.get_session_birthdays(uuid) from public, anon;
grant execute on function public.get_session_birthdays(uuid) to authenticated;
revoke all on function public.acknowledge_session_birthday(uuid,uuid) from public, anon;
grant execute on function public.acknowledge_session_birthday(uuid,uuid) to authenticated;

-- Operational writes must ignore cancelled, omitted, or unverified people.
create or replace function public.record_participant_checkin(
  p_session_id uuid,
  p_participant_id uuid,
  p_status public.check_in_status,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_session_role(p_session_id, array['coordinator','logistics_admin','session_director']::public.app_role[]) then
    raise exception 'Your role cannot record check-in';
  end if;
  if not exists (
    select 1 from public.participants p where p.id = p_participant_id
      and p.session_id = p_session_id and p.is_current
      and p.registration_status = 'approved' and p.verification_status = 'verified'
  ) then raise exception 'Participant is not currently eligible for check-in'; end if;
  insert into public.check_ins(session_id, participant_id, status, note, recorded_by, recorded_at)
  values (p_session_id, p_participant_id, p_status, nullif(trim(coalesce(p_note, '')), ''), (select auth.uid()), now())
  on conflict (session_id, participant_id) do update set
    status = excluded.status, note = excluded.note, recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_session_id, (select auth.uid()), 'participant_checkin_recorded', 'participant', p_participant_id::text,
    jsonb_build_object('status', p_status));
end;
$$;

-- Preserve the established invite/recovery signatures while recognizing the
-- explicit access_admin capability.
create or replace function public.create_leader_invite(
  p_session_id uuid, p_email text, p_display_name text, p_role public.app_role,
  p_company_ids uuid[] default '{}', p_committee_scope text[] default '{}'
)
returns table(invite_id uuid, invite_code text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  normalized_email text := lower(trim(p_email));
  normalized_name text := nullif(regexp_replace(trim(coalesce(p_display_name, '')), '\s+', ' ', 'g'), '');
  raw_code text; formatted_code text; new_id uuid;
  new_expiry timestamptz := now() + interval '7 days';
begin
  if not private.can_manage_access(p_session_id) then raise exception 'Your account cannot invite leaders'; end if;
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address'; end if;
  if normalized_name is null or length(normalized_name) < 2 or length(normalized_name) > 80 then raise exception 'Enter the leader''s name'; end if;
  if p_role = 'assistant_coordinator' then
    if coalesce(array_length(p_company_ids, 1), 0) = 0 then raise exception 'Select at least one company for an Assistant Coordinator'; end if;
    if exists (select 1 from unnest(p_company_ids) company_id where not exists (
      select 1 from public.companies c where c.id = company_id and c.session_id = p_session_id
    )) then raise exception 'One or more selected companies do not belong to this session'; end if;
  elsif p_role = 'committee_viewer' then
    if coalesce(array_length(p_committee_scope, 1), 0) = 0 then raise exception 'Add at least one committee area'; end if;
  elsif p_role not in ('coordinator','logistics_admin','session_director') then raise exception 'Unsupported role'; end if;
  update public.leader_invites set status = 'revoked', revoked_at = now()
  where session_id = p_session_id and lower(email) = normalized_email
    and status in ('pending','activating') and purpose = 'onboarding';
  raw_code := upper(encode(extensions.gen_random_bytes(12), 'hex'));
  formatted_code := 'FSY-' || substr(raw_code,1,4) || '-' || substr(raw_code,5,4) || '-' || substr(raw_code,9,4)
    || '-' || substr(raw_code,13,4) || '-' || substr(raw_code,17,4) || '-' || substr(raw_code,21,4);
  insert into public.leader_invites(
    session_id,email,display_name,role,company_ids,committee_scope,purpose,code_hash,created_by,expires_at
  ) values (
    p_session_id,normalized_email,normalized_name,p_role,
    case when p_role='assistant_coordinator' then coalesce(p_company_ids,'{}') else '{}'::uuid[] end,
    case when p_role='committee_viewer' then coalesce(p_committee_scope,'{}') else '{}'::text[] end,
    'onboarding',encode(extensions.digest(replace(upper(formatted_code),'-',''),'sha256'),'hex'),
    (select auth.uid()),new_expiry
  ) returning id into new_id;
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values (p_session_id,(select auth.uid()),'leader_invite_created','leader_invite',new_id::text,
    jsonb_build_object('email',normalized_email,'role',p_role,'purpose','onboarding'));
  return query select new_id, formatted_code, new_expiry;
end;
$$;

create or replace function public.revoke_leader_invite(p_invite_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target_session uuid;
begin
  select session_id into target_session from public.leader_invites where id = p_invite_id;
  if target_session is null then raise exception 'Invite not found'; end if;
  if not private.can_manage_access(target_session) then raise exception 'Not authorized to revoke this invite'; end if;
  update public.leader_invites set status='revoked', revoked_at=now()
  where id=p_invite_id and status in ('pending','activating');
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id)
  values (target_session,(select auth.uid()),'leader_invite_revoked','leader_invite',p_invite_id::text);
end;
$$;

create or replace function public.create_leader_recovery_code(p_session_id uuid, p_user_id uuid)
returns table(invite_id uuid, recovery_code text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  target_access public.access_assignments%rowtype; target_profile public.profiles%rowtype;
  raw_code text; formatted_code text; new_id uuid;
  new_expiry timestamptz := now() + interval '30 minutes';
begin
  if not private.can_manage_access(p_session_id) then raise exception 'Your account cannot issue recovery codes'; end if;
  select * into target_access from public.access_assignments aa
  where aa.session_id=p_session_id and aa.user_id=p_user_id and aa.active
  order by aa.created_at desc limit 1;
  if target_access.id is null then raise exception 'This leader does not have active access'; end if;
  select * into target_profile from public.profiles where user_id=p_user_id;
  if target_profile.user_id is null or target_profile.email is null then raise exception 'This leader does not have a recoverable email account'; end if;
  update public.leader_invites set status='revoked', revoked_at=now()
  where session_id=p_session_id and lower(email)=lower(target_profile.email)
    and status in ('pending','activating') and purpose='recovery';
  raw_code := upper(encode(extensions.gen_random_bytes(12),'hex'));
  formatted_code := 'FSY-' || substr(raw_code,1,4) || '-' || substr(raw_code,5,4) || '-' || substr(raw_code,9,4)
    || '-' || substr(raw_code,13,4) || '-' || substr(raw_code,17,4) || '-' || substr(raw_code,21,4);
  insert into public.leader_invites(
    session_id,email,display_name,role,company_ids,committee_scope,purpose,code_hash,created_by,expires_at
  ) values (
    p_session_id,lower(target_profile.email),target_profile.display_name,target_access.role,
    target_access.company_ids,target_access.committee_scope,'recovery',
    encode(extensions.digest(replace(upper(formatted_code),'-',''),'sha256'),'hex'),
    (select auth.uid()),new_expiry
  ) returning id into new_id;
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values (p_session_id,(select auth.uid()),'leader_recovery_code_created','leader_invite',new_id::text,
    jsonb_build_object('target_user_id',p_user_id,'role',target_access.role));
  return query select new_id, formatted_code, new_expiry;
end;
$$;

revoke all on function public.create_leader_invite(uuid,text,text,public.app_role,uuid[],text[]) from public, anon;
grant execute on function public.create_leader_invite(uuid,text,text,public.app_role,uuid[],text[]) to authenticated;
revoke all on function public.revoke_leader_invite(uuid) from public, anon;
grant execute on function public.revoke_leader_invite(uuid) to authenticated;
revoke all on function public.create_leader_recovery_code(uuid,uuid) from public, anon;
grant execute on function public.create_leader_recovery_code(uuid,uuid) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.birthday_acknowledgements;
exception when duplicate_object then null;
end $$;
