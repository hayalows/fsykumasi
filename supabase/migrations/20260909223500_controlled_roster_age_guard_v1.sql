-- Keep every participant badge path aligned with the active session age policy.
-- The controlled final roster sets the current Kumasi session to age 12-18.
-- A later on-site verification therefore cannot accidentally provision an
-- age-19+ youth badge through an older supplemental helper.

-- Repeat the dev-compiled eligibility definition here so this migration is the
-- final authority even if the larger controlled-rebalance migration evolves.
create or replace function private.operational_participant_is_eligible(
  target_session uuid,
  target_participant uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select coalesce((
    select case
      when coalesce(p.operational_status,'active')<>'active' then false
      when not p.is_current then false
      when p.registration_status='cancelled' then false
      when p.attendance_status='confirmed_not_attending' then false
      when private.session_participant_age(target_session,p.id) is null then false
      when private.session_participant_age(target_session,p.id)<coalesce(ss.participant_min_age,12) then false
      when private.session_participant_age(target_session,p.id)>coalesce(ss.participant_max_age,19) then false
      when o.cohort_state='excluded' then false
      when o.cohort_state='exception'
        and coalesce(o.local_clearance,false)
        and o.registration_confirmed
        and o.guardian_confirmed
        and o.leadership_confirmed then true
      when p.verification_status='verified'
        and p.registration_status in ('approved','awaiting') then true
      else false
    end
    from public.participants p
    left join public.participant_operation_decisions o on o.participant_id=p.id
    left join public.session_structure_settings ss on ss.session_id=p.session_id
    where p.id=target_participant and p.session_id=target_session
  ),false);
$$;

create or replace function private.enforce_active_participant_badge_policy_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  -- Retirement is always allowed. That lets finalization cleanly retire an ID
  -- after an age-policy or company change without the guard blocking cleanup.
  if new.state='retired' then
    return new;
  end if;

  if not private.operational_participant_is_eligible(new.session_id,new.participant_id) then
    raise exception 'Participant is outside the active final-roster age or eligibility policy';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_active_participant_badge_policy_v1() from public;

drop trigger if exists participant_badge_active_policy_guard_v1 on public.participant_badge_assignments;
create trigger participant_badge_active_policy_guard_v1
before insert or update of session_id,participant_id,state
on public.participant_badge_assignments
for each row execute function private.enforce_active_participant_badge_policy_v1();
