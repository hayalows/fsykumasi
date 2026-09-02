-- The legacy participant-only importer cannot represent the official mixed
-- registration export and must not remain an alternate production write path.
revoke execute on function public.apply_participant_import(uuid,text,jsonb) from authenticated;

create index if not exists participants_last_seen_batch_id_idx on public.participants(last_seen_batch_id);
create index if not exists participants_verified_by_idx on public.participants(verified_by);
create index if not exists staff_last_seen_batch_id_idx on public.staff(last_seen_batch_id);
create index if not exists participant_private_session_id_idx on public.participant_private_details(session_id);
create index if not exists staff_private_session_id_idx on public.staff_private_details(session_id);
create index if not exists birthday_acknowledgements_participant_id_idx on public.birthday_acknowledgements(participant_id);
create index if not exists birthday_acknowledgements_acknowledged_by_idx on public.birthday_acknowledgements(acknowledged_by);
