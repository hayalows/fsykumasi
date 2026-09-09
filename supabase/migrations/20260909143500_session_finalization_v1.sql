-- Final pre-session roster workflow for FSY Kumasi 2026.
-- Source registration fields remain untouched. Operational decisions are additive,
-- 20+ youth records are removed from the active roster without deleting source history,
-- and supplemental structure is appended without moving existing placements.

create table if not exists public.session_roster_finalizations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.sessions(id) on delete cascade,
  finalized_by uuid references public.profiles(user_id) on delete set null,
  finalized_at timestamptz not null default now(),
  summary jsonb not null default '{}'::jsonb
);

alter table public.session_roster_finalizations enable row level security;
revoke all on public.session_roster_finalizations from anon, authenticated;

create table if not exists public.session_roster_freezes (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  frozen_by uuid references public.profiles(user_id) on delete set null,
  frozen_at timestamptz not null default now(),
  note text
);

alter table public.session_roster_freezes enable row level security;
revoke all on public.session_roster_freezes from anon, authenticated;

create or replace function private.can_finalize_session(target_session uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1
    from public.access_assignments aa
    where aa.session_id=target_session
      and aa.user_id=(select auth.uid())
      and aa.active
      and aa.role::text in ('logistics_admin','coordinator','session_director')
  );
$$;

create or replace function private.block_roster_import_after_freeze()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if exists(select 1 from public.session_roster_freezes f where f.session_id=new.session_id) then
    raise exception 'The final session roster is frozen. Add new arrivals through on-site registration instead of importing another roster.';
  end if;
  return new;
end;
$$;

drop trigger if exists block_roster_import_after_freeze on public.import_batches;
create trigger block_roster_import_after_freeze
before insert on public.import_batches
for each row execute function private.block_roster_import_after_freeze();

create or replace function public.get_session_finalization_preview_v1(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  s public.sessions%rowtype;
  include_total int:=0;
  include_female int:=0;
  include_male int:=0;
  exclude_total int:=0;
  awaiting_staff int:=0;
  open_groups int:=0;
  current_participants int:=0;
  current_staff int:=0;
  existing_companies int:=0;
  existing_groups int:=0;
  female_groups int:=0;
  male_groups int:=0;
  new_companies int:=0;
  available_female_counselors int:=0;
  available_male_counselors int:=0;
  available_assistants int:=0;
  exclusion_conflicts int:=0;
  final_row public.session_roster_finalizations%rowtype;
begin
  if not private.can_finalize_session(p_session_id) then
    raise exception 'Final roster access required';
  end if;

  select * into s from public.sessions where id=p_session_id;
  if s.id is null then raise exception 'Session not found'; end if;

  select * into final_row from public.session_roster_finalizations where session_id=p_session_id;

  select count(*)::int into current_participants
  from public.participants p
  where p.session_id=p_session_id and p.is_current;

  select count(*)::int into current_staff
  from public.staff st
  where st.session_id=p_session_id and st.is_current and st.registration_status<>'cancelled';

  select count(*)::int into existing_companies from public.companies where session_id=p_session_id;
  select count(*)::int into existing_groups from public.counselor_groups where session_id=p_session_id and state='published';

  with targets as (
    select p.id,p.sex::text as sex
    from public.participants p
    join private.participant_eligibility_projection(p_session_id) e on e.participant_id=p.id
    left join public.participant_private_details d on d.participant_id=p.id
    where p.session_id=p_session_id
      and p.is_current
      and coalesce(p.operational_status,'active')='active'
      and p.attendance_status<>'confirmed_not_attending'
      and p.registration_status<>'cancelled'
      and d.date_of_birth is not null
      and extract(year from age(s.starts_on,d.date_of_birth))<20
      and not e.eligible
      and e.reason in ('Registration is not approved','Too young for this FSY year','Turns 19 before or on the end of this session')
  )
  select count(*)::int,
         count(*) filter(where sex='female')::int,
         count(*) filter(where sex='male')::int
    into include_total,include_female,include_male
  from targets;

  select count(*)::int into exclude_total
  from public.participants p
  join public.participant_private_details d on d.participant_id=p.id
  where p.session_id=p_session_id and p.is_current
    and d.date_of_birth is not null
    and extract(year from age(s.starts_on,d.date_of_birth))>=20;

  select count(*)::int into exclusion_conflicts
  from public.participants p
  join public.participant_private_details d on d.participant_id=p.id
  where p.session_id=p_session_id and p.is_current
    and d.date_of_birth is not null
    and extract(year from age(s.starts_on,d.date_of_birth))>=20
    and (
      p.group_id is not null
      or exists(select 1 from public.check_ins ci where ci.session_id=p_session_id and ci.participant_id=p.id)
      or exists(select 1 from public.housing_assignments ha where ha.session_id=p_session_id and ha.participant_id=p.id and ha.active)
      or exists(select 1 from public.participant_badge_assignments b where b.session_id=p_session_id and b.participant_id=p.id and b.state<>'retired')
    );

  select count(*)::int into awaiting_staff
  from public.staff st
  left join public.staff_operations o on o.staff_id=st.id
  where st.session_id=p_session_id and st.is_current and st.registration_status='awaiting'
    and coalesce(o.planning_state,'reserve')<>'excluded'
    and coalesce(o.arrival_state,'expected') not in ('no_show','left');

  select count(*)::int into open_groups
  from public.counselor_groups g
  where g.session_id=p_session_id and g.state='published'
    and (g.counselor_id is null or not private.staff_can_plan(g.counselor_id));

  female_groups:=case when include_female>0 then ceil(include_female/11.0)::int else 0 end;
  male_groups:=case when include_male>0 then ceil(include_male/11.0)::int else 0 end;
  new_companies:=greatest(female_groups,male_groups);

  select count(*) filter(where st.sex='female')::int,
         count(*) filter(where st.sex='male')::int
    into available_female_counselors,available_male_counselors
  from public.staff st
  left join public.staff_operations o on o.staff_id=st.id
  where st.session_id=p_session_id
    and st.is_current and st.registration_status<>'cancelled'
    and st.operational_role='counselor'
    and coalesce(o.planning_state,'reserve')<>'excluded'
    and coalesce(o.service_clearance,'confirmation_required')<>'not_cleared'
    and coalesce(o.arrival_state,'expected') not in ('no_show','left')
    and not exists(select 1 from public.counselor_groups g where g.session_id=p_session_id and g.counselor_id=st.id);

  select count(*)::int into available_assistants
  from public.staff st
  left join public.staff_operations o on o.staff_id=st.id
  where st.session_id=p_session_id
    and st.is_current and st.registration_status<>'cancelled'
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
    'current_participants',current_participants,
    'current_staff',current_staff,
    'participants_to_include',include_total,
    'female_to_include',include_female,
    'male_to_include',include_male,
    'participants_20_plus_to_remove',exclude_total,
    'staff_awaiting_to_clear',awaiting_staff,
    'existing_companies',existing_companies,
    'existing_groups',existing_groups,
    'existing_groups_needing_counselor',open_groups,
    'new_female_groups',female_groups,
    'new_male_groups',male_groups,
    'new_companies',new_companies,
    'available_female_counselors',available_female_counselors,
    'available_male_counselors',available_male_counselors,
    'available_assistant_coordinators',available_assistants,
    'exclusion_conflicts',exclusion_conflicts,
    'existing_placements_moved',0,
    'safe_to_apply', exclusion_conflicts=0
      and available_female_counselors>=female_groups
      and available_male_counselors>=male_groups+open_groups
      and available_assistants>=new_companies
  );
end;
$$;

create or replace function public.apply_session_finalization_v1(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  s public.sessions%rowtype;
  existing_final public.session_roster_finalizations%rowtype;
  include_total int:=0;
  exclude_total int:=0;
  staff_cleared int:=0;
  female_count int:=0;
  male_count int:=0;
  female_group_count int:=0;
  male_group_count int:=0;
  company_count int:=0;
  next_company int:=0;
  next_yw int:=0;
  next_ym int:=0;
  open_existing_groups int:=0;
  new_groups int:=0;
  counselors_assigned int:=0;
  assistants_assigned int:=0;
  badges_issued int:=0;
  unknown_origin int:=0;
  remaining_blockers int:=0;
  eligible_without_group int:=0;
  conflict_count int:=0;
  person record;
  next_slot int;
  origin_code text;
  result jsonb;
begin
  if not private.can_finalize_session(p_session_id) then
    raise exception 'Final roster access required';
  end if;

  select * into s from public.sessions where id=p_session_id for update;
  if s.id is null then raise exception 'Session not found'; end if;

  select * into existing_final from public.session_roster_finalizations where session_id=p_session_id;
  if existing_final.id is not null then
    return existing_final.summary || jsonb_build_object('already_finalized',true,'finalized_at',existing_final.finalized_at);
  end if;

  create temporary table tmp_session_exceptions(id uuid primary key, sex text) on commit drop;
  insert into tmp_session_exceptions(id,sex)
  select p.id,p.sex::text
  from public.participants p
  join private.participant_eligibility_projection(p_session_id) e on e.participant_id=p.id
  left join public.participant_private_details d on d.participant_id=p.id
  where p.session_id=p_session_id
    and p.is_current
    and coalesce(p.operational_status,'active')='active'
    and p.attendance_status<>'confirmed_not_attending'
    and p.registration_status<>'cancelled'
    and d.date_of_birth is not null
    and extract(year from age(s.starts_on,d.date_of_birth))<20
    and not e.eligible
    and e.reason in ('Registration is not approved','Too young for this FSY year','Turns 19 before or on the end of this session');
  get diagnostics include_total=row_count;

  create temporary table tmp_session_excluded(id uuid primary key) on commit drop;
  insert into tmp_session_excluded(id)
  select p.id
  from public.participants p
  join public.participant_private_details d on d.participant_id=p.id
  where p.session_id=p_session_id and p.is_current
    and d.date_of_birth is not null
    and extract(year from age(s.starts_on,d.date_of_birth))>=20;
  get diagnostics exclude_total=row_count;

  select count(*)::int into conflict_count
  from tmp_session_excluded x
  join public.participants p on p.id=x.id
  where p.group_id is not null
     or exists(select 1 from public.check_ins ci where ci.session_id=p_session_id and ci.participant_id=p.id)
     or exists(select 1 from public.housing_assignments ha where ha.session_id=p_session_id and ha.participant_id=p.id and ha.active)
     or exists(select 1 from public.participant_badge_assignments b where b.session_id=p_session_id and b.participant_id=p.id and b.state<>'retired');
  if conflict_count>0 then
    raise exception '% participant(s) aged 20+ already have active operational history and need individual review', conflict_count;
  end if;

  insert into public.participant_operation_decisions(participant_id,cohort_state,registration_confirmed,guardian_confirmed,leadership_confirmed,authority,reason,revision,recorded_by,recorded_at)
  select x.id,'excluded',false,false,false,'FSY Kumasi pre-session final roster','Age 20+ · removed from active participant roster; source registration retained',1,(select auth.uid()),now()
  from tmp_session_excluded x
  on conflict(participant_id) do update set
    cohort_state='excluded',authority=excluded.authority,reason=excluded.reason,
    revision=public.participant_operation_decisions.revision+1,recorded_by=(select auth.uid()),recorded_at=now();

  update public.participants p
  set is_current=false,reconciliation_status='omitted',updated_at=now()
  from tmp_session_excluded x
  where p.id=x.id;

  insert into public.participant_operation_decisions(participant_id,cohort_state,registration_confirmed,guardian_confirmed,leadership_confirmed,authority,reason,revision,recorded_by,recorded_at)
  select x.id,'exception',true,true,true,'FSY Kumasi pre-session leadership decision','Included in the final Kumasi 2026 participant roster; original registration state retained',1,(select auth.uid()),now()
  from tmp_session_exceptions x
  on conflict(participant_id) do update set
    cohort_state='exception',registration_confirmed=true,guardian_confirmed=true,leadership_confirmed=true,
    authority=excluded.authority,reason=excluded.reason,
    revision=public.participant_operation_decisions.revision+1,recorded_by=(select auth.uid()),recorded_at=now();

  insert into public.staff_operations(staff_id,planning_state,arrival_state,service_clearance,revision,updated_by,updated_at)
  select st.id,'reserve','expected','cleared',1,(select auth.uid()),now()
  from public.staff st
  where st.session_id=p_session_id and st.is_current and st.registration_status='awaiting'
  on conflict(staff_id) do update set
    planning_state=case when public.staff_operations.planning_state='provisional' then 'reserve' else public.staff_operations.planning_state end,
    service_clearance='cleared',revision=public.staff_operations.revision+1,updated_by=(select auth.uid()),updated_at=now()
  where public.staff_operations.planning_state<>'excluded' and public.staff_operations.arrival_state not in ('no_show','left');
  get diagnostics staff_cleared=row_count;

  -- Repair existing published counselor gaps first, without moving a covered group.
  create temporary table tmp_open_groups(id uuid primary key,sex text,rn int) on commit drop;
  insert into tmp_open_groups(id,sex,rn)
  select g.id,g.sex::text,row_number() over(partition by g.sex order by g.name)::int
  from public.counselor_groups g
  where g.session_id=p_session_id and g.state='published'
    and (g.counselor_id is null or not private.staff_can_plan(g.counselor_id));
  get diagnostics open_existing_groups=row_count;

  create temporary table tmp_available_counselors(id uuid primary key,sex text,rn int) on commit drop;
  insert into tmp_available_counselors(id,sex,rn)
  select st.id,st.sex::text,row_number() over(partition by st.sex order by case when st.registration_status='approved' then 0 else 1 end,lower(st.full_name),st.id)::int
  from public.staff st
  join public.staff_operations o on o.staff_id=st.id
  where st.session_id=p_session_id and st.is_current and st.registration_status<>'cancelled'
    and st.operational_role='counselor'
    and o.planning_state<>'excluded' and o.service_clearance<>'not_cleared' and o.arrival_state not in ('no_show','left')
    and not exists(select 1 from public.counselor_groups g where g.session_id=p_session_id and g.counselor_id=st.id);

  update public.counselor_groups g
  set counselor_id=c.id
  from tmp_open_groups og
  join tmp_available_counselors c on c.sex=og.sex and c.rn=og.rn
  where g.id=og.id;
  get diagnostics counselors_assigned=row_count;

  delete from tmp_available_counselors c
  using public.counselor_groups g
  where g.session_id=p_session_id and g.counselor_id=c.id;

  -- Renumber the remaining counselor pool after existing gaps are covered.
  update tmp_available_counselors c
  set rn=q.rn
  from (
    select id,row_number() over(partition by sex order by rn,id)::int rn
    from tmp_available_counselors
  ) q where q.id=c.id;

  select count(*) filter(where sex='female')::int,count(*) filter(where sex='male')::int
  into female_count,male_count from tmp_session_exceptions x
  join public.participants p on p.id=x.id
  where p.group_id is null;

  female_group_count:=case when female_count>0 then ceil(female_count/11.0)::int else 0 end;
  male_group_count:=case when male_count>0 then ceil(male_count/11.0)::int else 0 end;
  company_count:=greatest(female_group_count,male_group_count);

  if (select count(*) from tmp_available_counselors where sex='female') < female_group_count then
    raise exception 'Not enough available female counselors for the supplemental groups';
  end if;
  if (select count(*) from tmp_available_counselors where sex='male') < male_group_count then
    raise exception 'Not enough available male counselors for the supplemental groups';
  end if;

  create temporary table tmp_available_assistants(id uuid primary key,rn int) on commit drop;
  insert into tmp_available_assistants(id,rn)
  select st.id,row_number() over(order by case when st.registration_status='approved' then 0 else 1 end,lower(st.full_name),st.id)::int
  from public.staff st
  join public.staff_operations o on o.staff_id=st.id
  where st.session_id=p_session_id and st.is_current and st.registration_status<>'cancelled'
    and st.operational_role='assistant_coordinator'
    and o.planning_state<>'excluded' and o.service_clearance<>'not_cleared' and o.arrival_state not in ('no_show','left')
    and not exists(select 1 from public.staff_company_assignments a where a.session_id=p_session_id and a.staff_id=st.id);

  if (select count(*) from tmp_available_assistants) < company_count then
    raise exception 'Not enough available Assistant Coordinators for the supplemental companies';
  end if;

  select coalesce(max(nullif(regexp_replace(c.name,'\D','','g'),'')::int),0) into next_company
  from public.companies c where c.session_id=p_session_id;
  select coalesce(max(nullif(regexp_replace(g.name,'\D','','g'),'')::int),0) into next_yw
  from public.counselor_groups g where g.session_id=p_session_id and g.sex='female';
  select coalesce(max(nullif(regexp_replace(g.name,'\D','','g'),'')::int),0) into next_ym
  from public.counselor_groups g where g.session_id=p_session_id and g.sex='male';

  create temporary table tmp_new_companies(idx int primary key,id uuid unique,name text) on commit drop;
  if company_count>0 then
    for i in 1..company_count loop
      insert into public.companies(session_id,name,operational_number)
      values(p_session_id,'Company '||(next_company+i),next_company+i)
      returning id,name into person;
      insert into tmp_new_companies(idx,id,name) values(i,person.id,person.name);
    end loop;
  end if;

  create temporary table tmp_new_groups(sex text,idx int,id uuid unique,company_idx int,primary key(sex,idx)) on commit drop;
  if female_group_count>0 then
    for i in 1..female_group_count loop
      insert into public.counselor_groups(session_id,company_id,name,sex,state,counselor_id)
      select p_session_id,c.id,'YW Group '||(next_yw+i),'female'::public.participant_sex,'published',ac.id
      from tmp_new_companies c
      join tmp_available_counselors ac on ac.sex='female' and ac.rn=i
      where c.idx=((i-1)%company_count)+1
      returning id into person;
      insert into tmp_new_groups(sex,idx,id,company_idx) values('female',i,person.id,((i-1)%company_count)+1);
      counselors_assigned:=counselors_assigned+1;
    end loop;
  end if;
  if male_group_count>0 then
    for i in 1..male_group_count loop
      insert into public.counselor_groups(session_id,company_id,name,sex,state,counselor_id)
      select p_session_id,c.id,'YM Group '||(next_ym+i),'male'::public.participant_sex,'published',ac.id
      from tmp_new_companies c
      join tmp_available_counselors ac on ac.sex='male' and ac.rn=i
      where c.idx=((i-1)%company_count)+1
      returning id into person;
      insert into tmp_new_groups(sex,idx,id,company_idx) values('male',i,person.id,((i-1)%company_count)+1);
      counselors_assigned:=counselors_assigned+1;
    end loop;
  end if;
  new_groups:=female_group_count+male_group_count;

  with ranked as (
    select p.id,p.sex::text as sex,
           row_number() over(partition by p.sex order by p.age,lower(p.last_name),lower(p.first_name),p.id)::int rn,
           count(*) over(partition by p.sex)::int total
    from tmp_session_exceptions x
    join public.participants p on p.id=x.id
    where p.group_id is null
  ), mapped as (
    select r.id,g.id as group_id
    from ranked r
    join tmp_new_groups g on g.sex=r.sex
      and g.idx=(floor((r.rn-1)::numeric * (case when r.sex='female' then female_group_count else male_group_count end)::numeric / r.total)+1)::int
  )
  update public.participants p set group_id=m.group_id,updated_at=now()
  from mapped m where p.id=m.id;

  insert into public.staff_company_assignments(session_id,staff_id,company_id,assignment_role,assigned_by,assigned_at)
  select p_session_id,a.id,c.id,'assistant_coordinator',(select auth.uid()),now()
  from tmp_new_companies c join tmp_available_assistants a on a.rn=c.idx;
  get diagnostics assistants_assigned=row_count;

  update public.staff_operations o set planning_state='primary',revision=o.revision+1,updated_by=(select auth.uid()),updated_at=now()
  where o.staff_id in (
    select counselor_id from public.counselor_groups where session_id=p_session_id and counselor_id is not null
    union
    select staff_id from public.staff_company_assignments where session_id=p_session_id
  );

  for person in
    select p.id,p.group_id,g.company_id,trim(concat_ws(' ',p.first_name,p.last_name)) full_name
    from tmp_session_exceptions x
    join public.participants p on p.id=x.id
    join public.counselor_groups g on g.id=p.group_id
    where not exists(select 1 from public.participant_badge_assignments b where b.session_id=p_session_id and b.participant_id=p.id and b.state<>'retired')
    order by g.company_id,g.name,lower(p.last_name),lower(p.first_name),p.id
  loop
    select private.origin_code_for_participant(p) into origin_code from public.participants p where p.id=person.id;
    if origin_code is null or btrim(origin_code)='' then origin_code:='UNK'; unknown_origin:=unknown_origin+1; end if;
    select coalesce(max(b.slot_number),0)+1 into next_slot from public.participant_badge_assignments b where b.session_id=p_session_id and b.company_id=person.company_id and b.state<>'retired';
    if next_slot>99 then raise exception 'Company sequence is full while issuing supplemental FSY IDs'; end if;
    insert into public.participant_badge_assignments(session_id,participant_id,company_id,group_id,slot_number,origin_code,fsy_id,badge_name,state,assigned_by,assigned_at,finalized_by,finalized_at,note)
    values(p_session_id,person.id,person.company_id,person.group_id,next_slot,origin_code,'pending',person.full_name,'finalized',(select auth.uid()),now(),(select auth.uid()),now(),'Supplemental final roster · existing IDs preserved');
    badges_issued:=badges_issued+1;
  end loop;

  select count(*)::int into remaining_blockers
  from private.participant_eligibility_projection(p_session_id) e
  join public.participants p on p.id=e.participant_id
  where p.session_id=p_session_id and p.is_current
    and coalesce(p.operational_status,'active')='active'
    and p.attendance_status<>'confirmed_not_attending'
    and not e.eligible;
  if remaining_blockers>0 then raise exception '% participant eligibility blocker(s) remain after finalization',remaining_blockers; end if;

  select count(*)::int into eligible_without_group
  from public.participants p
  where p.session_id=p_session_id and p.is_current and private.operational_participant_is_eligible(p_session_id,p.id) and p.group_id is null;
  if eligible_without_group>0 then raise exception '% eligible participant(s) remain without a counselor group',eligible_without_group; end if;

  if exists(select 1 from public.counselor_groups g where g.session_id=p_session_id and g.state='published' and (g.counselor_id is null or not private.staff_can_plan(g.counselor_id))) then
    raise exception 'At least one published counselor group still lacks an available counselor';
  end if;

  result:=jsonb_build_object(
    'participants_included',include_total,
    'participants_20_plus_removed',exclude_total,
    'staff_cleared',staff_cleared,
    'existing_groups_repaired',open_existing_groups,
    'new_groups',new_groups,
    'new_companies',company_count,
    'counselors_assigned',counselors_assigned,
    'assistant_coordinators_assigned',assistants_assigned,
    'fsy_ids_issued',badges_issued,
    'unknown_origin_ids',unknown_origin,
    'existing_placements_moved',0,
    'remaining_participant_blockers',0,
    'finalized_at',now()
  );

  insert into public.session_roster_finalizations(session_id,finalized_by,summary)
  values(p_session_id,(select auth.uid()),result);
  insert into public.session_roster_freezes(session_id,frozen_by,note)
  values(p_session_id,(select auth.uid()),'Final roster completed. New people must be registered on site.')
  on conflict(session_id) do nothing;

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_session_id,(select auth.uid()),'session_roster_finalized','session',p_session_id::text,result);

  return result;
end;
$$;

revoke all on function public.get_session_finalization_preview_v1(uuid) from public;
revoke all on function public.apply_session_finalization_v1(uuid) from public;
grant execute on function public.get_session_finalization_preview_v1(uuid) to authenticated;
grant execute on function public.apply_session_finalization_v1(uuid) to authenticated;
