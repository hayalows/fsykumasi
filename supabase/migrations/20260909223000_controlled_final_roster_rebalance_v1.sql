-- Controlled final-roster rebalance v1.
--
-- Goals:
--   * keep the existing published structure as the baseline;
--   * integrate final eligible youth with the fewest possible placement changes;
--   * enforce the approved 12-18 participant window for the controlled closeout;
--   * keep same-unit youth out of the same counselor group;
--   * create groups/companies only when the final population truly needs them;
--   * preserve an exact rollback point before the rebalance is applied;
--   * preserve an existing FSY ID whenever the participant stays in the same company.
--
-- This migration is additive. Applying the migration alone does not rebalance a session.
-- The write path is public.apply_controlled_final_roster_rebalance_v3().

create table if not exists public.session_roster_versions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  label text not null,
  reason text,
  policy_version text not null default 'controlled-v3',
  snapshot jsonb not null,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  restored_by uuid references public.profiles(user_id) on delete set null,
  restored_at timestamptz
);

create index if not exists session_roster_versions_session_created_idx
  on public.session_roster_versions(session_id, created_at desc);

alter table public.session_roster_versions enable row level security;
revoke all on public.session_roster_versions from anon, authenticated;
grant select on public.session_roster_versions to authenticated;

drop policy if exists "whole session leaders read roster versions" on public.session_roster_versions;
create policy "whole session leaders read roster versions"
on public.session_roster_versions for select to authenticated
using (private.can_finalize_session(session_id));

alter table public.participant_operation_decisions
  drop constraint if exists participant_operation_decisions_kind_check;
alter table public.participant_operation_decisions
  add constraint participant_operation_decisions_kind_check
  check (decision_kind is null or decision_kind in (
    'awaiting_approval', 'age_12_13', 'age_19',
    'age_20_plus_excluded', 'age_policy_excluded',
    'manual_exception', 'manual_exclusion'
  ));

-- Eligibility now follows the session's configured age window. This lets a
-- saved roster version restore the earlier age policy without replacing SQL.
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
      when age_on_start is null then false
      when age_on_start < coalesce(ss.participant_min_age,12) then false
      when age_on_start > coalesce(ss.participant_max_age,19) then false
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
    cross join lateral (
      select private.session_participant_age(target_session,p.id) age_on_start
    ) age_value
    where p.id=target_participant and p.session_id=target_session
  ),false);
$$;

-- Capture only operational roster state. Source registration/private identity
-- data is deliberately not copied into the version store.
create or replace function private.capture_session_roster_snapshot_v1(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'schema_version',1,
    'session_id',p_session_id,
    'captured_at',now(),
    'settings',coalesce((
      select to_jsonb(ss) from public.session_structure_settings ss where ss.session_id=p_session_id
    ),'{}'::jsonb),
    'participant_state',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',p.id,
        'group_id',p.group_id,
        'attendance_status',p.attendance_status,
        'operational_status',p.operational_status,
        'operational_note',p.operational_note,
        'operational_revision',p.operational_revision,
        'operational_updated_by',p.operational_updated_by,
        'operational_updated_at',p.operational_updated_at
      ) order by p.id)
      from public.participants p where p.session_id=p_session_id
    ),'[]'::jsonb),
    'participant_decisions',coalesce((
      select jsonb_agg(to_jsonb(d) order by d.participant_id)
      from public.participant_operation_decisions d
      join public.participants p on p.id=d.participant_id
      where p.session_id=p_session_id
    ),'[]'::jsonb),
    'companies',coalesce((
      select jsonb_agg(to_jsonb(c) order by c.id)
      from public.companies c where c.session_id=p_session_id
    ),'[]'::jsonb),
    'groups',coalesce((
      select jsonb_agg(to_jsonb(g) order by g.id)
      from public.counselor_groups g where g.session_id=p_session_id
    ),'[]'::jsonb),
    'badges',coalesce((
      select jsonb_agg(to_jsonb(b) order by b.id)
      from public.participant_badge_assignments b where b.session_id=p_session_id
    ),'[]'::jsonb),
    'badge_history',coalesce((
      select jsonb_agg(to_jsonb(h) order by h.id)
      from public.participant_badge_id_history h where h.session_id=p_session_id
    ),'[]'::jsonb),
    'staff_company_assignments',coalesce((
      select jsonb_agg(to_jsonb(a) order by a.staff_id,a.company_id)
      from public.staff_company_assignments a where a.session_id=p_session_id
    ),'[]'::jsonb),
    'staff_operations',coalesce((
      select jsonb_agg(to_jsonb(o) order by o.staff_id)
      from public.staff_operations o
      join public.staff st on st.id=o.staff_id
      where st.session_id=p_session_id
    ),'[]'::jsonb),
    'finalization',coalesce((
      select to_jsonb(f) from public.session_roster_finalizations f where f.session_id=p_session_id
    ),'{}'::jsonb),
    'freeze',coalesce((
      select to_jsonb(f) from public.session_roster_freezes f where f.session_id=p_session_id
    ),'{}'::jsonb)
  );
$$;

create or replace function private.save_session_roster_version_v1(
  p_session_id uuid,
  p_label text,
  p_reason text,
  p_policy_version text default 'controlled-v3'
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  version_id uuid;
  snapshot_value jsonb;
  summary_value jsonb;
begin
  snapshot_value:=private.capture_session_roster_snapshot_v1(p_session_id);
  summary_value:=jsonb_build_object(
    'companies',(select count(*) from public.companies c where c.session_id=p_session_id),
    'published_groups',(select count(*) from public.counselor_groups g where g.session_id=p_session_id and g.state='published'),
    'participants_with_group',(select count(*) from public.participants p where p.session_id=p_session_id and p.group_id is not null),
    'active_badges',(select count(*) from public.participant_badge_assignments b where b.session_id=p_session_id and b.state<>'retired')
  );
  insert into public.session_roster_versions(
    session_id,label,reason,policy_version,snapshot,summary,created_by
  ) values(
    p_session_id,
    left(coalesce(nullif(trim(p_label),''),'Roster version'),120),
    nullif(trim(coalesce(p_reason,'')),''),
    coalesce(nullif(trim(p_policy_version),''),'controlled-v3'),
    snapshot_value,summary_value,(select auth.uid())
  ) returning id into version_id;
  return version_id;
end;
$$;

create or replace function public.save_session_roster_version_v1(
  p_session_id uuid,
  p_label text default 'Current roster',
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare version_id uuid;
begin
  if not private.can_finalize_session(p_session_id) then
    raise exception 'Final roster access required';
  end if;
  if not exists(select 1 from public.sessions s where s.id=p_session_id) then
    raise exception 'Session not found';
  end if;
  version_id:=private.save_session_roster_version_v1(p_session_id,p_label,p_reason,'manual-snapshot');
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_session_id,(select auth.uid()),'session_roster_version_saved','session_roster_version',version_id::text,
    jsonb_build_object('label',p_label,'reason',p_reason));
  return jsonb_build_object('version_id',version_id,'saved',true);
end;
$$;

create or replace function public.list_session_roster_versions_v1(p_session_id uuid)
returns table(
  id uuid,label text,reason text,policy_version text,summary jsonb,
  created_at timestamptz,restored_at timestamptz
)
language sql
stable
security definer
set search_path=''
as $$
  select v.id,v.label,v.reason,v.policy_version,v.summary,v.created_at,v.restored_at
  from public.session_roster_versions v
  where v.session_id=p_session_id and private.can_finalize_session(p_session_id)
  order by v.created_at desc
  limit 20;
$$;

-- Read-only planner. It may use temporary tables, but it changes no persistent
-- roster state. The plan is deterministic for a fixed database state.
create or replace function private.controlled_final_roster_plan_v3(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  min_size integer:=8;
  max_size integer:=10;
  groups_per_company integer:=4;
  avoid_same_unit boolean:=true;
  final_total integer:=0;
  final_female integer:=0;
  final_male integer:=0;
  existing_female_groups integer:=0;
  existing_male_groups integer:=0;
  target_female_groups integer:=0;
  target_male_groups integer:=0;
  new_female_groups integer:=0;
  new_male_groups integer:=0;
  new_companies integer:=0;
  excluded_19_plus integer:=0;
  unplaced_initial integer:=0;
  required_moves integer:=0;
  placement_moves integer:=0;
  badges_preserved integer:=0;
  badge_id_changes integer:=0;
  new_ids integer:=0;
  same_company_group_changes integer:=0;
  live_checkins integer:=0;
  active_housing integer:=0;
  participant_blockers integer:=0;
  baseline_unit_conflicts integer:=0;
  over_capacity_groups integer:=0;
  open_female_counselor_groups integer:=0;
  open_male_counselor_groups integer:=0;
  available_female_counselors integer:=0;
  available_male_counselors integer:=0;
  available_assistants integer:=0;
  female_counselors_needed integer:=0;
  male_counselors_needed integer:=0;
  company_number integer:=0;
  female_group_number integer:=0;
  male_group_number integer:=0;
  company_seq integer:=0;
  group_seq integer:=0;
  fill_target integer:=0;
  currently_unassigned integer:=0;
  reserve_needed integer:=0;
  current_count integer:=0;
  unit_row record;
  candidate_row record;
  group_row record;
  new_group_row record;
  donor_row record;
  spare_company record;
  target_group_key text;
  target_company_key text;
  shortage_female integer:=0;
  shortage_male integer:=0;
  safe boolean:=false;
begin
  select coalesce(ss.group_min_size,8),coalesce(ss.group_max_size,10),
    coalesce(ss.groups_per_company,4),coalesce(ss.avoid_same_unit,true)
  into min_size,max_size,groups_per_company,avoid_same_unit
  from public.session_structure_settings ss where ss.session_id=p_session_id;
  min_size:=greatest(coalesce(min_size,8),1);
  max_size:=greatest(coalesce(max_size,10),min_size);
  groups_per_company:=greatest(coalesce(groups_per_company,4),1);

  drop table if exists pg_temp.tmp_cr_candidates;
  drop table if exists pg_temp.tmp_cr_groups;
  drop table if exists pg_temp.tmp_cr_assignments;
  drop table if exists pg_temp.tmp_cr_unit_need;
  drop table if exists pg_temp.tmp_cr_new_groups;
  drop table if exists pg_temp.tmp_cr_company_capacity;

  create temporary table tmp_cr_candidates(
    participant_id uuid primary key,
    sex text not null,
    unit_key text not null,
    original_group_id uuid,
    original_company_id uuid,
    valid_group_id uuid,
    valid_company_id uuid,
    badge_id uuid,
    original_fsy_id text,
    original_slot integer,
    origin_code text,
    badge_name text
  ) on commit drop;

  insert into tmp_cr_candidates(
    participant_id,sex,unit_key,original_group_id,original_company_id,
    valid_group_id,valid_company_id,badge_id,original_fsy_id,original_slot,origin_code,badge_name
  )
  select p.id,p.sex::text,coalesce(nullif(lower(trim(p.unit_name)),''),'__unknown__'),
    p.group_id,original_group.company_id,
    valid_group.id,valid_group.company_id,
    b.id,b.fsy_id,b.slot_number,b.origin_code,b.badge_name
  from public.participants p
  left join public.counselor_groups original_group
    on original_group.id=p.group_id and original_group.session_id=p.session_id
  left join public.counselor_groups valid_group
    on valid_group.id=p.group_id and valid_group.session_id=p.session_id
    and valid_group.state='published' and valid_group.sex=p.sex
  left join public.participant_operation_decisions od on od.participant_id=p.id
  left join public.participant_badge_assignments b
    on b.session_id=p.session_id and b.participant_id=p.id and b.state<>'retired'
  where p.session_id=p_session_id
    and p.is_current
    and coalesce(p.operational_status,'active')='active'
    and p.attendance_status<>'confirmed_not_attending'
    and p.registration_status in ('approved','awaiting')
    and p.verification_status='verified'
    and private.session_participant_age(p_session_id,p.id) between 12 and 18
    and od.cohort_state is distinct from 'excluded';

  select count(*)::integer,
    count(*) filter(where sex='female')::integer,
    count(*) filter(where sex='male')::integer,
    count(*) filter(where valid_group_id is null)::integer
  into final_total,final_female,final_male,unplaced_initial
  from tmp_cr_candidates;

  select count(*)::integer into excluded_19_plus
  from public.participants p
  where p.session_id=p_session_id and p.is_current
    and p.registration_status<>'cancelled'
    and private.session_participant_age(p_session_id,p.id)>=19;

  select count(*)::integer into live_checkins
  from public.check_ins ci
  where ci.session_id=p_session_id and ci.status::text in ('arrived','needs_attention');

  select count(*)::integer into active_housing
  from public.housing_assignments h
  where h.session_id=p_session_id and h.active;

  select count(*)::integer into participant_blockers
  from public.participants p
  left join public.participant_operation_decisions od on od.participant_id=p.id
  where p.session_id=p_session_id and p.is_current
    and coalesce(p.operational_status,'active')='active'
    and p.attendance_status<>'confirmed_not_attending'
    and p.registration_status<>'cancelled'
    and private.session_participant_age(p_session_id,p.id) between 12 and 18
    and not (
      p.registration_status in ('approved','awaiting')
      and p.verification_status='verified'
      and od.cohort_state is distinct from 'excluded'
    );

  create temporary table tmp_cr_groups(
    group_key text primary key,
    group_id uuid,
    company_key text,
    company_id uuid,
    sex text not null,
    is_new boolean not null default false,
    group_order integer not null default 0,
    member_count integer not null default 0,
    unit_keys text[] not null default '{}'
  ) on commit drop;

  insert into tmp_cr_groups(group_key,group_id,company_key,company_id,sex,is_new,group_order,member_count,unit_keys)
  select g.id::text,g.id,g.company_id::text,g.company_id,g.sex::text,false,
    row_number() over(partition by g.sex order by
      coalesce(nullif(regexp_replace(g.name,'\D','','g'),'')::integer,2147483647),g.name,g.id)::integer,
    count(c.participant_id)::integer,
    coalesce(array_agg(c.unit_key order by c.unit_key) filter(where c.participant_id is not null),'{}'::text[])
  from public.counselor_groups g
  left join tmp_cr_candidates c on c.valid_group_id=g.id
  where g.session_id=p_session_id and g.state='published'
  group by g.id,g.company_id,g.sex,g.name;

  select count(*) filter(where sex='female')::integer,
    count(*) filter(where sex='male')::integer
  into existing_female_groups,existing_male_groups
  from tmp_cr_groups;

  select greatest(
      ceil(final_female/max_size::numeric)::integer,
      case when avoid_same_unit then coalesce(max(n),0)::integer else 0 end
    ) into target_female_groups
  from (select unit_key,count(*)::integer n from tmp_cr_candidates where sex='female' group by unit_key) q;
  target_female_groups:=greatest(coalesce(target_female_groups,0),existing_female_groups);

  select greatest(
      ceil(final_male/max_size::numeric)::integer,
      case when avoid_same_unit then coalesce(max(n),0)::integer else 0 end
    ) into target_male_groups
  from (select unit_key,count(*)::integer n from tmp_cr_candidates where sex='male' group by unit_key) q;
  target_male_groups:=greatest(coalesce(target_male_groups,0),existing_male_groups);

  new_female_groups:=greatest(target_female_groups-existing_female_groups,0);
  new_male_groups:=greatest(target_male_groups-existing_male_groups,0);

  select count(*)::integer into baseline_unit_conflicts
  from (
    select valid_group_id,unit_key,count(*)
    from tmp_cr_candidates
    where valid_group_id is not null
    group by valid_group_id,unit_key
    having count(*)>1
  ) d;

  select count(*)::integer into over_capacity_groups
  from tmp_cr_groups where member_count>max_size;

  create temporary table tmp_cr_assignments(
    participant_id uuid primary key,
    target_group_key text,
    assignment_kind text not null,
    original_group_id uuid,
    original_company_id uuid
  ) on commit drop;

  insert into tmp_cr_assignments(participant_id,target_group_key,assignment_kind,original_group_id,original_company_id)
  select c.participant_id,c.valid_group_id::text,'preserved',c.original_group_id,c.original_company_id
  from tmp_cr_candidates c where c.valid_group_id is not null;

  create temporary table tmp_cr_unit_need(
    sex text not null,
    unit_key text not null,
    unplaced_count integer not null,
    new_group_count integer not null,
    required_existing integer not null,
    compatible_open_groups integer not null default 0,
    primary key(sex,unit_key)
  ) on commit drop;

  insert into tmp_cr_unit_need(sex,unit_key,unplaced_count,new_group_count,required_existing)
  select c.sex,c.unit_key,count(*)::integer,
    case when c.sex='female' then new_female_groups else new_male_groups end,
    greatest(count(*)::integer-case when c.sex='female' then new_female_groups else new_male_groups end,0)
  from tmp_cr_candidates c
  left join tmp_cr_assignments a on a.participant_id=c.participant_id
  where a.participant_id is null
  group by c.sex,c.unit_key;

  update tmp_cr_unit_need u
  set compatible_open_groups=(
    select count(*)::integer
    from tmp_cr_groups g
    where not g.is_new and g.sex=u.sex and g.member_count<max_size
      and (not avoid_same_unit or not (u.unit_key=any(g.unit_keys)))
  );

  -- First place the unit repetitions that cannot fit into the planned new
  -- groups. Units with fewer compatible vacancies go first.
  for unit_row in
    select * from tmp_cr_unit_need
    where required_existing>0
    order by compatible_open_groups,required_existing desc,unit_key
  loop
    for group_seq in 1..unit_row.required_existing loop
      select c.participant_id into candidate_row
      from tmp_cr_candidates c
      left join tmp_cr_assignments a on a.participant_id=c.participant_id
      where a.participant_id is null and c.sex=unit_row.sex and c.unit_key=unit_row.unit_key
      order by c.participant_id limit 1;
      exit when candidate_row.participant_id is null;

      target_group_key:=null;
      select g.group_key into target_group_key
      from tmp_cr_groups g
      where not g.is_new and g.sex=unit_row.sex and g.member_count<max_size
        and (not avoid_same_unit or not (unit_row.unit_key=any(g.unit_keys)))
      order by g.member_count desc,g.group_order,g.group_key
      limit 1;
      exit when target_group_key is null;

      insert into tmp_cr_assignments(participant_id,target_group_key,assignment_kind,original_group_id,original_company_id)
      select c.participant_id,target_group_key,'new_into_existing',c.original_group_id,c.original_company_id
      from tmp_cr_candidates c where c.participant_id=candidate_row.participant_id;
      update tmp_cr_groups
      set member_count=member_count+1,unit_keys=array_append(unit_keys,unit_row.unit_key)
      where group_key=target_group_key;
    end loop;
  end loop;

  -- Fill additional old-group vacancies only when doing so still leaves at
  -- least the configured minimum for every new group.
  for unit_row in select distinct sex from tmp_cr_candidates order by sex loop
    select count(*)::integer into currently_unassigned
    from tmp_cr_candidates c left join tmp_cr_assignments a on a.participant_id=c.participant_id
    where c.sex=unit_row.sex and a.participant_id is null;
    reserve_needed:=(case when unit_row.sex='female' then new_female_groups else new_male_groups end)*min_size;
    fill_target:=greatest(currently_unassigned-reserve_needed,0);
    for group_seq in 1..fill_target loop
      candidate_row:=null;
      select c.* into candidate_row
      from tmp_cr_candidates c
      left join tmp_cr_assignments a on a.participant_id=c.participant_id
      where c.sex=unit_row.sex and a.participant_id is null
        and exists(
          select 1 from tmp_cr_groups g
          where not g.is_new and g.sex=c.sex and g.member_count<max_size
            and (not avoid_same_unit or not (c.unit_key=any(g.unit_keys)))
        )
      order by (
        select count(*) from tmp_cr_candidates x
        left join tmp_cr_assignments ax on ax.participant_id=x.participant_id
        where x.sex=c.sex and x.unit_key=c.unit_key and ax.participant_id is null
      ) desc,c.participant_id
      limit 1;
      exit when candidate_row.participant_id is null;
      select g.group_key into target_group_key
      from tmp_cr_groups g
      where not g.is_new and g.sex=candidate_row.sex and g.member_count<max_size
        and (not avoid_same_unit or not (candidate_row.unit_key=any(g.unit_keys)))
      order by g.member_count desc,g.group_order,g.group_key limit 1;
      exit when target_group_key is null;
      insert into tmp_cr_assignments values(
        candidate_row.participant_id,target_group_key,'new_into_existing',candidate_row.original_group_id,candidate_row.original_company_id
      );
      update tmp_cr_groups
      set member_count=member_count+1,unit_keys=array_append(unit_keys,candidate_row.unit_key)
      where group_key=target_group_key;
    end loop;
  end loop;

  select greatest(new_female_groups*min_size-(
      select count(*) from tmp_cr_candidates c left join tmp_cr_assignments a on a.participant_id=c.participant_id
      where c.sex='female' and a.participant_id is null
    ),0)::integer into shortage_female;
  select greatest(new_male_groups*min_size-(
      select count(*) from tmp_cr_candidates c left join tmp_cr_assignments a on a.participant_id=c.participant_id
      where c.sex='male' and a.participant_id is null
    ),0)::integer into shortage_male;

  select coalesce(max(coalesce(c.operational_number,nullif(regexp_replace(c.name,'\D','','g'),'')::integer)),0)::integer
  into company_number from public.companies c where c.session_id=p_session_id;
  select coalesce(max(nullif(regexp_replace(g.name,'\D','','g'),'')::integer),0)::integer
  into female_group_number from public.counselor_groups g
  where g.session_id=p_session_id and g.sex::text='female';
  select coalesce(max(nullif(regexp_replace(g.name,'\D','','g'),'')::integer),0)::integer
  into male_group_number from public.counselor_groups g
  where g.session_id=p_session_id and g.sex::text='male';

  create temporary table tmp_cr_new_groups(
    group_key text primary key,
    sex text not null,
    group_index integer not null,
    group_name text not null,
    company_key text,
    company_id uuid,
    company_name text,
    operational_number integer
  ) on commit drop;

  for group_seq in 1..new_female_groups loop
    female_group_number:=female_group_number+1;
    insert into tmp_cr_new_groups(group_key,sex,group_index,group_name,operational_number)
    values('new-female-'||group_seq,'female',group_seq,'YW Group '||female_group_number,female_group_number);
  end loop;
  for group_seq in 1..new_male_groups loop
    male_group_number:=male_group_number+1;
    insert into tmp_cr_new_groups(group_key,sex,group_index,group_name,operational_number)
    values('new-male-'||group_seq,'male',group_seq,'YM Group '||male_group_number,male_group_number);
  end loop;

  create temporary table tmp_cr_company_capacity(
    company_id uuid primary key,
    company_key text not null,
    company_name text not null,
    used_groups integer not null,
    free_groups integer not null
  ) on commit drop;
  insert into tmp_cr_company_capacity(company_id,company_key,company_name,used_groups,free_groups)
  select c.id,c.id::text,c.name,count(g.id) filter(where g.state='published')::integer,
    greatest(groups_per_company-count(g.id) filter(where g.state='published')::integer,0)
  from public.companies c
  left join public.counselor_groups g on g.company_id=c.id and g.session_id=c.session_id
  where c.session_id=p_session_id
  group by c.id,c.name
  having count(g.id) filter(where g.state='published')<groups_per_company;

  -- Put an under-filled new-group target into an existing company first. This
  -- gives any required donor move a chance to stay inside the same company,
  -- which preserves the participant's existing FSY ID.
  for spare_company in
    select * from tmp_cr_company_capacity where free_groups>0
    order by free_groups desc,company_name,company_id
  loop
    target_group_key:=null;
    if shortage_female>0 then
      select ng.group_key into target_group_key from tmp_cr_new_groups ng
      where ng.company_key is null and ng.sex='female'
      order by ng.group_index desc limit 1;
    end if;
    if target_group_key is null and shortage_male>0 then
      select ng.group_key into target_group_key from tmp_cr_new_groups ng
      where ng.company_key is null and ng.sex='male'
      order by ng.group_index desc limit 1;
    end if;
    if target_group_key is null then
      select ng.group_key into target_group_key from tmp_cr_new_groups ng
      where ng.company_key is null
      order by ng.sex,ng.group_index desc limit 1;
    end if;
    exit when target_group_key is null;
    update tmp_cr_new_groups
    set company_key=spare_company.company_key,company_id=spare_company.company_id,company_name=spare_company.company_name
    where group_key=target_group_key;
  end loop;

  -- Pack every remaining new group into the fewest possible new companies.
  company_seq:=0;
  group_seq:=0;
  for new_group_row in
    select * from tmp_cr_new_groups where company_key is null order by sex,group_index
  loop
    if group_seq % groups_per_company=0 then
      company_seq:=company_seq+1;
      company_number:=company_number+1;
    end if;
    target_company_key:='new-company-'||company_seq;
    update tmp_cr_new_groups
    set company_key=target_company_key,company_name='Company '||company_number
    where group_key=new_group_row.group_key;
    group_seq:=group_seq+1;
  end loop;
  new_companies:=company_seq;

  insert into tmp_cr_groups(group_key,group_id,company_key,company_id,sex,is_new,group_order,member_count,unit_keys)
  select ng.group_key,null,ng.company_key,ng.company_id,ng.sex,true,ng.group_index,0,'{}'::text[]
  from tmp_cr_new_groups ng;

  -- Place every remaining new participant into the new groups, most repeated
  -- units first, always respecting capacity and the same-unit prohibition.
  for candidate_row in
    select c.*
    from tmp_cr_candidates c
    left join tmp_cr_assignments a on a.participant_id=c.participant_id
    where a.participant_id is null
    order by (
      select count(*) from tmp_cr_candidates x
      left join tmp_cr_assignments ax on ax.participant_id=x.participant_id
      where x.sex=c.sex and x.unit_key=c.unit_key and ax.participant_id is null
    ) desc,c.unit_key,c.participant_id
  loop
    target_group_key:=null;
    select g.group_key into target_group_key
    from tmp_cr_groups g
    where g.is_new and g.sex=candidate_row.sex and g.member_count<max_size
      and (not avoid_same_unit or not (candidate_row.unit_key=any(g.unit_keys)))
    order by g.member_count,g.group_order,g.group_key limit 1;
    if target_group_key is null then
      continue;
    end if;
    insert into tmp_cr_assignments values(
      candidate_row.participant_id,target_group_key,'new_into_new',candidate_row.original_group_id,candidate_row.original_company_id
    );
    update tmp_cr_groups
    set member_count=member_count+1,unit_keys=array_append(unit_keys,candidate_row.unit_key)
    where group_key=target_group_key;
  end loop;

  -- If mandatory same-unit spreading left a new group below the minimum, move
  -- the smallest possible number of baseline participants. Same-company
  -- donors are preferred so their FSY ID can remain unchanged.
  for new_group_row in
    select * from tmp_cr_groups where is_new and member_count<min_size
    order by member_count,sex,group_order
  loop
    while (select member_count from tmp_cr_groups where group_key=new_group_row.group_key)<min_size loop
      donor_row:=null;
      select c.*,a.target_group_key as donor_group_key,g.member_count as donor_group_count
      into donor_row
      from tmp_cr_candidates c
      join tmp_cr_assignments a on a.participant_id=c.participant_id and a.assignment_kind='preserved'
      join tmp_cr_groups g on g.group_key=a.target_group_key and not g.is_new
      where c.sex=new_group_row.sex
        and g.member_count>min_size
        and (not avoid_same_unit or not (c.unit_key=any((select unit_keys from tmp_cr_groups where group_key=new_group_row.group_key))))
        and not exists(
          select 1 from public.check_ins ci where ci.session_id=p_session_id and ci.participant_id=c.participant_id and ci.status::text in ('arrived','needs_attention')
        )
        and not exists(
          select 1 from public.housing_assignments h where h.session_id=p_session_id and h.participant_id=c.participant_id and h.active
        )
      order by
        case when c.original_company_id=(select company_id from tmp_cr_groups where group_key=new_group_row.group_key) then 0 else 1 end,
        g.member_count desc,c.participant_id
      limit 1;
      exit when donor_row.participant_id is null;
      update tmp_cr_assignments
      set target_group_key=new_group_row.group_key,assignment_kind='moved'
      where participant_id=donor_row.participant_id;
      update tmp_cr_groups
      set member_count=member_count-1,unit_keys=array_remove(unit_keys,donor_row.unit_key)
      where group_key=donor_row.donor_group_key;
      update tmp_cr_groups
      set member_count=member_count+1,unit_keys=array_append(unit_keys,donor_row.unit_key)
      where group_key=new_group_row.group_key;
    end loop;
  end loop;

  select count(*)::integer into required_moves
  from tmp_cr_groups where is_new and member_count<min_size;
  select count(*)::integer into placement_moves
  from tmp_cr_assignments where assignment_kind='moved';

  select count(*)::integer into currently_unassigned
  from tmp_cr_candidates c left join tmp_cr_assignments a on a.participant_id=c.participant_id
  where a.participant_id is null;

  select count(*)::integer into badges_preserved
  from tmp_cr_candidates c
  join tmp_cr_assignments a on a.participant_id=c.participant_id
  join tmp_cr_groups g on g.group_key=a.target_group_key
  where c.badge_id is not null
    and coalesce(g.company_id::text,g.company_key)=coalesce(c.original_company_id::text,'');

  select count(*)::integer into badge_id_changes
  from tmp_cr_candidates c
  join tmp_cr_assignments a on a.participant_id=c.participant_id
  join tmp_cr_groups g on g.group_key=a.target_group_key
  where c.badge_id is not null
    and coalesce(g.company_id::text,g.company_key)<>coalesce(c.original_company_id::text,'');

  select count(*)::integer into same_company_group_changes
  from tmp_cr_candidates c
  join tmp_cr_assignments a on a.participant_id=c.participant_id
  join tmp_cr_groups g on g.group_key=a.target_group_key
  where c.badge_id is not null and a.assignment_kind='moved'
    and coalesce(g.company_id::text,g.company_key)=coalesce(c.original_company_id::text,'');

  select count(*)::integer into new_ids
  from tmp_cr_candidates c
  join tmp_cr_assignments a on a.participant_id=c.participant_id
  where c.badge_id is null;

  select count(*) filter(where g.sex::text='female')::integer,
    count(*) filter(where g.sex::text='male')::integer
  into open_female_counselor_groups,open_male_counselor_groups
  from public.counselor_groups g
  where g.session_id=p_session_id and g.state='published'
    and (g.counselor_id is null or not private.staff_can_plan(g.counselor_id));

  select count(*) filter(where st.sex::text='female')::integer,
    count(*) filter(where st.sex::text='male')::integer
  into available_female_counselors,available_male_counselors
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

  female_counselors_needed:=open_female_counselor_groups+new_female_groups;
  male_counselors_needed:=open_male_counselor_groups+new_male_groups;

  safe:=live_checkins=0
    and active_housing=0
    and participant_blockers=0
    and baseline_unit_conflicts=0
    and over_capacity_groups=0
    and currently_unassigned=0
    and required_moves=0
    and available_female_counselors>=female_counselors_needed
    and available_male_counselors>=male_counselors_needed
    and available_assistants>=new_companies;

  return jsonb_build_object(
    'policy_version','controlled-v3-12-18',
    'participant_min_age',12,
    'participant_max_age',18,
    'group_min_size',min_size,
    'group_max_size',max_size,
    'groups_per_company',groups_per_company,
    'avoid_same_unit',avoid_same_unit,
    'final_participants',final_total,
    'final_female',final_female,
    'final_male',final_male,
    'excluded_age_19_plus',excluded_19_plus,
    'new_participants_to_place',unplaced_initial,
    'existing_placements_preserved',final_total-unplaced_initial-placement_moves,
    'existing_placements_moved',placement_moves,
    'target_groups',existing_female_groups+existing_male_groups+new_female_groups+new_male_groups,
    'new_female_groups',new_female_groups,
    'new_male_groups',new_male_groups,
    'new_groups',new_female_groups+new_male_groups,
    'new_companies',new_companies,
    'badge_ids_preserved',badges_preserved,
    'badge_ids_changed',badge_id_changes,
    'same_company_group_changes',same_company_group_changes,
    'new_ids_issued',new_ids,
    'live_checkins',live_checkins,
    'active_housing_assignments',active_housing,
    'participant_blockers',participant_blockers,
    'baseline_unit_conflicts',baseline_unit_conflicts,
    'over_capacity_groups',over_capacity_groups,
    'unassigned_after_plan',currently_unassigned,
    'under_min_groups_after_plan',required_moves,
    'existing_female_groups_needing_counselor',open_female_counselor_groups,
    'existing_male_groups_needing_counselor',open_male_counselor_groups,
    'available_female_counselors',available_female_counselors,
    'available_male_counselors',available_male_counselors,
    'available_assistant_coordinators',available_assistants,
    'safe_to_apply',safe,
    'new_group_plan',coalesce((
      select jsonb_agg(jsonb_build_object(
        'group_key',ng.group_key,'sex',ng.sex,'group_name',ng.group_name,
        'company_key',ng.company_key,'company_id',ng.company_id,'company_name',ng.company_name,
        'operational_number',ng.operational_number,
        'planned_members',(select g.member_count from tmp_cr_groups g where g.group_key=ng.group_key)
      ) order by ng.sex,ng.group_index)
      from tmp_cr_new_groups ng
    ),'[]'::jsonb),
    'placements',coalesce((
      select jsonb_agg(jsonb_build_object(
        'participant_id',a.participant_id,
        'target_group_key',a.target_group_key,
        'target_company_key',g.company_key,
        'target_company_id',g.company_id,
        'assignment_kind',a.assignment_kind,
        'original_group_id',a.original_group_id,
        'original_company_id',a.original_company_id
      ) order by a.participant_id)
      from tmp_cr_assignments a join tmp_cr_groups g on g.group_key=a.target_group_key
    ),'[]'::jsonb)
  );
end;
$$;

create or replace function public.get_controlled_final_roster_preview_v3(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  plan jsonb;
  final_row public.session_roster_finalizations%rowtype;
  latest_version jsonb;
begin
  if not private.can_finalize_session(p_session_id) then
    raise exception 'Final roster access required';
  end if;
  if not exists(select 1 from public.sessions where id=p_session_id) then
    raise exception 'Session not found';
  end if;
  plan:=private.controlled_final_roster_plan_v3(p_session_id);
  select * into final_row from public.session_roster_finalizations where session_id=p_session_id;
  select jsonb_build_object('id',v.id,'label',v.label,'created_at',v.created_at,'summary',v.summary)
    into latest_version
  from public.session_roster_versions v where v.session_id=p_session_id
  order by v.created_at desc limit 1;
  return plan || jsonb_build_object(
    'already_finalized',final_row.id is not null,
    'finalized_at',final_row.finalized_at,
    'final_summary',coalesce(final_row.summary,'{}'::jsonb),
    'latest_saved_version',coalesce(latest_version,'{}'::jsonb)
  );
end;
$$;

-- Apply one exact plan inside one transaction. The automatic version is saved
-- before the first roster mutation, so the operation always has a rollback
-- point if the pre-session state later needs to be restored.
create or replace function public.apply_controlled_final_roster_rebalance_v3(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  plan jsonb;
  snapshot_version_id uuid;
  batch_id uuid:=extensions.gen_random_uuid();
  placement jsonb;
  group_spec jsonb;
  company_key text;
  company_id uuid;
  group_key text;
  group_id uuid;
  target_company_id uuid;
  target_group_id uuid;
  participant_row public.participants%rowtype;
  badge_row public.participant_badge_assignments%rowtype;
  counselor_id uuid;
  assistant_id uuid;
  company_no integer;
  next_slot integer;
  origin_code text;
  next_fsy_id text;
  moved_count integer:=0;
  ids_preserved integer:=0;
  ids_changed integer:=0;
  new_ids integer:=0;
  groups_created integer:=0;
  companies_created integer:=0;
  counselors_assigned integer:=0;
  assistants_assigned integer:=0;
  final_summary jsonb;
begin
  if not private.can_finalize_session(p_session_id) then
    raise exception 'Final roster access required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text,93));
  if not exists(select 1 from public.sessions s where s.id=p_session_id and s.status='planning') then
    raise exception 'The controlled final roster can only be applied while the session is in planning';
  end if;
  if exists(select 1 from public.session_roster_finalizations f where f.session_id=p_session_id) then
    raise exception 'The final roster is already finalized. Restore a saved roster version before applying another finalization';
  end if;

  plan:=private.controlled_final_roster_plan_v3(p_session_id);
  if not coalesce((plan->>'safe_to_apply')::boolean,false) then
    if coalesce((plan->>'live_checkins')::integer,0)>0 then
      raise exception 'Reset all live check-ins before applying the controlled final roster';
    elsif coalesce((plan->>'active_housing_assignments')::integer,0)>0 then
      raise exception 'Active Housing assignments exist. Review them before changing the final roster';
    else
      raise exception 'The controlled final roster has unresolved blockers. Refresh the preview and review the plan';
    end if;
  end if;

  snapshot_version_id:=private.save_session_roster_version_v1(
    p_session_id,
    'Before controlled final roster',
    'Automatic rollback point saved immediately before the controlled final-roster rebalance',
    'pre-controlled-v3'
  );

  insert into public.session_structure_settings(session_id,participant_min_age,participant_max_age,updated_by,updated_at)
  values(p_session_id,12,18,(select auth.uid()),now())
  on conflict(session_id) do update set
    participant_min_age=12,participant_max_age=18,updated_by=(select auth.uid()),updated_at=now();

  -- Exclude everyone outside 12-18 from the active youth roster while keeping
  -- their source registration/person row intact.
  insert into public.participant_operation_decisions(
    participant_id,cohort_state,decision_kind,local_clearance,
    registration_confirmed,guardian_confirmed,leadership_confirmed,
    authority,reason,revision,recorded_by,recorded_at,batch_id
  )
  select p.id,'excluded','age_policy_excluded',false,false,false,false,
    'FSY controlled final roster v3',
    'Outside the active participant age window of 12-18 at session start; source registration retained',
    1,(select auth.uid()),now(),batch_id
  from public.participants p
  where p.session_id=p_session_id and p.is_current and p.registration_status<>'cancelled'
    and private.session_participant_age(p_session_id,p.id)>=19
  on conflict(participant_id) do update set
    cohort_state='excluded',decision_kind='age_policy_excluded',local_clearance=false,
    registration_confirmed=false,guardian_confirmed=false,leadership_confirmed=false,
    authority=excluded.authority,reason=excluded.reason,
    revision=public.participant_operation_decisions.revision+1,
    recorded_by=(select auth.uid()),recorded_at=now(),batch_id=excluded.batch_id;

  update public.participants p set group_id=null,updated_at=now()
  where p.session_id=p_session_id and p.is_current and p.registration_status<>'cancelled'
    and private.session_participant_age(p_session_id,p.id)>=19 and p.group_id is not null;

  update public.participant_badge_assignments b
  set state='retired',retired_by=(select auth.uid()),retired_at=now(),
      note=concat_ws(' · ',nullif(b.note,''),'Retired by controlled final-roster age policy')
  where b.session_id=p_session_id and b.state<>'retired'
    and exists(
      select 1 from public.participants p where p.id=b.participant_id and p.session_id=p_session_id
        and private.session_participant_age(p_session_id,p.id)>=19
    );

  create temporary table tmp_apply_company_map(company_key text primary key,company_id uuid not null) on commit drop;
  insert into tmp_apply_company_map select c.id::text,c.id from public.companies c where c.session_id=p_session_id;

  for company_key in
    select distinct value->>'company_key'
    from jsonb_array_elements(plan->'new_group_plan') e(value)
    where value->>'company_key' like 'new-company-%'
    order by value->>'company_key'
  loop
    select coalesce(max(coalesce(c.operational_number,nullif(regexp_replace(c.name,'\D','','g'),'')::integer)),0)+1
      into company_no from public.companies c where c.session_id=p_session_id;
    insert into public.companies(session_id,name,operational_number,finalization_cohort,finalization_batch_id)
    values(p_session_id,'Company '||company_no,company_no,'standard',batch_id)
    returning id into company_id;
    insert into tmp_apply_company_map values(company_key,company_id);
    companies_created:=companies_created+1;
  end loop;

  create temporary table tmp_apply_group_map(group_key text primary key,group_id uuid not null,company_id uuid not null) on commit drop;
  insert into tmp_apply_group_map(group_key,group_id,company_id)
  select g.id::text,g.id,g.company_id from public.counselor_groups g
  where g.session_id=p_session_id and g.company_id is not null;

  for group_spec in select value from jsonb_array_elements(plan->'new_group_plan') e(value) loop
    group_key:=group_spec->>'group_key';
    company_key:=group_spec->>'company_key';
    if group_spec->>'company_id' is not null and group_spec->>'company_id'<>'null' then
      target_company_id:=(group_spec->>'company_id')::uuid;
    else
      select m.company_id into target_company_id from tmp_apply_company_map m where m.company_key=company_key;
    end if;
    if target_company_id is null then raise exception 'Could not resolve a company for %',group_key; end if;

    counselor_id:=null;
    select st.id into counselor_id
    from public.staff st
    left join public.staff_operations o on o.staff_id=st.id
    where st.session_id=p_session_id and st.is_current and st.registration_status<>'cancelled'
      and st.operational_role='counselor' and st.sex::text=group_spec->>'sex'
      and coalesce(o.planning_state,'reserve')<>'excluded'
      and coalesce(o.service_clearance,'confirmation_required')<>'not_cleared'
      and coalesce(o.arrival_state,'expected') not in ('no_show','left')
      and not exists(select 1 from public.counselor_groups g where g.session_id=p_session_id and g.counselor_id=st.id)
    order by case when st.registration_status='approved' then 0 else 1 end,lower(st.full_name),st.id limit 1;
    if counselor_id is null then raise exception 'Not enough available % counselors',group_spec->>'sex'; end if;

    insert into public.counselor_groups(
      session_id,company_id,name,sex,state,counselor_id,operational_number,
      finalization_cohort,finalization_batch_id
    ) values(
      p_session_id,target_company_id,group_spec->>'group_name',
      (group_spec->>'sex')::public.participant_sex,'published',counselor_id,
      nullif(group_spec->>'operational_number','')::integer,'standard',batch_id
    ) returning id into group_id;
    insert into tmp_apply_group_map values(group_key,group_id,target_company_id);
    groups_created:=groups_created+1;
    counselors_assigned:=counselors_assigned+1;
  end loop;

  -- Repair old counselor gaps before the final integrity checks.
  for group_id in
    select g.id from public.counselor_groups g
    where g.session_id=p_session_id and g.state='published'
      and (g.counselor_id is null or not private.staff_can_plan(g.counselor_id))
    order by g.sex,g.name,g.id
  loop
    select g.sex::text into company_key from public.counselor_groups g where g.id=group_id;
    counselor_id:=null;
    select st.id into counselor_id
    from public.staff st
    left join public.staff_operations o on o.staff_id=st.id
    where st.session_id=p_session_id and st.is_current and st.registration_status<>'cancelled'
      and st.operational_role='counselor' and st.sex::text=company_key
      and coalesce(o.planning_state,'reserve')<>'excluded'
      and coalesce(o.service_clearance,'confirmation_required')<>'not_cleared'
      and coalesce(o.arrival_state,'expected') not in ('no_show','left')
      and not exists(select 1 from public.counselor_groups x where x.session_id=p_session_id and x.counselor_id=st.id)
    order by case when st.registration_status='approved' then 0 else 1 end,lower(st.full_name),st.id limit 1;
    if counselor_id is null then raise exception 'Not enough available % counselors for existing groups',company_key; end if;
    update public.counselor_groups set counselor_id=counselor_id where id=group_id;
    counselors_assigned:=counselors_assigned+1;
  end loop;

  -- One available Assistant Coordinator is attached only to each newly
  -- created company. Existing company assignments are left untouched.
  for target_company_id in
    select m.company_id from tmp_apply_company_map m where m.company_key like 'new-company-%' order by m.company_key
  loop
    assistant_id:=null;
    select st.id into assistant_id
    from public.staff st
    left join public.staff_operations o on o.staff_id=st.id
    where st.session_id=p_session_id and st.is_current and st.registration_status<>'cancelled'
      and st.operational_role='assistant_coordinator'
      and coalesce(o.planning_state,'reserve')<>'excluded'
      and coalesce(o.service_clearance,'confirmation_required')<>'not_cleared'
      and coalesce(o.arrival_state,'expected') not in ('no_show','left')
      and not exists(select 1 from public.staff_company_assignments a where a.session_id=p_session_id and a.staff_id=st.id)
    order by case when st.registration_status='approved' then 0 else 1 end,lower(st.full_name),st.id limit 1;
    if assistant_id is null then raise exception 'Not enough available Assistant Coordinators'; end if;
    insert into public.staff_company_assignments(session_id,staff_id,company_id,assignment_role,assigned_by,assigned_at)
    values(p_session_id,assistant_id,target_company_id,'assistant_coordinator',(select auth.uid()),now());
    assistants_assigned:=assistants_assigned+1;
  end loop;

  for placement in select value from jsonb_array_elements(plan->'placements') e(value) loop
    select * into participant_row from public.participants where id=(placement->>'participant_id')::uuid for update;
    group_key:=placement->>'target_group_key';
    select m.group_id,m.company_id into target_group_id,target_company_id
    from tmp_apply_group_map m where m.group_key=group_key;
    if target_group_id is null or target_company_id is null then raise exception 'Could not resolve final placement for %',participant_row.id; end if;

    select * into badge_row from public.participant_badge_assignments b
    where b.session_id=p_session_id and b.participant_id=participant_row.id and b.state<>'retired'
    order by b.assigned_at desc limit 1 for update;

    if participant_row.group_id is distinct from target_group_id then
      if participant_row.group_id is not null then moved_count:=moved_count+1; end if;
      update public.participants set group_id=target_group_id,attendance_status='expected',updated_at=now()
      where id=participant_row.id;
    end if;

    if badge_row.id is not null and badge_row.company_id=target_company_id then
      update public.participant_badge_assignments set group_id=target_group_id where id=badge_row.id;
      ids_preserved:=ids_preserved+1;
    elsif badge_row.id is not null then
      update public.participant_badge_assignments
      set state='retired',retired_by=(select auth.uid()),retired_at=now(),
          note=concat_ws(' · ',nullif(note,''),'Retired by controlled final-roster company change')
      where id=badge_row.id;
      select coalesce(c.operational_number,nullif(regexp_replace(c.name,'\D','','g'),'')::integer)
        into company_no from public.companies c where c.id=target_company_id;
      select coalesce(max(b.slot_number),0)+1 into next_slot
      from public.participant_badge_assignments b
      where b.session_id=p_session_id and b.company_id=target_company_id and b.state<>'retired';
      if company_no is null or next_slot>99 then raise exception 'Could not allocate a replacement FSY ID'; end if;
      origin_code:=coalesce(nullif(btrim(private.origin_code_for_participant(participant_row)),''),'UNK');
      next_fsy_id:='C'||lpad(company_no::text,greatest(2,length(company_no::text)),'0')||'-'||lpad(next_slot::text,2,'0')||'-'||origin_code;
      insert into public.participant_badge_assignments(
        session_id,participant_id,company_id,group_id,slot_number,origin_code,fsy_id,badge_name,state,
        needs_reprint,replacement_for,assigned_by,assigned_at,finalized_by,finalized_at,note
      ) values(
        p_session_id,participant_row.id,target_company_id,target_group_id,next_slot,origin_code,next_fsy_id,
        trim(concat_ws(' ',participant_row.first_name,participant_row.last_name)),'finalized',true,badge_row.id,
        (select auth.uid()),now(),(select auth.uid()),now(),'Controlled final-roster replacement'
      );
      insert into public.participant_badge_id_history(
        session_id,badge_assignment_id,participant_id,previous_fsy_id,replacement_fsy_id,changed_at,changed_by,reason
      ) select p_session_id,b.id,participant_row.id,badge_row.fsy_id,next_fsy_id,now(),(select auth.uid()),
        'Controlled final-roster company change'
      from public.participant_badge_assignments b
      where b.session_id=p_session_id and b.participant_id=participant_row.id and b.state<>'retired'
      order by b.assigned_at desc limit 1;
      ids_changed:=ids_changed+1;
    else
      select coalesce(c.operational_number,nullif(regexp_replace(c.name,'\D','','g'),'')::integer)
        into company_no from public.companies c where c.id=target_company_id;
      select coalesce(max(b.slot_number),0)+1 into next_slot
      from public.participant_badge_assignments b
      where b.session_id=p_session_id and b.company_id=target_company_id and b.state<>'retired';
      if company_no is null or next_slot>99 then raise exception 'Could not allocate a new FSY ID'; end if;
      origin_code:=coalesce(nullif(btrim(private.origin_code_for_participant(participant_row)),''),'UNK');
      next_fsy_id:='C'||lpad(company_no::text,greatest(2,length(company_no::text)),'0')||'-'||lpad(next_slot::text,2,'0')||'-'||origin_code;
      insert into public.participant_badge_assignments(
        session_id,participant_id,company_id,group_id,slot_number,origin_code,fsy_id,badge_name,state,
        assigned_by,assigned_at,finalized_by,finalized_at,note
      ) values(
        p_session_id,participant_row.id,target_company_id,target_group_id,next_slot,origin_code,next_fsy_id,
        trim(concat_ws(' ',participant_row.first_name,participant_row.last_name)),'finalized',
        (select auth.uid()),now(),(select auth.uid()),now(),'Controlled final-roster new participant ID'
      );
      new_ids:=new_ids+1;
    end if;
  end loop;

  -- Final integrity checks. Any failure rolls the entire transaction back,
  -- including the automatic version row, because no partial finalization is safe.
  if exists(
    select 1 from public.participants p
    where p.session_id=p_session_id and private.operational_participant_is_eligible(p_session_id,p.id)
      and p.group_id is null
  ) then raise exception 'At least one eligible participant remains without a counselor group'; end if;

  if exists(
    select 1 from public.counselor_groups g
    join public.participants p on p.group_id=g.id and p.session_id=g.session_id
    where g.session_id=p_session_id and g.state='published'
    group by g.id
    having count(*) filter(where private.operational_participant_is_eligible(p_session_id,p.id)) not between
      (select group_min_size from public.session_structure_settings where session_id=p_session_id)
      and (select group_max_size from public.session_structure_settings where session_id=p_session_id)
  ) then raise exception 'At least one final counselor group is outside the configured size range'; end if;

  if coalesce((select avoid_same_unit from public.session_structure_settings where session_id=p_session_id),true)
    and exists(
      select 1 from public.participants p
      where p.session_id=p_session_id and private.operational_participant_is_eligible(p_session_id,p.id) and p.group_id is not null
      group by p.group_id,coalesce(nullif(lower(trim(p.unit_name)),''),'__unknown__') having count(*)>1
    ) then raise exception 'At least one final counselor group contains duplicate ward/branch membership'; end if;

  final_summary:=jsonb_build_object(
    'policy_version','controlled-v3-12-18',
    'rollback_version_id',snapshot_version_id,
    'final_participants',plan->'final_participants',
    'excluded_age_19_plus',plan->'excluded_age_19_plus',
    'existing_placements_preserved',(plan->>'existing_placements_preserved')::integer,
    'existing_placements_moved',moved_count,
    'new_participants_placed',plan->'new_participants_to_place',
    'new_groups',groups_created,
    'new_companies',companies_created,
    'badge_ids_preserved',ids_preserved,
    'badge_ids_changed',ids_changed,
    'new_ids_issued',new_ids,
    'counselors_assigned',counselors_assigned,
    'assistant_coordinators_assigned',assistants_assigned,
    'finalized_at',now()
  );

  insert into public.session_roster_finalizations(session_id,finalized_by,finalized_at,summary)
  values(p_session_id,(select auth.uid()),now(),final_summary)
  on conflict(session_id) do update set finalized_by=excluded.finalized_by,finalized_at=excluded.finalized_at,summary=excluded.summary;
  insert into public.session_roster_freezes(session_id,frozen_by,frozen_at,note)
  values(p_session_id,(select auth.uid()),now(),'Controlled final roster v3. Restore requires a saved roster version and a safe pre-session state.')
  on conflict(session_id) do update set frozen_by=excluded.frozen_by,frozen_at=excluded.frozen_at,note=excluded.note;

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_session_id,(select auth.uid()),'controlled_final_roster_applied','session',p_session_id::text,final_summary);
  return final_summary;
end;
$$;

create or replace function public.restore_session_roster_version_v1(
  p_session_id uuid,
  p_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  target public.session_roster_versions%rowtype;
  pre_restore_version uuid;
  participant_state jsonb;
  extra_company_count integer:=0;
  restored_summary jsonb;
begin
  if not private.can_finalize_session(p_session_id) then raise exception 'Final roster access required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text,94));
  select * into target from public.session_roster_versions v
  where v.id=p_version_id and v.session_id=p_session_id for update;
  if target.id is null then raise exception 'Saved roster version not found'; end if;
  if not exists(select 1 from public.sessions s where s.id=p_session_id and s.status='planning') then
    raise exception 'A saved roster can only be restored while the session is still in planning';
  end if;
  if exists(select 1 from public.check_ins ci where ci.session_id=p_session_id and ci.status::text in ('arrived','needs_attention')) then
    raise exception 'Reset all live check-ins before restoring a saved roster version';
  end if;
  if exists(select 1 from public.housing_assignments h where h.session_id=p_session_id and h.active) then
    raise exception 'Active Housing assignments exist. Clear them before restoring a saved roster version';
  end if;
  if exists(
    select 1 from public.headcount_round_people rp
    where rp.session_id=p_session_id
      and not exists(
        select 1 from jsonb_array_elements(target.snapshot->'companies') c
        where (c->>'id')::uuid=rp.company_id
      )
  ) then
    raise exception 'Head-count history references a company created after this version. Void that operational round before restoring';
  end if;

  pre_restore_version:=private.save_session_roster_version_v1(
    p_session_id,'Before roster restore','Automatic safety version created before restoring '||target.label,'pre-restore'
  );

  -- Remove current badge state first. The just-created pre-restore version holds
  -- the exact state if this restore itself must later be reversed.
  delete from public.participant_badge_id_history h where h.session_id=p_session_id;
  delete from public.participant_badge_assignments b where b.session_id=p_session_id;
  delete from public.staff_company_assignments a where a.session_id=p_session_id;

  -- Clear participants that point at post-version groups before removing those
  -- groups/companies. Source participant rows remain in place.
  update public.participants p set group_id=null,updated_at=now()
  where p.session_id=p_session_id and p.group_id is not null
    and not exists(
      select 1 from jsonb_array_elements(target.snapshot->'groups') g
      where (g->>'id')::uuid=p.group_id
    );

  update public.staff st set assigned_company_id=null
  where st.session_id=p_session_id and st.assigned_company_id is not null
    and not exists(
      select 1 from jsonb_array_elements(target.snapshot->'companies') c
      where (c->>'id')::uuid=st.assigned_company_id
    );

  delete from public.counselor_groups g
  where g.session_id=p_session_id
    and not exists(select 1 from jsonb_array_elements(target.snapshot->'groups') x where (x->>'id')::uuid=g.id);
  delete from public.companies c
  where c.session_id=p_session_id
    and not exists(select 1 from jsonb_array_elements(target.snapshot->'companies') x where (x->>'id')::uuid=c.id);

  -- Restore company and group rows with their original stable IDs and labels.
  insert into public.companies
  select * from jsonb_populate_recordset(null::public.companies,target.snapshot->'companies')
  on conflict(id) do update set
    session_id=excluded.session_id,name=excluded.name,color=excluded.color,created_at=excluded.created_at,
    custom_name=excluded.custom_name,scripture_reference=excluded.scripture_reference,meeting_spot=excluded.meeting_spot,
    operational_number=excluded.operational_number,finalization_batch_id=excluded.finalization_batch_id,
    finalization_cohort=excluded.finalization_cohort;

  insert into public.counselor_groups
  select * from jsonb_populate_recordset(null::public.counselor_groups,target.snapshot->'groups')
  on conflict(id) do update set
    session_id=excluded.session_id,company_id=excluded.company_id,name=excluded.name,sex=excluded.sex,
    counselor_id=excluded.counselor_id,state=excluded.state,created_at=excluded.created_at,
    custom_name=excluded.custom_name,operational_number=excluded.operational_number,
    finalization_batch_id=excluded.finalization_batch_id,finalization_cohort=excluded.finalization_cohort;

  -- Restore participant operational fields for every person that existed in
  -- the version. People added later remain source records but are not deleted.
  for participant_state in select value from jsonb_array_elements(target.snapshot->'participant_state') e(value) loop
    update public.participants p set
      group_id=nullif(participant_state->>'group_id','')::uuid,
      attendance_status=participant_state->>'attendance_status',
      operational_status=participant_state->>'operational_status',
      operational_note=participant_state->>'operational_note',
      operational_revision=coalesce((participant_state->>'operational_revision')::integer,p.operational_revision),
      operational_updated_by=nullif(participant_state->>'operational_updated_by','')::uuid,
      operational_updated_at=coalesce((participant_state->>'operational_updated_at')::timestamptz,p.operational_updated_at),
      updated_at=now()
    where p.id=(participant_state->>'id')::uuid and p.session_id=p_session_id;
  end loop;

  delete from public.participant_operation_decisions d
  using public.participants p where p.id=d.participant_id and p.session_id=p_session_id;
  insert into public.participant_operation_decisions
  select * from jsonb_populate_recordset(null::public.participant_operation_decisions,target.snapshot->'participant_decisions');

  -- Restore badges in two phases so self-referencing replacement chains remain
  -- valid regardless of JSON ordering.
  create temporary table tmp_restore_badges on commit drop as
    select * from jsonb_populate_recordset(null::public.participant_badge_assignments,target.snapshot->'badges');
  insert into public.participant_badge_assignments(
    id,session_id,participant_id,company_id,group_id,slot_number,origin_code,fsy_id,badge_name,state,
    needs_reprint,replacement_for,assigned_by,assigned_at,finalized_by,finalized_at,retired_by,retired_at,note
  )
  select id,session_id,participant_id,company_id,group_id,slot_number,origin_code,fsy_id,badge_name,state,
    needs_reprint,null,assigned_by,assigned_at,finalized_by,finalized_at,retired_by,retired_at,note
  from tmp_restore_badges;
  update public.participant_badge_assignments b set replacement_for=t.replacement_for
  from tmp_restore_badges t where b.id=t.id and t.replacement_for is not null;

  insert into public.participant_badge_id_history
  select * from jsonb_populate_recordset(null::public.participant_badge_id_history,target.snapshot->'badge_history');

  insert into public.staff_company_assignments
  select * from jsonb_populate_recordset(null::public.staff_company_assignments,target.snapshot->'staff_company_assignments');

  insert into public.staff_operations
  select * from jsonb_populate_recordset(null::public.staff_operations,target.snapshot->'staff_operations')
  on conflict(staff_id) do update set
    planning_state=excluded.planning_state,arrival_state=excluded.arrival_state,
    service_clearance=excluded.service_clearance,revision=excluded.revision,updated_by=excluded.updated_by,
    updated_at=excluded.updated_at,clearance_authority=excluded.clearance_authority,
    clearance_reason=excluded.clearance_reason,clearance_recorded_by=excluded.clearance_recorded_by,
    clearance_recorded_at=excluded.clearance_recorded_at,clearance_batch_id=excluded.clearance_batch_id;

  if target.snapshot->'settings' <> '{}'::jsonb then
    insert into public.session_structure_settings
    select * from jsonb_populate_record(null::public.session_structure_settings,target.snapshot->'settings')
    on conflict(session_id) do update set
      group_min_size=excluded.group_min_size,group_max_size=excluded.group_max_size,
      groups_per_company=excluded.groups_per_company,use_age_bands=excluded.use_age_bands,
      avoid_same_unit=excluded.avoid_same_unit,balance_sexes=excluded.balance_sexes,
      updated_by=excluded.updated_by,updated_at=excluded.updated_at,
      participant_min_age=excluded.participant_min_age,participant_max_age=excluded.participant_max_age,
      companies_per_assistant_coordinator=excluded.companies_per_assistant_coordinator;
  end if;

  delete from public.session_roster_finalizations where session_id=p_session_id;
  delete from public.session_roster_freezes where session_id=p_session_id;
  if target.snapshot->'finalization' <> '{}'::jsonb then
    insert into public.session_roster_finalizations
    select * from jsonb_populate_record(null::public.session_roster_finalizations,target.snapshot->'finalization');
  end if;
  if target.snapshot->'freeze' <> '{}'::jsonb then
    insert into public.session_roster_freezes
    select * from jsonb_populate_record(null::public.session_roster_freezes,target.snapshot->'freeze');
  end if;

  update public.session_roster_versions set restored_by=(select auth.uid()),restored_at=now() where id=target.id;
  restored_summary:=jsonb_build_object(
    'restored_version_id',target.id,
    'pre_restore_version_id',pre_restore_version,
    'companies',(select count(*) from public.companies c where c.session_id=p_session_id),
    'published_groups',(select count(*) from public.counselor_groups g where g.session_id=p_session_id and g.state='published'),
    'participants_with_group',(select count(*) from public.participants p where p.session_id=p_session_id and p.group_id is not null),
    'active_badges',(select count(*) from public.participant_badge_assignments b where b.session_id=p_session_id and b.state<>'retired')
  );
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_session_id,(select auth.uid()),'session_roster_version_restored','session_roster_version',target.id::text,restored_summary);
  return restored_summary;
end;
$$;

revoke all on function private.capture_session_roster_snapshot_v1(uuid) from public;
revoke all on function private.save_session_roster_version_v1(uuid,text,text,text) from public;
revoke all on function private.controlled_final_roster_plan_v3(uuid) from public;
revoke all on function public.save_session_roster_version_v1(uuid,text,text) from public,anon;
revoke all on function public.list_session_roster_versions_v1(uuid) from public,anon;
revoke all on function public.get_controlled_final_roster_preview_v3(uuid) from public,anon;
revoke all on function public.apply_controlled_final_roster_rebalance_v3(uuid) from public,anon;
revoke all on function public.restore_session_roster_version_v1(uuid,uuid) from public,anon;
grant execute on function public.save_session_roster_version_v1(uuid,text,text) to authenticated;
grant execute on function public.list_session_roster_versions_v1(uuid) to authenticated;
grant execute on function public.get_controlled_final_roster_preview_v3(uuid) to authenticated;
grant execute on function public.apply_controlled_final_roster_rebalance_v3(uuid) to authenticated;
grant execute on function public.restore_session_roster_version_v1(uuid,uuid) to authenticated;
