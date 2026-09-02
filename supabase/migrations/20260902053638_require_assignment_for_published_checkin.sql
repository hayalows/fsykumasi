create or replace function public.record_participant_checkin(
  p_session_id uuid,
  p_participant_id uuid,
  p_status public.check_in_status,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_session_role(p_session_id, array['coordinator','logistics_admin','session_director']::public.app_role[]) then
    raise exception 'Your role cannot record check-in';
  end if;
  if not exists (
    select 1 from public.participants p where p.id = p_participant_id
      and p.session_id = p_session_id and p.is_current
      and p.registration_status = 'approved' and p.verification_status = 'verified'
      and (
        p.group_id is not null
        or not exists (
          select 1 from public.counselor_groups g
          where g.session_id = p_session_id and g.state = 'published'
        )
      )
  ) then raise exception 'Participant is not currently eligible for check-in or still needs a group assignment'; end if;
  insert into public.check_ins(session_id, participant_id, status, note, recorded_by, recorded_at)
  values (p_session_id, p_participant_id, p_status, nullif(trim(coalesce(p_note, '')), ''), (select auth.uid()), now())
  on conflict (session_id, participant_id) do update set
    status = excluded.status, note = excluded.note, recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at;
  insert into public.audit_events(session_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_session_id, (select auth.uid()), 'participant_checkin_recorded', 'participant', p_participant_id::text,
    jsonb_build_object('status', p_status));
end;
$$;

revoke all on function public.record_participant_checkin(uuid,uuid,public.check_in_status,text) from public, anon;
grant execute on function public.record_participant_checkin(uuid,uuid,public.check_in_status,text) to authenticated;
