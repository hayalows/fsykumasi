-- Eligibility projection performance
-- Evaluate the session roster in one joined pass instead of calling per-participant
-- eligibility and age lookups repeatedly.
create or replace function private.participant_eligibility_projection(target_session uuid)
returns table(participant_id uuid, eligible boolean, reason text)
language sql
stable
security definer
set search_path = ''
as $function$
with evaluated as (
  select
    p.id as participant_id,
    p.is_current,
    p.registration_status,
    p.verification_status,
    p.attendance_status,
    coalesce(p.operational_status, 'active') as operational_status,
    coalesce(
      case
        when s.starts_on is not null and d.date_of_birth is not null
          then extract(year from age(s.starts_on, d.date_of_birth))::integer
        else null
      end,
      p.age
    ) as age_on_start,
    coalesce(ss.participant_min_age, 12) as participant_min_age,
    coalesce(ss.participant_max_age, 19) as participant_max_age,
    s.ends_on,
    d.date_of_birth,
    o.cohort_state,
    coalesce(o.local_clearance, false) as local_clearance,
    o.registration_confirmed,
    o.guardian_confirmed,
    o.leadership_confirmed
  from public.participants p
  join public.sessions s on s.id = p.session_id
  left join public.participant_private_details d on d.participant_id = p.id
  left join public.participant_operation_decisions o on o.participant_id = p.id
  left join public.session_structure_settings ss on ss.session_id = p.session_id
  where p.session_id = target_session
),
scored as (
  select
    evaluated.*,
    case
      when operational_status <> 'active' then false
      when not is_current then false
      when registration_status = 'cancelled' then false
      when attendance_status = 'confirmed_not_attending' then false
      when age_on_start is null then false
      when age_on_start < participant_min_age then false
      when age_on_start > participant_max_age then false
      when cohort_state = 'excluded' then false
      when cohort_state = 'exception'
        and local_clearance
        and registration_confirmed
        and guardian_confirmed
        and leadership_confirmed then true
      when verification_status = 'verified'
        and registration_status in ('approved', 'awaiting') then true
      else false
    end as eligible
  from evaluated
)
select
  participant_id,
  eligible,
  case
    when eligible then 'Eligible'
    when age_on_start >= 20 then 'Age 20+ removed from active participant roster'
    when cohort_state = 'excluded' then 'Excluded from active youth operations'
    when operational_status <> 'active' then 'Not active in operations'
    when attendance_status = 'confirmed_not_attending' then 'Confirmed not attending'
    when not is_current then 'Not current in latest registration snapshot'
    when registration_status = 'cancelled' then 'Cancelled source registration'
    when verification_status <> 'verified' then 'Needs verification'
    when age_on_start is null then 'Date of birth is missing'
    when age_on_start < 12 then 'Too young for this FSY policy'
    when age_on_start > 19 then 'Age 20+ removed from active participant roster'
    when registration_status <> 'approved' then 'Registration is not approved'
    when not (ends_on < (date_of_birth + interval '19 years')::date)
      then 'Turns 19 before or on the end of this session'
    else 'Needs review'
  end
from scored;
$function$;