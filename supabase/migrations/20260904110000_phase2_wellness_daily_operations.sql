-- Phase 2: Wellness 2.0 and Daily Operations 2.0.
-- Additive only. No real visits, meal attendance, or head-count reports are seeded.

-- Keep the source tree aligned with the eligibility rule already running in production.
-- This is the shared boundary for grouping, check-in, meals, and head count.
create or replace function private.operational_participant_is_eligible(
  target_session uuid,
  target_participant uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.participants p
    join public.sessions s on s.id = p.session_id
    join public.participant_private_details d on d.participant_id = p.id
    where p.id = target_participant
      and p.session_id = target_session
      and p.is_current
      and p.registration_status = 'approved'
      and p.verification_status = 'verified'
      and p.attendance_status <> 'confirmed_not_attending'
      and d.date_of_birth is not null
      and s.starts_on is not null
      and s.ends_on is not null
      and extract(year from s.starts_on)::int - extract(year from d.date_of_birth)::int >= 14
      and s.ends_on < (d.date_of_birth + interval '19 years')::date
  );
$$;
revoke all on function private.operational_participant_is_eligible(uuid, uuid) from public;
grant execute on function private.operational_participant_is_eligible(uuid, uuid) to authenticated;

-- One denominator for the live session. A replacement is included through its
-- current group and eligible participant row; a retired-only badge is excluded.
create or replace function private.expected_participant_count(
  target_session uuid,
  target_company uuid
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.participants p
  join public.counselor_groups g on g.id = p.group_id
  where p.session_id = target_session
    and g.session_id = target_session
    and g.company_id = target_company
    and g.state = 'published'
    and private.operational_participant_is_eligible(target_session, p.id)
    and (
      not exists(
        select 1 from public.participant_badge_assignments b
        where b.session_id = target_session and b.participant_id = p.id
      )
      or exists(
        select 1 from public.participant_badge_assignments b
        where b.session_id = target_session and b.participant_id = p.id and b.state <> 'retired'
      )
    );
$$;
revoke all on function private.expected_participant_count(uuid, uuid) from public;
grant execute on function private.expected_participant_count(uuid, uuid) to authenticated;

-- Head-count reconciliation is a direct operational record, separate from
-- check-in and Wellness context. It is only writable through guarded RPCs.
create table if not exists public.headcount_person_statuses(
  id uuid primary key default extensions.gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  round_id uuid not null references public.headcount_rounds(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  status text not null check (status in ('present','missing','known_elsewhere','at_wellness','not_expected')),
  note text,
  recorded_by uuid not null references public.profiles(user_id),
  recorded_at timestamptz not null default now(),
  unique(round_id, participant_id)
);
create index if not exists headcount_person_status_round_company_idx
  on public.headcount_person_statuses(round_id, company_id, status);
create index if not exists headcount_person_status_session_round_idx
  on public.headcount_person_statuses(session_id, round_id);
alter table public.headcount_person_statuses enable row level security;
revoke all on public.headcount_person_statuses from anon, authenticated;

-- Recalculate the stored expected count at write time and serialize reports on
-- the round row. Existing callers keep the same signature and behavior.
create or replace function public.submit_company_headcount(
  p_round_id uuid,
  p_company_id uuid,
  p_accounted_count integer,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session uuid;
  expected integer;
begin
  select r.session_id into target_session
  from public.headcount_rounds r
  where r.id = p_round_id and r.closes_at is null
  for update;
  if target_session is null then raise exception 'This head-count round is closed or unavailable'; end if;
  if not private.can_access_company(target_session, p_company_id) then raise exception 'You cannot submit for this company'; end if;
  if not exists(select 1 from public.companies c where c.id = p_company_id and c.session_id = target_session) then
    raise exception 'Company does not belong to this session';
  end if;
  expected := private.expected_participant_count(target_session, p_company_id);
  if p_accounted_count is null or p_accounted_count < 0 or p_accounted_count > expected then
    raise exception 'Accounted count must be between 0 and the expected company total';
  end if;
  insert into public.headcount_submissions(round_id, company_id, expected_count, accounted_count, status, note, submitted_by, submitted_at)
  values(
    p_round_id, p_company_id, expected, p_accounted_count,
    case when p_accounted_count = expected then 'submitted'::public.submission_status else 'exception'::public.submission_status end,
    nullif(trim(coalesce(p_note, '')), ''), (select auth.uid()), now()
  )
  on conflict(round_id, company_id) do update set
    expected_count = excluded.expected_count,
    accounted_count = excluded.accounted_count,
    status = excluded.status,
    note = excluded.note,
    submitted_by = excluded.submitted_by,
    submitted_at = excluded.submitted_at;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(target_session, (select auth.uid()), 'company_headcount_submitted', 'company', p_company_id::text,
    jsonb_build_object('round_id', p_round_id, 'expected', expected, 'accounted', p_accounted_count));
end;
$$;
revoke all on function public.submit_company_headcount(uuid, uuid, integer, text) from public, anon;
grant execute on function public.submit_company_headcount(uuid, uuid, integer, text) to authenticated;

-- Same transaction as the company report, with optional direct reconciliation
-- statuses. Empty status input intentionally clears an old reconciliation.
create or replace function public.submit_company_headcount_v2(
  p_round_id uuid,
  p_company_id uuid,
  p_accounted_count integer,
  p_note text default null,
  p_person_statuses jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session uuid;
  expected integer;
  status_count integer := 0;
begin
  select r.session_id into target_session
  from public.headcount_rounds r
  where r.id = p_round_id and r.closes_at is null
  for update;
  if target_session is null then raise exception 'This head-count round is closed or unavailable'; end if;
  if not private.can_access_company(target_session, p_company_id) then raise exception 'You cannot submit for this company'; end if;
  if not exists(select 1 from public.companies c where c.id = p_company_id and c.session_id = target_session) then
    raise exception 'Company does not belong to this session';
  end if;
  if jsonb_typeof(coalesce(p_person_statuses, '[]'::jsonb)) <> 'array' then raise exception 'Person reconciliation must be an array'; end if;
  if jsonb_array_length(coalesce(p_person_statuses, '[]'::jsonb)) > 500 then raise exception 'Too many person statuses in one report'; end if;
  if exists(
    select 1 from jsonb_array_elements(coalesce(p_person_statuses, '[]'::jsonb)) item
    where nullif(trim(item->>'participant_id'), '') is null
      or item->>'status' not in ('present','missing','known_elsewhere','at_wellness','not_expected')
  ) then raise exception 'Each person status needs a valid participant and operational status'; end if;

  if exists(
    select 1
    from jsonb_to_recordset(coalesce(p_person_statuses, '[]'::jsonb)) as item(participant_id uuid, status text, note text)
    left join public.participants p on p.id = item.participant_id and p.session_id = target_session
    left join public.counselor_groups g on g.id = p.group_id and g.session_id = target_session
    where p.id is null or g.company_id is distinct from p_company_id
  ) then raise exception 'A person status does not belong to this company'; end if;

  expected := private.expected_participant_count(target_session, p_company_id);
  if p_accounted_count is null or p_accounted_count < 0 or p_accounted_count > expected then
    raise exception 'Accounted count must be between 0 and the expected company total';
  end if;
  insert into public.headcount_submissions(round_id, company_id, expected_count, accounted_count, status, note, submitted_by, submitted_at)
  values(
    p_round_id, p_company_id, expected, p_accounted_count,
    case when p_accounted_count = expected then 'submitted'::public.submission_status else 'exception'::public.submission_status end,
    nullif(trim(coalesce(p_note, '')), ''), (select auth.uid()), now()
  )
  on conflict(round_id, company_id) do update set
    expected_count = excluded.expected_count,
    accounted_count = excluded.accounted_count,
    status = excluded.status,
    note = excluded.note,
    submitted_by = excluded.submitted_by,
    submitted_at = excluded.submitted_at;

  delete from public.headcount_person_statuses
  where round_id = p_round_id and company_id = p_company_id;
  insert into public.headcount_person_statuses(session_id, round_id, company_id, participant_id, status, note, recorded_by, recorded_at)
  select target_session, p_round_id, p_company_id, item.participant_id, item.status,
    nullif(trim(coalesce(item.note, '')), ''), (select auth.uid()), now()
  from jsonb_to_recordset(coalesce(p_person_statuses, '[]'::jsonb)) as item(participant_id uuid, status text, note text);
  get diagnostics status_count = row_count;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(target_session, (select auth.uid()), 'company_headcount_submitted', 'company', p_company_id::text,
    jsonb_build_object('round_id', p_round_id, 'expected', expected, 'accounted', p_accounted_count, 'person_statuses', status_count));
  return jsonb_build_object('round_id', p_round_id, 'company_id', p_company_id, 'expected_count', expected,
    'accounted_count', p_accounted_count, 'status_count', status_count);
end;
$$;
revoke all on function public.submit_company_headcount_v2(uuid, uuid, integer, text, jsonb) from public, anon;
grant execute on function public.submit_company_headcount_v2(uuid, uuid, integer, text, jsonb) to authenticated;

-- One guarded read supplies all rounds, server-computed company denominators,
-- scoped rosters, and direct reconciliation statuses without app-wide hydration.
create or replace function public.get_headcount_workspace(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.has_capability(p_session_id, 'headcount_view') or private.has_capability(p_session_id, 'headcount_record')) then
    raise exception 'Head-count access required';
  end if;
  return (
    with visible_companies as (
      select c.id, c.name, c.custom_name, c.meeting_spot, c.operational_number,
        private.expected_participant_count(p_session_id, c.id) as expected_count,
        (select count(*)::integer from public.counselor_groups g where g.session_id = p_session_id and g.company_id = c.id and g.state = 'published') as group_count
      from public.companies c
      where c.session_id = p_session_id
        and (
          private.has_session_role(p_session_id, array['coordinator','logistics_admin','session_director']::public.app_role[])
          or private.can_access_company(p_session_id, c.id)
        )
    ),
    visible_rounds as (
      select r.id, r.label, r.opens_at, r.closes_at
      from public.headcount_rounds r where r.session_id = p_session_id
    ),
    visible_people as (
      select p.id as participant_id, p.registration_id, p.group_id, g.name as group_name,
        coalesce(nullif(g.custom_name, ''), g.name) as group_display_name,
        c.id as company_id, coalesce(nullif(c.custom_name, ''), c.name) as company_name,
        b.fsy_id, trim(concat_ws(' ', p.first_name, p.last_name)) as display_name
      from public.participants p
      join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id and g.state = 'published'
      join visible_companies c on c.id = g.company_id
      left join lateral (
        select badge.fsy_id
        from public.participant_badge_assignments badge
        where badge.session_id = p_session_id and badge.participant_id = p.id and badge.state <> 'retired'
        order by badge.assigned_at desc
        limit 1
      ) b on true
      where p.session_id = p_session_id
        and private.operational_participant_is_eligible(p_session_id, p.id)
        and (
          not exists(
            select 1 from public.participant_badge_assignments b
            where b.session_id = p_session_id and b.participant_id = p.id
          )
          or exists(
            select 1 from public.participant_badge_assignments b
            where b.session_id = p_session_id and b.participant_id = p.id and b.state <> 'retired'
          )
        )
    )
    select jsonb_build_object(
      'rounds', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'label', r.label, 'opens_at', r.opens_at, 'closes_at', r.closes_at) order by r.opens_at desc) from visible_rounds r), '[]'::jsonb),
      'companies', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'display_name', coalesce(nullif(c.custom_name, ''), c.name), 'meeting_spot', c.meeting_spot, 'operational_number', c.operational_number, 'expected_count', c.expected_count, 'group_count', c.group_count) order by c.operational_number nulls last, c.name) from visible_companies c), '[]'::jsonb),
      'submissions', coalesce((select jsonb_agg(jsonb_build_object('round_id', s.round_id, 'company_id', s.company_id, 'expected_count', s.expected_count, 'accounted_count', s.accounted_count, 'status', s.status::text, 'note', s.note, 'submitted_at', s.submitted_at) order by s.submitted_at desc) from public.headcount_submissions s join visible_rounds r on r.id = s.round_id join visible_companies c on c.id = s.company_id), '[]'::jsonb),
      'people', coalesce((select jsonb_agg(jsonb_build_object('participant_id', p.participant_id, 'registration_id', p.registration_id, 'display_name', p.display_name, 'fsy_id', p.fsy_id, 'company_id', p.company_id, 'company_name', p.company_name, 'group_id', p.group_id, 'group_name', p.group_display_name) order by p.company_name, p.group_display_name, p.display_name) from visible_people p), '[]'::jsonb),
      'person_statuses', coalesce((select jsonb_agg(jsonb_build_object('round_id', h.round_id, 'company_id', h.company_id, 'participant_id', h.participant_id, 'status', h.status, 'note', h.note, 'recorded_at', h.recorded_at) order by h.recorded_at desc) from public.headcount_person_statuses h join visible_rounds r on r.id = h.round_id join visible_companies c on c.id = h.company_id), '[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.get_headcount_workspace(uuid) from public, anon;
grant execute on function public.get_headcount_workspace(uuid) to authenticated;

-- Wellness lifecycle and private follow-up state.
alter table public.wellness_encounters
  add column if not exists follow_up_status text not null default 'not_required',
  add column if not exists follow_up_resolved_at timestamptz,
  add column if not exists follow_up_resolved_by uuid references public.profiles(user_id);
alter table public.wellness_encounters drop constraint if exists wellness_follow_up_status_check;
alter table public.wellness_encounters add constraint wellness_follow_up_status_check
  check (follow_up_status in ('not_required','open','resolved'));
update public.wellness_encounters
set follow_up_status = 'open'
where outcome = 'follow_up_needed' and follow_up_status <> 'resolved';
create unique index if not exists wellness_active_participant_uq
  on public.wellness_encounters(session_id, participant_id)
  where participant_id is not null and closed_at is null;
create unique index if not exists wellness_active_staff_uq
  on public.wellness_encounters(session_id, staff_id)
  where staff_id is not null and closed_at is null;
create index if not exists wellness_session_follow_up_idx
  on public.wellness_encounters(session_id, follow_up_status, started_at desc);

-- Preserve the original RPC for existing callers, but never reopen a closed
-- visit through a details update. Explicit checkout is a separate action below.
create or replace function public.create_wellness_encounter(
  p_session_id uuid,
  p_person_type text,
  p_person_id uuid,
  p_concern text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  eid uuid;
begin
  if not private.has_capability(p_session_id, 'wellness_manage') then raise exception 'Your account cannot record Wellness visits'; end if;
  if p_person_type = 'participant' then
    if not exists(select 1 from public.participants where id = p_person_id and session_id = p_session_id) then raise exception 'Participant not found'; end if;
    select w.id into eid from public.wellness_encounters w where w.session_id = p_session_id and w.participant_id = p_person_id and w.closed_at is null for update;
    if eid is not null then return eid; end if;
    insert into public.wellness_encounters(session_id, participant_id, concern, recorded_by)
    values(p_session_id, p_person_id, nullif(trim(coalesce(p_concern, '')), ''), (select auth.uid())) returning id into eid;
  elsif p_person_type = 'staff' then
    if not exists(select 1 from public.staff where id = p_person_id and session_id = p_session_id) then raise exception 'Staff member not found'; end if;
    select w.id into eid from public.wellness_encounters w where w.session_id = p_session_id and w.staff_id = p_person_id and w.closed_at is null for update;
    if eid is not null then return eid; end if;
    insert into public.wellness_encounters(session_id, staff_id, concern, recorded_by)
    values(p_session_id, p_person_id, nullif(trim(coalesce(p_concern, '')), ''), (select auth.uid())) returning id into eid;
  else raise exception 'Person type must be participant or staff'; end if;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(p_session_id, (select auth.uid()), 'wellness_visit_started', 'wellness_encounter', eid::text, jsonb_build_object('person_type', p_person_type, 'person_id', p_person_id));
  return eid;
exception when unique_violation then
  if p_person_type = 'participant' then
    select w.id into eid from public.wellness_encounters w where w.session_id = p_session_id and w.participant_id = p_person_id and w.closed_at is null;
  else
    select w.id into eid from public.wellness_encounters w where w.session_id = p_session_id and w.staff_id = p_person_id and w.closed_at is null;
  end if;
  if eid is null then raise; end if;
  return eid;
end;
$$;
revoke all on function public.create_wellness_encounter(uuid, text, uuid, text) from public, anon;
grant execute on function public.create_wellness_encounter(uuid, text, uuid, text) to authenticated;

-- Start the complete first visit in one idempotent operation. Returning
-- `created = false` lets a second operator open the existing queue item
-- instead of overwriting the first operator's private notes.
create or replace function public.start_wellness_visit(
  p_session_id uuid,
  p_person_type text,
  p_person_id uuid,
  p_concern text default null,
  p_care_provided text default null,
  p_medicine_provided text default null
)
returns table(encounter_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  eid uuid;
begin
  if not private.has_capability(p_session_id, 'wellness_manage') then raise exception 'Your account cannot record Wellness visits'; end if;
  if p_person_type = 'participant' then
    if not exists(select 1 from public.participants where id = p_person_id and session_id = p_session_id) then raise exception 'Participant not found'; end if;
    select w.id into eid from public.wellness_encounters w where w.session_id = p_session_id and w.participant_id = p_person_id and w.closed_at is null for update;
    if eid is not null then return query select eid, false; return; end if;
    insert into public.wellness_encounters(session_id, participant_id, concern, care_provided, medicine_provided, recorded_by)
    values(p_session_id, p_person_id, nullif(trim(coalesce(p_concern, '')), ''), nullif(trim(coalesce(p_care_provided, '')), ''), nullif(trim(coalesce(p_medicine_provided, '')), ''), (select auth.uid())) returning id into eid;
  elsif p_person_type = 'staff' then
    if not exists(select 1 from public.staff where id = p_person_id and session_id = p_session_id) then raise exception 'Staff member not found'; end if;
    select w.id into eid from public.wellness_encounters w where w.session_id = p_session_id and w.staff_id = p_person_id and w.closed_at is null for update;
    if eid is not null then return query select eid, false; return; end if;
    insert into public.wellness_encounters(session_id, staff_id, concern, care_provided, medicine_provided, recorded_by)
    values(p_session_id, p_person_id, nullif(trim(coalesce(p_concern, '')), ''), nullif(trim(coalesce(p_care_provided, '')), ''), nullif(trim(coalesce(p_medicine_provided, '')), ''), (select auth.uid())) returning id into eid;
  else raise exception 'Person type must be participant or staff'; end if;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(p_session_id, (select auth.uid()), 'wellness_visit_started', 'wellness_encounter', eid::text, jsonb_build_object('person_type', p_person_type, 'person_id', p_person_id));
  return query select eid, true;
exception when unique_violation then
  if p_person_type = 'participant' then
    select w.id into eid from public.wellness_encounters w where w.session_id = p_session_id and w.participant_id = p_person_id and w.closed_at is null;
  else
    select w.id into eid from public.wellness_encounters w where w.session_id = p_session_id and w.staff_id = p_person_id and w.closed_at is null;
  end if;
  if eid is null then raise; end if;
  return query select eid, false;
end;
$$;
revoke all on function public.start_wellness_visit(uuid, text, uuid, text, text, text) from public, anon;
grant execute on function public.start_wellness_visit(uuid, text, uuid, text, text, text) to authenticated;

create or replace function public.update_wellness_encounter(
  p_encounter_id uuid,
  p_concern text,
  p_care_provided text,
  p_medicine_provided text,
  p_outcome text,
  p_close boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.wellness_encounters%rowtype;
begin
  select * into target from public.wellness_encounters where id = p_encounter_id for update;
  if target.id is null then raise exception 'Wellness visit not found'; end if;
  if not private.has_capability(target.session_id, 'wellness_manage') then raise exception 'Your account cannot update Wellness visits'; end if;
  if p_outcome not in ('receiving_support','returned_to_activity','follow_up_needed','sent_home','referred_off_site','emergency_escalation') then raise exception 'Invalid Wellness outcome'; end if;
  if target.closed_at is not null and p_outcome = 'receiving_support' then raise exception 'A closed Wellness visit needs a terminal outcome'; end if;
  update public.wellness_encounters set
    concern = nullif(trim(coalesce(p_concern, '')), ''),
    care_provided = nullif(trim(coalesce(p_care_provided, '')), ''),
    medicine_provided = nullif(trim(coalesce(p_medicine_provided, '')), ''),
    outcome = p_outcome,
    closed_at = case
      when target.closed_at is not null then target.closed_at
      when p_close or p_outcome in ('returned_to_activity','sent_home','referred_off_site','emergency_escalation') then now()
      else null
    end,
    follow_up_status = case
      when p_outcome = 'follow_up_needed' and (p_close or p_outcome in ('returned_to_activity','sent_home','referred_off_site','emergency_escalation')) then 'open'
      when p_outcome <> 'follow_up_needed' then 'not_required'
      else follow_up_status
    end,
    updated_by = (select auth.uid()), updated_at = now()
  where id = p_encounter_id;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(target.session_id, (select auth.uid()), 'wellness_visit_updated', 'wellness_encounter', p_encounter_id::text, jsonb_build_object('outcome', p_outcome, 'closed', target.closed_at is not null or p_close));
end;
$$;
revoke all on function public.update_wellness_encounter(uuid, text, text, text, text, boolean) from public, anon;
grant execute on function public.update_wellness_encounter(uuid, text, text, text, text, boolean) to authenticated;

create or replace function public.checkout_wellness_encounter(
  p_encounter_id uuid,
  p_outcome text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.wellness_encounters%rowtype;
  checked_out_at timestamptz;
begin
  select * into target from public.wellness_encounters where id = p_encounter_id for update;
  if target.id is null then raise exception 'Wellness visit not found'; end if;
  if not private.has_capability(target.session_id, 'wellness_manage') then raise exception 'Your account cannot check out Wellness visits'; end if;
  if target.closed_at is not null then raise exception 'This Wellness visit is already checked out'; end if;
  if p_outcome not in ('follow_up_needed','returned_to_activity','sent_home','referred_off_site','emergency_escalation') then raise exception 'Choose a checkout outcome before ending the visit'; end if;
  checked_out_at := now();
  update public.wellness_encounters set
    outcome = p_outcome,
    closed_at = checked_out_at,
    follow_up_status = case when p_outcome = 'follow_up_needed' then 'open' else 'not_required' end,
    follow_up_resolved_at = null,
    follow_up_resolved_by = null,
    updated_by = (select auth.uid()), updated_at = checked_out_at
  where id = p_encounter_id;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(target.session_id, (select auth.uid()), 'wellness_visit_checked_out', 'wellness_encounter', p_encounter_id::text, jsonb_build_object('outcome', p_outcome));
  return checked_out_at;
end;
$$;
revoke all on function public.checkout_wellness_encounter(uuid, text) from public, anon;
grant execute on function public.checkout_wellness_encounter(uuid, text) to authenticated;

create or replace function public.resolve_wellness_follow_up(p_encounter_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.wellness_encounters%rowtype;
  resolved_at timestamptz;
begin
  select * into target from public.wellness_encounters where id = p_encounter_id for update;
  if target.id is null then raise exception 'Wellness visit not found'; end if;
  if not private.has_capability(target.session_id, 'wellness_manage') then raise exception 'Your account cannot resolve Wellness follow-up'; end if;
  if target.follow_up_status <> 'open' then raise exception 'This Wellness follow-up is not open'; end if;
  resolved_at := now();
  update public.wellness_encounters set follow_up_status = 'resolved', follow_up_resolved_at = resolved_at, follow_up_resolved_by = (select auth.uid()), updated_by = (select auth.uid()), updated_at = resolved_at where id = p_encounter_id;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(target.session_id, (select auth.uid()), 'wellness_follow_up_resolved', 'wellness_encounter', p_encounter_id::text, '{}'::jsonb);
  return resolved_at;
end;
$$;
revoke all on function public.resolve_wellness_follow_up(uuid) from public, anon;
grant execute on function public.resolve_wellness_follow_up(uuid) to authenticated;

create or replace function public.get_wellness_status(p_session_id uuid)
returns table(
  encounter_id uuid,
  person_type text,
  person_id uuid,
  display_name text,
  fsy_id text,
  company_name text,
  group_name text,
  outcome text,
  started_at timestamptz,
  closed_at timestamptz,
  follow_up_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_capability(p_session_id, 'wellness_status') then raise exception 'Wellness status access required'; end if;
  return query
  select w.id, 'participant'::text, p.id, trim(concat_ws(' ', p.first_name, p.last_name)), b.fsy_id,
    coalesce(nullif(c.custom_name, ''), c.name), coalesce(nullif(g.custom_name, ''), g.name), w.outcome, w.started_at, w.closed_at, w.follow_up_status
  from public.wellness_encounters w
  join public.participants p on p.id = w.participant_id
  left join public.counselor_groups g on g.id = p.group_id
  left join public.companies c on c.id = g.company_id
  left join lateral (select badge.fsy_id from public.participant_badge_assignments badge where badge.session_id = p_session_id and badge.participant_id = p.id and badge.state <> 'retired' order by badge.assigned_at desc limit 1) b on true
  where w.session_id = p_session_id
    and (
      private.has_session_role(p_session_id, array['coordinator','logistics_admin','session_director']::public.app_role[])
      or (c.id is not null and private.can_access_company(p_session_id, c.id))
    )
  union all
  select w.id, 'staff'::text, s.id, s.full_name, null::text,
    coalesce(nullif(c.custom_name, ''), c.name), null::text, w.outcome, w.started_at, w.closed_at, w.follow_up_status
  from public.wellness_encounters w
  join public.staff s on s.id = w.staff_id
  left join public.companies c on c.id = s.assigned_company_id
  where w.session_id = p_session_id
    and (
      private.has_session_role(p_session_id, array['coordinator','logistics_admin','session_director']::public.app_role[])
      or (c.id is not null and private.can_access_company(p_session_id, c.id))
    )
  order by started_at desc;
end;
$$;
revoke all on function public.get_wellness_status(uuid) from public, anon;
grant execute on function public.get_wellness_status(uuid) to authenticated;

create or replace function public.get_wellness_encounters_v2(p_session_id uuid)
returns table(
  encounter_id uuid,
  person_type text,
  person_id uuid,
  display_name text,
  fsy_id text,
  company_name text,
  group_name text,
  concern text,
  care_provided text,
  medicine_provided text,
  outcome text,
  started_at timestamptz,
  closed_at timestamptz,
  follow_up_status text,
  follow_up_resolved_at timestamptz,
  recorded_by_name text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, 'participant'::text, p.id, trim(concat_ws(' ', p.first_name, p.last_name)), b.fsy_id,
    coalesce(nullif(c.custom_name, ''), c.name), coalesce(nullif(g.custom_name, ''), g.name),
    w.concern, w.care_provided, w.medicine_provided, w.outcome, w.started_at, w.closed_at, w.follow_up_status, w.follow_up_resolved_at, pr.display_name, w.updated_at
  from public.wellness_encounters w
  join public.participants p on p.id = w.participant_id
  left join public.counselor_groups g on g.id = p.group_id
  left join public.companies c on c.id = g.company_id
  left join lateral (select badge.fsy_id from public.participant_badge_assignments badge where badge.session_id = p_session_id and badge.participant_id = p.id and badge.state <> 'retired' order by badge.assigned_at desc limit 1) b on true
  left join public.profiles pr on pr.user_id = w.recorded_by
  where w.session_id = p_session_id and private.has_capability(p_session_id, 'wellness_private')
  union all
  select w.id, 'staff'::text, s.id, s.full_name, null::text,
    coalesce(nullif(c.custom_name, ''), c.name), null::text,
    w.concern, w.care_provided, w.medicine_provided, w.outcome, w.started_at, w.closed_at, w.follow_up_status, w.follow_up_resolved_at, pr.display_name, w.updated_at
  from public.wellness_encounters w
  join public.staff s on s.id = w.staff_id
  left join public.companies c on c.id = s.assigned_company_id
  left join public.profiles pr on pr.user_id = w.recorded_by
  where w.session_id = p_session_id and private.has_capability(p_session_id, 'wellness_private')
  order by started_at desc;
$$;
revoke all on function public.get_wellness_encounters_v2(uuid) from public, anon;
grant execute on function public.get_wellness_encounters_v2(uuid) to authenticated;

-- Independent meal service and attendance records. Dietary acknowledgements
-- remain a separate workflow and are not copied into this table.
create table if not exists public.meal_services(
  id uuid primary key default extensions.gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  service_date date not null,
  meal_type text not null check (meal_type in ('breakfast','lunch','dinner','snack','other')),
  label text,
  status text not null default 'planned' check (status in ('planned','open','closed')),
  opened_at timestamptz,
  closed_at timestamptz,
  created_by uuid not null references public.profiles(user_id),
  updated_by uuid references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id, service_date, meal_type)
);
create index if not exists meal_services_session_date_idx on public.meal_services(session_id, service_date, status);

create table if not exists public.meal_attendance(
  id uuid primary key default extensions.gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  meal_service_id uuid not null references public.meal_services(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete cascade,
  served_at timestamptz not null default now(),
  recorded_by uuid not null references public.profiles(user_id),
  constraint meal_attendance_person_check check ((participant_id is not null)::int + (staff_id is not null)::int = 1)
);
create unique index if not exists meal_attendance_participant_uq on public.meal_attendance(meal_service_id, participant_id) where participant_id is not null;
create unique index if not exists meal_attendance_staff_uq on public.meal_attendance(meal_service_id, staff_id) where staff_id is not null;
create index if not exists meal_attendance_session_service_idx on public.meal_attendance(session_id, meal_service_id, served_at desc);
alter table public.meal_services enable row level security;
alter table public.meal_attendance enable row level security;
revoke all on public.meal_services, public.meal_attendance from anon, authenticated;

create or replace function public.get_meal_services(p_session_id uuid, p_service_date date default null)
returns table(service_id uuid, service_date date, meal_type text, label text, status text, opened_at timestamptz, closed_at timestamptz, served_count integer, expected_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare target_date date := coalesce(p_service_date, current_date);
begin
  if not private.has_capability(p_session_id, 'food_view') then raise exception 'Food access required'; end if;
  return query
  select m.id, m.service_date, m.meal_type, coalesce(nullif(m.label, ''), initcap(m.meal_type)), m.status, m.opened_at, m.closed_at,
    (select count(*)::integer from public.meal_attendance a where a.meal_service_id = m.id),
    ((select count(*)::integer
       from public.participants p
       join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id and g.state = 'published'
       join public.companies c on c.id = g.company_id and c.session_id = p.session_id
       where p.session_id = p_session_id
         and private.operational_participant_is_eligible(p_session_id, p.id)
         and (not exists(select 1 from public.participant_badge_assignments b where b.session_id = p_session_id and b.participant_id = p.id)
           or exists(select 1 from public.participant_badge_assignments b where b.session_id = p_session_id and b.participant_id = p.id and b.state <> 'retired')))
       + (select count(*)::integer from public.staff s where s.session_id = p_session_id and s.is_current and s.registration_status = 'approved'))
  from public.meal_services m
  where m.session_id = p_session_id and m.service_date = target_date
  order by case m.meal_type when 'breakfast' then 1 when 'lunch' then 2 when 'dinner' then 3 when 'snack' then 4 else 5 end, m.id;
end;
$$;
revoke all on function public.get_meal_services(uuid, date) from public, anon;
grant execute on function public.get_meal_services(uuid, date) to authenticated;

create or replace function public.get_meal_roster(p_session_id uuid)
returns table(person_type text, person_id uuid, display_name text, fsy_id text, company_name text, group_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_capability(p_session_id, 'food_view') then raise exception 'Food access required'; end if;
  return query
  select 'participant'::text, p.id, trim(concat_ws(' ', p.first_name, p.last_name)), b.fsy_id,
    coalesce(nullif(c.custom_name, ''), c.name), coalesce(nullif(g.custom_name, ''), g.name)
  from public.participants p
  join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id and g.state = 'published'
  join public.companies c on c.id = g.company_id and c.session_id = p.session_id
  left join lateral (select badge.fsy_id from public.participant_badge_assignments badge where badge.session_id = p_session_id and badge.participant_id = p.id and badge.state <> 'retired' order by badge.assigned_at desc limit 1) b on true
  where p.session_id = p_session_id and private.operational_participant_is_eligible(p_session_id, p.id)
    and (not exists(select 1 from public.participant_badge_assignments b where b.session_id = p_session_id and b.participant_id = p.id)
      or exists(select 1 from public.participant_badge_assignments b where b.session_id = p_session_id and b.participant_id = p.id and b.state <> 'retired'))
  union all
  select 'staff'::text, s.id, s.full_name, null::text,
    coalesce(nullif(c.custom_name, ''), c.name), null::text
  from public.staff s
  left join public.companies c on c.id = s.assigned_company_id
  where s.session_id = p_session_id and s.is_current and s.registration_status = 'approved'
  order by display_name;
end;
$$;
revoke all on function public.get_meal_roster(uuid) from public, anon;
grant execute on function public.get_meal_roster(uuid) to authenticated;

create or replace function public.get_meal_attendance(p_meal_service_id uuid)
returns table(attendance_id uuid, person_type text, person_id uuid, display_name text, fsy_id text, company_name text, group_name text, served_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare target_session uuid;
begin
  select m.session_id into target_session from public.meal_services m where m.id = p_meal_service_id;
  if target_session is null then raise exception 'Meal service not found'; end if;
  if not private.has_capability(target_session, 'food_view') then raise exception 'Food access required'; end if;
  return query
  select a.id, 'participant'::text, p.id, trim(concat_ws(' ', p.first_name, p.last_name)), b.fsy_id,
    coalesce(nullif(c.custom_name, ''), c.name), coalesce(nullif(g.custom_name, ''), g.name), a.served_at
  from public.meal_attendance a
  join public.participants p on p.id = a.participant_id
  left join public.counselor_groups g on g.id = p.group_id
  left join public.companies c on c.id = g.company_id
  left join lateral (select badge.fsy_id from public.participant_badge_assignments badge where badge.session_id = target_session and badge.participant_id = p.id and badge.state <> 'retired' order by badge.assigned_at desc limit 1) b on true
  where a.meal_service_id = p_meal_service_id
  union all
  select a.id, 'staff'::text, s.id, s.full_name, null::text,
    coalesce(nullif(c.custom_name, ''), c.name), null::text, a.served_at
  from public.meal_attendance a
  join public.staff s on s.id = a.staff_id
  left join public.companies c on c.id = s.assigned_company_id
  where a.meal_service_id = p_meal_service_id
  order by served_at desc;
end;
$$;
revoke all on function public.get_meal_attendance(uuid) from public, anon;
grant execute on function public.get_meal_attendance(uuid) to authenticated;

create or replace function public.create_meal_service(p_session_id uuid, p_service_date date, p_meal_type text, p_label text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare service_id uuid;
begin
  if not private.has_capability(p_session_id, 'food_manage') then raise exception 'Your account cannot manage meal services'; end if;
  if p_service_date is null or p_meal_type not in ('breakfast','lunch','dinner','snack','other') then raise exception 'Choose a valid meal service'; end if;
  if not exists(
    select 1 from public.sessions s
    where s.id = p_session_id
      and (s.starts_on is null or p_service_date >= s.starts_on)
      and (s.ends_on is null or p_service_date <= s.ends_on)
  ) then raise exception 'Meal service date must be inside the session'; end if;
  insert into public.meal_services(session_id, service_date, meal_type, label, created_by, updated_by)
  values(p_session_id, p_service_date, p_meal_type, nullif(trim(coalesce(p_label, '')), ''), (select auth.uid()), (select auth.uid()))
  on conflict(session_id, service_date, meal_type) do update set label = coalesce(excluded.label, meal_services.label), updated_by = excluded.updated_by, updated_at = now()
  returning id into service_id;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(p_session_id, (select auth.uid()), 'meal_service_created', 'meal_service', service_id::text, jsonb_build_object('service_date', p_service_date, 'meal_type', p_meal_type));
  return service_id;
end;
$$;
revoke all on function public.create_meal_service(uuid, date, text, text) from public, anon;
grant execute on function public.create_meal_service(uuid, date, text, text) to authenticated;

create or replace function public.set_meal_service_status(p_service_id uuid, p_status text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare target public.meal_services%rowtype; changed_at timestamptz;
begin
  select * into target from public.meal_services where id = p_service_id for update;
  if target.id is null then raise exception 'Meal service not found'; end if;
  if not private.has_capability(target.session_id, 'food_manage') then raise exception 'Your account cannot manage meal services'; end if;
  if p_status not in ('open','closed') then raise exception 'Meal service status must be open or closed'; end if;
  if target.status = p_status then return coalesce(target.opened_at, target.closed_at); end if;
  if target.status = 'closed' then raise exception 'A closed meal service cannot be reopened'; end if;
  changed_at := now();
  update public.meal_services set status = p_status, opened_at = case when p_status = 'open' then coalesce(opened_at, changed_at) else opened_at end, closed_at = case when p_status = 'closed' then changed_at else null end, updated_by = (select auth.uid()), updated_at = changed_at where id = p_service_id;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(target.session_id, (select auth.uid()), case when p_status = 'open' then 'meal_service_opened' else 'meal_service_closed' end, 'meal_service', p_service_id::text, '{}'::jsonb);
  return changed_at;
end;
$$;
revoke all on function public.set_meal_service_status(uuid, text) from public, anon;
grant execute on function public.set_meal_service_status(uuid, text) to authenticated;

create or replace function public.mark_meal_served(p_meal_service_id uuid, p_person_type text, p_person_id uuid)
returns table(attendance_id uuid, served_at timestamptz, already_served boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.meal_services%rowtype;
  existing_id uuid;
  existing_at timestamptz;
  inserted_id uuid;
  inserted_at timestamptz;
begin
  select * into target from public.meal_services where id = p_meal_service_id for update;
  if target.id is null then raise exception 'Meal service not found'; end if;
  if not private.has_capability(target.session_id, 'food_manage') then raise exception 'Your account cannot record meal attendance'; end if;
  if target.status <> 'open' then raise exception 'Open the meal service before marking attendance'; end if;
  if p_person_type = 'participant' then
    if not exists(select 1 from public.participants p where p.id = p_person_id and p.session_id = target.session_id and private.operational_participant_is_eligible(target.session_id, p.id)) then raise exception 'Participant is not currently eligible for meal attendance'; end if;
    select a.id, a.served_at into existing_id, existing_at from public.meal_attendance a where a.meal_service_id = p_meal_service_id and a.participant_id = p_person_id;
    if existing_id is not null then return query select existing_id, existing_at, true; return; end if;
    insert into public.meal_attendance(session_id, meal_service_id, participant_id, recorded_by, served_at)
    values(target.session_id, p_meal_service_id, p_person_id, (select auth.uid()), now()) on conflict do nothing returning id, served_at into inserted_id, inserted_at;
  elsif p_person_type = 'staff' then
    if not exists(select 1 from public.staff s where s.id = p_person_id and s.session_id = target.session_id and s.is_current and s.registration_status = 'approved') then raise exception 'Staff member is not currently eligible for meal attendance'; end if;
    select a.id, a.served_at into existing_id, existing_at from public.meal_attendance a where a.meal_service_id = p_meal_service_id and a.staff_id = p_person_id;
    if existing_id is not null then return query select existing_id, existing_at, true; return; end if;
    insert into public.meal_attendance(session_id, meal_service_id, staff_id, recorded_by, served_at)
    values(target.session_id, p_meal_service_id, p_person_id, (select auth.uid()), now()) on conflict do nothing returning id, served_at into inserted_id, inserted_at;
  else raise exception 'Person type must be participant or staff'; end if;
  if inserted_id is null then
    if p_person_type = 'participant' then select a.id, a.served_at into inserted_id, inserted_at from public.meal_attendance a where a.meal_service_id = p_meal_service_id and a.participant_id = p_person_id;
    else select a.id, a.served_at into inserted_id, inserted_at from public.meal_attendance a where a.meal_service_id = p_meal_service_id and a.staff_id = p_person_id; end if;
    return query select inserted_id, inserted_at, true;
  end if;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(target.session_id, (select auth.uid()), 'meal_attendance_marked', 'meal_service', p_meal_service_id::text, jsonb_build_object('person_type', p_person_type, 'person_id', p_person_id));
  return query select inserted_id, inserted_at, false;
end;
$$;
revoke all on function public.mark_meal_served(uuid, text, uuid) from public, anon;
grant execute on function public.mark_meal_served(uuid, text, uuid) to authenticated;
