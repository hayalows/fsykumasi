-- Core RLS policies call this private SECURITY DEFINER predicate while evaluating
-- authenticated requests. Allow authenticated users to execute only the boolean
-- capability check; row access remains governed by the existing RLS policies.

grant execute on function private.has_team_capability(uuid, text, uuid) to authenticated;
