-- Registration performance v29
-- Keep one canonical, set-wise eligibility projection and expose a single read model
-- for the live Registration & check-in workspace.

create or replace function private.participant_eligibility_projection(target_session uuid)
returns table(participant_id uuid, eligible boolean, reason text)
language sql
stable
security definer
set search_path=''
as $$
  with evaluated as (
    select
      p.id as participant_id,
      p.is_current,
      p.registration_status,
      p.verification_status,
      p.attendance_status,
      s.starts_on,
      s.ends_on,
      d.date_of_birth,
      od.cohort_state,
      coalesce(
        case
          when od.cohort_state='excluded' then false
          when od.cohort_state='exception' then
            p.is_current
            and p.registration_status<>'cancelled'
            and p.attendance_status<>'confirmed_not_attending'
            and od.registration_confirmed
            and od.guardian_confirmed
            and od.leadership_confirmed
          when extract(year from age(s.starts_on,d.date_of_birth))>=20 then false
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
      when e.eligible then 'Eligible'
      when e.cohort_state='excluded' then 'Excluded from active youth operations'
      when e.attendance_status='confirmed_not_attending' then 'Confirmed not attending'
      when not e.is_current then 'Not current in latest registration snapshot'
      when e.registration_status<>'approved' then 'Registration is not approved'
      when e.verification_status<>'verified' then 'Needs verification'
      when e.date_of_birth is null then 'Date of birth is missing'
      when extract(year from e.starts_on)::int-extract(year from e.date_of_birth)::int<14 then 'Too young for this FSY year'
      when not(e.ends_on<(e.date_of_birth+interval '19 years')::date) then 'Turns 19 before or on the end of this session'
      else 'Eligible'
    end as reason
  from evaluated e;
$$;

revoke all on function private.participant_eligibility_projection(uuid) from public, anon, authenticated;

create or replace function public.get_participant_eligibility(p_session_id uuid)
returns table(participant_id uuid, eligible boolean, reason text)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  can_see_all boolean;
begin
  can_see_all :=
    private.has_session_role(p_session_id,array['coordinator','logistics_admin','session_director']::public.app_role[])
    or private.has_team_capability(p_session_id,'people_lookup');

  if can_see_all then
    return query
    select e.participant_id,e.eligible,e.reason
    from private.participant_eligibility_projection(p_session_id) e;
  end if;

  return query
  select e.participant_id,e.eligible,e.reason
  from private.participant_eligibility_projection(p_session_id) e
  join public.participants p on p.id=e.participant_id
  join public.counselor_groups g on g.id=p.group_id
  where private.can_access_company(p_session_id,g.company_id);
end;
$$;

revoke all on function public.get_participant_eligibility(uuid) from public, anon;
grant execute on function public.get_participant_eligibility(uuid) to authenticated, service_role;

create or replace function public.get_identity_readiness(p_session_id uuid)
returns table(
  eligible_grouped integer,
  active_ids integer,
  draft_ids integer,
  finalized_ids integer,
  unresolved_origin integer,
  name_reviews integer
)
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if not private.has_capability(p_session_id,'registration_view')
     and not private.has_capability(p_session_id,'reports_export') then
    raise exception 'Registration or reporting access required';
  end if;

  return query
  with origin_keys as (
    select o.session_id,o.code,lower(trim(o.canonical_name)) as key,0 as priority
    from public.origin_code_registry o
    where o.session_id=p_session_id and o.active
    union all
    select o.session_id,o.code,lower(trim(alias_name)) as key,1 as priority
    from public.origin_code_registry o
    cross join lateral unnest(o.aliases) alias_name
    where o.session_id=p_session_id and o.active
  ), eligible as (
    select
      p.id,
      p.first_name,
      p.last_name,
      p.preferred_name,
      coalesce(
        min(ok.code) filter (where ok.priority=0),
        min(ok.code) filter (where ok.priority=1)
      ) as origin_code
    from public.participants p
    join private.participant_eligibility_projection(p_session_id) e
      on e.participant_id=p.id and e.eligible
    left join origin_keys ok
      on ok.session_id=p.session_id
      and ok.key=lower(trim(coalesce(p.stake_name,'')))
    where p.session_id=p_session_id and p.group_id is not null
    group by p.id,p.first_name,p.last_name,p.preferred_name
  ), badge_counts as (
    select
      count(*) filter (where b.state<>'retired')::int as active_ids,
      count(*) filter (where b.state='draft')::int as draft_ids,
      count(*) filter (where b.state='finalized')::int as finalized_ids
    from public.participant_badge_assignments b
    where b.session_id=p_session_id
  )
  select
    count(e.id)::int,
    coalesce(max(bc.active_ids),0)::int,
    coalesce(max(bc.draft_ids),0)::int,
    coalesce(max(bc.finalized_ids),0)::int,
    count(*) filter (where e.origin_code is null)::int,
    count(*) filter (
      where nullif(trim(coalesce(e.preferred_name,'')),'') is not null
        and lower(trim(e.preferred_name))<>lower(trim(e.first_name))
        and lower(trim(e.preferred_name))<>lower(trim(concat_ws(' ',e.first_name,e.last_name)))
    )::int
  from eligible e
  cross join badge_counts bc;
end;
$$;

revoke all on function public.get_identity_readiness(uuid) from public, anon;
grant execute on function public.get_identity_readiness(uuid) to authenticated, service_role;

create or replace function public.get_registration_workspace_v29(p_session_id uuid)
returns table(
  participant_id uuid,
  fsy_id text,
  full_name text,
  preferred_name text,
  sex text,
  age integer,
  stake_name text,
  unit_name text,
  company_id uuid,
  company_name text,
  group_id uuid,
  group_name text,
  slot_number integer,
  badge_state text,
  attendance_status text,
  checkin_status text,
  source_kind text,
  verification_status text,
  registration_status text,
  is_current boolean,
  eligible boolean,
  eligibility_reason text,
  room_id uuid,
  room_name text,
  bed_label text,
  housing_assigned_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
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
    p.id,
    b.fsy_id,
    trim(concat_ws(' ',p.first_name,p.last_name)),
    p.preferred_name,
    p.sex::text,
    p.age,
    p.stake_name,
    p.unit_name,
    coalesce(b.company_id,g.company_id),
    c.name,
    coalesce(b.group_id,p.group_id),
    g.name,
    b.slot_number,
    b.state::text,
    coalesce(p.attendance_status,'expected'),
    ci.status::text,
    p.source_kind,
    p.verification_status,
    p.registration_status,
    p.is_current,
    e.eligible,
    e.reason,
    hr.id,
    hr.room_name,
    ha.bed_label,
    ha.assigned_at
  from public.participants p
  join private.participant_eligibility_projection(p_session_id) e on e.participant_id=p.id
  left join public.participant_badge_assignments b
    on b.participant_id=p.id and b.session_id=p.session_id and b.state<>'retired'
  left join public.counselor_groups g on g.id=coalesce(b.group_id,p.group_id)
  left join public.companies c on c.id=coalesce(b.company_id,g.company_id)
  left join public.check_ins ci on ci.session_id=p.session_id and ci.participant_id=p.id
  left join public.housing_assignments ha
    on ha.session_id=p.session_id and ha.participant_id=p.id and ha.active
  left join public.housing_rooms hr on hr.id=ha.room_id and hr.session_id=ha.session_id
  where p.session_id=p_session_id
    and (
      can_registration
      or coalesce(b.company_id,g.company_id)=any(caller_companies)
    )
  order by lower(coalesce(p.stake_name,'')),lower(coalesce(p.unit_name,'')),lower(p.last_name),lower(p.first_name),p.id;
end;
$$;

revoke all on function public.get_registration_workspace_v29(uuid) from public, anon;
grant execute on function public.get_registration_workspace_v29(uuid) to authenticated, service_role;
