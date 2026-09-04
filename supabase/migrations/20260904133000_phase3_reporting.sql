-- Phase 3: guarded operational reporting.
-- This migration adds no participant activity and does not finalize or mutate badges.

-- Wellness exports are deliberately separate from generic report access.
alter table public.operational_teams drop constraint if exists operational_teams_capabilities_check;
alter table public.operational_teams add constraint operational_teams_capabilities_check check (
  capabilities <@ array[
    'people_lookup','groups_view','checkin_record','headcount_view','headcount_record',
    'housing_view','housing_manage','housing_export',
    'wellness_status','wellness_private','wellness_manage','wellness_export',
    'food_view','food_manage','food_export',
    'registration_view','registration_manage','identity_manage','arrival_manage',
    'staff_view','staff_manage','inclusion_view','facilities_view','materials_view',
    'financial_view','publicity_view','reports_export','access_admin'
  ]::text[]
);

create or replace function private.effective_capabilities(target_session uuid, target_user uuid default null::uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
with subject as (select coalesce(target_user,(select auth.uid())) user_id), base as (
  select unnest(case
    when aa.role in ('session_director','logistics_admin') then array[
      'people_lookup','groups_view','checkin_record','headcount_view','headcount_record',
      'registration_view','registration_manage','identity_manage','arrival_manage',
      'staff_view','staff_manage','housing_view','housing_manage','housing_export',
      'food_view','food_manage','food_export','wellness_status','wellness_private','wellness_manage','wellness_export',
      'inclusion_view','facilities_view','materials_view','financial_view','publicity_view',
      'reports_export','access_admin'
    ]::text[]
    when aa.role='coordinator' then array[
      'people_lookup','groups_view','checkin_record','headcount_view','headcount_record',
      'registration_view','registration_manage','identity_manage','arrival_manage',
      'staff_view','staff_manage','housing_view','housing_manage','housing_export',
      'food_view','food_manage','food_export','wellness_status','wellness_private','wellness_manage','wellness_export',
      'inclusion_view','facilities_view','materials_view','financial_view','publicity_view',
      'reports_export'
    ]::text[]
    when aa.role='assistant_coordinator' then array['people_lookup','groups_view','checkin_record','headcount_view','headcount_record']::text[]
    else '{}'::text[] end) capability
  from public.access_assignments aa,subject s
  where aa.session_id=target_session and aa.user_id=s.user_id and aa.active
), explicit_caps as (
  select unnest(aa.capabilities) capability
  from public.access_assignments aa,subject s
  where aa.session_id=target_session and aa.user_id=s.user_id and aa.active
), team_caps as (
  select unnest(ot.capabilities) capability
  from public.team_memberships tm
  join public.operational_teams ot on ot.id=tm.team_id
  join subject s on s.user_id=tm.user_id
  where tm.session_id=target_session and tm.active and ot.active
)
select coalesce(array_agg(distinct capability order by capability),'{}'::text[])
from (select capability from base union all select capability from explicit_caps union all select capability from team_caps) caps
where capability is not null;
$$;
revoke all on function private.effective_capabilities(uuid, uuid) from public;
grant execute on function private.effective_capabilities(uuid, uuid) to authenticated;

update public.operational_teams
set capabilities = (
  select array_agg(distinct capability order by capability)
  from unnest(capabilities || array['wellness_export']::text[]) capability
), updated_at = now()
where team_key = 'wellness' and active;

-- A single internal row model keeps names, placements, badge identity, arrival,
-- check-in and Housing aligned for every general report.
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
    private.operational_participant_is_eligible(target_session, p.id),
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
    checkin.status,
    checkin.recorded_at,
    room.room_name,
    room.building,
    room.bed_label
  from public.participants p
  left join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id
  left join public.companies c on c.id = g.company_id and c.session_id = p.session_id
  left join public.staff counselor on counselor.id = g.counselor_id and counselor.session_id = p.session_id
  left join lateral (
    select b.fsy_id, b.badge_name, b.state, b.needs_reprint, b.slot_number, b.origin_code
    from public.participant_badge_assignments b
    where b.session_id = target_session and b.participant_id = p.id and b.state <> 'retired'
    order by b.assigned_at desc
    limit 1
  ) badge on true
  left join lateral (
    select ci.status::text as status, ci.recorded_at
    from public.check_ins ci
    where ci.session_id = target_session and ci.participant_id = p.id
    order by ci.recorded_at desc
    limit 1
  ) checkin on true
  left join lateral (
    select hr.room_name, hr.building, ha.bed_label
    from public.housing_assignments ha
    join public.housing_rooms hr on hr.id = ha.room_id
    where ha.session_id = target_session and ha.participant_id = p.id and ha.active
    order by ha.assigned_at desc
    limit 1
  ) room on true
  where p.session_id = target_session and p.is_current;
$$;
revoke all on function private.participant_report_rows(uuid) from public, anon, authenticated;

create or replace function public.get_operational_report(p_session_id uuid, p_report_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  report_rows jsonb := '[]'::jsonb;
  report_summary jsonb := '{}'::jsonb;
  generated_by_name text;
  report_title text;
begin
  if p_report_key is null or trim(p_report_key) = '' then raise exception 'Choose a report'; end if;

  if p_report_key in ('participant_master','unit_arrival','stake_summary','company_roster','counselor_group','badge_production','badge_exceptions','onsite_registrations','replacements','headcount_history') then
    if not private.has_capability(p_session_id, 'reports_export') then raise exception 'Report export access required'; end if;
  elsif p_report_key = 'housing_occupancy' then
    if not (private.has_capability(p_session_id, 'housing_export') or private.has_capability(p_session_id, 'reports_export')) then raise exception 'Housing export access required'; end if;
  elsif p_report_key = 'meal_attendance' then
    if not private.has_capability(p_session_id, 'food_export') then raise exception 'Food export access required'; end if;
  elsif p_report_key = 'wellness_visits' then
    if not private.has_capability(p_session_id, 'wellness_export') then raise exception 'Confidential Wellness export access required'; end if;
  elsif p_report_key = 'audit_activity' then
    if not private.has_capability(p_session_id, 'access_admin') then raise exception 'Access administration is required for the audit report'; end if;
  else
    raise exception 'Unknown operational report';
  end if;

  select coalesce(nullif(pr.display_name, ''), nullif(pr.email, ''), 'FSY leader')
  into generated_by_name
  from public.profiles pr
  where pr.user_id = (select auth.uid());
  generated_by_name := coalesce(generated_by_name, 'FSY leader');

  if p_report_key = 'participant_master' then
    report_title := 'Participant Master Roster';
    select coalesce(jsonb_agg(to_jsonb(q) order by q.full_name), '[]'::jsonb) into report_rows
    from (
      select fsy_id, registration_id as source_id, full_name, preferred_name, coalesce(badge_name, full_name) as badge_name,
        sex, age, stake_name as origin, unit_name as unit, company_name as company, group_name as counselor_group,
        counselor_name as counselor, registration_status, verification_status, arrival_status,
        coalesce(checkin_status, 'not_checked_in') as checkin_status, housing_room, source_kind, badge_state, eligible
      from private.participant_report_rows(p_session_id)
    ) q;

  elsif p_report_key = 'unit_arrival' then
    report_title := 'Unit Arrival Sheet';
    select coalesce(jsonb_agg(to_jsonb(q) order by q.origin nulls last, q.unit nulls last, q.full_name), '[]'::jsonb) into report_rows
    from (
      select fsy_id, full_name, stake_name as origin, unit_name as unit, company_name as company, group_name as counselor_group,
        arrival_status, coalesce(checkin_status, 'not_checked_in') as checkin_status
      from private.participant_report_rows(p_session_id)
      where registration_status = 'approved' and verification_status = 'verified'
    ) q;

  elsif p_report_key = 'stake_summary' then
    report_title := 'Stake & District Arrival Summary';
    select coalesce(jsonb_agg(to_jsonb(q) order by q.origin), '[]'::jsonb) into report_rows
    from (
      select coalesce(stake_name, 'Origin not recorded') as origin,
        count(*)::integer as roster,
        count(*) filter (where checkin_status = 'arrived')::integer as checked_in,
        count(*) filter (where arrival_status = 'expected_later')::integer as expected_later,
        count(*) filter (where arrival_status in ('unknown','needs_follow_up'))::integer as follow_up,
        count(*) filter (where arrival_status = 'confirmed_not_attending')::integer as not_attending,
        count(*) filter (where eligible)::integer as operational_expected
      from private.participant_report_rows(p_session_id)
      where registration_status = 'approved' and verification_status = 'verified'
      group by coalesce(stake_name, 'Origin not recorded')
    ) q;

  elsif p_report_key = 'company_roster' then
    report_title := 'Company Roster';
    select coalesce(jsonb_agg(to_jsonb(q) order by q.company_number nulls last, q.group_number nulls last, q.full_name), '[]'::jsonb) into report_rows
    from (
      select company_number, company_name as company, group_number, group_name as counselor_group, fsy_id, full_name,
        stake_name as origin, unit_name as unit, counselor_name as counselor,
        arrival_status, coalesce(checkin_status, 'not_checked_in') as checkin_status
      from private.participant_report_rows(p_session_id)
      where company_id is not null and eligible
    ) q;

  elsif p_report_key = 'counselor_group' then
    report_title := 'Counselor Group Sheet';
    select coalesce(jsonb_agg(to_jsonb(q) order by q.company_number nulls last, q.group_number nulls last, q.full_name), '[]'::jsonb) into report_rows
    from (
      select company_number, company_name as company, group_number, group_name as counselor_group, counselor_name as counselor,
        fsy_id, full_name, stake_name as origin, unit_name as unit, arrival_status,
        coalesce(checkin_status, 'not_checked_in') as checkin_status
      from private.participant_report_rows(p_session_id)
      where group_id is not null and eligible
    ) q;

  elsif p_report_key = 'badge_production' then
    report_title := 'Badge Production';
    select coalesce(jsonb_agg(to_jsonb(q) order by q.company_number nulls last, q.slot_number nulls last, q.full_name), '[]'::jsonb) into report_rows
    from (
      select fsy_id, coalesce(badge_name, full_name) as badge_name, full_name, origin_code,
        company_number, company_name as company, group_name as counselor_group, slot_number,
        badge_state, needs_reprint,
        case when needs_reprint then 'Needs reprint' when badge_state = 'finalized' then 'Ready' else 'Needs review' end as production_status
      from private.participant_report_rows(p_session_id)
      where fsy_id is not null
    ) q;

  elsif p_report_key = 'badge_exceptions' then
    report_title := 'Badge Exceptions';
    select coalesce(jsonb_agg(to_jsonb(q) order by q.full_name), '[]'::jsonb) into report_rows
    from (
      select fsy_id, full_name, stake_name as origin, company_name as company, group_name as counselor_group,
        badge_state, needs_reprint,
        concat_ws('; ',
          case when company_id is null then 'No company' end,
          case when group_id is null then 'No counselor group' end,
          case when fsy_id is null then 'Missing FSY ID' end,
          case when fsy_id is not null and origin_code is null then 'Missing origin code' end,
          case when fsy_id is not null and badge_state <> 'finalized' then 'Badge not finalized' end,
          case when needs_reprint then 'Needs reprint' end
        ) as issue
      from private.participant_report_rows(p_session_id)
      where eligible and (company_id is null or group_id is null or fsy_id is null or origin_code is null or badge_state <> 'finalized' or needs_reprint)
    ) q;

  elsif p_report_key = 'onsite_registrations' then
    report_title := 'On-site Registrations';
    select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc), '[]'::jsonb) into report_rows
    from (
      select p.created_at, p.registration_id as source_id, r.fsy_id, r.full_name, r.stake_name as origin, r.unit_name as unit,
        p.verification_status, r.company_name as company, r.group_name as counselor_group, r.housing_room,
        r.arrival_status, coalesce(r.checkin_status, 'not_checked_in') as checkin_status
      from public.participants p
      join private.participant_report_rows(p_session_id) r on r.participant_id = p.id
      where p.session_id = p_session_id and p.source_kind = 'on_site'
    ) q;

  elsif p_report_key = 'replacements' then
    report_title := 'No-shows & Replacements';
    select coalesce(jsonb_agg(to_jsonb(q) order by q.replaced_at desc), '[]'::jsonb) into report_rows
    from (
      select old_badge.fsy_id as original_fsy_id,
        trim(concat_ws(' ', old_p.first_name, old_p.last_name)) as original_name,
        coalesce(nullif(old_c.custom_name, ''), old_c.name) as company,
        coalesce(nullif(old_g.custom_name, ''), old_g.name) as counselor_group,
        old_badge.slot_number,
        arrival.note as no_show_confirmation,
        arrival.recorded_at as no_show_confirmed_at,
        new_badge.fsy_id as replacement_fsy_id,
        trim(concat_ws(' ', new_p.first_name, new_p.last_name)) as replacement_name,
        new_badge.assigned_at as replaced_at,
        coalesce(actor.display_name, actor.email, 'FSY leader') as replaced_by
      from public.participant_badge_assignments new_badge
      join public.participant_badge_assignments old_badge on old_badge.id = new_badge.replacement_for
      join public.participants old_p on old_p.id = old_badge.participant_id
      join public.participants new_p on new_p.id = new_badge.participant_id
      left join public.counselor_groups old_g on old_g.id = old_badge.group_id
      left join public.companies old_c on old_c.id = old_badge.company_id
      left join public.profiles actor on actor.user_id = new_badge.assigned_by
      left join lateral (
        select e.note, e.recorded_at
        from public.participant_arrival_events e
        where e.session_id = p_session_id and e.participant_id = old_p.id and e.status = 'confirmed_not_attending'
        order by e.recorded_at desc limit 1
      ) arrival on true
      where new_badge.session_id = p_session_id
    ) q;

  elsif p_report_key = 'housing_occupancy' then
    report_title := 'Housing Occupancy';
    select coalesce(jsonb_agg(to_jsonb(q) order by q.building nulls last, q.room, q.name), '[]'::jsonb) into report_rows
    from (
      select hr.building, hr.room_name as room, ha.bed_label as bed_key, 'Participant'::text as person_type,
        r.fsy_id, r.full_name as name, r.sex, r.company_name as company, r.group_name as counselor_group,
        case when r.checkin_status = 'arrived' then 'Checked in' else 'Not checked in' end as checkin_status
      from public.housing_assignments ha
      join public.housing_rooms hr on hr.id = ha.room_id
      join private.participant_report_rows(p_session_id) r on r.participant_id = ha.participant_id
      where ha.session_id = p_session_id and ha.active and ha.participant_id is not null
      union all
      select hr.building, hr.room_name, ha.bed_label, 'Staff'::text,
        null::text, s.full_name, s.sex::text, coalesce(nullif(c.custom_name, ''), c.name), null::text, 'Staff'::text
      from public.housing_assignments ha
      join public.housing_rooms hr on hr.id = ha.room_id
      join public.staff s on s.id = ha.staff_id
      left join public.companies c on c.id = s.assigned_company_id
      where ha.session_id = p_session_id and ha.active and ha.staff_id is not null
    ) q;

  elsif p_report_key = 'meal_attendance' then
    report_title := 'Meal Attendance';
    select coalesce(jsonb_agg(to_jsonb(q) order by q.service_date desc, q.meal, q.served_at desc), '[]'::jsonb) into report_rows
    from (
      select ms.service_date, coalesce(nullif(ms.label, ''), initcap(ms.meal_type)) as meal, ms.status as service_status,
        coalesce(b.fsy_id, '') as fsy_id,
        coalesce(trim(concat_ws(' ', p.first_name, p.last_name)), s.full_name) as name,
        case when ma.participant_id is not null then 'Participant' else 'Staff' end as person_type,
        coalesce(nullif(c.custom_name, ''), c.name) as company,
        coalesce(nullif(g.custom_name, ''), g.name) as counselor_group,
        ma.served_at,
        coalesce(recorder.display_name, recorder.email, 'FSY leader') as recorded_by
      from public.meal_attendance ma
      join public.meal_services ms on ms.id = ma.meal_service_id
      left join public.participants p on p.id = ma.participant_id
      left join public.staff s on s.id = ma.staff_id
      left join public.counselor_groups g on g.id = p.group_id
      left join public.companies c on c.id = coalesce(g.company_id, s.assigned_company_id)
      left join lateral (
        select pb.fsy_id from public.participant_badge_assignments pb
        where pb.session_id = p_session_id and pb.participant_id = p.id and pb.state <> 'retired'
        order by pb.assigned_at desc limit 1
      ) b on true
      left join public.profiles recorder on recorder.user_id = ma.recorded_by
      where ma.session_id = p_session_id
    ) q;
    select coalesce(jsonb_build_object('services', jsonb_agg(to_jsonb(s) order by s.service_date, s.sort_order)), jsonb_build_object('services','[]'::jsonb))
    into report_summary
    from (
      select ms.service_date, coalesce(nullif(ms.label, ''), initcap(ms.meal_type)) as label, ms.status,
        case ms.meal_type when 'breakfast' then 1 when 'lunch' then 2 when 'dinner' then 3 when 'snack' then 4 else 5 end as sort_order,
        (select count(*)::integer from public.meal_attendance a where a.meal_service_id = ms.id) as served,
        ((select count(*)::integer
          from public.participants p2
          join public.counselor_groups g2 on g2.id = p2.group_id and g2.session_id = p2.session_id and g2.state = 'published'
          where p2.session_id = p_session_id
            and private.operational_participant_is_eligible(p_session_id, p2.id)
            and (not exists(select 1 from public.participant_badge_assignments pb2 where pb2.session_id = p_session_id and pb2.participant_id = p2.id)
              or exists(select 1 from public.participant_badge_assignments pb2 where pb2.session_id = p_session_id and pb2.participant_id = p2.id and pb2.state <> 'retired')))
          + (select count(*)::integer from public.staff s2 where s2.session_id = p_session_id and s2.is_current and s2.registration_status = 'approved')) as expected
      from public.meal_services ms where ms.session_id = p_session_id
    ) s;

  elsif p_report_key = 'headcount_history' then
    report_title := 'Head Count History';
    select coalesce(jsonb_agg(to_jsonb(q) order by q.opened_at desc, q.company_number nulls last), '[]'::jsonb) into report_rows
    from (
      select r.label as round, r.opens_at as opened_at, r.closes_at as closed_at,
        c.operational_number as company_number, coalesce(nullif(c.custom_name, ''), c.name) as company,
        hs.expected_count, hs.accounted_count, hs.status::text as status, hs.note,
        hs.submitted_at, coalesce(actor.display_name, actor.email, 'FSY leader') as submitted_by,
        coalesce(rec.reconciliation, '') as reconciliation
      from public.headcount_rounds r
      join public.headcount_submissions hs on hs.round_id = r.id
      join public.companies c on c.id = hs.company_id
      left join public.profiles actor on actor.user_id = hs.submitted_by
      left join lateral (
        select string_agg(trim(concat_ws(' ', p.first_name, p.last_name)) || ' — ' || h.status, '; ' order by p.last_name, p.first_name) as reconciliation
        from public.headcount_person_statuses h
        join public.participants p on p.id = h.participant_id
        where h.round_id = r.id and h.company_id = c.id
      ) rec on true
      where r.session_id = p_session_id
    ) q;

  elsif p_report_key = 'wellness_visits' then
    report_title := 'Wellness Visit Log';
    select coalesce(jsonb_agg(to_jsonb(q) order by q.started_at desc), '[]'::jsonb) into report_rows
    from (
      select coalesce(b.fsy_id, '') as fsy_id,
        coalesce(trim(concat_ws(' ', p.first_name, p.last_name)), s.full_name) as name,
        case when w.participant_id is not null then 'Participant' else 'Staff' end as person_type,
        w.started_at, w.closed_at,
        case when w.closed_at is null then null else floor(extract(epoch from (w.closed_at - w.started_at))/60)::integer end as duration_minutes,
        w.concern, w.care_provided, w.medicine_provided, w.outcome, w.follow_up_status,
        coalesce(recorder.display_name, recorder.email, 'FSY Wellness') as recorded_by
      from public.wellness_encounters w
      left join public.participants p on p.id = w.participant_id
      left join public.staff s on s.id = w.staff_id
      left join lateral (
        select pb.fsy_id from public.participant_badge_assignments pb
        where pb.session_id = p_session_id and pb.participant_id = p.id and pb.state <> 'retired'
        order by pb.assigned_at desc limit 1
      ) b on true
      left join public.profiles recorder on recorder.user_id = w.recorded_by
      where w.session_id = p_session_id
    ) q;

  elsif p_report_key = 'audit_activity' then
    report_title := 'Operational Audit Activity';
    select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc), '[]'::jsonb) into report_rows
    from (
      select a.created_at, a.action, a.entity_type, a.entity_id,
        coalesce(actor.display_name, actor.email, 'System') as actor,
        a.metadata::text as details
      from public.audit_events a
      left join public.profiles actor on actor.user_id = a.actor_id
      where a.session_id = p_session_id
        and (
          a.action like 'wellness_%' or a.action like 'meal_%' or
          a.action in ('company_headcount_submitted','participant_attendance_status_changed','participant_replaced','participant_badge_finalized','participant_badge_updated','participant_group_assigned','housing_assignment_saved','housing_assignment_cleared','leader_access_updated','access_request_decided','leader_invite_created','leader_invite_revoked','on_site_participant_created','on_site_participant_verified')
        )
      limit 2500
    ) q;
  end if;

  return jsonb_build_object(
    'key', p_report_key,
    'title', report_title,
    'generated_at', now(),
    'generated_by', generated_by_name,
    'scope', 'FSY Kumasi session',
    'rows', coalesce(report_rows, '[]'::jsonb),
    'summary', coalesce(report_summary, '{}'::jsonb)
  );
end;
$$;
revoke all on function public.get_operational_report(uuid, text) from public, anon;
grant execute on function public.get_operational_report(uuid, text) to authenticated;
