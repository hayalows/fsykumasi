-- Reversible operational state and voidable workflow actions.
-- This migration is additive: source registrations, identity history,
-- attendance history and audit events remain intact.

alter table public.participants
  add column if not exists operational_status text not null default 'active',
  add column if not exists operational_note text,
  add column if not exists operational_revision integer not null default 0,
  add column if not exists operational_updated_by uuid references public.profiles(user_id) on delete set null,
  add column if not exists operational_updated_at timestamptz not null default now();

alter table public.participants drop constraint if exists participants_operational_status_check;
alter table public.participants add constraint participants_operational_status_check
  check (operational_status in ('active','not_attending','did_not_arrive','withdrawn'));

create index if not exists participants_session_operational_status_idx
  on public.participants(session_id, operational_status, updated_at desc);
create index if not exists participants_session_operational_updated_idx
  on public.participants(session_id, operational_updated_at desc);

-- Preserve the v26 exception rule, while making the operational lifecycle a
-- first-class gate for grouping, identity, meals, housing and head count.
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
  select coalesce((
    select case
      when coalesce(p.operational_status, 'active') <> 'active' then false
      when o.cohort_state = 'excluded' then false
      when o.cohort_state = 'exception' then
        p.is_current
        and p.registration_status <> 'cancelled'
        and p.attendance_status <> 'confirmed_not_attending'
        and o.registration_confirmed
        and o.guardian_confirmed
        and o.leadership_confirmed
      when extract(year from age(s.starts_on, d.date_of_birth)) >= 20 then false
      else private.operational_participant_is_eligible_v25(target_session, target_participant)
    end
    from public.participants p
    join public.sessions s on s.id = p.session_id
    left join public.participant_private_details d on d.participant_id = p.id
    left join public.participant_operation_decisions o on o.participant_id = p.id
    where p.id = target_participant and p.session_id = target_session
  ), false);
$$;
revoke all on function private.operational_participant_is_eligible(uuid, uuid) from public;
grant execute on function private.operational_participant_is_eligible(uuid, uuid) to authenticated;

-- Keep the set-wise Registration projection aligned with the same lifecycle.
do $$
declare
  body text;
  original text;
begin
  if to_regprocedure('private.participant_eligibility_projection(uuid)') is null then
    raise exception 'Expected private.participant_eligibility_projection(uuid) before reversible operations migration';
  end if;
  body := pg_get_functiondef('private.participant_eligibility_projection(uuid)'::regprocedure);
  original := body;
  body := replace(
    body,
    'p.attendance_status <> ''confirmed_not_attending''',
    'coalesce(p.operational_status, ''active'') = ''active'' and p.attendance_status <> ''confirmed_not_attending'''
  );
  if body = original then
    raise exception 'Eligibility projection baseline drifted; operational lifecycle guard was not installed';
  end if;
  execute body;
end;
$$;

create or replace function public.get_participant_operational_states(p_session_id uuid)
returns table(
  participant_id uuid,
  operational_status text,
  operational_note text,
  operational_revision integer,
  operational_updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, coalesce(p.operational_status, 'active'), p.operational_note,
    coalesce(p.operational_revision, 0), p.operational_updated_at
  from public.participants p
  left join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id
  where p.session_id = p_session_id
    and private.has_session_access(p_session_id)
    and (
      private.has_session_role(p_session_id, array['coordinator','logistics_admin','session_director']::public.app_role[])
      or (
        not private.has_session_role(p_session_id, array['assistant_coordinator']::public.app_role[])
        and (
          private.has_capability(p_session_id, 'people_lookup')
          or private.has_capability(p_session_id, 'registration_view')
          or private.has_capability(p_session_id, 'registration_manage')
          or private.has_capability(p_session_id, 'reports_export')
        )
      )
      or (g.company_id is not null and private.can_access_company(p_session_id, g.company_id))
    );
$$;
revoke all on function public.get_participant_operational_states(uuid) from public, anon;
grant execute on function public.get_participant_operational_states(uuid) to authenticated;

create or replace function public.get_participant_checkin_state(p_session_id uuid, p_participant_id uuid)
returns table(participant_id uuid, status text, recorded_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.participant_id, c.status::text, c.recorded_at
  from public.check_ins c
  where c.session_id = p_session_id and c.participant_id = p_participant_id
    and private.has_session_access(p_session_id)
    and (
      private.has_session_role(p_session_id, array['coordinator','logistics_admin','session_director']::public.app_role[])
      or (
        not private.has_session_role(p_session_id, array['assistant_coordinator']::public.app_role[])
        and (
          private.has_capability(p_session_id, 'people_lookup')
          or private.has_capability(p_session_id, 'registration_view')
          or private.has_capability(p_session_id, 'registration_manage')
          or private.has_capability(p_session_id, 'reports_export')
        )
      )
      or exists (
        select 1
        from public.participants p
        left join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id
        where p.id = c.participant_id and p.session_id = c.session_id
          and g.company_id is not null and private.can_access_company(p_session_id, g.company_id)
      )
    );
$$;
revoke all on function public.get_participant_checkin_state(uuid, uuid) from public, anon;
grant execute on function public.get_participant_checkin_state(uuid, uuid) to authenticated;

create or replace function public.get_participant_checkin_states(p_session_id uuid)
returns table(participant_id uuid, status text, recorded_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.participant_id, c.status::text, c.recorded_at
  from public.check_ins c
  where c.session_id = p_session_id and private.has_session_access(p_session_id)
    and (
      private.has_session_role(p_session_id, array['coordinator','logistics_admin','session_director']::public.app_role[])
      or (
        not private.has_session_role(p_session_id, array['assistant_coordinator']::public.app_role[])
        and (
          private.has_capability(p_session_id, 'people_lookup')
          or private.has_capability(p_session_id, 'registration_view')
          or private.has_capability(p_session_id, 'registration_manage')
          or private.has_capability(p_session_id, 'reports_export')
        )
      )
      or exists (
        select 1
        from public.participants p
        left join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id
        where p.id = c.participant_id and p.session_id = c.session_id
          and g.company_id is not null and private.can_access_company(p_session_id, g.company_id)
      )
    );
$$;
revoke all on function public.get_participant_checkin_states(uuid) from public, anon;
grant execute on function public.get_participant_checkin_states(uuid) to authenticated;

-- Keep the server permission boundary aligned with the Registration UI: whole-
-- session leaders can record any participant, while scoped operators can only
-- record a participant in one of their assigned companies.
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
  if not (
    private.has_session_role(p_session_id, array['coordinator','logistics_admin','session_director']::public.app_role[])
    or (
      private.has_capability(p_session_id, 'checkin_record')
      and (
        not private.has_session_role(p_session_id, array['assistant_coordinator']::public.app_role[])
        or exists (
          select 1
          from public.participants p
          join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id
          where p.id = p_participant_id
            and p.session_id = p_session_id
            and private.can_access_company(p_session_id, g.company_id)
        )
      )
    )
  ) then raise exception 'Your role cannot record check-in for this participant'; end if;

  if not exists (
    select 1 from public.participants p
    where p.id = p_participant_id and p.session_id = p_session_id
  ) then raise exception 'Participant does not belong to this session'; end if;

  if not private.operational_participant_is_eligible(p_session_id, p_participant_id) then
    raise exception 'This record is outside the current youth operational eligibility rules';
  end if;

  if exists (
    select 1 from public.counselor_groups g
    where g.session_id = p_session_id and g.state = 'published'
  ) and not exists (
    select 1 from public.participants p
    where p.id = p_participant_id and p.session_id = p_session_id and p.group_id is not null
  ) then
    raise exception 'Participant still needs a counselor group assignment';
  end if;

  insert into public.check_ins(session_id, participant_id, status, note, recorded_by, recorded_at)
  values (p_session_id, p_participant_id, p_status, nullif(trim(coalesce(p_note, '')), ''), auth.uid(), now())
  on conflict (session_id, participant_id) do update set
    status = excluded.status,
    note = excluded.note,
    recorded_by = excluded.recorded_by,
    recorded_at = excluded.recorded_at;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_session_id, auth.uid(), 'participant_checkin_recorded', 'participant', p_participant_id::text,
    jsonb_build_object('status', p_status));
end;
$$;
revoke all on function public.record_participant_checkin(uuid, uuid, public.check_in_status, text) from public, anon;
grant execute on function public.record_participant_checkin(uuid, uuid, public.check_in_status, text) to authenticated;

create or replace function public.set_participant_operational_status(
  p_participant_id uuid,
  p_status text,
  p_revision integer,
  p_authority text default '',
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.participants%rowtype;
  previous_group uuid;
  previous_checkin public.check_in_status;
  released_housing uuid;
  headcount_released integer := 0;
  allowed boolean;
  normalized_reason text := nullif(trim(coalesce(p_reason, '')), '');
  normalized_authority text := nullif(trim(coalesce(p_authority, '')), '');
begin
  if p_status not in ('active','not_attending','did_not_arrive','withdrawn') then
    raise exception 'Choose a valid operational status';
  end if;

  select * into target from public.participants where id = p_participant_id for update;
  if target.id is null then raise exception 'Participant not found'; end if;

  allowed := private.has_capability(target.session_id, 'registration_manage')
    or private.has_session_role(target.session_id, array['coordinator','logistics_admin','session_director']::public.app_role[]);
  if not allowed then raise exception 'Registration management access required'; end if;
  if coalesce(target.operational_revision, 0) is distinct from p_revision then
    raise exception 'Participant status changed. Refresh and review the latest record';
  end if;
  if p_status <> 'active' and length(coalesce(normalized_reason, '')) < 5 then
    raise exception 'Record an operational reason before removing this participant from active work';
  end if;
  if p_status = 'withdrawn' and length(coalesce(normalized_authority, '')) < 3 then
    raise exception 'Record the confirming authority before withdrawing this participant';
  end if;
  if p_status = 'did_not_arrive' and exists(
    select 1 from public.check_ins ci
    where ci.session_id = target.session_id and ci.participant_id = target.id and ci.status = 'arrived'
  ) then
    raise exception 'A participant who checked in cannot be marked did not arrive';
  end if;

  previous_group := target.group_id;
  select ci.status into previous_checkin
  from public.check_ins ci
  where ci.session_id = target.session_id and ci.participant_id = target.id
  for update;

  if p_status <> 'active' then
    update public.housing_assignments
    set active = false, ended_at = now()
    where session_id = target.session_id and participant_id = target.id and active
    returning id into released_housing;

    if released_housing is not null then
      insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
      values(target.session_id, auth.uid(), 'housing_unassigned_for_participant_status', 'housing_assignment', released_housing::text,
        jsonb_build_object('participant_id', target.id, 'status', p_status));
    end if;

    if previous_checkin = 'arrived' then
      update public.check_ins
      set status = 'departed', note = coalesce(normalized_reason, note), recorded_by = auth.uid(), recorded_at = now()
      where session_id = target.session_id and participant_id = target.id;
    end if;

    -- Open head-count rounds are live operational work. Release this person
    -- from those snapshots without rewriting closed or voided history.
    update public.headcount_round_people hp
    set status = 'not_expected',
        note = coalesce(normalized_reason, hp.note),
        revision = hp.revision + 1,
        recorded_by = auth.uid(),
        recorded_at = now()
    from public.headcount_rounds hr
    where hp.round_id = hr.id
      and hp.session_id = target.session_id
      and hp.person_type = 'participant'
      and hp.person_id = target.id
      and hr.session_id = target.session_id
      and hr.roster_version = 3
      and hr.closes_at is null
      and hp.status <> 'not_expected';
    get diagnostics headcount_released = row_count;
  end if;

  update public.participants
  set operational_status = p_status,
      operational_note = normalized_reason,
      operational_revision = coalesce(operational_revision, 0) + 1,
      operational_updated_by = auth.uid(),
      operational_updated_at = now(),
      attendance_status = case when p_status = 'active' then 'expected' else 'confirmed_not_attending' end,
      attendance_note = case when p_status = 'active' then null else normalized_reason end,
      attendance_updated_by = auth.uid(),
      attendance_updated_at = now(),
      group_id = case when p_status = 'active' then group_id else null end,
      updated_at = now()
  where id = target.id and coalesce(operational_revision, 0) = p_revision;
  if not found then raise exception 'Participant status changed. Refresh and review the latest record'; end if;

  insert into public.participant_arrival_events(session_id, participant_id, status, note, recorded_by)
  values(target.session_id, target.id, case when p_status = 'active' then 'expected' else 'confirmed_not_attending' end,
    normalized_reason, auth.uid());

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(target.session_id, auth.uid(), 'participant_operational_status_changed', 'participant', target.id::text,
    jsonb_build_object(
      'before_status', coalesce(target.operational_status, 'active'),
      'status', p_status,
      'reason', normalized_reason,
      'authority', normalized_authority,
      'previous_group_id', previous_group,
      'released_housing_id', released_housing,
      'headcount_released_count', headcount_released,
      'previous_checkin_status', previous_checkin
    ));

  return jsonb_build_object(
    'participant_id', target.id,
    'status', p_status,
    'revision', p_revision + 1,
    'released_group_id', case when p_status = 'active' then null else previous_group end,
    'released_housing_id', released_housing,
    'headcount_released_count', headcount_released,
    'checkin_status', case when p_status = 'active' then coalesce(previous_checkin::text, 'expected') else case when previous_checkin = 'arrived' then 'departed' else coalesce(previous_checkin::text, 'expected') end end
  );
end;
$$;
revoke all on function public.set_participant_operational_status(uuid, text, integer, text, text) from public, anon;
grant execute on function public.set_participant_operational_status(uuid, text, integer, text, text) to authenticated;

-- Undo is safe only for the exact arrival event the operator just created.
create or replace function public.undo_participant_checkin(
  p_session_id uuid,
  p_participant_id uuid,
  p_expected_recorded_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.check_ins%rowtype;
  participant_company uuid;
begin
  select g.company_id into participant_company
  from public.participants p
  left join public.counselor_groups g on g.id = p.group_id
  where p.id = p_participant_id and p.session_id = p_session_id;

  if not (
    private.has_session_role(p_session_id, array['coordinator','logistics_admin','session_director']::public.app_role[])
    or (
      private.has_capability(p_session_id, 'checkin_record')
      and (
        not private.has_session_role(p_session_id, array['assistant_coordinator']::public.app_role[])
        or (
          participant_company is not null
          and private.can_access_company(p_session_id, participant_company)
        )
      )
    )
  ) then raise exception 'Your account cannot undo check-in for this participant'; end if;

  select * into target
  from public.check_ins
  where session_id = p_session_id and participant_id = p_participant_id
  for update;
  if target.id is null then return jsonb_build_object('undone', false, 'reason', 'no_checkin'); end if;
  if target.status <> 'arrived' then return jsonb_build_object('undone', false, 'reason', 'not_arrived', 'status', target.status::text); end if;
  if p_expected_recorded_at is not null and target.recorded_at is distinct from p_expected_recorded_at then
    raise exception 'This check-in changed again. Refresh before trying to undo it';
  end if;

  update public.check_ins
  set status = 'expected', note = null, recorded_by = auth.uid(), recorded_at = now()
  where id = target.id;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(p_session_id, auth.uid(), 'participant_checkin_undone', 'participant', p_participant_id::text,
    jsonb_build_object('previous_status', target.status::text, 'previous_recorded_at', target.recorded_at, 'previous_recorded_by', target.recorded_by));
  return jsonb_build_object('undone', true, 'participant_id', p_participant_id, 'status', 'expected');
end;
$$;
revoke all on function public.undo_participant_checkin(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.undo_participant_checkin(uuid, uuid, timestamptz) to authenticated;

-- Room edits cannot reduce capacity below current occupancy. The existing
-- signature remains intact so older clients receive the same safety rule.
create or replace function public.save_housing_room(
  p_session_id uuid,
  p_room_id uuid,
  p_room_name text,
  p_building text default null,
  p_floor text default null,
  p_sex public.participant_sex default null,
  p_capacity integer default 1,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid uuid;
  occupied integer := 0;
  old_capacity integer;
begin
  if not private.has_capability(p_session_id, 'housing_manage') then raise exception 'Your account cannot manage Housing'; end if;
  if nullif(trim(coalesce(p_room_name, '')), '') is null then raise exception 'Room name is required'; end if;
  if p_capacity < 1 or p_capacity > 50 then raise exception 'Room capacity must be between 1 and 50'; end if;

  if p_room_id is null then
    insert into public.housing_rooms(session_id, room_name, building, floor, sex, capacity, notes, created_by)
    values(p_session_id, trim(p_room_name), nullif(trim(coalesce(p_building, '')), ''), nullif(trim(coalesce(p_floor, '')), ''), p_sex, p_capacity, nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
    returning id into rid;
  else
    select r.capacity into old_capacity
    from public.housing_rooms r
    where r.id = p_room_id and r.session_id = p_session_id
    for update;
    if old_capacity is null then raise exception 'Housing room not found'; end if;
    select count(*)::integer into occupied
    from public.housing_assignments a
    where a.room_id = p_room_id and a.active;
    if p_capacity < occupied then raise exception 'Capacity cannot be lower than the % people already assigned', occupied; end if;
    update public.housing_rooms
    set room_name = trim(p_room_name),
        building = nullif(trim(coalesce(p_building, '')), ''),
        floor = nullif(trim(coalesce(p_floor, '')), ''),
        sex = p_sex,
        capacity = p_capacity,
        notes = nullif(trim(coalesce(p_notes, '')), ''),
        updated_at = now()
    where id = p_room_id and session_id = p_session_id
    returning id into rid;
  end if;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(p_session_id, auth.uid(), case when p_room_id is null then 'housing_room_created' else 'housing_room_updated' end, 'housing_room', rid::text,
    jsonb_build_object('room_name', trim(p_room_name), 'capacity', p_capacity, 'previous_capacity', old_capacity, 'occupancy', occupied));
  return rid;
end;
$$;
revoke all on function public.save_housing_room(uuid, uuid, text, text, text, public.participant_sex, integer, text) from public, anon;
grant execute on function public.save_housing_room(uuid, uuid, text, text, text, public.participant_sex, integer, text) to authenticated;

create or replace function public.clear_housing_assignment_v2(
  p_session_id uuid,
  p_person_type text,
  p_person_id uuid,
  p_expected_assignment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target public.housing_assignments%rowtype;
begin
  if not private.has_capability(p_session_id, 'housing_manage') then raise exception 'Your account cannot manage Housing'; end if;
  select * into target
  from public.housing_assignments
  where id = p_expected_assignment_id and session_id = p_session_id and active
    and ((p_person_type = 'participant' and participant_id = p_person_id) or (p_person_type = 'staff' and staff_id = p_person_id))
  for update;
  if target.id is null then raise exception 'The room assignment changed. Refresh before unassigning'; end if;
  update public.housing_assignments set active = false, ended_at = now() where id = target.id;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(p_session_id, auth.uid(), 'housing_unassigned', 'housing_assignment', target.id::text,
    jsonb_build_object('person_type', p_person_type, 'person_id', p_person_id, 'room_id', target.room_id, 'bed_label', target.bed_label, 'reversible', true));
  return jsonb_build_object('assignment_id', target.id, 'room_id', target.room_id, 'person_type', p_person_type, 'person_id', p_person_id, 'bed_label', target.bed_label);
end;
$$;
revoke all on function public.clear_housing_assignment_v2(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.clear_housing_assignment_v2(uuid, text, uuid, uuid) to authenticated;

create or replace function public.restore_housing_assignment_v1(p_session_id uuid, p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.housing_assignments%rowtype;
  room_row public.housing_rooms%rowtype;
  occupancy integer;
  person_sex public.participant_sex;
begin
  if not private.has_capability(p_session_id, 'housing_manage') then raise exception 'Your account cannot manage Housing'; end if;
  select * into target from public.housing_assignments where id = p_assignment_id and session_id = p_session_id for update;
  if target.id is null then raise exception 'Housing assignment not found'; end if;
  if target.active then return jsonb_build_object('restored', false, 'reason', 'already_active', 'assignment_id', target.id); end if;
  select * into room_row from public.housing_rooms where id = target.room_id and session_id = p_session_id and active for update;
  if room_row.id is null then raise exception 'The original room is no longer available'; end if;
  if target.participant_id is not null then
    select p.sex into person_sex from public.participants p where p.id = target.participant_id and p.session_id = p_session_id and p.is_current and private.operational_participant_is_eligible(p_session_id, p.id);
    if person_sex is null then raise exception 'This participant is no longer eligible for active Housing'; end if;
    if exists(select 1 from public.housing_assignments a where a.session_id = p_session_id and a.participant_id = target.participant_id and a.active) then raise exception 'This participant already has another active room'; end if;
  else
    select s.sex into person_sex from public.staff s where s.id = target.staff_id and s.session_id = p_session_id and s.is_current;
    if person_sex is null then raise exception 'This staff member is no longer active'; end if;
    if exists(select 1 from public.housing_assignments a where a.session_id = p_session_id and a.staff_id = target.staff_id and a.active) then raise exception 'This staff member already has another active room'; end if;
  end if;
  if room_row.sex is not null and person_sex is not null and room_row.sex <> person_sex then raise exception 'The original room is no longer compatible'; end if;
  select count(*)::integer into occupancy from public.housing_assignments where room_id = room_row.id and active;
  if occupancy >= room_row.capacity then raise exception 'The original room is full'; end if;
  update public.housing_assignments set active = true, ended_at = null where id = target.id;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(p_session_id, auth.uid(), 'housing_assignment_restored', 'housing_assignment', target.id::text, jsonb_build_object('room_id', room_row.id, 'occupancy_before', occupancy));
  return jsonb_build_object('restored', true, 'assignment_id', target.id, 'room_id', target.room_id);
end;
$$;
revoke all on function public.restore_housing_assignment_v1(uuid, uuid) from public, anon;
grant execute on function public.restore_housing_assignment_v1(uuid, uuid) to authenticated;

create or replace function public.set_staff_operational_status_v1(
  p_staff_id uuid,
  p_status text,
  p_revision integer,
  p_authority text default '',
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  staff_row public.staff%rowtype;
  old_ops public.staff_operations%rowtype;
  previous_group_ids jsonb;
  previous_company_ids jsonb;
  released_housing uuid;
  normalized_reason text := nullif(trim(coalesce(p_reason, '')), '');
  normalized_authority text := nullif(trim(coalesce(p_authority, '')), '');
begin
  if p_status not in ('active','no_show','left','withdrawn') then raise exception 'Choose a valid staff operational status'; end if;
  select * into staff_row from public.staff where id = p_staff_id for update;
  if staff_row.id is null then raise exception 'Staff member not found'; end if;
  if not private.has_capability(staff_row.session_id, 'staff_manage') then raise exception 'Staff management access is required'; end if;
  if p_status = 'withdrawn' and not private.has_session_role(staff_row.session_id, array['coordinator','logistics_admin','session_director']::public.app_role[]) then
    raise exception 'Session leadership is required to withdraw a staff member';
  end if;
  if p_status <> 'active' and length(coalesce(normalized_reason, '')) < 5 then raise exception 'Record an operational reason'; end if;
  if p_status = 'withdrawn' and length(coalesce(normalized_authority, '')) < 3 then raise exception 'Record the confirming authority'; end if;

  select * into old_ops from public.staff_operations where staff_id = p_staff_id for update;
  if old_ops.revision is distinct from p_revision then raise exception 'Staff state changed. Refresh before updating it'; end if;
  select coalesce(jsonb_agg(g.id order by g.id), '[]'::jsonb) into previous_group_ids from public.counselor_groups g where g.counselor_id = p_staff_id;
  select coalesce(jsonb_agg(a.company_id order by a.company_id), '[]'::jsonb) into previous_company_ids from public.staff_company_assignments a where a.staff_id = p_staff_id;

  if p_status <> 'active' then
    update public.counselor_groups set counselor_id = null where counselor_id = p_staff_id;
    delete from public.staff_company_assignments where staff_id = p_staff_id;
    update public.staff set assigned_company_id = null, is_current = case when p_status = 'withdrawn' then false else is_current end where id = p_staff_id;
    update public.housing_assignments set active = false, ended_at = now() where session_id = staff_row.session_id and staff_id = p_staff_id and active returning id into released_housing;
  else
    if staff_row.is_current is false then
      raise exception 'A withdrawn staff record must be reactivated through source registration review';
    end if;
  end if;

  update public.staff_operations
  set planning_state = case when p_status = 'withdrawn' then 'excluded' when p_status = 'active' and planning_state = 'excluded' then 'reserve' else planning_state end,
      arrival_state = case when p_status = 'active' then 'expected' when p_status = 'no_show' then 'no_show' else 'left' end,
      revision = revision + 1, updated_by = auth.uid(), updated_at = now()
  where staff_id = p_staff_id;
  if not found then raise exception 'Staff operations record is missing'; end if;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(staff_row.session_id, auth.uid(), 'staff_operational_status_changed', 'staff', p_staff_id::text,
    jsonb_build_object('before', to_jsonb(old_ops), 'status', p_status, 'reason', normalized_reason, 'authority', normalized_authority,
      'released_group_ids', previous_group_ids, 'released_company_ids', previous_company_ids, 'released_housing_id', released_housing));
  return jsonb_build_object('staff_id', p_staff_id, 'status', p_status, 'revision', old_ops.revision + 1, 'released_housing_id', released_housing,
    'released_group_ids', previous_group_ids, 'released_company_ids', previous_company_ids);
end;
$$;
revoke all on function public.set_staff_operational_status_v1(uuid, text, integer, text, text) from public, anon;
grant execute on function public.set_staff_operational_status_v1(uuid, text, integer, text, text) to authenticated;

-- Meal attendance remains intact when a service is voided. Reports can exclude
-- the void service while audit/history still explains what happened.
alter table public.meal_services drop constraint if exists meal_services_status_check;
alter table public.meal_services add constraint meal_services_status_check check (status in ('planned','open','closed','void'));

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
  if target.status in ('closed','void') then raise exception 'A closed or void meal service cannot be reopened'; end if;
  changed_at := now();
  update public.meal_services
  set status = p_status,
      opened_at = case when p_status = 'open' then coalesce(opened_at, changed_at) else opened_at end,
      closed_at = case when p_status = 'closed' then changed_at else null end,
      updated_by = auth.uid(), updated_at = changed_at
  where id = p_service_id;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(target.session_id, auth.uid(), case when p_status = 'open' then 'meal_service_opened' else 'meal_service_closed' end, 'meal_service', p_service_id::text, '{}'::jsonb);
  return changed_at;
end;
$$;
revoke all on function public.set_meal_service_status(uuid, text) from public, anon;
grant execute on function public.set_meal_service_status(uuid, text) to authenticated;

create or replace function public.cancel_meal_service_v1(p_service_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target public.meal_services%rowtype; served_count integer; normalized_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into target from public.meal_services where id = p_service_id for update;
  if target.id is null then raise exception 'Meal service not found'; end if;
  if not private.has_session_role(target.session_id, array['coordinator','logistics_admin','session_director']::public.app_role[]) then raise exception 'Session leadership required to void meal services'; end if;
  if length(coalesce(normalized_reason, '')) < 5 then raise exception 'Record why this meal service is being voided'; end if;
  select count(*)::integer into served_count from public.meal_attendance where meal_service_id = p_service_id;
  if target.status = 'void' then return jsonb_build_object('voided', false, 'reason', 'already_void', 'served_count', served_count); end if;
  update public.meal_services set status = 'void', closed_at = coalesce(closed_at, now()), updated_by = auth.uid(), updated_at = now() where id = p_service_id;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(target.session_id, auth.uid(), 'meal_service_voided', 'meal_service', p_service_id::text,
    jsonb_build_object('reason', normalized_reason, 'served_count', served_count, 'previous_status', target.status));
  return jsonb_build_object('voided', true, 'served_count', served_count, 'history_preserved', true);
end;
$$;
revoke all on function public.cancel_meal_service_v1(uuid, text) from public, anon;
grant execute on function public.cancel_meal_service_v1(uuid, text) to authenticated;

alter table public.headcount_rounds
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles(user_id) on delete set null,
  add column if not exists void_reason text;
create index if not exists headcount_rounds_session_status_idx on public.headcount_rounds(session_id, voided_at, opens_at desc);

create or replace function public.get_headcount_roster_v4(p_session_id uuid, p_round_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.has_capability(p_session_id, 'headcount_view') or private.has_capability(p_session_id, 'headcount_record')) then
    return jsonb_build_object('rounds', '[]'::jsonb, 'people', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'rounds', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'label', r.label, 'opens_at', r.opens_at, 'closes_at', r.closes_at,
      'voided_at', r.voided_at, 'void_reason', r.void_reason,
      'status', case when r.voided_at is not null then 'void' when r.closes_at is not null then 'closed' else 'open' end
    ) order by r.opens_at desc) from public.headcount_rounds r where r.session_id = p_session_id and r.roster_version = 3), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(to_jsonb(p) - 'recorded_by' order by p.company_name, p.display_name, p.id)
      from public.headcount_round_people p
      where p.session_id = p_session_id
        and p.round_id = coalesce(p_round_id, (select r.id from public.headcount_rounds r where r.session_id = p_session_id and r.roster_version = 3 order by r.opens_at desc limit 1))
        and (private.has_session_role(p_session_id, array['coordinator','logistics_admin','session_director']::public.app_role[])
          or (p.company_id is not null and private.can_access_company(p_session_id, p.company_id)))), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_headcount_roster_v4(uuid, uuid) from public, anon;
grant execute on function public.get_headcount_roster_v4(uuid, uuid) to authenticated;

-- The summary RPC feeds overview and older consumers. Do not let a voided
-- round remain the active round after its roster is preserved for history.
create or replace function public.get_headcount_summary_v3(p_session_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 with current_round as (
 select r.* from public.headcount_rounds r where r.session_id=p_session_id and r.roster_version=3 and r.voided_at is null
 and (private.has_capability(p_session_id,'headcount_view') or private.has_capability(p_session_id,'headcount_record'))
 order by r.opens_at desc limit 1
 ), visible as (
 select p.* from public.headcount_round_people p join current_round r on r.id=p.round_id
 where private.has_session_role(p_session_id,array['coordinator','logistics_admin','session_director']::public.app_role[])
 or (p.company_id is not null and private.can_access_company(p_session_id,p.company_id))
 ) select jsonb_build_object('round',(select jsonb_build_object('id',id,'label',label,'opens_at',opens_at,'closes_at',closes_at) from current_round),
 'unresolved',(select count(*) from visible where status='unresolved'),
 'missing',(select count(*) from visible where status='missing'),
 'total',(select count(*) from visible));
$$;
revoke all on function public.get_headcount_summary_v3(uuid) from public,anon;
grant execute on function public.get_headcount_summary_v3(uuid) to authenticated;

create or replace function public.cancel_headcount_round_v1(p_round_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target public.headcount_rounds%rowtype; normalized_reason text := nullif(trim(coalesce(p_reason, '')), ''); people_count integer;
begin
  select * into target from public.headcount_rounds where id = p_round_id for update;
  if target.id is null then raise exception 'Head-count round not found'; end if;
  if not private.has_session_role(target.session_id, array['coordinator','logistics_admin','session_director']::public.app_role[]) then raise exception 'Session leadership required'; end if;
  if length(coalesce(normalized_reason, '')) < 5 then raise exception 'Record why this head-count round is being voided'; end if;
  select count(*)::integer into people_count from public.headcount_round_people where round_id = p_round_id;
  if target.voided_at is not null then return jsonb_build_object('voided', false, 'reason', 'already_void', 'people_count', people_count); end if;
  update public.headcount_rounds set voided_at = now(), voided_by = auth.uid(), void_reason = normalized_reason, closes_at = coalesce(closes_at, now()) where id = p_round_id;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(target.session_id, auth.uid(), 'headcount_round_voided', 'headcount_round', p_round_id::text,
    jsonb_build_object('reason', normalized_reason, 'people_count', people_count, 'previously_closed', target.closes_at is not null));
  return jsonb_build_object('voided', true, 'people_count', people_count, 'history_preserved', true);
end;
$$;
revoke all on function public.cancel_headcount_round_v1(uuid, text) from public, anon;
grant execute on function public.cancel_headcount_round_v1(uuid, text) to authenticated;

-- Keep active operational reports honest after a correction. The audit report
-- still includes the void action and the underlying attendance/submission rows
-- remain available through their history views.
do $$
declare
  body text;
  original text;
begin
  if to_regprocedure('public.get_operational_report(uuid,text)') is null then
    raise exception 'Expected public.get_operational_report(uuid,text) before reversible operations migration';
  end if;
  body := pg_get_functiondef('public.get_operational_report(uuid,text)'::regprocedure);
  original := body;
  body := replace(
    body,
    'where ma.session_id = p_session_id',
    'where ma.session_id = p_session_id and ms.status <> ''void'''
  );
  body := replace(
    body,
    'from public.meal_services ms where ms.session_id = p_session_id',
    'from public.meal_services ms where ms.session_id = p_session_id and ms.status <> ''void'''
  );
  body := regexp_replace(
    body,
    'where r[.]session_id = p_session_id[[:space:]]+and [(]not private[.]is_assistant_coordinator',
    E'where r.session_id = p_session_id\n        and r.voided_at is null\n        and (not private.is_assistant_coordinator',
    1
  );
  body := regexp_replace(
    body,
    'from public[.]meal_services ms[[:space:]]+where ms[.]session_id = p_session_id',
    'from public.meal_services ms where ms.session_id = p_session_id and ms.status <> ''void''',
    1
  );
  body := replace(
    body,
    'a.action in (''company_headcount_submitted'',',
    'a.action in (''headcount_round_voided'',''participant_operational_status_changed'',''participant_checkin_recorded'',''participant_checkin_undone'',''staff_operational_status_changed'',''housing_room_created'',''housing_room_updated'',''housing_unassigned'',''housing_unassigned_for_participant_status'',''housing_assignment_restored'',''company_headcount_submitted'', '
  );
  if body = original
     or position('r.voided_at is null' in body) = 0
     or position('ms.status <> ''void''' in body) = 0
     or position('headcount_round_voided' in body) = 0 then
    raise exception 'Operational report baseline drifted; void/history filters were not installed';
  end if;
  execute body;
end;
$$;

-- The operational overview also selects the latest modern round directly.
-- Exclude voided rounds there so a correction cannot look like active work.
do $$
declare
  body text;
  original text;
begin
  if to_regprocedure('public.get_my_operational_overview(uuid)') is null then
    raise exception 'Expected public.get_my_operational_overview(uuid) before reversible operations migration';
  end if;
  body := pg_get_functiondef('public.get_my_operational_overview(uuid)'::regprocedure);
  original := body;
  body := replace(
    body,
    'where r.session_id = p_session_id and r.roster_version >= 3',
    'where r.session_id = p_session_id and r.roster_version >= 3 and r.voided_at is null'
  );
  if body = original or position('r.voided_at is null' in body) = 0 then
    raise exception 'Operational overview baseline drifted; voided rounds remain eligible';
  end if;
  execute body;
end;
$$;
