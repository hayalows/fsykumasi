-- Whole-session pre-session authority for the final roster.
-- This does not change source registration values or website Access approval rules.

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
declare p public.participants%rowtype;
begin
  select * into p from public.participants where id=p_participant_id for update;
  if p.id is null or not private.has_session_role(
    p.session_id,
    array['logistics_admin','session_director']::public.app_role[]
  ) then
    raise exception 'Whole-session leadership access is required to record participant final-roster decisions';
  end if;
  if length(trim(coalesce(p_authority,'')))<3 or length(trim(coalesce(p_reason,'')))<5 then
    raise exception 'Record the confirming authority and reason';
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
  if not p_allow and (
    p.group_id is not null
    or exists(select 1 from public.housing_assignments h where h.participant_id=p.id and h.active)
    or exists(select 1 from public.check_ins c where c.session_id=p.session_id and c.participant_id=p.id and c.status='arrived')
  ) then
    raise exception 'This participant already has live placement, Housing or arrival work. Use the operational status action instead';
  end if;

  insert into public.participant_operation_decisions(
    participant_id,cohort_state,registration_confirmed,guardian_confirmed,leadership_confirmed,
    authority,reason,recorded_by
  ) values(
    p.id,case when p_allow then 'exception' else 'excluded' end,
    p_registration_confirmed,p_guardian_confirmed,p_leadership_confirmed,
    p_authority,p_reason,(select auth.uid())
  )
  on conflict(participant_id) do update set
    cohort_state=excluded.cohort_state,
    registration_confirmed=excluded.registration_confirmed,
    guardian_confirmed=excluded.guardian_confirmed,
    leadership_confirmed=excluded.leadership_confirmed,
    authority=excluded.authority,
    reason=excluded.reason,
    recorded_by=(select auth.uid()),
    recorded_at=now(),
    revision=public.participant_operation_decisions.revision+1;

  if p_allow then
    update public.participants set is_current=true,attendance_status='expected',updated_at=now() where id=p.id;
  end if;

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(p.session_id,(select auth.uid()),'participant_exception_recorded','participant',p.id::text,
    jsonb_build_object('allowed',p_allow,'authority',p_authority,'reason',p_reason,
      'registration',p_registration_confirmed,'guardian',p_guardian_confirmed,'leadership',p_leadership_confirmed));
end;
$$;

create or replace function public.update_staff_operations(
  p_staff_id uuid,
  p_revision integer,
  p_planning text,
  p_arrival text,
  p_clearance text,
  p_authority text default '',
  p_reason text default '',
  p_duties text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare s public.staff%rowtype; old public.staff_operations%rowtype; result public.staff_operations%rowtype;
begin
  select * into s from public.staff where id=p_staff_id;
  if s.id is null or not private.has_capability(s.session_id,'staff_manage') then
    raise exception 'Staff management access is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(s.session_id::text,26));
  select * into old from public.staff_operations where staff_id=s.id for update;
  if old.revision is distinct from p_revision then
    raise exception 'Staff record changed. Refresh and review again.';
  end if;
  if p_clearance is distinct from old.service_clearance then
    if not private.has_session_role(
      s.session_id,
      array['logistics_admin','session_director']::public.app_role[]
    ) then
      raise exception 'Whole-session leadership is required to record Ready to serve';
    end if;
    if length(trim(coalesce(p_authority,'')))<3 or length(trim(coalesce(p_reason,'')))<5 then
      raise exception 'Record the confirming authority and reason';
    end if;
  end if;
  if p_arrival in ('no_show','left') and p_arrival is distinct from old.arrival_state and length(trim(coalesce(p_reason,'')))<5 then
    raise exception 'Record a reason for this presence change';
  end if;
  if p_duties is not null and cardinality(p_duties)>12 then raise exception 'Too many committee duties'; end if;

  update public.staff_operations
  set planning_state=p_planning,arrival_state=p_arrival,service_clearance=p_clearance,
      revision=revision+1,updated_by=(select auth.uid()),updated_at=now()
  where staff_id=s.id returning * into result;

  if p_duties is not null then
    delete from public.staff_committee_duties where staff_id=s.id;
    insert into public.staff_committee_duties(staff_id,duty,assigned_by)
    select s.id,trim(value),(select auth.uid()) from unnest(p_duties) value where trim(value)<>''
    on conflict do nothing;
  end if;

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(s.session_id,(select auth.uid()),'staff_operations_updated','staff',s.id::text,
    jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(result),'authority',p_authority,'reason',p_reason,'duties',p_duties));
  return to_jsonb(result);
end;
$$;
