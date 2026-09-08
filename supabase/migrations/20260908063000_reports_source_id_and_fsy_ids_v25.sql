-- Reports + identity v25
-- 1. Report consumers no longer need the imported/source registration identifier.
-- 2. Once the reviewed Kumasi 2026 structure is published, every operationally
--    eligible grouped youth receives one permanent company-first FSY ID.

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
begin
  payload := public.get_operational_report(p_session_id, p_report_key);

  if p_report_key in ('participant_master', 'onsite_registrations') then
    select coalesce(jsonb_agg(item - 'source_id' order by ord), '[]'::jsonb)
      into cleaned_rows
    from jsonb_array_elements(coalesce(payload->'rows', '[]'::jsonb)) with ordinality as r(item, ord);

    payload := jsonb_set(payload, '{rows}', cleaned_rows, true);
  end if;

  return payload;
end;
$$;

revoke all on function public.get_operational_report_v2(uuid,text) from public, anon;
grant execute on function public.get_operational_report_v2(uuid,text) to authenticated, service_role;

-- Generate/finalize IDs only for the named 2026 Kumasi planning session after
-- its counselor groups are published. Natural session attributes are used here
-- deliberately; no generated database IDs are embedded in this migration.
do $$
declare
  target_session uuid;
  matching_sessions integer;
  eligible_count integer;
  active_count integer;
  distinct_id_count integer;
  pending_count integer;
  missing_origin integer;
  max_company_size integer;
  inserted_count integer := 0;
  finalized_count integer := 0;
begin
  select count(*)::int, min(id)
    into matching_sessions, target_session
  from public.sessions
  where name = 'FSY Kumasi 2026'
    and year = 2026
    and status = 'planning';

  if matching_sessions = 0 then
    return;
  end if;

  if matching_sessions > 1 then
    raise exception 'FSY ID backfill stopped: more than one FSY Kumasi 2026 planning session exists';
  end if;

  if not exists(
    select 1 from public.counselor_groups
    where session_id = target_session and state = 'published'
  ) then
    return;
  end if;

  perform 1 from public.sessions where id = target_session for update;

  with eligible as (
    select p.id, g.company_id, private.origin_code_for_participant(p) as origin_code
    from public.participants p
    join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id
    join public.sessions s on s.id = p.session_id
    join public.participant_private_details d on d.participant_id = p.id
    where p.session_id = target_session
      and p.is_current
      and p.registration_status = 'approved'
      and p.verification_status = 'verified'
      and p.attendance_status <> 'confirmed_not_attending'
      and d.date_of_birth is not null
      and s.starts_on is not null
      and s.ends_on is not null
      and extract(year from s.starts_on)::int - extract(year from d.date_of_birth)::int >= 14
      and s.ends_on < (d.date_of_birth + interval '19 years')::date
  )
  select count(*)::int,
         count(*) filter (where origin_code is null)::int
    into eligible_count, missing_origin
  from eligible;

  if eligible_count = 0 then
    raise exception 'FSY ID backfill stopped: the published structure has no operationally eligible youth';
  end if;

  if missing_origin <> 0 then
    raise exception 'FSY ID backfill stopped: % eligible youth do not have an origin code', missing_origin;
  end if;

  with eligible as (
    select g.company_id
    from public.participants p
    join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id
    join public.sessions s on s.id = p.session_id
    join public.participant_private_details d on d.participant_id = p.id
    where p.session_id = target_session
      and p.is_current
      and p.registration_status = 'approved'
      and p.verification_status = 'verified'
      and p.attendance_status <> 'confirmed_not_attending'
      and d.date_of_birth is not null
      and s.starts_on is not null
      and s.ends_on is not null
      and extract(year from s.starts_on)::int - extract(year from d.date_of_birth)::int >= 14
      and s.ends_on < (d.date_of_birth + interval '19 years')::date
  )
  select coalesce(max(company_size), 0)::int
    into max_company_size
  from (
    select company_id, count(*)::int as company_size
    from eligible
    group by company_id
  ) x;

  if max_company_size > 99 then
    raise exception 'FSY ID backfill stopped: a company has % youth and exceeds the two-digit slot limit', max_company_size;
  end if;

  select count(*)::int into active_count
  from public.participant_badge_assignments
  where session_id = target_session and state <> 'retired';

  if active_count not in (0, eligible_count) then
    raise exception 'FSY ID backfill stopped: % active IDs exist for % eligible youth', active_count, eligible_count;
  end if;

  if active_count = 0 then
    with eligible as (
      select
        p.session_id,
        p.id as participant_id,
        g.company_id,
        p.group_id,
        row_number() over (
          partition by g.company_id
          order by g.operational_number, lower(p.last_name), lower(p.first_name), p.id
        )::int as slot_number,
        private.origin_code_for_participant(p) as origin_code,
        trim(concat_ws(' ', p.first_name, p.last_name)) as badge_name
      from public.participants p
      join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id
      join public.sessions s on s.id = p.session_id
      join public.participant_private_details d on d.participant_id = p.id
      where p.session_id = target_session
        and p.is_current
        and p.registration_status = 'approved'
        and p.verification_status = 'verified'
        and p.attendance_status <> 'confirmed_not_attending'
        and d.date_of_birth is not null
        and s.starts_on is not null
        and s.ends_on is not null
        and extract(year from s.starts_on)::int - extract(year from d.date_of_birth)::int >= 14
        and s.ends_on < (d.date_of_birth + interval '19 years')::date
    )
    insert into public.participant_badge_assignments(
      session_id, participant_id, company_id, group_id, slot_number,
      origin_code, fsy_id, badge_name, state, assigned_by, note
    )
    select
      session_id, participant_id, company_id, group_id, slot_number,
      origin_code, 'pending', badge_name, 'draft', null,
      'Generated from the published reviewed FSY structure'
    from eligible
    order by company_id, slot_number;

    get diagnostics inserted_count = row_count;
  end if;

  select count(*)::int,
         count(distinct fsy_id)::int,
         count(*) filter (where fsy_id = 'pending')::int
    into active_count, distinct_id_count, pending_count
  from public.participant_badge_assignments
  where session_id = target_session and state <> 'retired';

  if active_count <> eligible_count then
    raise exception 'FSY ID verification failed: generated %, expected %', active_count, eligible_count;
  end if;

  if distinct_id_count <> active_count then
    raise exception 'FSY ID verification failed: generated IDs are not unique';
  end if;

  if pending_count <> 0 then
    raise exception 'FSY ID verification failed: % placeholder IDs remain', pending_count;
  end if;

  if exists(
    select 1
    from public.participant_badge_assignments b
    left join public.participants p on p.id = b.participant_id and p.session_id = b.session_id
    where b.session_id = target_session
      and b.state <> 'retired'
      and (p.id is null or p.group_id is distinct from b.group_id)
  ) then
    raise exception 'FSY ID verification failed: an ID does not match the participant published group';
  end if;

  update public.participant_badge_assignments
  set state = 'finalized',
      finalized_at = coalesce(finalized_at, now()),
      finalized_by = null
  where session_id = target_session and state = 'draft';

  get diagnostics finalized_count = row_count;

  if inserted_count > 0 or finalized_count > 0 then
    insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
    values(
      target_session,
      null,
      'fsy_ids_prepared_and_finalized',
      'session',
      target_session::text,
      jsonb_build_object(
        'eligible_youth', eligible_count,
        'inserted', inserted_count,
        'finalized', finalized_count,
        'source', 'published_reviewed_structure'
      )
    );
  end if;
end;
$$;