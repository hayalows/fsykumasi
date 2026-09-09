-- Final-roster preview performance repair.
--
-- The prior preview repeatedly called per-participant age, eligibility and
-- cohort helpers. On a full session roster that multiplied the same joins
-- thousands of times and could hit Postgres statement_timeout. Build the
-- participant projection once, then aggregate the preview from that set.

create or replace function public.get_session_finalization_preview_v2(p_session_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path=''
as $$
declare
  final_row public.session_roster_finalizations%rowtype;
  include_total integer:=0;
  awaiting_total integer:=0;
  younger_total integer:=0;
  age19_total integer:=0;
  exclude_total integer:=0;
  new_participants integer:=0;
  new_female integer:=0;
  new_male integer:=0;
  new_groups integer:=0;
  new_female_groups integer:=0;
  new_male_groups integer:=0;
  new_companies integer:=0;
  open_groups integer:=0;
  open_female_groups integer:=0;
  open_male_groups integer:=0;
  awaiting_staff integer:=0;
  remaining_blockers integer:=0;
  exclusion_conflicts integer:=0;
  available_female integer:=0;
  available_male integer:=0;
  available_assistants integer:=0;
  min_group_size integer:=8;
  max_group_size integer:=10;
  groups_per_company integer:=2;
  avoid_same_unit boolean:=true;
  small_cohort_groups integer:=0;
begin
  if not private.can_finalize_session(p_session_id) then
    raise exception 'Final roster access required';
  end if;
  if not exists(select 1 from public.sessions where id=p_session_id) then
    raise exception 'Session not found';
  end if;

  select * into final_row
  from public.session_roster_finalizations
  where session_id=p_session_id;

  select coalesce(ss.group_min_size,8),coalesce(ss.group_max_size,10),
    coalesce(ss.groups_per_company,2),coalesce(ss.avoid_same_unit,true)
  into min_group_size,max_group_size,groups_per_company,avoid_same_unit
  from public.session_structure_settings ss
  where ss.session_id=p_session_id;

  min_group_size:=greatest(coalesce(min_group_size,8),1);
  max_group_size:=greatest(coalesce(max_group_size,10),1);
  groups_per_company:=greatest(coalesce(groups_per_company,2),1);

  with session_row as materialized (
    select id,starts_on,ends_on
    from public.sessions
    where id=p_session_id
  ),
  participant_state as materialized (
    select
      p.id,
      p.sex::text as sex,
      p.group_id,
      p.unit_name,
      p.is_current,
      p.registration_status,
      p.verification_status,
      p.attendance_status,
      coalesce(p.operational_status,'active') as operational_status,
      od.cohort_state,
      coalesce(od.local_clearance,false) as local_clearance,
      coalesce(od.registration_confirmed,false) as registration_confirmed,
      coalesce(od.guardian_confirmed,false) as guardian_confirmed,
      coalesce(od.leadership_confirmed,false) as leadership_confirmed,
      coalesce(
        case
          when s.starts_on is not null and d.date_of_birth is not null
            then extract(year from age(s.starts_on,d.date_of_birth))::integer
          else null
        end,
        p.age
      )::integer as age_on_start,
      d.date_of_birth,
      s.starts_on,
      s.ends_on
    from public.participants p
    join session_row s on s.id=p.session_id
    left join public.participant_private_details d on d.participant_id=p.id
    left join public.participant_operation_decisions od on od.participant_id=p.id
  ),
  evaluated as materialized (
    select ps.*,
      case
        when ps.operational_status<>'active' then false
        when not ps.is_current then false
        when ps.registration_status='cancelled' then false
        when ps.attendance_status='confirmed_not_attending' then false
        when ps.age_on_start>=20 then false
        when ps.cohort_state='excluded' then false
        when ps.cohort_state='exception'
          and ps.local_clearance
          and ps.registration_confirmed
          and ps.guardian_confirmed
          and ps.leadership_confirmed then true
        when ps.verification_status='verified'
          and ps.registration_status in ('approved','awaiting')
          and ps.age_on_start between 12 and 19 then true
        when ps.registration_status='approved'
          and ps.verification_status='verified'
          and ps.date_of_birth is not null
          and ps.starts_on is not null
          and ps.ends_on is not null
          and ps.age_on_start between 14 and 18
          and ps.ends_on < (ps.date_of_birth+interval '19 years')::date then true
        else false
      end as eligible
    from participant_state ps
  ),
  candidates as materialized (
    select e.*,
      case
        when e.age_on_start between 12 and 13 then 'age_12_13'
        when e.registration_status='awaiting' then 'awaiting_approval'
        when e.age_on_start=19 then 'age_19'
        else 'standard'
      end as cohort,
      (
        e.is_current
        and e.operational_status='active'
        and e.attendance_status<>'confirmed_not_attending'
        and e.registration_status<>'cancelled'
        and coalesce(e.verification_status,'pending')='verified'
        and e.age_on_start between 12 and 19
        and e.cohort_state is distinct from 'excluded'
        and (e.eligible or e.registration_status in ('approved','awaiting'))
      ) as include_candidate
    from evaluated e
  ),
  unplaced_people as materialized (
    select
      c.cohort,
      c.sex,
      coalesce(nullif(lower(trim(c.unit_name)),''),'__unknown__') as unit_key,
      count(*) over(
        partition by c.cohort,c.sex,coalesce(nullif(lower(trim(c.unit_name)),''),'__unknown__')
      )::integer as unit_count
    from candidates c
    where c.include_candidate and c.group_id is null
  ),
  bucket_counts as materialized (
    select cohort,sex,count(*)::integer as participant_count,
      coalesce(max(unit_count),0)::integer as max_unit_count
    from unplaced_people
    group by cohort,sex
  ),
  planned as materialized (
    select cohort,sex,
      greatest(
        ceil(participant_count/max_group_size::numeric)::integer,
        case when avoid_same_unit then max_unit_count else 0 end
      ) as group_count,
      participant_count
    from bucket_counts
  )
  select
    count(*) filter(where c.include_candidate)::integer,
    count(*) filter(where c.include_candidate and c.cohort='awaiting_approval')::integer,
    count(*) filter(where c.include_candidate and c.cohort='age_12_13')::integer,
    count(*) filter(where c.include_candidate and c.cohort='age_19')::integer,
    count(*) filter(where c.include_candidate and c.group_id is null)::integer,
    count(*) filter(where c.include_candidate and c.group_id is null and c.sex='female')::integer,
    count(*) filter(where c.include_candidate and c.group_id is null and c.sex='male')::integer,
    count(*) filter(where c.is_current and c.registration_status<>'cancelled' and c.age_on_start>=20)::integer,
    count(*) filter(
      where c.is_current
        and c.registration_status<>'cancelled'
        and c.age_on_start>=20
        and (
          exists(select 1 from public.check_ins ci where ci.session_id=p_session_id and ci.participant_id=c.id and ci.status::text in ('arrived','needs_attention'))
          or exists(select 1 from public.housing_assignments ha where ha.session_id=p_session_id and ha.participant_id=c.id and ha.active)
          or exists(select 1 from public.participant_badge_assignments b where b.session_id=p_session_id and b.participant_id=c.id and b.state<>'retired')
        )
    )::integer,
    count(*) filter(
      where c.is_current
        and c.operational_status='active'
        and c.attendance_status<>'confirmed_not_attending'
        and c.registration_status<>'cancelled'
        and c.age_on_start<20
        and not c.eligible
        and not c.include_candidate
    )::integer,
    coalesce((select sum(p.group_count) from planned p),0)::integer,
    coalesce((select sum(p.group_count) from planned p where p.sex='female'),0)::integer,
    coalesce((select sum(p.group_count) from planned p where p.sex='male'),0)::integer,
    coalesce((select sum(ceil(p.group_count::numeric/groups_per_company)) from planned p),0)::integer,
    coalesce((select sum(p.group_count) from planned p where p.participant_count<min_group_size),0)::integer
  into include_total,awaiting_total,younger_total,age19_total,
    new_participants,new_female,new_male,exclude_total,exclusion_conflicts,
    remaining_blockers,new_groups,new_female_groups,new_male_groups,
    new_companies,small_cohort_groups
  from candidates c;

  select count(*)::integer,
    count(*) filter(where g.sex::text='female')::integer,
    count(*) filter(where g.sex::text='male')::integer
  into open_groups,open_female_groups,open_male_groups
  from public.counselor_groups g
  where g.session_id=p_session_id and g.state='published'
    and (g.counselor_id is null or not private.staff_can_plan(g.counselor_id));

  select count(*)::integer into awaiting_staff
  from public.staff st
  left join public.staff_operations o on o.staff_id=st.id
  where st.session_id=p_session_id and st.is_current and st.registration_status='awaiting'
    and coalesce(o.planning_state,'reserve')<>'excluded'
    and coalesce(o.arrival_state,'expected') not in ('no_show','left');

  select count(*) filter(where st.sex::text='female')::integer,
    count(*) filter(where st.sex::text='male')::integer
  into available_female,available_male
  from public.staff st
  left join public.staff_operations o on o.staff_id=st.id
  where st.session_id=p_session_id and st.is_current and st.registration_status<>'cancelled'
    and st.operational_role='counselor'
    and coalesce(o.planning_state,'reserve')<>'excluded'
    and coalesce(o.service_clearance,'confirmation_required')<>'not_cleared'
    and coalesce(o.arrival_state,'expected') not in ('no_show','left')
    and not exists(select 1 from public.counselor_groups g where g.session_id=p_session_id and g.counselor_id=st.id);

  select count(*)::integer into available_assistants
  from public.staff st
  left join public.staff_operations o on o.staff_id=st.id
  where st.session_id=p_session_id and st.is_current and st.registration_status<>'cancelled'
    and st.operational_role='assistant_coordinator'
    and coalesce(o.planning_state,'reserve')<>'excluded'
    and coalesce(o.service_clearance,'confirmation_required')<>'not_cleared'
    and coalesce(o.arrival_state,'expected') not in ('no_show','left')
    and not exists(select 1 from public.staff_company_assignments a where a.session_id=p_session_id and a.staff_id=st.id);

  return jsonb_build_object(
    'can_finalize',true,
    'already_finalized',final_row.id is not null,
    'finalized_at',final_row.finalized_at,
    'final_summary',coalesce(final_row.summary,'{}'::jsonb),
    'participants_to_include',include_total,
    'participants_awaiting_to_allow',awaiting_total,
    'participants_12_13_to_allow',younger_total,
    'participants_19_to_allow',age19_total,
    'new_participants',new_participants,
    'female_to_include',new_female,
    'male_to_include',new_male,
    'participants_20_plus_to_remove',exclude_total,
    'staff_awaiting_to_clear',awaiting_staff,
    'existing_groups_needing_counselor',open_groups,
    'existing_female_groups_needing_counselor',open_female_groups,
    'existing_male_groups_needing_counselor',open_male_groups,
    'new_female_groups',new_female_groups,
    'new_male_groups',new_male_groups,
    'new_groups',new_groups,
    'new_companies',new_companies,
    'small_cohort_groups',small_cohort_groups,
    'group_min_size',min_group_size,
    'group_max_size',max_group_size,
    'groups_per_company',groups_per_company,
    'avoid_same_unit',avoid_same_unit,
    'remaining_participant_blockers',remaining_blockers,
    'available_female_counselors',available_female,
    'available_male_counselors',available_male,
    'available_assistant_coordinators',available_assistants,
    'exclusion_conflicts',exclusion_conflicts,
    'existing_placements_moved',0,
    'safe_to_apply',exclusion_conflicts=0
      and remaining_blockers=0
      and available_female>=open_female_groups+new_female_groups
      and available_male>=open_male_groups+new_male_groups
      and available_assistants>=new_companies
  );
end;
$$;

revoke all on function public.get_session_finalization_preview_v2(uuid) from public;
grant execute on function public.get_session_finalization_preview_v2(uuid) to authenticated;
