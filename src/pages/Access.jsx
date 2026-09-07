import { Access as AccessV19, createInitialAccessRequests } from "./AccessV19.jsx";
import "../access-operations-v20.css";

// AccessV5 remains in the repository for historical regression coverage.
// AccessV17 remains in the repository for historical regression coverage. AccessV18 remains too.
// Access v19 keeps the email-first identity model and database reconciliation logic.
// Access v20 is a presentation-only refinement layer: calmer density, grouped responsibility context,
// progressive disclosure for uncommon setup paths and mobile-safe task sheets.
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

  return <div className="access-v20-shell"><AccessV19 {...props} currentCapabilities={currentCapabilities} /></div>;
}
