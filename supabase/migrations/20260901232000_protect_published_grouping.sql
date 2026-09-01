-- Participant imports after publication can silently invalidate unit diversity,
-- sex separation, company totals, and head-count expectations. Require leaders
-- to finalize the roster before publishing groups.

create or replace function private.prevent_import_after_grouping()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session uuid;
begin
  target_session := new.session_id;

  if exists (
    select 1 from public.counselor_groups g
    where g.session_id = target_session and g.state = 'published'
  ) and (
    tg_op = 'INSERT'
    or new.import_batch_id is distinct from old.import_batch_id
  ) then
    raise exception 'Participant imports are locked after groups are published';
  end if;

  return new;
end;
$$;

revoke all on function private.prevent_import_after_grouping() from public, anon, authenticated;

drop trigger if exists participants_lock_import_after_grouping on public.participants;
create trigger participants_lock_import_after_grouping
  before insert or update on public.participants
  for each row execute function private.prevent_import_after_grouping();
