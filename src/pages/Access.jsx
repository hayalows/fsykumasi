import { useEffect, useState } from "react";
import { Access as AccessV19, createInitialAccessRequests } from "./AccessV19.jsx";
import { loadTeamCatalog } from "../lib/field-operations.js";
import "../access-operations-v20.css";
import "../access-operations-v21.css";

// AccessV5 remains in the repository for historical regression coverage.
// AccessV17 remains in the repository for historical regression coverage. AccessV18 remains too.
// Access v19 keeps the email-first identity model and database reconciliation logic.
// Access v20 is a presentation-only refinement layer: calmer density, grouped responsibility context,
// progressive disclosure for uncommon setup paths and mobile-safe task sheets.
// Access v21 makes new-person entry immediate and loads committee choices inside Access itself so the
// setup flow does not depend on another page having already hydrated the team catalog.
// Access v22 opens on Everyone by default so a newly assigned Assistant Coordinator who chose
// "set up later" remains immediately visible with their company scope and Invite action.
// Full-session Access administrators can add staff-level website access because the server authorizes
// coordinator, logistical administrator and session directing couple roles through can_manage_access.
const FULL_SESSION_ACCESS_ADMINS = new Set(["coordinator", "logistics_admin", "session_director", "area_advisory_couple"]);

export { createInitialAccessRequests };

export function Access(props) {
  const currentRole = props.currentRole || "logistics_admin";
  const suppliedCapabilities = props.currentCapabilities || [];
  const currentCapabilities = FULL_SESSION_ACCESS_ADMINS.has(currentRole) && !suppliedCapabilities.includes("staff_manage")
    ? [...suppliedCapabilities, "staff_manage"]
    : suppliedCapabilities;
  const initialFilter = props.initialFilter || "all";
  const [resolvedTeams, setResolvedTeams] = useState(props.teams || []);

  useEffect(() => {
    let active = true;
    if (props.teams?.length) {
      setResolvedTeams(props.teams);
      return () => { active = false; };
    }
    if (!props.live || !props.sessionId) {
      setResolvedTeams(props.teams || []);
      return () => { active = false; };
    }
    loadTeamCatalog(props.sessionId)
      .then((teams) => { if (active) setResolvedTeams(teams || []); })
      .catch(() => { if (active) setResolvedTeams([]); });
    return () => { active = false; };
  }, [props.live, props.sessionId, props.teams]);

  return <div className="access-v20-shell access-v21-shell"><AccessV19 {...props} initialFilter={initialFilter} teams={resolvedTeams} currentCapabilities={currentCapabilities} /></div>;
}
