-- Final roster v22: keep preview work comfortably below the authenticated 8s statement timeout.
-- v21 used per-row correlated lookups into identity-count CTEs. With a mostly new source file,
-- that caused the existing participant roster to be rescanned for nearly every staged participant.
-- The same matching semantics are preserved here, but identity counts and source-key matches are
-- computed once and joined set-wise.

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

  with stage_counts as materialized (
    select identity_key, count(*) as n
    from pg_temp.final_registration_stage
    where person_type='participant'
    group by identity_key
  ),
  existing_counts as materialized (
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
  left join stage_counts sc on sc.identity_key=s.identity_key
  left join existing_counts ec on ec.identity_key=s.identity_key
  left join public.participants p
    on p.session_id=p_session_id
   and p.source_record_key=s.source_record_key
  where s.person_type='participant'
    and (
      p.id is not null
      or (coalesce(sc.n,0)=1 and coalesce(ec.n,0)=1)
    );

  with stage_counts as materialized (
    select identity_key, count(*) as n
    from pg_temp.final_registration_stage
    where person_type='counselor'
    group by identity_key
  ),
  existing_counts as materialized (
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
  left join stage_counts sc on sc.identity_key=s.identity_key
  left join existing_counts ec on ec.identity_key=s.identity_key
  left join public.staff st
    on st.session_id=p_session_id
   and st.source_record_key=s.source_record_key
  where s.person_type='counselor'
    and (
      st.id is not null
      or (coalesce(sc.n,0)=1 and coalesce(ec.n,0)=1)
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
