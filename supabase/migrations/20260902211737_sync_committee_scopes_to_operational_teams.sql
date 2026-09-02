create or replace function private.sync_access_assignment_teams()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if not new.active then return new; end if;
  insert into public.team_memberships(session_id,team_id,user_id,active,assigned_by)
  select new.session_id,ot.id,new.user_id,true,null::uuid
  from public.operational_teams ot
  where ot.session_id=new.session_id and ot.active
    and exists (
      select 1 from unnest(coalesce(new.committee_scope,'{}'::text[])) scope_name
      where lower(trim(scope_name)) in (lower(ot.display_name),lower(ot.team_key),lower(coalesce(ot.preset_key,'')))
    )
  on conflict(session_id,team_id,user_id)
  do update set active=true,updated_at=now();
  return new;
end;
$$;

drop trigger if exists access_assignments_sync_teams on public.access_assignments;
create trigger access_assignments_sync_teams
after insert or update of committee_scope,active on public.access_assignments
for each row execute function private.sync_access_assignment_teams();
revoke all on function private.sync_access_assignment_teams() from public;