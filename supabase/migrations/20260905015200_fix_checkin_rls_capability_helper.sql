-- Fix the check-ins SELECT policy without exposing the broad private.has_capability helper.
-- The policy now calls one authenticated-safe SECURITY DEFINER predicate that evaluates
-- all capability and company-scope checks internally as the function owner.

create or replace function private.can_read_checkin(
  target_session uuid,
  target_participant uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.has_session_wide_visibility(target_session)
    or private.has_capability(target_session, 'checkin_record')
    or private.has_capability(target_session, 'registration_view')
    or private.has_capability(target_session, 'housing_view')
    or exists (
      select 1
      from public.participants p
      join public.counselor_groups g on g.id = p.group_id
      where p.id = target_participant
        and p.session_id = target_session
        and private.can_access_company(target_session, g.company_id)
    );
$$;

revoke all on function private.can_read_checkin(uuid, uuid) from public, anon;
grant execute on function private.can_read_checkin(uuid, uuid) to authenticated;

drop policy if exists "members read scoped checkins" on public.check_ins;
create policy "members read scoped checkins" on public.check_ins
for select to authenticated
using (private.can_read_checkin(session_id, participant_id));

comment on function private.can_read_checkin(uuid, uuid)
is 'RLS-safe check-in read predicate. Keeps private.has_capability non-callable by clients while allowing authorized check-in, Registration, Housing, whole-session, and company-scoped users to read the check-in rows they need.';
