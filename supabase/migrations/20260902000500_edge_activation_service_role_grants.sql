-- The pre-auth account activation Edge Function uses the service role to
-- validate one-time leader invites and recovery codes, then finalize access.
-- RLS is still enforced for browser roles; this grant is only for service_role.

grant select, update on table public.leader_invites to service_role;
grant select on table public.profiles to service_role;
