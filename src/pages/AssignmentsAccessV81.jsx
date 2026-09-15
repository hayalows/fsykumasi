import { useEffect, useMemo, useState } from "react";
import { Assignments as AssignmentsLiveV79 } from "./AssignmentsLiveV79.jsx";
import { LeaderSetupFlow } from "../components/LeaderSetupFlow.jsx";
import { Empty, MutationFeedback, SearchField, Status } from "../components/UI.jsx";
import { loadOperationalStructure } from "../lib/operations.js";
import { accessStateLabel, loadStaffAccessDirectory } from "../lib/staff-access.js";
import { writeWorkspaceLocation } from "../lib/navigation.js";
import "./assignments-access-v81.css";

function companyLabel(company) {
  return company?.displayName || company?.customName || company?.name || "Company";
}

function accessTone(state) {
  if (state === "active") return "good";
  if (state === "invited") return "warn";
  if (state === "disabled") return "danger";
  if (state === "not_ready") return "warn";
  return "neutral";
}

function goToAccess(filter = "") {
  if (typeof window === "undefined") return;
  writeWorkspaceLocation({ view: "access", filter });
  window.dispatchEvent(new Event("popstate"));
}

function setupPerson(person) {
  return {
    staffId: person.staffId,
    name: person.name,
    operationalRole: "assistant_coordinator",
    companyIds: person.companyIds || [],
    companyNames: person.companyNames || [],
    email: person.email || "",
    accountEmail: person.accountEmail || "",
    accessState: person.accessState || "not_enabled",
  };
}

function AssistantCoordinatorAccessDesk({ sessionId, canManage = false }) {
  const [directory, setDirectory] = useState([]);
  const [structure, setStructure] = useState({ companies: [] });
  const [view, setView] = useState("needs");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [setupTarget, setSetupTarget] = useState(null);
  const [addingLeader, setAddingLeader] = useState(false);

  const refresh = async () => {
    if (!sessionId) return;
    const [nextDirectory, nextStructure] = await Promise.all([
      loadStaffAccessDirectory(sessionId),
      loadOperationalStructure(sessionId),
    ]);
    setDirectory(nextDirectory || []);
    setStructure(nextStructure || { companies: [] });
  };

  useEffect(() => {
    let active = true;
    if (!sessionId) {
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    setError("");
    refresh()
      .catch((err) => { if (active) setError(err.message || "Assistant Coordinator website access could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sessionId]);

  const companyById = useMemo(() => new Map((structure.companies || []).map((company) => [company.id, company])), [structure.companies]);
  const assigned = useMemo(() => directory
    .filter((person) => person.operationalRole === "assistant_coordinator" && (person.companyIds || []).length)
    .map((person) => {
      const groupNames = (person.companyIds || []).flatMap((companyId) => {
        const company = companyById.get(companyId);
        return (company?.groups || []).map((group) => group.displayName || group.customName || group.name || "").filter(Boolean);
      });
      return { ...person, groupNames };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })), [directory, companyById]);

  const counts = useMemo(() => ({
    all: assigned.length,
    active: assigned.filter((person) => person.accessState === "active").length,
    needs: assigned.filter((person) => person.accessState !== "active").length,
    notEnabled: assigned.filter((person) => person.accessState === "not_enabled").length,
  }), [assigned]);

  const shown = useMemo(() => {
    const text = query.trim().toLowerCase();
    return assigned.filter((person) => {
      if (view === "needs" && person.accessState === "active") return false;
      if (!text) return true;
      return `${person.name} ${(person.companyNames || []).join(" ")} ${(person.groupNames || []).join(" ")} ${accessStateLabel(person.accessState)}`.toLowerCase().includes(text);
    });
  }, [assigned, query, view]);

  const completeSetup = async (person) => {
    await refresh();
    setSetupTarget(null);
    setAddingLeader(false);
    setNotice(`${person.name} is ready for website access.`);
  };

  if (!sessionId) return null;

  return <section className="page assignments-access-v81" aria-label="Assistant Coordinator website access">
    <article className="panel assignments-access-v81-panel">
      <header className="assignments-access-v81-head">
        <div>
          <span className="kicker">Website access</span>
          <h2>Finish Assistant Coordinator access</h2>
          <p>Assignments stays the source of truth. Anyone already assigned to a company stays here until their sign-in is ready.</p>
        </div>
        {canManage ? <button type="button" className="secondary" onClick={() => { setNotice(""); setAddingLeader(true); }}>Add leader</button> : null}
      </header>

      {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      {notice ? <MutationFeedback>{notice}</MutationFeedback> : null}

      <div className="assignments-access-v81-summary" aria-label="Assistant Coordinator access summary">
        <span><b>{loading ? "—" : counts.all}</b><small>assigned</small></span>
        <span><b>{loading ? "—" : counts.active}</b><small>access active</small></span>
        <span className={counts.needs ? "attention" : ""}><b>{loading ? "—" : counts.needs}</b><small>still to finish</small></span>
      </div>

      <div className="assignments-access-v81-tools">
        <div className="assignments-access-v81-tabs" role="tablist" aria-label="Website access view">
          <button type="button" role="tab" aria-selected={view === "needs"} className={view === "needs" ? "active" : ""} onClick={() => setView("needs")}>Needs setup <b>{counts.needs}</b></button>
          <button type="button" role="tab" aria-selected={view === "all"} className={view === "all" ? "active" : ""} onClick={() => setView("all")}>All assigned <b>{counts.all}</b></button>
        </div>
        <SearchField value={query} onChange={setQuery} label="Find Assistant Coordinator access" placeholder="Name, company or counselor group" />
      </div>

      {loading ? <p role="status">Loading assigned Assistant Coordinators…</p> : shown.length ? <div className="assignments-access-v81-list">
        {shown.map((person) => {
          const state = person.accessState || "not_enabled";
          const canSetup = canManage && state === "not_enabled";
          return <div className="assignments-access-v81-row" key={person.staffId}>
            <div className="assignments-access-v81-person">
              <b>{person.name}</b>
              <small>{(person.companyNames || []).length ? person.companyNames.join(" · ") : `${person.companyIds.length} assigned compan${person.companyIds.length === 1 ? "y" : "ies"}`}</small>
            </div>
            <div className="assignments-access-v81-groups">
              <small>Counselor groups</small>
              <span>{person.groupNames.length ? person.groupNames.join(" · ") : "Company assignment saved"}</span>
            </div>
            <div className="assignments-access-v81-state">
              <small>Website</small>
              <Status tone={accessTone(state)}>{accessStateLabel(state)}</Status>
            </div>
            <div className="assignments-access-v81-actions">
              {canSetup ? <button type="button" className="primary" onClick={() => { setNotice(""); setSetupTarget(setupPerson(person)); }}>Set up access</button> : state !== "active" && canManage ? <button type="button" className="secondary" onClick={() => goToAccess(state === "invited" ? "invited" : "all")}>Open Access</button> : null}
            </div>
          </div>;
        })}
      </div> : <Empty title={query ? "No matching Assistant Coordinator" : view === "needs" ? "All assigned ACs have access" : "No assigned Assistant Coordinators"} text={query ? "Try a name, company number, or counselor group." : view === "needs" ? "There is no unfinished website setup in the assigned AC list." : "Assign an Assistant Coordinator to a company first, or add a leader here."} />}

      {!loading && counts.notEnabled > 0 ? <p className="assignments-access-v81-hint">{counts.notEnabled} assigned Assistant Coordinator{counts.notEnabled === 1 ? " has" : "s have"} no website access yet. Their company assignments are already saved, so you only need to prepare their sign-in.</p> : null}
    </article>

    {setupTarget ? <LeaderSetupFlow sessionId={sessionId} person={setupTarget} requireEmail onClose={() => setSetupTarget(null)} onComplete={completeSetup} /> : null}
    {addingLeader ? <LeaderSetupFlow sessionId={sessionId} requireEmail allowStaffRoles onClose={() => setAddingLeader(false)} onComplete={completeSetup} /> : null}
  </section>;
}

export function Assignments(props) {
  return <>
    <AssistantCoordinatorAccessDesk sessionId={props.sessionId} canManage={props.canManage} />
    <AssignmentsLiveV79 {...props} />
  </>;
}
