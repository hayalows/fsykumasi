-- Security and day-one hardening for FSY identity/arrival operations.
-- This is a forward migration because 20260904072000 may already be applied in production.

-- Arrival reconciliation needs more states than the original attendance model.
alter table public.participants drop constraint if exists participants_attendance_status_check;
alter table public.participants add constraint participants_attendance_status_check
  check (attendance_status in ('expected','expected_later','unknown','confirmed_not_attending'));

-- Full-session operations do not imply access administration for an ordinary Coordinator.
-- Logistical Administrators and Session Directing Couples remain top access administrators.
-- A Coordinator receives access administration only when it is explicitly delegated in access_assignments.capabilities.
create or replace function private.effective_capabilities(target_session uuid, target_user uuid default null)
returns text[]
language sql
stable
security definer
set search_path=''
as $$
with subject as (select coalesce(target_user,(select auth.uid())) user_id), base as (
  select unnest(case
    when aa.role in ('session_director','logistics_admin') then array[
      'people_lookup','groups_view','checkin_record','headcount_view','headcount_record',
      'registration_view','registration_manage','identity_manage','arrival_manage',
      'staff_view','staff_manage','housing_view','housing_manage','housing_export',
      'food_view','food_manage','food_export','wellness_status','wellness_private','wellness_manage',
      'inclusion_view','facilities_view','materials_view','financial_view','publicity_view',
      'reports_export','access_admin'
    ]::text[]
    when aa.role='coordinator' then array[
      'people_lookup','groups_view','checkin_record','headcount_view','headcount_record',
      'registration_view','registration_manage','identity_manage','arrival_manage',
      'staff_view','staff_manage','housing_view','housing_manage','housing_export',
      'food_view','food_manage','food_export','wellness_status','wellness_private','wellness_manage',
      'inclusion_view','facilities_view','materials_view','financial_view','publicity_view',
      'reports_export'
    ]::text[]
    when aa.role='assistant_coordinator' then array['people_lookup','groups_view','checkin_record','headcount_view','headcount_record']::text[]
    else '{}'::text[] end) capability
  from public.access_assignments aa,subject s
  where aa.session_id=target_session and aa.user_id=s.user_id and aa.active
), explicit_caps as (
  select unnest(aa.capabilities) capability
  from public.access_assignments aa,subject s
  where aa.session_id=target_session and aa.user_id=s.user_id and aa.active
), team_caps as (
  select unnest(ot.capabilities) capability
  from public.team_memberships tm
  join public.operational_teams ot on ot.id=tm.team_id
  join subject s on s.user_id=tm.user_id
  where tm.session_id=target_session and tm.active and ot.active
)
select coalesce(array_agg(distinct capability order by capability),'{}'::text[])
from (select capability from base union all select capability from explicit_caps union all select capability from team_caps) caps
where capability is not null;
$$;

create or replace function private.can_manage_access(target_session uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.access_assignments aa
    where aa.session_id=target_session
      and aa.user_id=(select auth.uid())
      and aa.active
      and (
        aa.role in ('logistics_admin','session_director')
        or (aa.role='coordinator' and 'access_admin'=any(coalesce(aa.capabilities,'{}'::text[])))
      )
  );
$$;

create or replace function private.is_top_access_admin(target_session uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.access_assignments aa
    where aa.session_id=target_session
      and aa.user_id=(select auth.uid())
      and aa.active
      and aa.role in ('logistics_admin','session_director')
  );
$$;

-- People lookup stays company-scoped for Assistant Coordinators even though the identity RPC is SECURITY DEFINER.
create or replace function public.get_participant_operational_identity(p_session_id uuid)
returns table(
  participant_id uuid, fsy_id text, badge_name text, badge_state text, needs_reprint boolean,
  slot_number integer, origin_code text, company_id uuid, company_name text, group_id uuid, group_name text,
  attendance_status text, source_kind text, verification_status text, is_current boolean,
  stake_name text, unit_name text, checkin_status text, sex text, full_name text, preferred_name text,
  name_review_required boolean
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare caller_role public.app_role;
begin
  select aa.role into caller_role
  from public.access_assignments aa
  where aa.session_id=p_session_id and aa.user_id=(select auth.uid()) and aa.active
  limit 1;

  if not (
    private.has_capability(p_session_id,'people_lookup')
    or private.has_capability(p_session_id,'registration_view')
    or private.has_capability(p_session_id,'reports_export')
  ) then raise exception 'Your account cannot view participant operational identity'; end if;

  return query
  select p.id,b.fsy_id,b.badge_name,b.state,b.needs_reprint,b.slot_number,b.origin_code,
    c.id,c.name,g.id,g.name,coalesce(p.attendance_status,'expected'),p.source_kind,p.verification_status,p.is_current,
    p.stake_name,p.unit_name,ci.status::text,p.sex::text,
    trim(concat_ws(' ',p.first_name,p.last_name)),p.preferred_name,
    case
      when nullif(trim(coalesce(p.preferred_name,'')),'') is null then false
      when lower(trim(p.preferred_name))=lower(trim(p.first_name)) then false
      when lower(trim(p.preferred_name))=lower(trim(concat_ws(' ',p.first_name,p.last_name))) then false
      else true
    end
  from public.participants p
  left join public.participant_badge_assignments b on b.participant_id=p.id and b.session_id=p.session_id and b.state<>'retired'
  left join public.counselor_groups g on g.id=coalesce(b.group_id,p.group_id)
  left join public.companies c on c.id=coalesce(b.company_id,g.company_id)
  left join public.check_ins ci on ci.session_id=p.session_id and ci.participant_id=p.id
  where p.session_id=p_session_id
    and (
      caller_role is distinct from 'assistant_coordinator'::public.app_role
      or (g.company_id is not null and private.can_access_company(p_session_id,g.company_id))
    )
  order by c.operational_number nulls last,b.slot_number nulls last,lower(p.last_name),lower(p.first_name),p.id;
end;
$$;

-- Registration committee capability is session-wide; Assistant Coordinator capability remains company-scoped.
create or replace function public.record_participant_checkin(p_session_id uuid,p_participant_id uuid,p_status public.check_in_status,p_note text default null)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare caller_role public.app_role; participant_company uuid;
begin
  select aa.role into caller_role
  from public.access_assignments aa
  where aa.session_id=p_session_id and aa.user_id=(select auth.uid()) and aa.active
  limit 1;

  select g.company_id into participant_company
  from public.participants p
  left join public.counselor_groups g on g.id=p.group_id
  where p.id=p_participant_id and p.session_id=p_session_id;

  if caller_role='assistant_coordinator' then
    if participant_company is null or not private.can_access_company(p_session_id,participant_company) then
      raise exception 'Your account cannot record check-in outside your assigned companies';
    end if;
  elsif not private.has_capability(p_session_id,'checkin_record') then
    raise exception 'Your account cannot record check-in for this participant';
  end if;

  if not private.operational_participant_is_eligible(p_session_id,p_participant_id) then
    raise exception 'This record is outside the current youth operational eligibility rules';
  end if;
  if exists(select 1 from public.counselor_groups g where g.session_id=p_session_id and g.state='published')
     and not exists(select 1 from public.participants p where p.id=p_participant_id and p.session_id=p_session_id and p.group_id is not null) then
    raise exception 'Participant still needs a counselor group assignment';
  end if;

  insert into public.check_ins(session_id,participant_id,status,note,recorded_by,recorded_at)
  values(p_session_id,p_participant_id,p_status,nullif(trim(coalesce(p_note,'')),''),(select auth.uid()),now())
  on conflict(session_id,participant_id) do update
    set status=excluded.status,note=excluded.note,recorded_by=excluded.recorded_by,recorded_at=excluded.recorded_at;
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_session_id,(select auth.uid()),'participant_checkin_recorded','participant',p_participant_id::text,jsonb_build_object('status',p_status));
end;
$$;

-- A no-show cannot be created accidentally or without an auditable confirmation source.
create or replace function public.set_participant_arrival_status(p_participant_id uuid,p_status text,p_note text default null)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare target public.participants%rowtype; caller_role public.app_role; target_company uuid;
begin
  select * into target from public.participants where id=p_participant_id for update;
  if target.id is null then raise exception 'Participant not found'; end if;
  if not private.has_capability(target.session_id,'registration_manage') then raise exception 'Registration management access required'; end if;
  if p_status not in ('expected','expected_later','unknown','confirmed_not_attending') then raise exception 'Invalid arrival status'; end if;
  if p_status='confirmed_not_attending' and nullif(trim(coalesce(p_note,'')),'') is null then
    raise exception 'Record how the no-show was confirmed before making the roster place available';
  end if;
  if p_status='confirmed_not_attending' and exists(
    select 1 from public.check_ins ci where ci.session_id=target.session_id and ci.participant_id=target.id and ci.status::text='arrived'
  ) then raise exception 'A participant who already checked in cannot be marked not attending'; end if;

  select aa.role into caller_role
  from public.access_assignments aa
  where aa.session_id=target.session_id and aa.user_id=(select auth.uid()) and aa.active
  limit 1;
  if caller_role='assistant_coordinator' then
    select g.company_id into target_company from public.counselor_groups g where g.id=target.group_id;
    if target_company is null or not private.can_access_company(target.session_id,target_company) then
      raise exception 'Your account cannot change arrival status outside your assigned companies';
    end if;
  end if;

  update public.participants
  set attendance_status=p_status,
      attendance_note=nullif(trim(coalesce(p_note,'')),''),
      attendance_updated_by=(select auth.uid()),
      attendance_updated_at=now(),
      updated_at=now()
  where id=target.id;
  insert into public.participant_arrival_events(session_id,participant_id,status,note,recorded_by)
  values(target.session_id,target.id,p_status,nullif(trim(coalesce(p_note,'')),''),(select auth.uid()));
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(target.session_id,(select auth.uid()),'participant_arrival_status_updated','participant',target.id::text,
    jsonb_build_object('status',p_status,'note',nullif(trim(coalesce(p_note,'')),'')));
end;
$$;

-- Replacements must preserve the same group integrity rules as normal participant assignment.
create or replace function public.replace_arrival_vacancy(p_absent_participant_id uuid,p_new_participant_id uuid)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  absent public.participants%rowtype;
  newcomer public.participants%rowtype;
  old_badge public.participant_badge_assignments%rowtype;
  target_group public.counselor_groups%rowtype;
  target_company public.companies%rowtype;
  newcomer_origin text;
  new_fsy_id text;
  avoid_units boolean;
  caller_role public.app_role;
begin
  select * into absent from public.participants where id=p_absent_participant_id for update;
  select * into newcomer from public.participants where id=p_new_participant_id for update;
  if absent.id is null or newcomer.id is null then raise exception 'Participant not found'; end if;
  if absent.session_id<>newcomer.session_id then raise exception 'Participants must belong to the same session'; end if;
  if not private.has_capability(absent.session_id,'registration_manage') then raise exception 'Registration management access required'; end if;
  if absent.attendance_status<>'confirmed_not_attending' then raise exception 'The original participant must first be confirmed not attending'; end if;
  if exists(select 1 from public.check_ins ci where ci.session_id=absent.session_id and ci.participant_id=absent.id and ci.status::text='arrived') then
    raise exception 'A participant who already checked in cannot be replaced';
  end if;
  if newcomer.source_kind<>'on_site' or newcomer.verification_status<>'verified' or not newcomer.is_current then raise exception 'Choose a verified on-site participant'; end if;
  if newcomer.attendance_status='confirmed_not_attending' then raise exception 'The replacement participant is marked not attending'; end if;
  if not private.operational_participant_is_eligible(newcomer.session_id,newcomer.id) then raise exception 'The on-site participant is not operationally eligible'; end if;
  if newcomer.group_id is not null then raise exception 'The on-site participant is already assigned to a counselor group'; end if;

  select * into old_badge from public.participant_badge_assignments
  where participant_id=absent.id and state<>'retired' for update;
  if old_badge.id is null then raise exception 'The absent participant does not have an active roster slot'; end if;
  select * into target_group from public.counselor_groups where id=old_badge.group_id;
  select * into target_company from public.companies where id=old_badge.company_id;
  if target_group.id is null or target_company.id is null then raise exception 'The roster slot is missing its company or counselor group'; end if;
  if newcomer.sex<>target_group.sex then raise exception 'The replacement participant must match the counselor group sex'; end if;

  select aa.role into caller_role
  from public.access_assignments aa
  where aa.session_id=absent.session_id and aa.user_id=(select auth.uid()) and aa.active
  limit 1;
  if caller_role='assistant_coordinator' and not private.can_access_company(absent.session_id,old_badge.company_id) then
    raise exception 'Your account cannot fill a vacancy outside your assigned companies';
  end if;

  select avoid_same_unit into avoid_units
  from public.session_structure_settings where session_id=absent.session_id;
  avoid_units:=coalesce(avoid_units,true);
  if avoid_units and nullif(trim(coalesce(newcomer.unit_name,'')),'') is not null and exists(
    select 1
    from public.participants peer
    where peer.group_id=old_badge.group_id
      and peer.id<>absent.id
      and peer.id<>newcomer.id
      and private.operational_participant_is_eligible(absent.session_id,peer.id)
      and lower(trim(coalesce(peer.unit_name,'')))=lower(trim(newcomer.unit_name))
  ) then raise exception 'This counselor group already contains someone from the same unit'; end if;

  newcomer_origin:=private.origin_code_for_participant(newcomer);
  if newcomer_origin is null then raise exception 'The on-site participant needs a recognized Stake, District, or Mission before replacement'; end if;
  if coalesce(target_company.operational_number,nullif(regexp_replace(target_company.name,'\D','','g'),'')::integer) is null then
    raise exception 'The target company needs an operational number before a replacement ID can be issued';
  end if;
  new_fsy_id:=newcomer_origin||'-C'||lpad(coalesce(target_company.operational_number,nullif(regexp_replace(target_company.name,'\D','','g'),'')::integer)::text,2,'0')||'-'||lpad(old_badge.slot_number::text,2,'0');

  update public.participant_badge_assignments
  set state='retired',retired_by=(select auth.uid()),retired_at=now(),note='Retired when roster slot was filled by an on-site participant'
  where id=old_badge.id;
  update public.participants
  set group_id=null,attendance_status='confirmed_not_attending',updated_at=now()
  where id=absent.id;
  update public.participants
  set group_id=old_badge.group_id,attendance_status='expected',attendance_note=null,
      attendance_updated_by=(select auth.uid()),attendance_updated_at=now(),updated_at=now()
  where id=newcomer.id;

  insert into public.participant_badge_assignments(
    session_id,participant_id,company_id,group_id,slot_number,origin_code,fsy_id,badge_name,state,
    replacement_for,assigned_by,finalized_by,finalized_at
  ) values(
    newcomer.session_id,newcomer.id,old_badge.company_id,old_badge.group_id,old_badge.slot_number,
    newcomer_origin,new_fsy_id,trim(concat_ws(' ',newcomer.first_name,newcomer.last_name)),'finalized',
    old_badge.id,(select auth.uid()),(select auth.uid()),now()
  );

  insert into public.participant_arrival_events(session_id,participant_id,status,note,recorded_by)
  values(absent.session_id,absent.id,'replaced','Roster slot filled by on-site participant',(select auth.uid()));
  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(absent.session_id,(select auth.uid()),'arrival_vacancy_replaced','participant',newcomer.id::text,
    jsonb_build_object('replaced_participant_id',absent.id,'company_id',old_badge.company_id,'group_id',old_badge.group_id,'slot_number',old_badge.slot_number,'fsy_id',new_fsy_id));
  return new_fsy_id;
end;
$$;
