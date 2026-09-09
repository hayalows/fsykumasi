-- Pre-session finalization for FSY Kumasi 2026.
--
-- This keeps imported/source registration and identity history intact while
-- giving the operational team a simple, auditable way to finish the roster
-- before Day One. Logistical administrators share the pre-session confirmation
-- authority with the Session Directing Couple. No source registration row is
-- rewritten to pretend an external approval changed.

-- A youth who is still 18 when the session starts remains in the youth cohort.
-- This replaces the older upper-age rule that required the participant to stay
-- under 19 through the final day of the session.
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
      else
        p.is_current
        and p.registration_status = 'approved'
        and p.verification_status = 'verified'
        and p.attendance_status <> 'confirmed_not_attending'
        and d.date_of_birth is not null
        and s.starts_on is not null
        and s.ends_on is not null
        and extract(year from s.starts_on)::int - extract(year from d.date_of_birth)::int >= 14
        and extract(year from age(s.starts_on, d.date_of_birth)) < 19
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

create or replace function private.participant_eligibility_projection(target_session uuid)
returns table(participant_id uuid, eligible boolean, reason text)
language sql
stable
security definer
set search_path = ''
as $$
  with evaluated as (
    select
      p.id as participant_id,
      p.is_current,
      p.registration_status,
      p.verification_status,
      p.attendance_status,
      p.operational_status,
      s.starts_on,
      s.ends_on,
      d.date_of_birth,
      od.cohort_state,
      coalesce(
        case
          when coalesce(p.operational_status, 'active') <> 'active' then false
          when od.cohort_state = 'excluded' then false
          when od.cohort_state = 'exception' then
            p.is_current
            and p.registration_status <> 'cancelled'
            and p.attendance_status <> 'confirmed_not_attending'
            and od.registration_confirmed
            and od.guardian_confirmed
            and od.leadership_confirmed
          else
            p.is_current
            and p.registration_status = 'approved'
            and p.verification_status = 'verified'
            and p.attendance_status <> 'confirmed_not_attending'
            and d.date_of_birth is not null
            and s.starts_on is not null
            and s.ends_on is not null
            and extract(year from s.starts_on)::int - extract(year from d.date_of_birth)::int >= 14
            and extract(year from age(s.starts_on, d.date_of_birth)) < 19
        end,
        false
      ) as eligible
    from public.participants p
    join public.sessions s on s.id = p.session_id
    left join public.participant_private_details d on d.participant_id = p.id
    left join public.participant_operation_decisions od on od.participant_id = p.id
    where p.session_id = target_session
  )
  select
    e.participant_id,
    e.eligible,
    case
      when e.eligible then 'Eligible'
      when e.cohort_state = 'excluded' then 'Excluded from active youth operations'
      when e.attendance_status = 'confirmed_not_attending' then 'Confirmed not attending'
      when coalesce(e.operational_status, 'active') <> 'active' then 'Not active in session operations'
      when not e.is_current then 'Not current in latest registration snapshot'
      when e.registration_status <> 'approved' then 'Registration is not approved'
      when e.verification_status <> 'verified' then 'Needs verification'
      when e.date_of_birth is null then 'Date of birth is missing'
      when extract(year from e.starts_on)::int - extract(year from e.date_of_birth)::int < 14 then 'Too young for this FSY year'
      when extract(year from age(e.starts_on, e.date_of_birth)) >= 19 then 'Age 19 or older at session start'
      else 'Needs final roster review'
    end as reason
  from evaluated e;
$$;
revoke all on function private.participant_eligibility_projection(uuid) from public, anon, authenticated;

-- Existing explicit exclusions were already decided but still appeared in the
-- old exception queue because only the decision row changed. Make that earlier
-- decision effective in operational attendance without touching source history.
insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
select p.session_id, od.recorded_by, 'participant_pre_session_exclusion_applied', 'participant', p.id::text,
  jsonb_build_object('reason', coalesce(od.reason, 'Previously excluded from active youth operations'))
from public.participants p
join public.participant_operation_decisions od on od.participant_id = p.id
where od.cohort_state = 'excluded'
  and p.is_current
  and coalesce(p.operational_status, 'active') = 'active'
  and p.group_id is null
  and not exists (
    select 1 from public.housing_assignments h
    where h.participant_id = p.id and h.active
  )
  and not exists (
    select 1 from public.check_ins c
    where c.session_id = p.session_id and c.participant_id = p.id and c.status = 'arrived'
  );

update public.participants p
set operational_status = 'not_attending',
    operational_note = coalesce(od.reason, 'Excluded from active youth operations'),
    operational_revision = coalesce(p.operational_revision, 0) + 1,
    operational_updated_by = od.recorded_by,
    operational_updated_at = now(),
    attendance_status = 'confirmed_not_attending',
    attendance_note = coalesce(od.reason, 'Excluded from active youth operations'),
    attendance_updated_by = od.recorded_by,
    attendance_updated_at = now(),
    updated_at = now()
from public.participant_operation_decisions od
where od.participant_id = p.id
  and od.cohort_state = 'excluded'
  and p.is_current
  and coalesce(p.operational_status, 'active') = 'active'
  and p.group_id is null
  and not exists (
    select 1 from public.housing_assignments h
    where h.participant_id = p.id and h.active
  )
  and not exists (
    select 1 from public.check_ins c
    where c.session_id = p.session_id and c.participant_id = p.id and c.status = 'arrived'
  );

-- Logistical administrators are responsible for substantial pre-session work.
-- They can now record the same auditable local final-roster decision as the
-- Session Directing Couple. The source registration status is preserved.
create or replace function public.record_participant_exception(
  p_participant_id uuid,
  p_allow boolean,
  p_authority text,
  p_reason text,
  p_registration_confirmed boolean,
  p_guardian_confirmed boolean,
  p_leadership_confirmed boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.participants%rowtype;
begin
  select * into p from public.participants where id = p_participant_id for update;
  if p.id is null or not private.has_session_role(
    p.session_id,
    array['session_director','logistics_admin']::public.app_role[]
  ) then
    raise exception 'A Session Directing Couple or Logistical Administrator must record this final roster decision';
  end if;

  if length(trim(coalesce(p_authority, ''))) < 3 or length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Record the confirming authority and reason';
  end if;

  if p_allow and not (
    coalesce(p_registration_confirmed, false)
    and coalesce(p_guardian_confirmed, false)
    and coalesce(p_leadership_confirmed, false)
  ) then
    raise exception 'Confirm the required registration, guardian and leadership checks';
  end if;

  if p.registration_status = 'cancelled' then
    raise exception 'Cancelled source registration must be resolved at source first';
  end if;

  if not p_allow and (
    p.group_id is not null
    or exists(select 1 from public.housing_assignments h where h.participant_id = p.id and h.active)
    or exists(select 1 from public.check_ins c where c.session_id = p.session_id and c.participant_id = p.id and c.status = 'arrived')
  ) then
    raise exception 'This participant already has live placement, housing or arrival work. Use the operational status action instead';
  end if;

  insert into public.participant_operation_decisions(
    participant_id, cohort_state, registration_confirmed, guardian_confirmed,
    leadership_confirmed, authority, reason, recorded_by
  )
  values(
    p.id,
    case when p_allow then 'exception' else 'excluded' end,
    p_registration_confirmed,
    p_guardian_confirmed,
    p_leadership_confirmed,
    trim(p_authority),
    trim(p_reason),
    auth.uid()
  )
  on conflict(participant_id) do update set
    cohort_state = excluded.cohort_state,
    registration_confirmed = excluded.registration_confirmed,
    guardian_confirmed = excluded.guardian_confirmed,
    leadership_confirmed = excluded.leadership_confirmed,
    authority = excluded.authority,
    reason = excluded.reason,
    recorded_by = auth.uid(),
    recorded_at = now(),
    revision = participant_operation_decisions.revision + 1;

  update public.participants
  set is_current = case when p_allow then true else is_current end,
      operational_status = case when p_allow then 'active' else 'not_attending' end,
      operational_note = trim(p_reason),
      operational_revision = coalesce(operational_revision, 0) + 1,
      operational_updated_by = auth.uid(),
      operational_updated_at = now(),
      attendance_status = case when p_allow then 'expected' else 'confirmed_not_attending' end,
      attendance_note = case when p_allow then null else trim(p_reason) end,
      attendance_updated_by = auth.uid(),
      attendance_updated_at = now(),
      group_id = case when p_allow then group_id else null end,
      updated_at = now()
  where id = p.id;

  insert into public.participant_arrival_events(session_id, participant_id, status, note, recorded_by)
  values(
    p.session_id,
    p.id,
    case when p_allow then 'expected' else 'confirmed_not_attending' end,
    trim(p_reason),
    auth.uid()
  );

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(
    p.session_id,
    auth.uid(),
    'participant_final_roster_decision_recorded',
    'participant',
    p.id::text,
    jsonb_build_object(
      'included', p_allow,
      'authority', trim(p_authority),
      'reason', trim(p_reason),
      'registration_confirmed', p_registration_confirmed,
      'guardian_confirmed', p_guardian_confirmed,
      'leadership_confirmed', p_leadership_confirmed,
      'source_registration_status', p.registration_status
    )
  );
end;
$$;
revoke all on function public.record_participant_exception(uuid,boolean,text,text,boolean,boolean,boolean) from public, anon;
grant execute on function public.record_participant_exception(uuid,boolean,text,text,boolean,boolean,boolean) to authenticated;

-- Pre-session staff confirmation follows the same leadership pairing. This does
-- not replace source registration status; it records local readiness to serve.
create or replace function public.update_staff_operations(
  p_staff_id uuid,
  p_revision integer,
  p_planning text,
  p_arrival text,
  p_clearance text,
  p_authority text default '',
  p_reason text default '',
  p_duties text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.staff%rowtype;
  old public.staff_operations%rowtype;
  result public.staff_operations%rowtype;
begin
  select * into s from public.staff where id = p_staff_id;
  if s.id is null or not private.has_capability(s.session_id, 'staff_manage') then
    raise exception 'Staff management access is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(s.session_id::text, 26));
  select * into old from public.staff_operations where staff_id = s.id for update;
  if old.revision is distinct from p_revision then
    raise exception 'Staff record changed. Refresh and review again.';
  end if;

  if p_clearance is distinct from old.service_clearance then
    if not private.has_session_role(
      s.session_id,
      array['session_director','logistics_admin']::public.app_role[]
    ) then
      raise exception 'A Session Directing Couple or Logistical Administrator must record service confirmation';
    end if;
    if length(trim(coalesce(p_authority, ''))) < 3 or length(trim(coalesce(p_reason, ''))) < 5 then
      raise exception 'Record the confirming authority and reason';
    end if;
  end if;

  if p_arrival in ('no_show','left')
    and p_arrival is distinct from old.arrival_state
    and length(trim(coalesce(p_reason, ''))) < 5
  then
    raise exception 'Record a reason for this arrival change';
  end if;

  if p_duties is not null and cardinality(p_duties) > 12 then
    raise exception 'Too many committee duties';
  end if;

  update public.staff_operations
  set planning_state = p_planning,
      arrival_state = p_arrival,
      service_clearance = p_clearance,
      revision = revision + 1,
      updated_by = auth.uid(),
      updated_at = now()
  where staff_id = s.id
  returning * into result;

  if p_duties is not null then
    delete from public.staff_committee_duties where staff_id = s.id;
    insert into public.staff_committee_duties(staff_id, duty, assigned_by)
    select s.id, trim(value), auth.uid()
    from unnest(p_duties) value
    where trim(value) <> ''
    on conflict do nothing;
  end if;

  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values(
    s.session_id,
    auth.uid(),
    'staff_operations_updated',
    'staff',
    s.id::text,
    jsonb_build_object(
      'before', to_jsonb(old),
      'after', to_jsonb(result),
      'authority', p_authority,
      'reason', p_reason,
      'duties', p_duties
    )
  );

  return to_jsonb(result);
end;
$$;
revoke all on function public.update_staff_operations(uuid,integer,text,text,text,text,text,text[]) from public, anon;
grant execute on function public.update_staff_operations(uuid,integer,text,text,text,text,text,text[]) to authenticated;

-- One compact read model for the four-day pre-session cleanup. It reports only
-- counts and coverage, keeping private participant/staff details in their
-- existing screens.
create or replace function public.get_pre_session_finalization_summary_v1(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  participant_current integer := 0;
  participant_final integer := 0;
  participant_remaining integer := 0;
  participant_final_out integer := 0;
  staff_current integer := 0;
  staff_final integer := 0;
  staff_remaining integer := 0;
  group_total integer := 0;
  groups_need_counselor integer := 0;
  company_total integer := 0;
  companies_need_assistant integer := 0;
  assistant_company_limit integer := 1;
begin
  if not private.has_session_access(p_session_id) then
    raise exception 'Session access required';
  end if;

  if not (
    private.has_capability(p_session_id, 'registration_view')
    or private.has_capability(p_session_id, 'staff_view')
    or private.has_capability(p_session_id, 'reports_export')
  ) then
    raise exception 'Roster visibility is required';
  end if;

  with eligibility as (
    select * from private.participant_eligibility_projection(p_session_id)
  )
  select
    count(*) filter (where p.is_current)::integer,
    count(*) filter (where p.is_current and e.eligible)::integer,
    count(*) filter (
      where p.is_current
        and not e.eligible
        and p.attendance_status <> 'confirmed_not_attending'
        and coalesce(p.operational_status, 'active') = 'active'
    )::integer,
    count(*) filter (
      where p.is_current
        and (p.attendance_status = 'confirmed_not_attending' or coalesce(p.operational_status, 'active') <> 'active')
    )::integer
  into participant_current, participant_final, participant_remaining, participant_final_out
  from public.participants p
  join eligibility e on e.participant_id = p.id
  where p.session_id = p_session_id;

  select
    count(*) filter (where s.is_current and s.registration_status <> 'cancelled')::integer,
    count(*) filter (
      where s.is_current
        and s.registration_status <> 'cancelled'
        and coalesce(o.planning_state, 'reserve') <> 'excluded'
        and coalesce(o.service_clearance, 'confirmation_required') = 'cleared'
        and coalesce(o.arrival_state, 'expected') not in ('no_show','left')
    )::integer
  into staff_current, staff_final
  from public.staff s
  left join public.staff_operations o on o.staff_id = s.id
  where s.session_id = p_session_id;
  staff_remaining := greatest(staff_current - staff_final, 0);

  select count(*)::integer,
    count(*) filter (
      where g.counselor_id is null
        or not exists (
          select 1
          from public.staff s
          left join public.staff_operations o on o.staff_id = s.id
          where s.id = g.counselor_id
            and s.session_id = p_session_id
            and s.is_current
            and s.registration_status <> 'cancelled'
            and coalesce(o.planning_state, 'reserve') <> 'excluded'
            and coalesce(o.service_clearance, 'confirmation_required') = 'cleared'
            and coalesce(o.arrival_state, 'expected') not in ('no_show','left')
        )
    )::integer
  into group_total, groups_need_counselor
  from public.counselor_groups g
  where g.session_id = p_session_id and g.state = 'published';

  select count(*)::integer,
    count(*) filter (
      where not exists (
        select 1
        from public.staff_company_assignments a
        join public.staff s on s.id = a.staff_id
        left join public.staff_operations o on o.staff_id = s.id
        where a.session_id = p_session_id
          and a.company_id = c.id
          and s.is_current
          and s.registration_status <> 'cancelled'
          and s.operational_role = 'assistant_coordinator'
          and coalesce(o.planning_state, 'reserve') <> 'excluded'
          and coalesce(o.service_clearance, 'confirmation_required') = 'cleared'
          and coalesce(o.arrival_state, 'expected') not in ('no_show','left')
      )
    )::integer
  into company_total, companies_need_assistant
  from public.companies c
  where c.session_id = p_session_id;

  select coalesce(s.companies_per_assistant_coordinator, 1)
  into assistant_company_limit
  from public.session_structure_settings s
  where s.session_id = p_session_id;
  assistant_company_limit := coalesce(assistant_company_limit, 1);

  return jsonb_build_object(
    'participant_current', participant_current,
    'participant_final', participant_final,
    'participant_remaining', participant_remaining,
    'participant_final_out', participant_final_out,
    'staff_current', staff_current,
    'staff_final', staff_final,
    'staff_remaining', staff_remaining,
    'groups_total', group_total,
    'groups_need_counselor', groups_need_counselor,
    'companies_total', company_total,
    'companies_need_assistant', companies_need_assistant,
    'assistant_company_limit', assistant_company_limit
  );
end;
$$;
revoke all on function public.get_pre_session_finalization_summary_v1(uuid) from public, anon;
grant execute on function public.get_pre_session_finalization_summary_v1(uuid) to authenticated;

-- The existing Participant Master report was a source-oriented current list and
-- could show unassigned blocked rows. During operations, make it the final active
-- participant roster while preserving the broader source data in Registration.
create or replace function public.get_operational_report_v2(p_session_id uuid, p_report_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  payload jsonb;
  cleaned_rows jsonb;
  source_count integer := 0;
begin
  payload := public.get_operational_report(p_session_id, p_report_key);

  if p_report_key = 'participant_master' then
    source_count := jsonb_array_length(coalesce(payload->'rows', '[]'::jsonb));
    select coalesce(jsonb_agg((item - 'source_id' - 'eligible') order by ord), '[]'::jsonb)
      into cleaned_rows
    from jsonb_array_elements(coalesce(payload->'rows', '[]'::jsonb)) with ordinality as r(item, ord)
    where coalesce((item->>'eligible')::boolean, false);

    payload := jsonb_set(payload, '{rows}', cleaned_rows, true);
    payload := jsonb_set(payload, '{title}', to_jsonb('Final Participant Roster'::text), true);
    payload := jsonb_set(
      payload,
      '{summary}',
      jsonb_build_object(
        'included', jsonb_array_length(cleaned_rows),
        'current_source_records', source_count,
        'not_in_final_roster', greatest(source_count - jsonb_array_length(cleaned_rows), 0)
      ),
      true
    );
  elsif p_report_key = 'onsite_registrations' then
    select coalesce(jsonb_agg(item - 'source_id' order by ord), '[]'::jsonb)
      into cleaned_rows
    from jsonb_array_elements(coalesce(payload->'rows', '[]'::jsonb)) with ordinality as r(item, ord);
    payload := jsonb_set(payload, '{rows}', cleaned_rows, true);
  end if;

  return payload;
end;
$$;
revoke all on function public.get_operational_report_v2(uuid, text) from public, anon;
grant execute on function public.get_operational_report_v2(uuid, text) to authenticated;
