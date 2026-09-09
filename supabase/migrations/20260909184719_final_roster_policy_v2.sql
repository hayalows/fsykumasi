-- Final roster policy v2.
--
-- This migration is additive. The source registration snapshot is retained;
-- the active participant roster is determined by operational policy. Ages
-- 12-13 and registration-awaiting participants can participate after the
-- approved session policy is applied. Ages 20+ are removed from the active
-- youth roster without deleting the source person.

alter table public.participants drop constraint if exists participants_age_check;
alter table public.participants
  add constraint participants_age_check check (age is null or age between 0 and 120);

create table if not exists public.participant_operation_decisions (
  participant_id uuid primary key references public.participants(id) on delete cascade,
  cohort_state text not null default 'normal' check (cohort_state in ('normal','excluded','exception')),
  registration_confirmed boolean not null default false,
  guardian_confirmed boolean not null default false,
  leadership_confirmed boolean not null default false,
  authority text,
  reason text,
  revision integer not null default 0,
  recorded_by uuid,
  recorded_at timestamptz not null default now()
);

alter table public.participant_operation_decisions
  add column if not exists decision_kind text,
  add column if not exists local_clearance boolean not null default false,
  add column if not exists batch_id uuid;

alter table public.participant_operation_decisions
  drop constraint if exists participant_operation_decisions_kind_check;
alter table public.participant_operation_decisions
  add constraint participant_operation_decisions_kind_check
  check (decision_kind is null or decision_kind in (
    'awaiting_approval', 'age_12_13', 'age_19',
    'age_20_plus_excluded', 'manual_exception', 'manual_exclusion'
  ));

create index if not exists participant_operation_decisions_kind_idx
  on public.participant_operation_decisions(participant_id, decision_kind, cohort_state);

alter table public.participant_operation_decisions enable row level security;
revoke all on public.participant_operation_decisions from anon, authenticated;
grant select on public.participant_operation_decisions to authenticated;
drop policy if exists "directors read decision evidence" on public.participant_operation_decisions;
drop policy if exists "whole session leaders read decision evidence" on public.participant_operation_decisions;
create policy "whole session leaders read decision evidence"
on public.participant_operation_decisions for select to authenticated
using (
  exists (
    select 1 from public.participants p
    where p.id=participant_operation_decisions.participant_id
      and private.has_session_role(
        p.session_id,
        array['coordinator','logistics_admin','session_director','area_advisory_couple']::public.app_role[]
      )
  )
);

create table if not exists public.session_roster_finalizations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.sessions(id) on delete cascade,
  finalized_by uuid references public.profiles(user_id) on delete set null,
  finalized_at timestamptz not null default now(),
  summary jsonb not null default '{}'::jsonb
);

create table if not exists public.session_roster_freezes (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  frozen_by uuid references public.profiles(user_id) on delete set null,
  frozen_at timestamptz not null default now(),
  note text
);

alter table public.session_roster_finalizations enable row level security;
alter table public.session_roster_freezes enable row level security;
revoke all on public.session_roster_finalizations, public.session_roster_freezes from anon, authenticated;

alter table public.companies
  add column if not exists finalization_cohort text not null default 'base',
  add column if not exists finalization_batch_id uuid;
alter table public.counselor_groups
  add column if not exists finalization_cohort text not null default 'base',
  add column if not exists finalization_batch_id uuid;

alter table public.companies drop constraint if exists companies_finalization_cohort_check;
alter table public.companies add constraint companies_finalization_cohort_check
  check (finalization_cohort in ('base','standard','awaiting_approval','age_12_13','age_19'));
alter table public.counselor_groups drop constraint if exists groups_finalization_cohort_check;
alter table public.counselor_groups add constraint groups_finalization_cohort_check
  check (finalization_cohort in ('base','standard','awaiting_approval','age_12_13','age_19'));

create index if not exists companies_session_finalization_cohort_idx
  on public.companies(session_id, finalization_cohort);
create index if not exists groups_session_finalization_cohort_idx
  on public.counselor_groups(session_id, finalization_cohort);

-- Area Advisory Couples are whole-program leaders in the current FSY
-- workspace. An active assignment on any session grants the same area-wide
-- scope to every session in the workspace.
create or replace function private.has_area_advisory_access(
  target_session uuid,
  target_user uuid default null::uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1
    from public.access_assignments aa
    where aa.user_id=coalesce(target_user,(select auth.uid()))
      and aa.active
      and aa.role='area_advisory_couple'::public.app_role
  );
$$;

create or replace function private.has_session_access(target_session uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1 from public.access_assignments aa
    where aa.session_id=target_session
      and aa.user_id=(select auth.uid())
      and aa.active
  ) or private.has_area_advisory_access(target_session);
$$;

create or replace function private.has_session_role(target_session uuid, allowed public.app_role[])
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1 from public.access_assignments aa
    where aa.session_id=target_session
      and aa.user_id=(select auth.uid())
      and aa.active
      and aa.role=any(allowed)
  ) or (
    private.has_area_advisory_access(target_session)
    and (
      'area_advisory_couple'::public.app_role=any(allowed)
      or allowed && array[
        'coordinator'::public.app_role,
        'logistics_admin'::public.app_role,
        'session_director'::public.app_role
      ]
    )
  );
$$;

create or replace function private.can_access_company(target_session uuid, target_company uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select private.has_area_advisory_access(target_session)
    or exists (
      select 1
      from public.access_assignments aa
      where aa.session_id=target_session
        and aa.user_id=(select auth.uid())
        and aa.active
        and (
          aa.role in (
            'coordinator'::public.app_role,
            'logistics_admin'::public.app_role,
            'session_director'::public.app_role
          )
          or target_company=any(aa.company_ids)
        )
    );
$$;

create or replace function private.can_finalize_session(target_session uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select private.has_session_role(
    target_session,
    array['coordinator','logistics_admin','session_director','area_advisory_couple']::public.app_role[]
  );
$$;

create or replace function private.can_manage_access(target_session uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select private.has_session_role(
    target_session,
    array['coordinator','logistics_admin','session_director','area_advisory_couple']::public.app_role[]
  );
$$;

create or replace function private.is_top_access_admin(target_session uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select private.can_manage_access(target_session);
$$;

create or replace function private.full_session_admin_count(
  p_session_id uuid,
  p_exclude_user uuid default null
)
returns integer
language sql
stable
security definer
set search_path=''
as $$
  select count(distinct aa.user_id)::integer
  from public.access_assignments aa
  where aa.active
    and aa.role in (
      'coordinator'::public.app_role,
      'logistics_admin'::public.app_role,
      'session_director'::public.app_role,
      'area_advisory_couple'::public.app_role
    )
    and (aa.session_id=p_session_id or aa.role='area_advisory_couple'::public.app_role)
    and (p_exclude_user is null or aa.user_id<>p_exclude_user);
$$;

create or replace function private.effective_capabilities(
  target_session uuid,
  target_user uuid default null::uuid
)
returns text[]
language sql
stable
security definer
set search_path=''
as $$
with subject as (
  select coalesce(target_user,(select auth.uid())) user_id
), base as (
  select unnest(case
    when aa.role in (
      'session_director'::public.app_role,
      'logistics_admin'::public.app_role,
      'coordinator'::public.app_role,
      'area_advisory_couple'::public.app_role
    ) then array[
      'people_lookup','groups_view','checkin_record','headcount_view','headcount_record',
      'registration_view','registration_manage','identity_manage','arrival_manage',
      'staff_view','staff_manage','housing_view','housing_manage','housing_export',
      'food_view','food_manage','food_export','meal_attendance_view','meal_attendance_record',
      'wellness_status','wellness_private','wellness_manage','wellness_export',
      'inclusion_view','facilities_view','materials_view','financial_view','publicity_view',
      'reports_export','access_admin'
    ]::text[]
    when aa.role='assistant_coordinator'::public.app_role then array[
      'people_lookup','groups_view','checkin_record','headcount_view','headcount_record',
      'meal_attendance_view','meal_attendance_record'
    ]::text[]
    else '{}'::text[] end) capability
  from public.access_assignments aa, subject s
  where aa.user_id=s.user_id
    and aa.active
    and (aa.session_id=target_session or aa.role='area_advisory_couple'::public.app_role)
), explicit_caps as (
  select unnest(aa.capabilities) capability
  from public.access_assignments aa, subject s
  where aa.user_id=s.user_id
    and aa.active
    and (aa.session_id=target_session or aa.role='area_advisory_couple'::public.app_role)
), team_caps as (
  select unnest(ot.capabilities) capability
  from public.team_memberships tm
  join public.operational_teams ot on ot.id=tm.team_id and ot.session_id=tm.session_id
  join subject s on s.user_id=tm.user_id
  where tm.session_id=target_session and tm.active and ot.active
)
select coalesce(array_agg(distinct capability order by capability),'{}'::text[])
from (
  select capability from base
  union all select capability from explicit_caps
  union all select capability from team_caps
) caps
where capability is not null;
$$;

create or replace function private.staff_role_to_app_role(p_role text)
returns public.app_role
language sql
immutable
set search_path=''
as $$
  select case p_role
    when 'assistant_coordinator' then 'assistant_coordinator'::public.app_role
    when 'coordinator' then 'coordinator'::public.app_role
    when 'logistics_admin' then 'logistics_admin'::public.app_role
    when 'session_director' then 'session_director'::public.app_role
    when 'area_advisory_couple' then 'area_advisory_couple'::public.app_role
    else null::public.app_role
  end;
$$;

-- Expose every session to the Area Advisory Couple while preserving the
-- existing session-scoped rows for all other roles.
create or replace function public.my_access_state()
returns table (
  session_id uuid, session_name text, session_status text, role public.app_role,
  active boolean, capabilities text[], request_status public.access_request_status,
  requested_role public.app_role, requested_at timestamptz
)
language sql
stable
security definer
set search_path=''
as $$
  select * from (
    select s.id as session_id,s.name as session_name,s.status as session_status,
      aa.role as role,aa.active as active,
      private.effective_capabilities(s.id,(select auth.uid())) as capabilities,
      null::public.access_request_status as request_status,
      null::public.app_role as requested_role,
      null::timestamptz as requested_at
    from public.access_assignments aa
    join public.sessions s on s.id=aa.session_id
    where aa.user_id=(select auth.uid()) and aa.active

    union all

    select s.id as session_id,s.name as session_name,s.status as session_status,
      'area_advisory_couple'::public.app_role as role,true as active,
      private.effective_capabilities(s.id,(select auth.uid())) as capabilities,
      null::public.access_request_status as request_status,
      null::public.app_role as requested_role,
      null::timestamptz as requested_at
    from public.sessions s
    where exists (
      select 1 from public.access_assignments area
      where area.user_id=(select auth.uid())
        and area.active
        and area.role='area_advisory_couple'::public.app_role
    )
      and not exists (
        select 1 from public.access_assignments direct
        where direct.session_id=s.id
          and direct.user_id=(select auth.uid())
          and direct.active
      )

    union all

    select s.id,s.name,s.status,null::public.app_role,false,'{}'::text[],
      ar.status,ar.requested_role,ar.requested_at
    from public.access_requests ar
    join public.sessions s on s.id=ar.session_id
    where ar.requested_by=(select auth.uid())
      and ar.status='pending'
      and not private.has_session_access(ar.session_id)
  ) access_state
  order by active desc,requested_at desc nulls last;
$$;

revoke all on function private.has_area_advisory_access(uuid,uuid) from public;
revoke all on function private.has_session_access(uuid) from public;
revoke all on function private.has_session_role(uuid,public.app_role[]) from public;
revoke all on function private.can_access_company(uuid,uuid) from public;
revoke all on function private.can_finalize_session(uuid) from public;
revoke all on function private.can_manage_access(uuid) from public;
revoke all on function private.effective_capabilities(uuid,uuid) from public;
grant execute on function private.has_area_advisory_access(uuid,uuid) to authenticated;
grant execute on function private.has_session_access(uuid) to authenticated;
grant execute on function private.has_session_role(uuid,public.app_role[]) to authenticated;
grant execute on function private.can_access_company(uuid,uuid) to authenticated;
grant execute on function private.can_finalize_session(uuid) to authenticated;
grant execute on function private.can_manage_access(uuid) to authenticated;
grant execute on function private.effective_capabilities(uuid,uuid) to authenticated;
revoke all on function public.my_access_state() from public, anon;
grant execute on function public.my_access_state() to authenticated;

create or replace function private.session_participant_age(
  target_session uuid,
  target_participant uuid
)
returns integer
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(
    case
      when s.starts_on is not null and d.date_of_birth is not null
        then extract(year from age(s.starts_on,d.date_of_birth))::integer
      else null
    end,
    p.age
  )::integer
  from public.participants p
  join public.sessions s on s.id=p.session_id
  left join public.participant_private_details d on d.participant_id=p.id
  where p.id=target_participant and p.session_id=target_session;
$$;

create or replace function private.session_finalization_cohort(
  target_session uuid,
  target_participant uuid
)
returns text
language sql
stable
security definer
set search_path=''
as $$
  select case
    when private.session_participant_age(target_session,p.id) between 12 and 13 then 'age_12_13'
    when p.registration_status='awaiting' then 'awaiting_approval'
    when private.session_participant_age(target_session,p.id)=19 then 'age_19'
    else 'standard'
  end
  from public.participants p
  where p.id=target_participant and p.session_id=target_session;
$$;

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
      when private.session_participant_age(target_session,p.id)>=20 then false
      when o.cohort_state='excluded' then false
      when o.cohort_state='exception'
        and coalesce(o.local_clearance,false)
        and o.registration_confirmed
        and o.guardian_confirmed
        and o.leadership_confirmed then true
      when p.verification_status='verified'
        and p.registration_status in ('approved','awaiting')
        and private.session_participant_age(target_session,p.id) between 12 and 19 then true
      when p.registration_status='approved'
        and p.verification_status='verified'
        and d.date_of_birth is not null
        and s.starts_on is not null
        and s.ends_on is not null
        and private.session_participant_age(target_session,p.id) between 14 and 18
        and s.ends_on < (d.date_of_birth+interval '19 years')::date then true
      else false
    end
    from public.participants p
    join public.sessions s on s.id=p.session_id
    left join public.participant_private_details d on d.participant_id=p.id
    left join public.participant_operation_decisions o on o.participant_id=p.id
    where p.id=target_participant and p.session_id=target_session
  ),false);
$$;

create or replace function private.participant_eligibility_projection(target_session uuid)
returns table(participant_id uuid, eligible boolean, reason text)
language sql
stable
security definer
set search_path=''
as $$
with evaluated as (
  select p.id as participant_id,
    p.is_current,p.registration_status,p.verification_status,p.attendance_status,
    coalesce(p.operational_status,'active') as operational_status,
    private.session_participant_age(target_session,p.id) as age_on_start,
    s.starts_on,s.ends_on,d.date_of_birth,o.cohort_state,
    private.operational_participant_is_eligible(target_session,p.id) as eligible
  from public.participants p
  join public.sessions s on s.id=p.session_id
  left join public.participant_private_details d on d.participant_id=p.id
  left join public.participant_operation_decisions o on o.participant_id=p.id
  where p.session_id=target_session
)
select participant_id,eligible,
  case
    when eligible then 'Eligible'
    when age_on_start>=20 then 'Age 20+ removed from active participant roster'
    when cohort_state='excluded' then 'Excluded from active youth operations'
    when operational_status<>'active' then 'Not active in operations'
    when attendance_status='confirmed_not_attending' then 'Confirmed not attending'
    when not is_current then 'Not current in latest registration snapshot'
    when registration_status='cancelled' then 'Cancelled source registration'
    when verification_status<>'verified' then 'Needs verification'
    when age_on_start is null then 'Date of birth is missing'
    when age_on_start<12 then 'Too young for this FSY policy'
    when age_on_start>19 then 'Age 20+ removed from active participant roster'
    when registration_status<>'approved' then 'Registration is not approved'
    when not (ends_on<(date_of_birth+interval '19 years')::date) then 'Turns 19 before or on the end of this session'
    else 'Needs review'
  end
from evaluated;
$$;

revoke all on function private.session_participant_age(uuid,uuid) from public;
revoke all on function private.session_finalization_cohort(uuid,uuid) from public;
revoke all on function private.operational_participant_is_eligible(uuid,uuid) from public;
revoke all on function private.participant_eligibility_projection(uuid) from public, anon, authenticated;
grant execute on function private.session_participant_age(uuid,uuid) to authenticated;
grant execute on function private.session_finalization_cohort(uuid,uuid) to authenticated;
grant execute on function private.operational_participant_is_eligible(uuid,uuid) to authenticated;

create or replace function private.session_finalization_include_candidate(
  target_session uuid,
  target_participant uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1
    from public.participants p
    left join public.participant_operation_decisions od on od.participant_id=p.id
    where p.id=target_participant
      and p.session_id=target_session
      and p.is_current
      and coalesce(p.operational_status,'active')='active'
      and p.attendance_status<>'confirmed_not_attending'
      and p.registration_status<>'cancelled'
      and coalesce(p.verification_status,'pending')='verified'
      and private.session_participant_age(target_session,p.id) between 12 and 19
      and od.cohort_state is distinct from 'excluded'
      and (
        private.operational_participant_is_eligible(target_session,p.id)
        or p.registration_status in ('approved','awaiting')
      )
  );
$$;

revoke all on function private.session_finalization_include_candidate(uuid,uuid) from public;
grant execute on function private.session_finalization_include_candidate(uuid,uuid) to authenticated;

-- A single roster read model removes age 20+ and operationally excluded
-- people from the active participant roster while keeping awaiting and
-- younger approved-policy candidates visible for resolution.
create or replace function public.get_participant_roster_v2(p_session_id uuid)
returns table(
  participant_id uuid,
  registration_id text,
  first_name text,
  last_name text,
  preferred_name text,
  sex text,
  age integer,
  unit_name text,
  stake_name text,
  group_id uuid,
  source_kind text,
  registration_status text,
  verification_status text,
  is_current boolean,
  reconciliation_status text,
  operational_status text,
  operational_note text,
  operational_revision integer,
  operational_updated_at timestamptz,
  decision_kind text
)
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if not private.has_session_access(p_session_id) then
    raise exception 'Participant roster access required';
  end if;

  return query
  select p.id,p.registration_id,p.first_name,p.last_name,p.preferred_name,
    p.sex::text,p.age,p.unit_name,p.stake_name,p.group_id,p.source_kind,
    p.registration_status,p.verification_status,p.is_current,p.reconciliation_status,
    coalesce(p.operational_status,'active'),p.operational_note,
    coalesce(p.operational_revision,0),p.operational_updated_at,od.decision_kind
  from public.participants p
  join public.sessions s on s.id=p.session_id
  left join public.participant_private_details d on d.participant_id=p.id
  left join public.participant_operation_decisions od on od.participant_id=p.id
  left join public.counselor_groups g on g.id=p.group_id and g.session_id=p.session_id
  where p.session_id=p_session_id
    and p.is_current
    and coalesce(od.cohort_state,'normal')<>'excluded'
    and coalesce(
      case when s.starts_on is not null and d.date_of_birth is not null
        then extract(year from age(s.starts_on,d.date_of_birth))::integer
        else p.age end,
      0
    ) < 20
    and (
      private.has_session_role(
        p_session_id,
        array['coordinator','logistics_admin','session_director','area_advisory_couple']::public.app_role[]
      )
      or (g.company_id is not null and private.can_access_company(p_session_id,g.company_id))
    )
  order by lower(p.last_name),lower(p.first_name),p.id;
end;
$$;

revoke all on function public.get_participant_roster_v2(uuid) from public, anon;
grant execute on function public.get_participant_roster_v2(uuid) to authenticated;

-- Explicit individual decisions remain available from Registration. The
-- blanket policy used by finalization is recorded separately with the same
-- evidence fields, so the source approval status is never overwritten.
create or replace function public.record_participant_exception(
  p_participant_id uuid,
  p_allow boolean,
  p_authority text,
  p_reason text,
  p_registration_confirmed boolean,
  p_guardian_confirmed boolean,
  p_leadership_confirmed boolean
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  p public.participants%rowtype;
  age_on_start integer;
  kind text;
begin
  select * into p from public.participants where id=p_participant_id for update;
  if p.id is null or not private.can_finalize_session(p.session_id) then
    raise exception 'Whole-session leadership access is required to record participant final-roster decisions';
  end if;
  if length(trim(coalesce(p_authority,'')))<3 or length(trim(coalesce(p_reason,'')))<5 then
    raise exception 'Record the confirming authority and reason';
  end if;
  age_on_start:=private.session_participant_age(p.session_id,p.id);
  if p_allow and age_on_start>=20 then
    raise exception 'People aged 20 or above cannot be admitted to the youth participant roster';
  end if;
  if p_allow and not (
    coalesce(p_registration_confirmed,false)
    and coalesce(p_guardian_confirmed,false)
    and coalesce(p_leadership_confirmed,false)
  ) then
    raise exception 'Confirm the required registration, guardian and leadership checks';
  end if;
  if p.registration_status='cancelled' then
    raise exception 'Cancelled source registration must be resolved at source first';
  end if;
  kind:=case
    when not p_allow and age_on_start>=20 then 'age_20_plus_excluded'
    when not p_allow then 'manual_exclusion'
    when age_on_start between 12 and 13 then 'age_12_13'
    when p.registration_status='awaiting' then 'awaiting_approval'
    when age_on_start=19 then 'age_19'
    else 'manual_exception'
  end;

  insert into public.participant_operation_decisions(
    participant_id,cohort_state,decision_kind,local_clearance,
    registration_confirmed,guardian_confirmed,leadership_confirmed,
    authority,reason,recorded_by,recorded_at,batch_id
  ) values (
    p.id,case when p_allow then 'exception' else 'excluded' end,kind,p_allow,
    p_registration_confirmed,p_guardian_confirmed,p_leadership_confirmed,
    p_authority,p_reason,(select auth.uid()),now(),extensions.gen_random_uuid()
  )
  on conflict(participant_id) do update set
    cohort_state=excluded.cohort_state,
    decision_kind=excluded.decision_kind,
    local_clearance=excluded.local_clearance,
    registration_confirmed=excluded.registration_confirmed,
    guardian_confirmed=excluded.guardian_confirmed,
    leadership_confirmed=excluded.leadership_confirmed,
    authority=excluded.authority,
    reason=excluded.reason,
    recorded_by=(select auth.uid()),
    recorded_at=now(),
    revision=public.participant_operation_decisions.revision+1,
    batch_id=excluded.batch_id;

  if p_allow then
    update public.participants
    set is_current=true,attendance_status='expected',operational_status='active',updated_at=now()
    where id=p.id;
  end if;

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(
    p.session_id,(select auth.uid()),'participant_exception_recorded','participant',p.id::text,
    jsonb_build_object(
      'allowed',p_allow,'decision_kind',kind,'authority',p_authority,'reason',p_reason,
      'registration',p_registration_confirmed,'guardian',p_guardian_confirmed,
      'leadership',p_leadership_confirmed,'source_registration_status',p.registration_status
    )
  );
end;
$$;

revoke all on function public.record_participant_exception(uuid,boolean,text,text,boolean,boolean,boolean) from public, anon;
grant execute on function public.record_participant_exception(uuid,boolean,text,text,boolean,boolean,boolean) to authenticated;

create or replace function public.get_session_finalization_preview_v2(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
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

  select * into final_row from public.session_roster_finalizations where session_id=p_session_id;
  select coalesce(group_min_size,8),coalesce(group_max_size,10),
    coalesce(groups_per_company,2),coalesce(avoid_same_unit,true)
  into min_group_size,max_group_size,groups_per_company,avoid_same_unit
  from public.session_structure_settings where session_id=p_session_id;
  min_group_size:=greatest(coalesce(min_group_size,8),1);
  max_group_size:=greatest(coalesce(max_group_size,10),1);
  groups_per_company:=greatest(coalesce(groups_per_company,2),1);

  with targets as (
    select p.id,p.sex::text as sex,p.group_id,
      private.session_finalization_cohort(p_session_id,p.id) as cohort
    from public.participants p
    where p.session_id=p_session_id
      and private.session_finalization_include_candidate(p_session_id,p.id)
  )
  select count(*)::integer,
    count(*) filter(where cohort='awaiting_approval')::integer,
    count(*) filter(where cohort='age_12_13')::integer,
    count(*) filter(where cohort='age_19')::integer,
    count(*) filter(where group_id is null)::integer,
    count(*) filter(where group_id is null and sex='female')::integer,
    count(*) filter(where group_id is null and sex='male')::integer
  into include_total,awaiting_total,younger_total,age19_total,new_participants,new_female,new_male
  from targets;

  select count(*)::integer into exclude_total
  from public.participants p
  where p.session_id=p_session_id and p.is_current
    and p.registration_status<>'cancelled'
    and private.session_participant_age(p_session_id,p.id)>=20;

  select count(*)::integer into exclusion_conflicts
  from public.participants p
  where p.session_id=p_session_id and p.is_current
    and p.registration_status<>'cancelled'
    and private.session_participant_age(p_session_id,p.id)>=20
    and (
      exists(select 1 from public.check_ins ci where ci.session_id=p_session_id and ci.participant_id=p.id and ci.status::text in ('arrived','needs_attention'))
      or exists(select 1 from public.housing_assignments ha where ha.session_id=p_session_id and ha.participant_id=p.id and ha.active)
      or exists(select 1 from public.participant_badge_assignments b where b.session_id=p_session_id and b.participant_id=p.id and b.state<>'retired')
    );

  select count(*)::integer,
    count(*) filter(where g.sex::text='female')::integer,
    count(*) filter(where g.sex::text='male')::integer
  into open_groups,open_female_groups,open_male_groups
  from public.counselor_groups g
  where g.session_id=p_session_id and g.state='published'
    and (g.counselor_id is null or not private.staff_can_plan(g.counselor_id));

  with people as (
    select p.sex::text sex,
      private.session_finalization_cohort(p_session_id,p.id) cohort,
      coalesce(nullif(lower(trim(p.unit_name)),''),'__unknown__') unit_key
    from public.participants p
    where p.session_id=p_session_id
      and p.group_id is null
      and private.session_finalization_include_candidate(p_session_id,p.id)
  ), unit_counts as (
    select cohort,sex,unit_key,count(*)::integer unit_count
    from people group by cohort,sex,unit_key
  ), bucket_counts as (
    select p.cohort,p.sex,count(*)::integer participant_count,
      coalesce(max(u.unit_count),0)::integer max_unit_count
    from people p
    left join unit_counts u on u.cohort=p.cohort and u.sex=p.sex
    group by p.cohort,p.sex
  ), planned as (
    select cohort,sex,
      greatest(ceil(participant_count/max_group_size::numeric)::integer,
        case when avoid_same_unit then max_unit_count else 0 end) group_count,
      participant_count
    from bucket_counts
  )
  select coalesce(sum(group_count),0)::integer,
    coalesce(sum(group_count) filter(where sex='female'),0)::integer,
    coalesce(sum(group_count) filter(where sex='male'),0)::integer,
    coalesce(sum(ceil(group_count::numeric/groups_per_company)),0)::integer,
    coalesce(sum(group_count) filter(where participant_count<min_group_size),0)::integer
  into new_groups,new_female_groups,new_male_groups,new_companies,small_cohort_groups
  from planned;

  select count(*)::integer into remaining_blockers
  from public.participants p
  join private.participant_eligibility_projection(p_session_id) e on e.participant_id=p.id
  where p.session_id=p_session_id and p.is_current
    and coalesce(p.operational_status,'active')='active'
    and p.attendance_status<>'confirmed_not_attending'
    and p.registration_status<>'cancelled'
    and private.session_participant_age(p_session_id,p.id)<20
    and not e.eligible
    and not private.session_finalization_include_candidate(p_session_id,p.id);

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

create or replace function public.apply_session_finalization_v2(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  s public.sessions%rowtype;
  batch_id uuid:=extensions.gen_random_uuid();
  min_group_size integer:=8;
  max_group_size integer:=10;
  groups_per_company integer:=2;
  avoid_same_unit boolean:=true;
  include_total integer:=0;
  exclude_total integer:=0;
  staff_cleared integer:=0;
  open_groups_repaired integer:=0;
  new_groups integer:=0;
  new_companies integer:=0;
  counselors_assigned integer:=0;
  assistants_assigned integer:=0;
  badges_issued integer:=0;
  unknown_origin integer:=0;
  remaining_blockers integer:=0;
  eligible_without_group integer:=0;
  conflict_count integer:=0;
  next_company integer:=0;
  next_slot integer:=0;
  company_number integer:=0;
  needed_groups integer:=0;
  needed_companies integer:=0;
  max_unit_size integer:=0;
  i integer;
  cohort record;
  person record;
  counselor_id uuid;
  assistant_id uuid;
  target_group_id uuid;
  target_company_id uuid;
  origin_code text;
  fsy_id text;
  cohort_label text;
  final_summary jsonb;
begin
  if not private.can_finalize_session(p_session_id) then
    raise exception 'Final roster access required';
  end if;
  select * into s from public.sessions where id=p_session_id for update;
  if s.id is null then raise exception 'Session not found'; end if;

  select coalesce(group_min_size,8),coalesce(group_max_size,10),
    coalesce(groups_per_company,2),coalesce(avoid_same_unit,true)
  into min_group_size,max_group_size,groups_per_company,avoid_same_unit
  from public.session_structure_settings where session_id=p_session_id;
  min_group_size:=greatest(coalesce(min_group_size,8),1);
  max_group_size:=greatest(coalesce(max_group_size,10),1);
  groups_per_company:=greatest(coalesce(groups_per_company,2),1);

  create temporary table tmp_session_candidates(
    id uuid primary key,
    sex text not null,
    cohort text not null
  ) on commit drop;
  insert into tmp_session_candidates(id,sex,cohort)
  select p.id,p.sex::text,private.session_finalization_cohort(p_session_id,p.id)
  from public.participants p
  where p.session_id=p_session_id
    and private.session_finalization_include_candidate(p_session_id,p.id);
  get diagnostics include_total=row_count;

  create temporary table tmp_session_excluded(id uuid primary key) on commit drop;
  insert into tmp_session_excluded(id)
  select p.id
  from public.participants p
  where p.session_id=p_session_id and p.is_current
    and p.registration_status<>'cancelled'
    and private.session_participant_age(p_session_id,p.id)>=20;
  get diagnostics exclude_total=row_count;

  select count(*)::integer into conflict_count
  from tmp_session_excluded x
  where exists(select 1 from public.check_ins ci where ci.session_id=p_session_id and ci.participant_id=x.id and ci.status::text in ('arrived','needs_attention'))
     or exists(select 1 from public.housing_assignments ha where ha.session_id=p_session_id and ha.participant_id=x.id and ha.active)
     or exists(select 1 from public.participant_badge_assignments b where b.session_id=p_session_id and b.participant_id=x.id and b.state<>'retired');
  if conflict_count>0 then
    raise exception '% participant(s) aged 20+ already have live check-in, Housing or badge history and need individual review',conflict_count;
  end if;

  -- The group assignment is operational state, so it can be cleared safely
  -- after the live-history check. The source participant remains intact.
  update public.participants p
  set group_id=null,updated_at=now()
  from tmp_session_excluded x
  where p.id=x.id and p.group_id is not null;

  insert into public.participant_operation_decisions(
    participant_id,cohort_state,decision_kind,local_clearance,
    registration_confirmed,guardian_confirmed,leadership_confirmed,
    authority,reason,revision,recorded_by,recorded_at,batch_id
  )
  select x.id,'excluded','age_20_plus_excluded',false,false,false,false,
    'FSY session finalization policy v2',
    'Age 20+ removed from the active participant roster; source registration retained',
    1,(select auth.uid()),now(),batch_id
  from tmp_session_excluded x
  on conflict(participant_id) do update set
    cohort_state='excluded',decision_kind='age_20_plus_excluded',local_clearance=false,
    registration_confirmed=false,guardian_confirmed=false,leadership_confirmed=false,
    authority=excluded.authority,reason=excluded.reason,
    revision=public.participant_operation_decisions.revision+1,
    recorded_by=(select auth.uid()),recorded_at=now(),batch_id=excluded.batch_id;

  insert into public.participant_operation_decisions(
    participant_id,cohort_state,decision_kind,local_clearance,
    registration_confirmed,guardian_confirmed,leadership_confirmed,
    authority,reason,revision,recorded_by,recorded_at,batch_id
  )
  select x.id,'exception',
    case x.cohort when 'age_12_13' then 'age_12_13' when 'awaiting_approval' then 'awaiting_approval' when 'age_19' then 'age_19' else null end,
    true,true,true,true,
    'FSY session finalization policy v2',
    case x.cohort
      when 'age_12_13' then 'Approved 12-13 participant policy; source registration retained'
      when 'awaiting_approval' then 'Approved awaiting-registration participant policy; source registration retained'
      when 'age_19' then 'Approved age 19 participant policy; source registration retained'
      else 'Included in the final participant roster; source registration retained'
    end,
    1,(select auth.uid()),now(),batch_id
  from tmp_session_candidates x
  where x.cohort<>'standard'
  on conflict(participant_id) do update set
    cohort_state='exception',decision_kind=excluded.decision_kind,local_clearance=true,
    registration_confirmed=true,guardian_confirmed=true,leadership_confirmed=true,
    authority=excluded.authority,reason=excluded.reason,
    revision=public.participant_operation_decisions.revision+1,
    recorded_by=(select auth.uid()),recorded_at=now(),batch_id=excluded.batch_id;

  insert into public.staff_operations(staff_id,planning_state,arrival_state,service_clearance,revision,updated_by,updated_at)
  select st.id,'reserve','expected','cleared',1,(select auth.uid()),now()
  from public.staff st
  where st.session_id=p_session_id and st.is_current and st.registration_status='awaiting'
  on conflict(staff_id) do update set
    planning_state=case when public.staff_operations.planning_state='provisional' then 'reserve' else public.staff_operations.planning_state end,
    service_clearance='cleared',revision=public.staff_operations.revision+1,
    updated_by=(select auth.uid()),updated_at=now()
  where public.staff_operations.planning_state<>'excluded'
    and public.staff_operations.arrival_state not in ('no_show','left');
  get diagnostics staff_cleared=row_count;

  create temporary table tmp_open_groups(id uuid primary key,sex text,rn integer) on commit drop;
  insert into tmp_open_groups(id,sex,rn)
  select g.id,g.sex::text,row_number() over(partition by g.sex order by g.operational_number nulls last,g.name,g.id)::integer
  from public.counselor_groups g
  where g.session_id=p_session_id and g.state='published'
    and (g.counselor_id is null or not private.staff_can_plan(g.counselor_id));

  create temporary table tmp_available_counselors(id uuid primary key,sex text,rn integer) on commit drop;
  insert into tmp_available_counselors(id,sex,rn)
  select st.id,st.sex::text,
    row_number() over(partition by st.sex order by case when st.registration_status='approved' then 0 else 1 end,lower(st.full_name),st.id)::integer
  from public.staff st
  left join public.staff_operations o on o.staff_id=st.id
  where st.session_id=p_session_id and st.is_current and st.registration_status<>'cancelled'
    and st.operational_role='counselor'
    and coalesce(o.planning_state,'reserve')<>'excluded'
    and coalesce(o.service_clearance,'confirmation_required')<>'not_cleared'
    and coalesce(o.arrival_state,'expected') not in ('no_show','left')
    and not exists(select 1 from public.counselor_groups g where g.session_id=p_session_id and g.counselor_id=st.id);

  update public.counselor_groups g
  set counselor_id=c.id
  from tmp_open_groups og
  join tmp_available_counselors c on c.sex=og.sex and c.rn=og.rn
  where g.id=og.id;
  get diagnostics open_groups_repaired=row_count;
  delete from tmp_available_counselors c
  where exists(select 1 from public.counselor_groups g where g.session_id=p_session_id and g.counselor_id=c.id);

  select coalesce(max(coalesce(c.operational_number,nullif(regexp_replace(c.name,'\D','','g'),'')::integer)),0)::integer
    into next_company
  from public.companies c where c.session_id=p_session_id;

  create temporary table tmp_new_companies(
    id uuid primary key,
    cohort text not null,
    company_no integer not null
  ) on commit drop;
  create temporary table tmp_new_groups(
    id uuid primary key,
    cohort text not null,
    sex text not null,
    group_no integer not null,
    member_count integer not null default 0,
    unit_keys text[] not null default '{}'
  ) on commit drop;

  for cohort in
    select x.cohort,x.sex,count(*)::integer participant_count,
      coalesce(max(unit_count),0)::integer max_unit_count
    from (
      select x.cohort,x.sex,
        coalesce(nullif(lower(trim(p.unit_name)),''),'__unknown__') unit_key,
        count(*) over(partition by x.cohort,x.sex,coalesce(nullif(lower(trim(p.unit_name)),''),'__unknown__'))::integer unit_count
      from tmp_session_candidates x
      join public.participants p on p.id=x.id
      where p.group_id is null
    ) x
    group by x.cohort,x.sex
    order by x.cohort,x.sex
  loop
    needed_groups:=greatest(
      ceil(cohort.participant_count/max_group_size::numeric)::integer,
      case when avoid_same_unit then cohort.max_unit_count else 0 end
    );
    needed_companies:=ceil(needed_groups/groups_per_company::numeric)::integer;

  for i in 1..needed_companies loop
      next_company:=next_company+1;
      insert into public.companies(
        session_id,name,operational_number,finalization_cohort,finalization_batch_id
      ) values(
        p_session_id,
        format('Supplemental %s Company %s',replace(initcap(cohort.cohort),'_',' '),lpad(next_company::text,2,'0')),
        next_company,cohort.cohort,batch_id
      ) returning id into target_company_id;
      insert into tmp_new_companies(id,cohort,company_no)
      values(target_company_id,cohort.cohort,i);
      new_companies:=new_companies+1;
    end loop;

    for i in 1..needed_groups loop
      select c.id into target_company_id
      from tmp_new_companies c
      where c.cohort=cohort.cohort
        and c.company_no=ceil(i/groups_per_company::numeric)::integer;
      select c.id into counselor_id
      from tmp_available_counselors c
      where c.sex=cohort.sex
      order by c.rn,c.id limit 1;
      if counselor_id is null then
        raise exception 'Not enough available % counselors for the supplemental roster',cohort.sex;
      end if;
      select case when cohort.sex='female' then 'YW' else 'YM' end into cohort_label;
      insert into public.counselor_groups(
        session_id,company_id,name,sex,state,counselor_id,
        finalization_cohort,finalization_batch_id
      ) values(
        p_session_id,target_company_id,
        format('%s %s %s',cohort_label,replace(initcap(cohort.cohort),'_',' '),lpad(i::text,2,'0')),
        cohort.sex::public.participant_sex,'published',counselor_id,cohort.cohort,batch_id
      ) returning id into target_group_id;
      insert into tmp_new_groups(id,cohort,sex,group_no)
      values(target_group_id,cohort.cohort,cohort.sex,i);
      delete from tmp_available_counselors where id=counselor_id;
      new_groups:=new_groups+1;
      counselors_assigned:=counselors_assigned+1;
    end loop;
  end loop;

  -- The supplemental groups are intentionally allowed to be smaller than the
  -- normal target. They remain isolated and are marked with their policy
  -- cohort so leaders can review them without reshuffling the baseline.
  for person in
    select p.id,x.cohort,x.sex,
      coalesce(nullif(lower(trim(p.unit_name)),''),'__unknown__') unit_key,
      count(*) over(partition by x.cohort,x.sex,coalesce(nullif(lower(trim(p.unit_name)),''),'__unknown__'))::integer unit_count
    from tmp_session_candidates x
    join public.participants p on p.id=x.id
    where p.group_id is null
    order by x.cohort,x.sex,unit_count desc,unit_key,lower(p.last_name),lower(p.first_name),p.id
  loop
    target_group_id:=null;
    select g.id into target_group_id
    from tmp_new_groups g
    where g.cohort=person.cohort
      and g.sex=person.sex
      and g.member_count<max_group_size
      and (not avoid_same_unit or not (person.unit_key=any(g.unit_keys)))
    order by g.member_count,g.group_no,g.id
    limit 1;
    if target_group_id is null then
      raise exception 'Could not place every supplemental participant within the configured group rules';
    end if;
    update public.participants set group_id=target_group_id,updated_at=now() where id=person.id;
    update tmp_new_groups
    set member_count=member_count+1,unit_keys=array_append(unit_keys,person.unit_key)
    where id=target_group_id;
  end loop;

  create temporary table tmp_available_assistants(id uuid primary key,rn integer) on commit drop;
  insert into tmp_available_assistants(id,rn)
  select st.id,row_number() over(order by case when st.registration_status='approved' then 0 else 1 end,lower(st.full_name),st.id)::integer
  from public.staff st
  left join public.staff_operations o on o.staff_id=st.id
  where st.session_id=p_session_id and st.is_current and st.registration_status<>'cancelled'
    and st.operational_role='assistant_coordinator'
    and coalesce(o.planning_state,'reserve')<>'excluded'
    and coalesce(o.service_clearance,'confirmation_required')<>'not_cleared'
    and coalesce(o.arrival_state,'expected') not in ('no_show','left')
    and not exists(select 1 from public.staff_company_assignments a where a.session_id=p_session_id and a.staff_id=st.id);

  for person in select id from tmp_new_companies order by company_no loop
    select id into assistant_id from tmp_available_assistants order by rn,id limit 1;
    if assistant_id is null then
      raise exception 'Not enough available Assistant Coordinators for the supplemental companies';
    end if;
    insert into public.staff_company_assignments(
      session_id,staff_id,company_id,assignment_role,assigned_by,assigned_at
    ) values(
      p_session_id,assistant_id,person.id,'assistant_coordinator',(select auth.uid()),now()
    ) on conflict do nothing;
    delete from tmp_available_assistants where id=assistant_id;
    assistants_assigned:=assistants_assigned+1;
  end loop;

  update public.staff_operations o
  set planning_state='primary',revision=o.revision+1,updated_by=(select auth.uid()),updated_at=now()
  where o.staff_id in (
    select counselor_id from public.counselor_groups where session_id=p_session_id and counselor_id is not null
    union
    select staff_id from public.staff_company_assignments where session_id=p_session_id
  );

  for person in
    select p.id,p.group_id,g.company_id,trim(concat_ws(' ',p.first_name,p.last_name)) full_name
    from tmp_session_candidates x
    join public.participants p on p.id=x.id
    join public.counselor_groups g on g.id=p.group_id and g.session_id=p.session_id
    where not exists(
      select 1 from public.participant_badge_assignments b
      where b.session_id=p_session_id and b.participant_id=p.id and b.state<>'retired'
    )
    order by g.company_id,g.name,lower(p.last_name),lower(p.first_name),p.id
  loop
    select private.origin_code_for_participant(p) into origin_code
    from public.participants p where p.id=person.id;
    if origin_code is null or btrim(origin_code)='' then
      origin_code:='UNK';
      unknown_origin:=unknown_origin+1;
    end if;
    select coalesce(c.operational_number,nullif(regexp_replace(c.name,'\D','','g'),'')::integer)
      into company_number
    from public.companies c where c.id=person.company_id and c.session_id=p_session_id;
    if company_number is null then raise exception 'A supplemental company number is required before issuing an FSY ID'; end if;
    select coalesce(max(b.slot_number),0)+1 into next_slot
    from public.participant_badge_assignments b
    where b.session_id=p_session_id and b.company_id=person.company_id;
    if next_slot>99 then raise exception 'Company sequence is full while issuing supplemental FSY IDs'; end if;
    fsy_id:='C'||lpad(company_number::text,greatest(2,length(company_number::text)),'0')||'-'||lpad(next_slot::text,2,'0')||'-'||origin_code;
    insert into public.participant_badge_assignments(
      session_id,participant_id,company_id,group_id,slot_number,origin_code,fsy_id,badge_name,state,
      assigned_by,assigned_at,finalized_by,finalized_at,note
    ) values(
      p_session_id,person.id,person.company_id,person.group_id,next_slot,origin_code,fsy_id,person.full_name,'finalized',
      (select auth.uid()),now(),(select auth.uid()),now(),
      'Supplemental final roster v2; existing IDs preserved'
    );
    badges_issued:=badges_issued+1;
  end loop;

  select count(*)::integer into remaining_blockers
  from public.participants p
  where p.session_id=p_session_id and p.is_current
    and coalesce(p.operational_status,'active')='active'
    and p.attendance_status<>'confirmed_not_attending'
    and p.registration_status<>'cancelled'
    and private.session_participant_age(p_session_id,p.id)<20
    and not private.operational_participant_is_eligible(p_session_id,p.id);
  if remaining_blockers>0 then
    raise exception '% participant eligibility blocker(s) remain after finalization',remaining_blockers;
  end if;

  select count(*)::integer into eligible_without_group
  from public.participants p
  where p.session_id=p_session_id and p.is_current
    and private.operational_participant_is_eligible(p_session_id,p.id)
    and p.group_id is null;
  if eligible_without_group>0 then
    raise exception '% eligible participant(s) remain without a counselor group',eligible_without_group;
  end if;

  if exists(
    select 1 from public.counselor_groups g
    where g.session_id=p_session_id and g.state='published'
      and (g.counselor_id is null or not private.staff_can_plan(g.counselor_id))
  ) then
    raise exception 'At least one published counselor group still lacks an available counselor';
  end if;

  final_summary:=jsonb_build_object(
    'participants_included',include_total,
    'participants_20_plus_removed',exclude_total,
    'staff_cleared',staff_cleared,
    'existing_groups_repaired',open_groups_repaired,
    'new_groups',new_groups,
    'new_companies',new_companies,
    'counselors_assigned',counselors_assigned,
    'assistant_coordinators_assigned',assistants_assigned,
    'fsy_ids_issued',badges_issued,
    'unknown_origin_ids',unknown_origin,
    'existing_placements_moved',0,
    'remaining_participant_blockers',0,
    'policy_version','v2',
    'finalized_at',now()
  );

  insert into public.session_roster_finalizations(session_id,finalized_by,summary)
  values(p_session_id,(select auth.uid()),final_summary)
  on conflict(session_id) do update set
    summary=excluded.summary,
    finalized_by=coalesce(public.session_roster_finalizations.finalized_by,excluded.finalized_by),
    finalized_at=coalesce(public.session_roster_finalizations.finalized_at,excluded.finalized_at);

  insert into public.session_roster_freezes(session_id,frozen_by,note)
  values(p_session_id,(select auth.uid()),'Final roster completed with additive policy v2. New people use on-site registration.')
  on conflict(session_id) do nothing;

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_session_id,(select auth.uid()),'session_roster_finalized_v2','session',p_session_id::text,final_summary);
  return final_summary;
end;
$$;

revoke all on function public.get_session_finalization_preview_v2(uuid) from public, anon;
revoke all on function public.apply_session_finalization_v2(uuid) from public, anon;
grant execute on function public.get_session_finalization_preview_v2(uuid) to authenticated;
grant execute on function public.apply_session_finalization_v2(uuid) to authenticated;

-- The current UI uses this helper for the live participant directory. Keep
-- its source-page query available, but make the operational roster query
-- authoritative for age 20+ removal.
