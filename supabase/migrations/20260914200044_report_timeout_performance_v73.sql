-- Keep live operational reports comfortably below the authenticated statement timeout.
-- The previous report projection performed authorization and eligibility helper work once
-- per participant. During day-of operations that multiplied small access-table scans into
-- millions of calls and could push report RPCs past the 8 second authenticated timeout.

create or replace function private.operational_participant_is_eligible(target_session uuid, target_participant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when coalesce(p.operational_status,'active') <> 'active' then false
      when not p.is_current then false
      when p.registration_status = 'cancelled' then false
      when p.attendance_status = 'confirmed_not_attending' then false
      when age_ctx.session_age is null then false
      when age_ctx.session_age < coalesce(ss.participant_min_age,12) then false
      when age_ctx.session_age > coalesce(ss.participant_max_age,19) then false
      when o.cohort_state = 'excluded' then false
      when o.cohort_state = 'exception'
        and coalesce(o.local_clearance,false)
        and o.registration_confirmed
        and o.guardian_confirmed
        and o.leadership_confirmed then true
      when p.verification_status = 'verified'
        and p.registration_status in ('approved','awaiting') then true
      else false
    end
    from public.participants p
    join public.sessions sess on sess.id = p.session_id
    left join public.participant_private_details d on d.participant_id = p.id
    left join public.participant_operation_decisions o on o.participant_id = p.id
    left join public.session_structure_settings ss on ss.session_id = p.session_id
    cross join lateral (
      select coalesce(
        case when sess.starts_on is not null and d.date_of_birth is not null
          then extract(year from age(sess.starts_on,d.date_of_birth))::integer
        end,
        p.age
      )::integer as session_age
    ) age_ctx
    where p.id = target_participant and p.session_id = target_session
  ), false);
$$;

create or replace function private.staff_in_current_company_scope(target_session uuid, target_staff uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with scope as materialized (
    select private.current_user_company_ids(target_session) as company_ids
  )
  select exists(
    select 1
    from public.staff s
    cross join scope sc
    where s.id = target_staff
      and s.session_id = target_session
      and (
        s.assigned_company_id = any(sc.company_ids)
        or exists(
          select 1
          from public.counselor_groups g
          where g.session_id = s.session_id
            and g.counselor_id = s.id
            and g.company_id = any(sc.company_ids)
        )
        or exists(
          select 1
          from public.staff_company_assignments sca
          where sca.session_id = target_session
            and sca.staff_id = s.id
            and sca.company_id = any(sc.company_ids)
        )
      )
  );
$$;

create or replace function private.participant_report_rows(target_session uuid)
returns table(
  participant_id uuid,
  registration_id text,
  full_name text,
  preferred_name text,
  sex text,
  age integer,
  stake_name text,
  unit_name text,
  source_kind text,
  registration_status text,
  verification_status text,
  arrival_status text,
  eligible boolean,
  company_id uuid,
  company_name text,
  company_number integer,
  group_id uuid,
  group_name text,
  group_number integer,
  counselor_name text,
  fsy_id text,
  badge_name text,
  badge_state text,
  needs_reprint boolean,
  slot_number integer,
  origin_code text,
  checkin_status text,
  checkin_at timestamptz,
  housing_room text,
  housing_building text,
  housing_bed text
)
language sql
stable
security definer
set search_path = ''
as $$
  with scope_base as materialized (
    select private.is_assistant_coordinator(target_session) as is_ac
  ),
  scope as materialized (
    select sb.is_ac,
      case when sb.is_ac then private.current_user_company_ids(target_session) else '{}'::uuid[] end as company_ids
    from scope_base sb
  )
  select
    p.id,
    p.registration_id,
    trim(concat_ws(' ', p.first_name, p.last_name)),
    nullif(trim(p.preferred_name), ''),
    p.sex::text,
    p.age,
    nullif(trim(p.stake_name), ''),
    nullif(trim(p.unit_name), ''),
    p.source_kind,
    p.registration_status,
    p.verification_status,
    p.attendance_status,
    case
      when coalesce(p.operational_status,'active') <> 'active' then false
      when not p.is_current then false
      when p.registration_status = 'cancelled' then false
      when p.attendance_status = 'confirmed_not_attending' then false
      when age_ctx.session_age is null then false
      when age_ctx.session_age < coalesce(ss.participant_min_age,12) then false
      when age_ctx.session_age > coalesce(ss.participant_max_age,19) then false
      when decision.cohort_state = 'excluded' then false
      when decision.cohort_state = 'exception'
        and coalesce(decision.local_clearance,false)
        and decision.registration_confirmed
        and decision.guardian_confirmed
        and decision.leadership_confirmed then true
      when p.verification_status = 'verified'
        and p.registration_status in ('approved','awaiting') then true
      else false
    end as eligible,
    c.id,
    coalesce(nullif(c.custom_name, ''), c.name),
    c.operational_number,
    g.id,
    coalesce(nullif(g.custom_name, ''), g.name),
    g.operational_number,
    counselor.full_name,
    badge.fsy_id,
    badge.badge_name,
    badge.state,
    coalesce(badge.needs_reprint, false),
    badge.slot_number,
    badge.origin_code,
    ci.status::text,
    ci.recorded_at,
    hr.room_name,
    hr.building,
    ha.bed_label
  from public.participants p
  join public.sessions sess on sess.id = p.session_id
  left join public.participant_private_details pd on pd.participant_id = p.id
  left join public.participant_operation_decisions decision on decision.participant_id = p.id
  left join public.session_structure_settings ss on ss.session_id = p.session_id
  left join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id
  left join public.companies c on c.id = g.company_id and c.session_id = p.session_id
  left join public.staff counselor on counselor.id = g.counselor_id and counselor.session_id = p.session_id
  left join public.participant_badge_assignments badge
    on badge.session_id = target_session
   and badge.participant_id = p.id
   and badge.state <> 'retired'
  left join public.check_ins ci
    on ci.session_id = target_session
   and ci.participant_id = p.id
  left join public.housing_assignments ha
    on ha.session_id = target_session
   and ha.participant_id = p.id
   and ha.active
  left join public.housing_rooms hr on hr.id = ha.room_id
  cross join lateral (
    select coalesce(
      case when sess.starts_on is not null and pd.date_of_birth is not null
        then extract(year from age(sess.starts_on,pd.date_of_birth))::integer
      end,
      p.age
    )::integer as session_age
  ) age_ctx
  cross join scope sc
  where p.session_id = target_session
    and p.is_current
    and (not sc.is_ac or c.id = any(sc.company_ids));
$$;

comment on function private.participant_report_rows(uuid) is
  'Operational report projection optimized for live session reads: access scope and eligibility context are evaluated set-wise rather than once per participant.';
