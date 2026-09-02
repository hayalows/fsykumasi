drop policy if exists "scoped company visibility" on public.companies;
create policy "scoped company visibility" on public.companies
for select to authenticated
using (
  private.has_session_wide_visibility(session_id)
  or private.can_access_company(session_id, id)
  or private.has_team_capability(session_id, 'groups_view')
);