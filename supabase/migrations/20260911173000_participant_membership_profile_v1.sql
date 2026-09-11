-- Participant membership profile v1.
-- This is participant-only religious-status data used at Registration & Check-in.
-- Store the minimum category needed for FSY operations. Do not infer it from ward,
-- surname, registration history, Church account presence, or other proxies.

create table if not exists public.participant_membership_profiles (
  participant_id uuid primary key references public.participants(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  membership_status text not null default 'unconfirmed'
    check (membership_status in ('non_member','recent_convert','member_12_plus','unconfirmed')),
  verification_source text not null default 'not_recorded'
    check (verification_source in ('participant_or_guardian','unit_or_stake_leader','registration_record','checkin_confirmation','not_recorded')),
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id, participant_id)
);

create index if not exists participant_membership_profiles_session_status_idx
  on public.participant_membership_profiles(session_id, membership_status);

alter table public.participant_membership_profiles enable row level security;
revoke all on table public.participant_membership_profiles from public, anon, authenticated;

create or replace function private.can_read_participant_membership(target_session uuid, target_participant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.has_capability(target_session,'registration_view')
    or private.has_capability(target_session,'registration_manage')
    or private.has_capability(target_session,'reports_export')
    or (
      private.has_capability(target_session,'checkin_record')
      and exists (
        select 1
        from public.participants p
        join public.counselor_groups g on g.id = p.group_id and g.session_id = p.session_id
        where p.id = target_participant
          and p.session_id = target_session
          and private.can_access_company(target_session,g.company_id)
      )
    );
$$;

revoke all on function private.can_read_participant_membership(uuid,uuid) from public, anon, authenticated;

create or replace function public.get_participant_membership_statuses(p_session_id uuid)
returns table(
  participant_id uuid,
  membership_status text,
  verification_source text,
  verified_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    coalesce(m.membership_status,'unconfirmed') as membership_status,
    coalesce(m.verification_source,'not_recorded') as verification_source,
    m.verified_at
  from public.participants p
  left join public.participant_membership_profiles m
    on m.participant_id = p.id and m.session_id = p.session_id
  where p.session_id = p_session_id
    and private.can_read_participant_membership(p_session_id,p.id)
  order by p.id;
$$;

create or replace function public.set_participant_membership_status(
  p_participant_id uuid,
  p_membership_status text,
  p_verification_source text default 'checkin_confirmation'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.participants%rowtype;
  normalized_status text := lower(trim(coalesce(p_membership_status,'')));
  normalized_source text := lower(trim(coalesce(p_verification_source,'')));
  scoped_checkin_access boolean := false;
begin
  select * into target
  from public.participants
  where id = p_participant_id;

  if target.id is null then
    raise exception 'Participant not found';
  end if;

  if normalized_status not in ('non_member','recent_convert','member_12_plus','unconfirmed') then
    raise exception 'Choose a valid participant membership status';
  end if;

  if normalized_status = 'unconfirmed' then
    normalized_source := 'not_recorded';
  elsif normalized_source not in ('participant_or_guardian','unit_or_stake_leader','registration_record','checkin_confirmation') then
    raise exception 'Choose how this participant membership status was confirmed';
  end if;

  if target.group_id is not null and private.has_capability(target.session_id,'checkin_record') then
    select exists (
      select 1
      from public.counselor_groups g
      where g.id = target.group_id
        and g.session_id = target.session_id
        and private.can_access_company(target.session_id,g.company_id)
    ) into scoped_checkin_access;
  end if;

  if not private.has_capability(target.session_id,'registration_manage') and not scoped_checkin_access then
    raise exception 'Registration or assigned check-in access required';
  end if;

  insert into public.participant_membership_profiles(
    participant_id, session_id, membership_status, verification_source,
    verified_by, verified_at, created_at, updated_at
  ) values (
    target.id, target.session_id, normalized_status, normalized_source,
    case when normalized_status='unconfirmed' then null else (select auth.uid()) end,
    case when normalized_status='unconfirmed' then null else now() end,
    now(), now()
  )
  on conflict(participant_id) do update set
    session_id = excluded.session_id,
    membership_status = excluded.membership_status,
    verification_source = excluded.verification_source,
    verified_by = excluded.verified_by,
    verified_at = excluded.verified_at,
    updated_at = now();

  insert into public.audit_events(session_id,actor_id,action,entity_type,entity_id,metadata)
  values(
    target.session_id,
    (select auth.uid()),
    'participant_membership_status_updated',
    'participant',
    target.id::text,
    jsonb_build_object('membership_status',normalized_status,'verification_source',normalized_source)
  );
end;
$$;

create or replace function public.get_participant_membership_summary(p_session_id uuid)
returns table(
  membership_status text,
  roster_count integer,
  checked_in_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with statuses(status, ordinal) as (
    values
      ('non_member'::text,1),
      ('recent_convert'::text,2),
      ('member_12_plus'::text,3),
      ('unconfirmed'::text,4)
  ), visible_participants as (
    select
      p.id,
      coalesce(m.membership_status,'unconfirmed') as membership_status,
      case when ci.status::text = 'arrived' then 1 else 0 end as checked_in
    from public.participants p
    left join public.participant_membership_profiles m
      on m.participant_id = p.id and m.session_id = p.session_id
    left join public.check_ins ci
      on ci.session_id = p.session_id and ci.participant_id = p.id
    where p.session_id = p_session_id
      and p.is_current
      and p.registration_status <> 'cancelled'
      and private.can_read_participant_membership(p_session_id,p.id)
  )
  select
    s.status,
    count(v.id)::integer as roster_count,
    coalesce(sum(v.checked_in),0)::integer as checked_in_count
  from statuses s
  left join visible_participants v on v.membership_status = s.status
  group by s.status,s.ordinal
  order by s.ordinal;
$$;

revoke all on function public.get_participant_membership_statuses(uuid) from public, anon;
revoke all on function public.set_participant_membership_status(uuid,text,text) from public, anon;
revoke all on function public.get_participant_membership_summary(uuid) from public, anon;
grant execute on function public.get_participant_membership_statuses(uuid) to authenticated;
grant execute on function public.set_participant_membership_status(uuid,text,text) to authenticated;
grant execute on function public.get_participant_membership_summary(uuid) to authenticated;
