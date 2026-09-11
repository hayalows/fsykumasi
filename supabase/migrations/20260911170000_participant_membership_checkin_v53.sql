-- Participant-only membership classification at first check-in.
-- Staff are deliberately excluded from this model.
-- Store only the operational category needed for FSY reporting; no baptism date is retained.

create table if not exists public.participant_membership_profiles (
  participant_id uuid primary key references public.participants(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  membership_status text not null,
  recorded_by uuid references public.profiles(user_id) on delete set null,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint participant_membership_profiles_status_check check (
    membership_status in ('member_12_plus','recent_convert','non_member','not_sure')
  )
);

create index if not exists participant_membership_profiles_session_idx
  on public.participant_membership_profiles(session_id, membership_status);

alter table public.participant_membership_profiles enable row level security;
revoke all on public.participant_membership_profiles from public, anon, authenticated;

-- The existing record_participant_checkin RPC is intentionally left unchanged.
-- That keeps already-deployed clients safe during rollout. The membership-aware
-- client uses this RPC for arrivals. Passing null means "use the saved category";
-- if no category exists, the server asks the UI to collect it first.
create or replace function public.record_participant_checkin_with_membership(
  p_session_id uuid,
  p_participant_id uuid,
  p_membership_status text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  participant_company uuid;
  inserted_count integer := 0;
begin
  if p_membership_status is not null
     and p_membership_status not in ('member_12_plus','recent_convert','non_member','not_sure') then
    raise exception 'Choose a valid membership status';
  end if;

  select g.company_id into participant_company
  from public.participants p
  left join public.counselor_groups g on g.id = p.group_id
  where p.id = p_participant_id and p.session_id = p_session_id
  for update of p;

  if not found then
    raise exception 'Participant not found in this session';
  end if;

  if not (
    private.has_capability(p_session_id, 'checkin_record')
    or (participant_company is not null and private.can_access_company(p_session_id, participant_company))
  ) then
    raise exception 'Check-in access required';
  end if;

  if p_membership_status is null then
    if not exists (
      select 1
      from public.participant_membership_profiles m
      where m.participant_id = p_participant_id
        and m.session_id = p_session_id
    ) then
      raise exception 'PARTICIPANT_MEMBERSHIP_STATUS_REQUIRED';
    end if;
  else
    insert into public.participant_membership_profiles(
      participant_id, session_id, membership_status, recorded_by, recorded_at, updated_at
    ) values (
      p_participant_id, p_session_id, p_membership_status, (select auth.uid()), now(), now()
    )
    on conflict (participant_id) do nothing;

    get diagnostics inserted_count = row_count;

    if inserted_count > 0 then
      insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
      values (
        p_session_id,
        (select auth.uid()),
        'participant_membership_status_recorded',
        'participant',
        p_participant_id::text,
        jsonb_build_object('membership_status', p_membership_status, 'source', 'checkin')
      );
    end if;
  end if;

  -- Membership capture and arrival remain one transaction. The established
  -- check-in RPC retains all eligibility, published-group and audit safeguards.
  perform public.record_participant_checkin(
    p_session_id,
    p_participant_id,
    'arrived'::public.check_in_status,
    null
  );
end;
$$;

revoke all on function public.record_participant_checkin_with_membership(uuid, uuid, text) from public, anon;
grant execute on function public.record_participant_checkin_with_membership(uuid, uuid, text) to authenticated;

-- Restricted end-of-program report. It includes checked-in participants only,
-- never staff, and surfaces legacy/missing capture explicitly rather than
-- guessing a religious status.
create or replace function public.get_participant_membership_report(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  generated_by_name text;
  report_rows jsonb := '[]'::jsonb;
  member_count integer := 0;
  recent_convert_count integer := 0;
  non_member_count integer := 0;
  not_sure_count integer := 0;
  not_captured_count integer := 0;
  checked_in_count integer := 0;
begin
  if not private.has_capability(p_session_id, 'reports_export') then
    raise exception 'Report export access required';
  end if;

  select coalesce(nullif(pr.display_name, ''), nullif(pr.email, ''), 'FSY leader')
  into generated_by_name
  from public.profiles pr
  where pr.user_id = (select auth.uid());
  generated_by_name := coalesce(generated_by_name, 'FSY leader');

  select coalesce(jsonb_agg(to_jsonb(q) order by q.full_name), '[]'::jsonb)
  into report_rows
  from (
    select
      r.participant_id,
      r.fsy_id,
      r.full_name,
      r.stake_name as origin,
      r.unit_name as unit,
      r.company_name as company,
      r.group_name as counselor_group,
      case m.membership_status
        when 'member_12_plus' then 'Member · 12+ months'
        when 'recent_convert' then 'Recent convert'
        when 'non_member' then 'Non-member'
        when 'not_sure' then 'Not sure'
        else 'Not captured'
      end as membership_status,
      m.recorded_at as captured_at
    from private.participant_report_rows(p_session_id) r
    left join public.participant_membership_profiles m
      on m.participant_id = r.participant_id and m.session_id = p_session_id
    where r.checkin_status = 'arrived'
  ) q;

  select
    count(*)::integer,
    count(*) filter (where m.membership_status = 'member_12_plus')::integer,
    count(*) filter (where m.membership_status = 'recent_convert')::integer,
    count(*) filter (where m.membership_status = 'non_member')::integer,
    count(*) filter (where m.membership_status = 'not_sure')::integer,
    count(*) filter (where m.participant_id is null)::integer
  into checked_in_count, member_count, recent_convert_count, non_member_count, not_sure_count, not_captured_count
  from private.participant_report_rows(p_session_id) r
  left join public.participant_membership_profiles m
    on m.participant_id = r.participant_id and m.session_id = p_session_id
  where r.checkin_status = 'arrived';

  return jsonb_build_object(
    'key', 'participant_membership',
    'title', 'Participant Membership Summary',
    'generated_at', now(),
    'generated_by', generated_by_name,
    'scope', 'Checked-in participants only · staff excluded',
    'rows', report_rows,
    'summary', jsonb_build_object(
      'checked_in', checked_in_count,
      'membership', jsonb_build_array(
        jsonb_build_object('key','member_12_plus','label','Member · 12+ months','count',member_count),
        jsonb_build_object('key','recent_convert','label','Recent convert','count',recent_convert_count),
        jsonb_build_object('key','non_member','label','Non-member','count',non_member_count),
        jsonb_build_object('key','not_sure','label','Not sure','count',not_sure_count),
        jsonb_build_object('key','not_captured','label','Not captured','count',not_captured_count)
      )
    )
  );
end;
$$;

revoke all on function public.get_participant_membership_report(uuid) from public, anon;
grant execute on function public.get_participant_membership_report(uuid) to authenticated;
