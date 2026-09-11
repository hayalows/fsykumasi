-- Deliberate participant membership confirmation and reversible first check-in.
-- This is additive to v53 so already-deployed clients remain compatible.

alter table public.participant_membership_profiles
  add column if not exists created_checkin_recorded_at timestamptz;

-- v53 created membership immediately before recording arrival in the same transaction.
-- Link only obvious existing pairs so the one already-recorded check-in can be safely undone.
update public.participant_membership_profiles m
set created_checkin_recorded_at = c.recorded_at
from public.check_ins c
where c.session_id = m.session_id
  and c.participant_id = m.participant_id
  and c.status = 'arrived'
  and m.created_checkin_recorded_at is null
  and m.recorded_by is not distinct from c.recorded_by
  and abs(extract(epoch from (c.recorded_at - m.recorded_at))) <= 5;

create or replace function public.record_participant_checkin_with_membership_v2(
  p_session_id uuid,
  p_participant_id uuid,
  p_membership_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  participant_company uuid;
  inserted_count integer := 0;
  checkin_at timestamptz;
  membership_created boolean := false;
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
    membership_created := inserted_count > 0;

    if membership_created then
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

  perform public.record_participant_checkin(
    p_session_id,
    p_participant_id,
    'arrived'::public.check_in_status,
    null
  );

  select c.recorded_at into checkin_at
  from public.check_ins c
  where c.session_id = p_session_id
    and c.participant_id = p_participant_id;

  if membership_created then
    update public.participant_membership_profiles
    set created_checkin_recorded_at = checkin_at,
        updated_at = now()
    where participant_id = p_participant_id
      and session_id = p_session_id;
  end if;

  return jsonb_build_object(
    'participant_id', p_participant_id,
    'status', 'arrived',
    'recorded_at', checkin_at,
    'membership_created', membership_created
  );
end;
$$;

revoke all on function public.record_participant_checkin_with_membership_v2(uuid, uuid, text) from public, anon;
grant execute on function public.record_participant_checkin_with_membership_v2(uuid, uuid, text) to authenticated;

create or replace function public.undo_participant_checkin_with_membership_v2(
  p_session_id uuid,
  p_participant_id uuid,
  p_expected_recorded_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_recorded_at timestamptz;
  captured_membership_status text;
  undo_result jsonb;
  membership_reverted boolean := false;
begin
  select c.recorded_at into current_recorded_at
  from public.check_ins c
  where c.session_id = p_session_id
    and c.participant_id = p_participant_id
  for update;

  if current_recorded_at is not null then
    select m.membership_status into captured_membership_status
    from public.participant_membership_profiles m
    where m.session_id = p_session_id
      and m.participant_id = p_participant_id
      and m.created_checkin_recorded_at is not distinct from current_recorded_at;
  end if;

  undo_result := public.undo_participant_checkin(
    p_session_id,
    p_participant_id,
    p_expected_recorded_at
  );

  if coalesce((undo_result ->> 'undone')::boolean, false)
     and captured_membership_status is not null then
    delete from public.participant_membership_profiles m
    where m.session_id = p_session_id
      and m.participant_id = p_participant_id
      and m.created_checkin_recorded_at is not distinct from current_recorded_at;

    membership_reverted := found;

    if membership_reverted then
      insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
      values (
        p_session_id,
        (select auth.uid()),
        'participant_membership_status_reverted',
        'participant',
        p_participant_id::text,
        jsonb_build_object(
          'membership_status', captured_membership_status,
          'checkin_recorded_at', current_recorded_at,
          'source', 'checkin_undo'
        )
      );
    end if;
  end if;

  return coalesce(undo_result, '{}'::jsonb) || jsonb_build_object(
    'membership_reverted', membership_reverted
  );
end;
$$;

revoke all on function public.undo_participant_checkin_with_membership_v2(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.undo_participant_checkin_with_membership_v2(uuid, uuid, timestamptz) to authenticated;
