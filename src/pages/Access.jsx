import { Access as AccessV19, createInitialAccessRequests } from "./AccessV19.jsx";

// AccessV5 remains in the repository for historical regression coverage.
// AccessV17 remains in the repository for historical regression coverage. AccessV18 remains too.
// Access v19 treats auth user_id + email as website identity, keeps names out of identity matching,
// reconciles existing staff-level sign-ins in the database, and asks admins only for real setup work.
// Full-session Access administrators can add staff-level website access because the server authorizes
// coordinator, logistical administrator and session directing couple roles through can_manage_access.
const FULL_SESSION_ACCESS_ADMINS = new Set(["coordinator", "logistics_admin", "session_director"]);

export { createInitialAccessRequests };

export function Access(props) {
  const currentRole = props.currentRole || "logistics_admin";
  const suppliedCapabilities = props.currentCapabilities || [];
  const currentCapabilities = FULL_SESSION_ACCESS_ADMINS.has(currentRole) && !suppliedCapabilities.includes("staff_manage")
    ? [...suppliedCapabilities, "staff_manage"]
    : suppliedCapabilities;

  return <AccessV19 {...props} currentCapabilities={currentCapabilities} />;
}
