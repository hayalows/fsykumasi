-- Kumasi 2026 pre-session finalization.
-- Keeps source registration facts unchanged while recording local operational decisions.

alter table public.participant_operation_decisions
  add column if not exists session_override boolean not null default false,
  add column if not exists override_rule text;

alter table public.staff_operations
  add column if not exists clearance_authority text,
  add column if not exists clearance_reason text,
  add column if not exists clearance_decided_by uuid references public.profiles(user_id) on delete set null,
  add column if not exists clearance_decided_at timestamptz;

alter table public.companies
  add column if not exists structure_origin text not null default 'baseline';

alter table public.counselor_groups
  add column if not exists structure_origin text not null default 'baseline';

create table if not exists public.session_finalization_batches (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  rule_version text not null,
  status text not null default 'applied' check (status in ('applied','rolled_back')),
  note text,
  summary jsonb not null default '{}'::jsonb,
  applied_by uuid references public.profiles(user_id) on delete set null,
  applied_at timestamptz not null default now(),
  unique(session_id, rule_version)
);

alter table public.session_finalization_batches enable row level security;
revoke all on public.session_finalization_batches from anon, authenticated;

create or replace function private.operational_participant_is_eligible(target_session uuid, target_participant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((
    select case
      when coalesce(p.operational_status, 'active') <> 'active' then false
      when o.cohort_state = 'excluded' then false
      when o.cohort_state = 'exception' and coalesce(o.session_override,false) then
        p.is_current
        and p.registration_status <> 'cancelled'
        and p.verification_status = 'verified'
        and p.attendance_status <> 'confirmed_not_attending'
        and d.date_of_birth is not null
        and s.starts_on is not null
        and extract(year from age(s.starts_on, d.date_of_birth)) < 20
      when o.cohort_state = 'exception' then
        p.is_current
        and p.registration_status <> 'cancelled'
        and p.attendance_status <> 'confirmed_not_attending'
        and o.registration_confirmed
        and o.guardian_confirmed
        and o.leadership_confirmed
      when d.date_of_birth is not null
        and s.starts_on is not null
        and extract(year from age(s.starts_on, d.date_of_birth)) >= 20 then false
      else private.operational_participant_is_eligible_v25(target_session, target_participant)
    end
    from public.participants p
    join public.sessions s on s.id = p.session_id
    left join public.participant_private_details d on d.participant_id = p.id
    left join public.participant_operation_decisions o on o.participant_id = p.id
    where p.id = target_participant and p.session_id = target_session
  ), false);
$function$;

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
      coalesce(p.operational_status,'active') as operational_status,
      s.starts_on,
      s.ends_on,
      d.date_of_birth,
      od.cohort_state,
      coalesce(od.session_override,false) as session_override,
      coalesce(
        case
          when coalesce(p.operational_status,'active') <> 'active' then false
          when od.cohort_state='excluded' then false
          when od.cohort_state='exception' and coalesce(od.session_override,false) then
            p.is_current
            and p.registration_status<>'cancelled'
            and p.verification_status='verified'
            and p.attendance_status<>'confirmed_not_attending'
            and d.date_of_birth is not null
            and s.starts_on is not null
            and extract(year from age(s.starts_on,d.date_of_birth)) < 20
          when od.cohort_state='exception' then
            p.is_current
            and p.registration_status<>'cancelled'
            and p.attendance_status<>'confirmed_not_attending'
            and od.registration_confirmed
            and od.guardian_confirmed
            and od.leadership_confirmed
          when d.date_of_birth is not null
            and s.starts_on is not null
            and extract(year from age(s.starts_on,d.date_of_birth))>=20 then false
          else
            p.is_current
            and p.registration_status='approved'
            and p.verification_status='verified'
            and p.attendance_status<>'confirmed_not_attending'
            and d.date_of_birth is not null
            and s.starts_on is not null
            and s.ends_on is not null
            and extract(year from s.starts_on)::int-extract(year from d.date_of_birth)::int>=14
            and s.ends_on < (d.date_of_birth+interval '19 years')::date
        end,
        false
      ) as eligible
    from public.participants p
    join public.sessions s on s.id=p.session_id
    left join public.participant_private_details d on d.participant_id=p.id
    left join public.participant_operation_decisions od on od.participant_id=p.id
    where p.session_id=target_session
  )
  select
    e.participant_id,
    e.eligible,
    case
      when e.eligible and e.session_override then 'Included by Kumasi session decision'
      when e.eligible then 'Eligible'
      when e.operational_status <> 'active' then 'Not active in session operations'
      when e.cohort_state='excluded' then 'Excluded from active youth operations'
      when e.attendance_status='confirmed_not_attending' then 'Confirmed not attending'
      when not e.is_current then 'Not current in latest registration snapshot'
      when e.registration_status<>'approved' then 'Registration is not approved'
      when e.verification_status<>'verified' then 'Needs verification'
      when e.date_of_birth is null then 'Date of birth is missing'
      when extract(year from e.starts_on)::int-extract(year from e.date_of_birth)::int<14 then 'Too young for this FSY year'
      when not(e.ends_on<(e.date_of_birth+interval '19 years')::date) then 'Turns 19 before or on the end of this session'
      else 'Needs review'
    end as reason
  from evaluated e;
$function$;

create or replace function public.get_session_finalization_preview(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  s public.sessions%rowtype;
  prior jsonb;
  participant_current integer;
  participant_eligible_now integer;
  participant_to_include integer;
  female_to_include integer;
  male_to_include integer;
  adult_to_exclude integer;
  adult_with_activity integer;
  staff_current integer;
  staff_awaiting integer;
  groups_without_counselor integer;
  companies_without_assistant integer;
  missing_origin integer;
  suggested_groups integer;
begin
  if not private.has_session_role(
    p_session_id,
    array['logistics_admin','coordinator','session_director']::public.app_role[]
  ) then
    raise exception 'Whole-session pre-session access required';
  end if;

  select * into s from public.sessions where id=p_session_id;
  if s.id is null then raise exception 'Session not found'; end if;

  select summary into prior
  from public.session_finalization_batches
  where session_id=p_session_id and rule_version='kumasi_2026_presession_v1' and status='applied';

  select count(*)::int into participant_current
  from public.participants p
  where p.session_id=p_session_id and p.is_current;

  select count(*)::int into participant_eligible_now
  from public.participants p
  where p.session_id=p_session_id and p.is_current
    and private.operational_participant_is_eligible(p_session_id,p.id);

  with candidates as (
    select p.*
    from public.participants p
    left join public.participant_private_details d on d.participant_id=p.id
    left join public.participant_operation_decisions od on od.participant_id=p.id
    where p.session_id=p_session_id
      and p.is_current
      and p.registration_status<>'cancelled'
      and p.verification_status='verified'
      and coalesce(p.operational_status,'active')='active'
      and p.attendance_status<>'confirmed_not_attending'
      and d.date_of_birth is not null
      and s.starts_on is not null
      and extract(year from age(s.starts_on,d.date_of_birth))<20
      and not private.operational_participant_is_eligible(p_session_id,p.id)
      and coalesce(od.cohort_state,'normal')<>'excluded'
  )
  select
    count(*)::int,
    count(*) filter(where sex='female')::int,
    count(*) filter(where sex='male')::int,
    count(*) filter(where private.origin_code_for_participant(candidates) is null)::int
  into participant_to_include,female_to_include,male_to_include,missing_origin
  from candidates;

  with adults as (
    select p.id
    from public.participants p
    left join public.participant_private_details d on d.participant_id=p.id
    where p.session_id=p_session_id
      and p.is_current
      and d.date_of_birth is not null
      and s.starts_on is not null
      and extract(year from age(s.starts_on,d.date_of_birth))>=20
  )
  select
    count(*)::int,
    count(*) filter(where
      exists(select 1 from public.participants p2 where p2.id=adults.id and p2.group_id is not null)
      or exists(select 1 from public.check_ins ci where ci.session_id=p_session_id and ci.participant_id=adults.id and ci.status='arrived')
      or exists(select 1 from public.housing_assignments ha where ha.session_id=p_session_id and ha.participant_id=adults.id and ha.active)
      or exists(select 1 from public.participant_badge_assignments b where b.session_id=p_session_id and b.participant_id=adults.id and b.state<>'retired')
    )::int
  into adult_to_exclude,adult_with_activity
  from adults;

  select count(*)::int into staff_current
  from public.staff st where st.session_id=p_session_id and st.is_current and st.registration_status<>'cancelled';

  select count(*)::int into staff_awaiting
  from public.staff st where st.session_id=p_session_id and st.is_current and st.registration_status='awaiting';

  select count(*)::int into groups_without_counselor
  from public.counselor_groups g
  where g.session_id=p_session_id
    and (g.counselor_id is null or not private.staff_can_plan(g.counselor_id));

  select count(*)::int into companies_without_assistant
  from public.companies c
  where c.session_id=p_session_id
    and not exists(
      select 1
      from public.staff_company_assignments sca
      join public.staff st on st.id=sca.staff_id
      where sca.session_id=p_session_id
        and sca.company_id=c.id
        and st.operational_role='assistant_coordinator'
        and private.staff_can_plan(st.id)
    );

  suggested_groups :=
    case
      when participant_to_include=0 then 0
      else ceil(female_to_include::numeric/10)::int + ceil(male_to_include::numeric/11)::int
    end;

  return jsonb_build_object(
    'sessionId',p_session_id,
    'sessionName',s.name,
    'status',s.status,
    'ruleVersion','kumasi_2026_presession_v1',
    'alreadyApplied',prior is not null,
    'appliedSummary',prior,
    'participantCurrent',participant_current,
    'participantEligibleNow',participant_eligible_now,
    'participantToInclude',participant_to_include,
    'femaleToInclude',female_to_include,
    'maleToInclude',male_to_include,
    'participant20Plus',adult_to_exclude,
    'participant20PlusWithActivity',adult_with_activity,
    'projectedActiveParticipants',participant_eligible_now+participant_to_include,
    'suggestedNewGroups',suggested_groups,
    'staffCurrent',staff_current,
    'staffAwaiting',staff_awaiting,
    'groupsWithoutCounselor',groups_without_counselor,
    'companiesWithoutAssistantCoordinator',companies_without_assistant,
    'missingOriginForNewIds',missing_origin
  );
end;
$function$;

create or replace function public.apply_session_finalization_v1(
  p_session_id uuid,
  p_note text default 'Kumasi 2026 pre-session final roster'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  s public.sessions%rowtype;
  actor uuid := (select auth.uid());
  existing_summary jsonb;
  adult_conflicts integer;
  included_count integer := 0;
  excluded_count integer := 0;
  staff_cleared integer := 0;
  female_count integer := 0;
  male_count integer := 0;
  female_groups integer := 0;
  male_groups integer := 0;
  next_company_no integer;
  next_yw_no integer;
  next_ym_no integer;
  company_id uuid;
  new_group_id uuid;
  female_group_ids uuid[] := '{}'::uuid[];
  male_group_ids uuid[] := '{}'::uuid[];
  counselor_assignments integer := 0;
  assistant_assignments integer := 0;
  ids_issued integer := 0;
  ids_missing_origin integer := 0;
  groups_without_counselor integer := 0;
  companies_without_assistant integer := 0;
  active_participants integer := 0;
  active_staff integer := 0;
  group_index integer;
  person_row record;
  group_row record;
  company_row record;
  candidate_staff uuid;
  candidate_origin text;
  slot_no integer;
  summary jsonb;
begin
  if not private.has_session_role(
    p_session_id,
    array['logistics_admin','coordinator','session_director']::public.app_role[]
  ) then
    raise exception 'Whole-session pre-session access required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('kumasi-finalization-'||p_session_id::text,0));
  select * into s from public.sessions where id=p_session_id for update;
  if s.id is null then raise exception 'Session not found'; end if;
  if s.status<>'planning' then raise exception 'This finalization can only run while the session is in planning'; end if;

  select b.summary into existing_summary
  from public.session_finalization_batches b
  where b.session_id=p_session_id
    and b.rule_version='kumasi_2026_presession_v1'
    and b.status='applied'
  for update;

  if existing_summary is not null then return existing_summary; end if;

  with adults as (
    select p.id
    from public.participants p
    left join public.participant_private_details d on d.participant_id=p.id
    where p.session_id=p_session_id
      and p.is_current
      and d.date_of_birth is not null
      and s.starts_on is not null
      and extract(year from age(s.starts_on,d.date_of_birth))>=20
  )
  select count(*)::int into adult_conflicts
  from adults a
  where exists(select 1 from public.participants p where p.id=a.id and p.group_id is not null)
     or exists(select 1 from public.check_ins ci where ci.session_id=p_session_id and ci.participant_id=a.id and ci.status='arrived')
     or exists(select 1 from public.housing_assignments ha where ha.session_id=p_session_id and ha.participant_id=a.id and ha.active)
     or exists(select 1 from public.participant_badge_assignments b where b.session_id=p_session_id and b.participant_id=a.id and b.state<>'retired');

  if adult_conflicts>0 then
    raise exception '% participant(s) aged 20+ already have live operational activity and need individual review',adult_conflicts;
  end if;

  insert into public.participant_operation_decisions(
    participant_id,cohort_state,session_override,override_rule,
    registration_confirmed,guardian_confirmed,leadership_confirmed,
    authority,reason,revision,recorded_by,recorded_at
  )
  select
    p.id,'excluded',true,'kumasi_2026_presession_v1',
    false,false,true,
    'Kumasi 2026 pre-session local session decision',
    'Age 20+ removed from the active participant roster; source registration preserved',
    coalesce(od.revision,-1)+1,actor,now()
  from public.participants p
  left join public.participant_private_details d on d.participant_id=p.id
  left join public.participant_operation_decisions od on od.participant_id=p.id
  where p.session_id=p_session_id
    and p.is_current
    and d.date_of_birth is not null
    and s.starts_on is not null
    and extract(year from age(s.starts_on,d.date_of_birth))>=20
  on conflict(participant_id) do update set
    cohort_state='excluded',
    session_override=true,
    override_rule='kumasi_2026_presession_v1',
    leadership_confirmed=true,
    authority=excluded.authority,
    reason=excluded.reason,
    revision=public.participant_operation_decisions.revision+1,
    recorded_by=actor,
    recorded_at=now();

  get diagnostics excluded_count = row_count;

  insert into public.participant_operation_decisions(
    participant_id,cohort_state,session_override,override_rule,
    registration_confirmed,guardian_confirmed,leadership_confirmed,
    authority,reason,revision,recorded_by,recorded_at
  )
  select
    p.id,'exception',true,'kumasi_2026_presession_v1',
    p.registration_status='approved',false,true,
    'Kumasi 2026 pre-session local session decision',
    case
      when p.registration_status='awaiting' then 'Source approval remains awaiting; participant included for Kumasi 2026 operations'
      else 'Age exception included for Kumasi 2026 operations; source registration preserved'
    end,
    coalesce(od.revision,-1)+1,actor,now()
  from public.participants p
  left join public.participant_private_details d on d.participant_id=p.id
  left join public.participant_operation_decisions od on od.participant_id=p.id
  where p.session_id=p_session_id
    and p.is_current
    and p.registration_status<>'cancelled'
    and p.verification_status='verified'
    and coalesce(p.operational_status,'active')='active'
    and p.attendance_status<>'confirmed_not_attending'
    and d.date_of_birth is not null
    and s.starts_on is not null
    and extract(year from age(s.starts_on,d.date_of_birth))<20
    and not private.operational_participant_is_eligible_v25(p_session_id,p.id)
    and coalesce(od.cohort_state,'normal')<>'excluded'
  on conflict(participant_id) do update set
    cohort_state='exception',
    session_override=true,
    override_rule='kumasi_2026_presession_v1',
    leadership_confirmed=true,
    authority=excluded.authority,
    reason=excluded.reason,
    revision=public.participant_operation_decisions.revision+1,
    recorded_by=actor,
    recorded_at=now();

  get diagnostics included_count = row_count;

  update public.staff_operations so set
    service_clearance='cleared',
    planning_state=case
      when exists(select 1 from public.counselor_groups g where g.session_id=p_session_id and g.counselor_id=so.staff_id)
        or exists(select 1 from public.staff_company_assignments sca where sca.session_id=p_session_id and sca.staff_id=so.staff_id)
      then 'primary'
      else 'reserve'
    end,
    clearance_authority='Kumasi 2026 pre-session local session decision',
    clearance_reason='Source registration remains awaiting; cleared for local operational planning',
    clearance_decided_by=actor,
    clearance_decided_at=now(),
    revision=so.revision+1,
    updated_by=actor,
    updated_at=now()
  from public.staff st
  where st.id=so.staff_id
    and st.session_id=p_session_id
    and st.is_current
    and st.registration_status='awaiting'
    and so.arrival_state not in ('no_show','left')
    and so.planning_state<>'excluded';

  get diagnostics staff_cleared = row_count;

  select count(*) filter(where p.sex='female')::int,
         count(*) filter(where p.sex='male')::int
  into female_count,male_count
  from public.participants p
  join public.participant_operation_decisions od on od.participant_id=p.id
  where p.session_id=p_session_id
    and od.override_rule='kumasi_2026_presession_v1'
    and od.cohort_state='exception'
    and od.session_override
    and private.operational_participant_is_eligible(p_session_id,p.id)
    and p.group_id is null;

  female_groups := case when female_count=0 then 0 else ceil(female_count::numeric/10)::int end;
  male_groups := case when male_count=0 then 0 else ceil(male_count::numeric/11)::int end;

  if female_groups+male_groups>4 then
    raise exception 'Supplemental cohort needs % groups; review before applying more than one supplemental company',female_groups+male_groups;
  end if;

  if female_groups+male_groups>0 then
    select coalesce(max(coalesce(c.operational_number,(regexp_match(c.name,'([0-9]+)$'))[1]::int)),0)+1
      into next_company_no
    from public.companies c where c.session_id=p_session_id;

    select coalesce(max(coalesce(g.operational_number,(regexp_match(g.name,'([0-9]+)$'))[1]::int)),0)+1
      into next_yw_no
    from public.counselor_groups g where g.session_id=p_session_id and g.sex='female';

    select coalesce(max(coalesce(g.operational_number,(regexp_match(g.name,'([0-9]+)$'))[1]::int)),0)+1
      into next_ym_no
    from public.counselor_groups g where g.session_id=p_session_id and g.sex='male';

    insert into public.companies(session_id,name,operational_number,structure_origin)
    values(p_session_id,'Company '||next_company_no,next_company_no,'supplemental_2026')
    returning id into company_id;

    if female_groups>0 then
      for group_index in 0..female_groups-1 loop
        insert into public.counselor_groups(session_id,company_id,name,sex,state,operational_number,structure_origin)
        values(p_session_id,company_id,'YW Group '||(next_yw_no+group_index),'female','published',next_yw_no+group_index,'supplemental_2026')
        returning id into new_group_id;
        female_group_ids:=array_append(female_group_ids,new_group_id);
      end loop;
    end if;

    if male_groups>0 then
      for group_index in 0..male_groups-1 loop
        insert into public.counselor_groups(session_id,company_id,name,sex,state,operational_number,structure_origin)
        values(p_session_id,company_id,'YM Group '||(next_ym_no+group_index),'male','published',next_ym_no+group_index,'supplemental_2026')
        returning id into new_group_id;
        male_group_ids:=array_append(male_group_ids,new_group_id);
      end loop;
    end if;

    if female_groups>0 then
      for person_row in
        select p.id,row_number() over(order by lower(p.last_name),lower(p.first_name),p.id) rn
        from public.participants p
        join public.participant_operation_decisions od on od.participant_id=p.id
        where p.session_id=p_session_id and p.sex='female'
          and p.group_id is null
          and od.override_rule='kumasi_2026_presession_v1'
          and od.cohort_state='exception' and od.session_override
          and private.operational_participant_is_eligible(p_session_id,p.id)
      loop
        group_index:=least(female_groups,ceil(person_row.rn::numeric/ceil(female_count::numeric/female_groups))::int);
        update public.participants set group_id=female_group_ids[group_index],updated_at=now() where id=person_row.id;
      end loop;
    end if;

    if male_groups>0 then
      for person_row in
        select p.id,row_number() over(order by lower(p.last_name),lower(p.first_name),p.id) rn
        from public.participants p
        join public.participant_operation_decisions od on od.participant_id=p.id
        where p.session_id=p_session_id and p.sex='male'
          and p.group_id is null
          and od.override_rule='kumasi_2026_presession_v1'
          and od.cohort_state='exception' and od.session_override
          and private.operational_participant_is_eligible(p_session_id,p.id)
      loop
        group_index:=least(male_groups,ceil(person_row.rn::numeric/ceil(male_count::numeric/male_groups))::int);
        update public.participants set group_id=male_group_ids[group_index],updated_at=now() where id=person_row.id;
      end loop;
    end if;
  end if;

  for group_row in
    select g.id,g.sex
    from public.counselor_groups g
    where g.session_id=p_session_id
      and (g.counselor_id is null or not private.staff_can_plan(g.counselor_id))
    order by case when coalesce(g.structure_origin,'baseline')='baseline' then 0 else 1 end,
             coalesce(g.operational_number,99999),g.name
  loop
    select st.id into candidate_staff
    from public.staff st
    join public.staff_operations so on so.staff_id=st.id
    where st.session_id=p_session_id
      and st.is_current
      and st.registration_status<>'cancelled'
      and st.operational_role='counselor'
      and st.sex=group_row.sex
      and private.staff_can_plan(st.id)
      and not exists(select 1 from public.counselor_groups used where used.session_id=p_session_id and used.counselor_id=st.id)
    order by case when st.registration_status='approved' then 0 else 1 end,
             case when so.service_clearance='cleared' then 0 else 1 end,
             lower(st.full_name),st.id
    limit 1;

    if candidate_staff is null then
      raise exception 'No available % counselor remains for all counselor groups',group_row.sex;
    end if;

    update public.counselor_groups set counselor_id=candidate_staff where id=group_row.id;
    counselor_assignments:=counselor_assignments+1;
  end loop;

  insert into public.session_structure_settings(session_id,companies_per_assistant_coordinator)
  values(p_session_id,3)
  on conflict(session_id) do update set
    companies_per_assistant_coordinator=greatest(public.session_structure_settings.companies_per_assistant_coordinator,3),
    updated_by=actor,
    updated_at=now();

  for company_row in
    select c.id
    from public.companies c
    where c.session_id=p_session_id
      and not exists(
        select 1
        from public.staff_company_assignments sca
        join public.staff st on st.id=sca.staff_id
        where sca.session_id=p_session_id
          and sca.company_id=c.id
          and st.operational_role='assistant_coordinator'
          and private.staff_can_plan(st.id)
      )
    order by coalesce(c.operational_number,(regexp_match(c.name,'([0-9]+)$'))[1]::int),c.name
  loop
    select st.id into candidate_staff
    from public.staff st
    join public.staff_operations so on so.staff_id=st.id
    where st.session_id=p_session_id
      and st.is_current
      and st.registration_status<>'cancelled'
      and st.operational_role='assistant_coordinator'
      and private.staff_can_plan(st.id)
      and (select count(*) from public.staff_company_assignments z where z.session_id=p_session_id and z.staff_id=st.id)<3
    order by
      (select count(*) from public.staff_company_assignments z where z.session_id=p_session_id and z.staff_id=st.id),
      case when st.registration_status='approved' then 0 else 1 end,
      lower(st.full_name),st.id
    limit 1;

    if candidate_staff is null then
      raise exception 'Not enough available Assistant Coordinators to cover all companies at a maximum of 3 companies each';
    end if;

    insert into public.staff_company_assignments(session_id,staff_id,company_id,assignment_role,assigned_by)
    values(p_session_id,candidate_staff,company_row.id,'assistant_coordinator',actor)
    on conflict do nothing;
    assistant_assignments:=assistant_assignments+1;
  end loop;

  for person_row in
    select p.*,g.company_id
    from public.participants p
    join public.participant_operation_decisions od on od.participant_id=p.id
    join public.counselor_groups g on g.id=p.group_id and g.session_id=p.session_id
    where p.session_id=p_session_id
      and od.override_rule='kumasi_2026_presession_v1'
      and od.cohort_state='exception'
      and od.session_override
      and private.operational_participant_is_eligible(p_session_id,p.id)
      and not exists(
        select 1 from public.participant_badge_assignments b
        where b.session_id=p_session_id and b.participant_id=p.id and b.state<>'retired'
      )
    order by lower(p.last_name),lower(p.first_name),p.id
  loop
    candidate_origin:=private.origin_code_for_participant(person_row);
    if candidate_origin is null then
      ids_missing_origin:=ids_missing_origin+1;
      continue;
    end if;

    select coalesce(max(b.slot_number),0)+1 into slot_no
    from public.participant_badge_assignments b
    where b.session_id=p_session_id and b.company_id=person_row.company_id and b.state<>'retired';

    if slot_no>99 then raise exception 'Supplemental company sequence is full'; end if;

    insert into public.participant_badge_assignments(
      session_id,participant_id,company_id,group_id,slot_number,origin_code,
      fsy_id,badge_name,state,assigned_by,finalized_by,finalized_at,note
    )
    values(
      p_session_id,person_row.id,person_row.company_id,person_row.group_id,slot_no,candidate_origin,
      'pending',trim(concat_ws(' ',person_row.first_name,person_row.last_name)),'finalized',
      actor,actor,now(),'Kumasi 2026 supplemental finalization'
    );
    ids_issued:=ids_issued+1;
  end loop;

  select count(*)::int into groups_without_counselor
  from public.counselor_groups g
  where g.session_id=p_session_id and (g.counselor_id is null or not private.staff_can_plan(g.counselor_id));

  select count(*)::int into companies_without_assistant
  from public.companies c
  where c.session_id=p_session_id
    and not exists(
      select 1 from public.staff_company_assignments sca
      join public.staff st on st.id=sca.staff_id
      where sca.session_id=p_session_id and sca.company_id=c.id
        and st.operational_role='assistant_coordinator' and private.staff_can_plan(st.id)
    );

  select count(*)::int into active_participants
  from public.participants p
  where p.session_id=p_session_id and p.is_current
    and private.operational_participant_is_eligible(p_session_id,p.id);

  select count(*)::int into active_staff
  from public.staff st
  where st.session_id=p_session_id and st.is_current and st.registration_status<>'cancelled'
    and private.staff_can_plan(st.id);

  summary:=jsonb_build_object(
    'ruleVersion','kumasi_2026_presession_v1',
    'includedParticipants',included_count,
    'excluded20Plus',excluded_count,
    'activeParticipants',active_participants,
    'staffCleared',staff_cleared,
    'activeStaff',active_staff,
    'newCompany',case when company_id is null then null else 'Company '||next_company_no end,
    'newGroups',female_groups+male_groups,
    'counselorsAssigned',counselor_assignments,
    'groupsWithoutCounselor',groups_without_counselor,
    'assistantAssignmentsAdded',assistant_assignments,
    'companiesWithoutAssistantCoordinator',companies_without_assistant,
    'supplementalIdsIssued',ids_issued,
    'supplementalIdsMissingOrigin',ids_missing_origin
  );

  insert into public.session_finalization_batches(
    session_id,rule_version,status,note,summary,applied_by
  )
  values(p_session_id,'kumasi_2026_presession_v1','applied',nullif(trim(p_note),''),summary,actor);

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_session_id,actor,'session_roster_finalized','session',p_session_id::text,summary);

  return summary;
end;
$function$;

create or replace function public.get_registration_workspace_v29(p_session_id uuid)
returns table(
  participant_id uuid, fsy_id text, full_name text, preferred_name text, sex text, age integer,
  stake_name text, unit_name text, company_id uuid, company_name text, group_id uuid, group_name text,
  slot_number integer, badge_state text, attendance_status text, checkin_status text, source_kind text,
  verification_status text, registration_status text, is_current boolean, eligible boolean,
  eligibility_reason text, room_id uuid, room_name text, bed_label text, housing_assigned_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  can_registration boolean;
  can_checkin boolean;
  caller_companies uuid[];
begin
  can_registration :=
    private.has_capability(p_session_id,'registration_view')
    or private.has_capability(p_session_id,'registration_manage');
  can_checkin := private.has_capability(p_session_id,'checkin_record');

  if not can_registration and not can_checkin then
    raise exception 'Registration or check-in access required';
  end if;

  if not can_registration then
    select coalesce(aa.company_ids,'{}'::uuid[])
      into caller_companies
    from public.access_assignments aa
    where aa.session_id=p_session_id
      and aa.user_id=(select auth.uid())
      and aa.active
    limit 1;
    caller_companies := coalesce(caller_companies,'{}'::uuid[]);
  end if;

  return query
  select
    p.id,b.fsy_id,trim(concat_ws(' ',p.first_name,p.last_name)),p.preferred_name,p.sex::text,p.age,
    p.stake_name,p.unit_name,coalesce(b.company_id,g.company_id),c.name,coalesce(b.group_id,p.group_id),g.name,
    b.slot_number,b.state::text,coalesce(p.attendance_status,'expected'),ci.status::text,p.source_kind,
    p.verification_status,p.registration_status,p.is_current,e.eligible,e.reason,hr.id,hr.room_name,ha.bed_label,ha.assigned_at
  from public.participants p
  join private.participant_eligibility_projection(p_session_id) e on e.participant_id=p.id
  left join public.participant_operation_decisions od on od.participant_id=p.id
  left join public.participant_badge_assignments b
    on b.participant_id=p.id and b.session_id=p.session_id and b.state<>'retired'
  left join public.counselor_groups g on g.id=coalesce(b.group_id,p.group_id)
  left join public.companies c on c.id=coalesce(b.company_id,g.company_id)
  left join public.check_ins ci on ci.session_id=p.session_id and ci.participant_id=p.id
  left join public.housing_assignments ha on ha.session_id=p.session_id and ha.participant_id=p.id and ha.active
  left join public.housing_rooms hr on hr.id=ha.room_id and hr.session_id=ha.session_id
  where p.session_id=p_session_id
    and coalesce(od.cohort_state,'normal')<>'excluded'
    and (can_registration or coalesce(b.company_id,g.company_id)=any(caller_companies))
  order by lower(coalesce(p.stake_name,'')),lower(coalesce(p.unit_name,'')),lower(p.last_name),lower(p.first_name),p.id;
end;
$function$;

create or replace function private.participant_report_rows(target_session uuid)
returns table(
  participant_id uuid, registration_id text, full_name text, preferred_name text, sex text, age integer,
  stake_name text, unit_name text, source_kind text, registration_status text, verification_status text,
  arrival_status text, eligible boolean, company_id uuid, company_name text, company_number integer,
  group_id uuid, group_name text, group_number integer, counselor_name text, fsy_id text, badge_name text,
  badge_state text, needs_reprint boolean, slot_number integer, origin_code text, checkin_status text,
  checkin_at timestamptz, housing_room text, housing_building text, housing_bed text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    p.id,p.registration_id,trim(concat_ws(' ',p.first_name,p.last_name)),nullif(trim(p.preferred_name),''),
    p.sex::text,p.age,nullif(trim(p.stake_name),''),nullif(trim(p.unit_name),''),p.source_kind,
    p.registration_status,p.verification_status,p.attendance_status,
    private.operational_participant_is_eligible(target_session,p.id),
    c.id,coalesce(nullif(c.custom_name,''),c.name),c.operational_number,
    g.id,coalesce(nullif(g.custom_name,''),g.name),g.operational_number,counselor.full_name,
    badge.fsy_id,badge.badge_name,badge.state,badge.needs_reprint,badge.slot_number,badge.origin_code,
    checkin.status,checkin.recorded_at,room.room_name,room.building,room.bed_label
  from public.participants p
  left join public.participant_operation_decisions od on od.participant_id=p.id
  left join public.counselor_groups g on g.id=p.group_id and g.session_id=p.session_id
  left join public.companies c on c.id=g.company_id and c.session_id=p.session_id
  left join public.staff counselor on counselor.id=g.counselor_id and counselor.session_id=p.session_id
  left join lateral (
    select b.fsy_id,b.badge_name,b.state,b.needs_reprint,b.slot_number,b.origin_code
    from public.participant_badge_assignments b
    where b.session_id=target_session and b.participant_id=p.id and b.state<>'retired'
    order by b.assigned_at desc limit 1
  ) badge on true
  left join lateral (
    select ci.status::text status,ci.recorded_at
    from public.check_ins ci
    where ci.session_id=target_session and ci.participant_id=p.id
    order by ci.recorded_at desc limit 1
  ) checkin on true
  left join lateral (
    select hr.room_name,hr.building,ha.bed_label
    from public.housing_assignments ha
    join public.housing_rooms hr on hr.id=ha.room_id
    where ha.session_id=target_session and ha.participant_id=p.id and ha.active
    order by ha.assigned_at desc limit 1
  ) room on true
  where p.session_id=target_session
    and p.is_current
    and coalesce(od.cohort_state,'normal')<>'excluded'
    and (not private.is_assistant_coordinator(target_session) or c.id=any(private.current_user_company_ids(target_session)));
$function$;

grant execute on function public.get_session_finalization_preview(uuid) to authenticated;
grant execute on function public.apply_session_finalization_v1(uuid,text) to authenticated;
