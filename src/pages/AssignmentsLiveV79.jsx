import { useEffect, useMemo, useState } from "react";
import { Assignments as AssignmentsV3 } from "./AssignmentsV3.jsx";
import { LeaderSetupFlow } from "../components/LeaderSetupFlow.jsx";
import { DismissibleLayer, Empty, MutationFeedback, SearchField, Status } from "../components/UI.jsx";
import {
  loadOperationalStructure,
  loadStaff,
  loadStructureSettings,
  transitionStaffOperationalRole,
} from "../lib/operations.js";
import {
  accessStateLabel,
  loadStaffAccessDirectory,
  setAssistantCoordinatorCompanies,
} from "../lib/staff-access.js";
import { canPlanStaff, staffException } from "../lib/staff-state.js";
import "./assignments-live-v79.css";

const AC_CANDIDATE_ROLES = new Set(["assistant_coordinator", "counselor", "other"]);
const ROLE_LABELS = {
  assistant_coordinator: "Assistant Coordinator",
  counselor: "Counselor",
  other: "Other staff",
};

function companyLabel(company) {
  return company?.displayName || company?.customName || company?.name || "Company";
}

function groupLabel(group) {
  return group?.displayName || group?.customName || group?.name || "Counselor group";
}

function naturalCompanySort(a, b) {
  return companyLabel(a).localeCompare(companyLabel(b), undefined, { numeric: true, sensitivity: "base" });
}

function accessTone(state) {
  if (state === "active") return "good";
  if (state === "invited") return "warn";
  return "neutral";
}

function setupPerson(person, access, companyById) {
  return {
    staffId: person.id,
    name: person.name,
    operationalRole: "assistant_coordinator",
    companyIds: person.companyIds || [],
    companyNames: (person.companyIds || []).map((id) => companyLabel(companyById.get(id))).filter(Boolean),
    email: access?.email || "",
    accountEmail: access?.accountEmail || "",
    accessState: access?.accessState || "not_enabled",
  };
}

function AssistantCoordinatorDesk({ sessionId, canManage = false }) {
  const [staff, setStaff] = useState([]);
  const [structure, setStructure] = useState({ companies: [], groups: [] });
  const [maxLoad, setMaxLoad] = useState(4);
  const [accessDirectory, setAccessDirectory] = useState([]);
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [companyOpen, setCompanyOpen] = useState(null);
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidate, setCandidate] = useState(null);
  const [replacementMode, setReplacementMode] = useState("open");
  const [replacementCounselorId, setReplacementCounselorId] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null);
  const [setupTarget, setSetupTarget] = useState(null);

  const refresh = async () => {
    if (!sessionId) return;
    const [nextStaff, nextStructure, nextSettings, nextAccess] = await Promise.all([
      loadStaff(sessionId),
      loadOperationalStructure(sessionId),
      loadStructureSettings(sessionId),
      loadStaffAccessDirectory(sessionId).catch(() => []),
    ]);
    setStaff(nextStaff);
    setStructure(nextStructure);
    setMaxLoad(Number(nextSettings.companiesPerAssistantCoordinator || 4));
    setAccessDirectory(nextAccess);
  };

  useEffect(() => {
    let active = true;
    if (!sessionId) {
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    refresh()
      .catch((err) => { if (active) setError(err.message || "Assistant Coordinator assignments could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sessionId]);

  const companies = useMemo(() => [...(structure.companies || [])].sort(naturalCompanySort), [structure.companies]);
  const groups = structure.groups || [];
  const staffById = useMemo(() => new Map(staff.map((person) => [person.id, person])), [staff]);
  const companyById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const accessByStaff = useMemo(() => new Map(accessDirectory.map((item) => [item.staffId, item])), [accessDirectory]);
  const groupByCounselor = useMemo(() => new Map(groups.filter((group) => group.counselorId).map((group) => [group.counselorId, group])), [groups]);

  const coveredCount = companies.filter((company) => (company.assistantCoordinatorIds || []).some((id) => canPlanStaff(staffById.get(id) || { isCurrent: false }))).length;
  const openCount = Math.max(0, companies.length - coveredCount);

  const filteredCompanies = useMemo(() => {
    const text = query.trim().toLowerCase();
    return companies.filter((company) => {
      if (!text) return true;
      const ownerNames = (company.assistantCoordinatorIds || []).map((id) => staffById.get(id)?.name || "").join(" ");
      const groupNames = (company.groups || []).map(groupLabel).join(" ");
      return `${companyLabel(company)} ${ownerNames} ${groupNames}`.toLowerCase().includes(text);
    });
  }, [companies, query, staffById]);

  const eligibleCandidates = useMemo(() => staff
    .filter((person) => person.isCurrent !== false
      && person.registrationStatus !== "cancelled"
      && canPlanStaff(person)
      && AC_CANDIDATE_ROLES.has(person.operationalRole))
    .sort((a, b) => {
      const aRole = a.operationalRole === "assistant_coordinator" ? 0 : 1;
      const bRole = b.operationalRole === "assistant_coordinator" ? 0 : 1;
      return aRole - bRole || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    }), [staff]);

  const candidateChoices = useMemo(() => {
    const text = candidateQuery.trim().toLowerCase();
    return eligibleCandidates.filter((person) => {
      const currentCompanies = (person.companyIds || []).map((id) => companyLabel(companyById.get(id))).join(" ");
      return !text || `${person.name} ${person.unit || ""} ${person.stake || ""} ${currentCompanies}`.toLowerCase().includes(text);
    });
  }, [eligibleCandidates, candidateQuery, companyById]);

  const currentOwner = companyOpen
    ? (companyOpen.assistantCoordinatorIds || []).map((id) => staffById.get(id)).filter(Boolean)[0] || null
    : null;
  const candidateGroup = candidate ? groupByCounselor.get(candidate.id) || null : null;
  const replacementCounselors = useMemo(() => {
    if (!candidateGroup || !candidate) return [];
    return staff.filter((person) => person.id !== candidate.id
      && person.operationalRole === "counselor"
      && person.isCurrent !== false
      && person.registrationStatus !== "cancelled"
      && !person.counselorGroupId
      && canPlanStaff(person)
      && (!person.sex || !candidateGroup.sex || person.sex === candidateGroup.sex))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [candidateGroup, candidate, staff]);

  const currentOwnerAccess = currentOwner ? accessByStaff.get(currentOwner.id) : null;
  const transferWouldOrphanActiveOwner = Boolean(
    companyOpen
      && candidate
      && currentOwner
      && currentOwner.id !== candidate.id
      && currentOwnerAccess?.accessState === "active"
      && (currentOwner.companyIds?.length || 0) <= 1,
  );
  const candidateAtLimit = Boolean(
    candidate
      && candidate.operationalRole === "assistant_coordinator"
      && !(candidate.companyIds || []).includes(companyOpen?.id)
      && (candidate.companyIds?.length || 0) >= maxLoad,
  );
  const replacementReady = !candidateGroup || replacementMode === "open" || Boolean(replacementCounselorId);
  const canSave = Boolean(candidate && !busy && replacementReady && !candidateAtLimit && !transferWouldOrphanActiveOwner);

  const openCompany = (company) => {
    setCompanyOpen(company);
    setCandidateQuery("");
    setCandidate(null);
    setReplacementMode("open");
    setReplacementCounselorId("");
    setSaved(null);
    setError("");
  };

  const chooseCandidate = (person) => {
    const group = groupByCounselor.get(person.id) || null;
    const replacements = group ? staff.filter((item) => item.id !== person.id
      && item.operationalRole === "counselor"
      && item.isCurrent !== false
      && item.registrationStatus !== "cancelled"
      && !item.counselorGroupId
      && canPlanStaff(item)
      && (!item.sex || !group.sex || item.sex === group.sex)) : [];
    setCandidate(person);
    setReplacementMode(group && replacements.length ? "replace" : "open");
    setReplacementCounselorId("");
    setSaved(null);
    setError("");
  };

  const saveAssignment = async () => {
    if (!companyOpen || !candidate || !canSave) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (candidate.operationalRole === "assistant_coordinator") {
        const desired = [...new Set([...(candidate.companyIds || []), companyOpen.id])];
        await setAssistantCoordinatorCompanies(candidate.id, desired);
      } else {
        await transitionStaffOperationalRole({
          staffId: candidate.id,
          role: "assistant_coordinator",
          replacementCounselorId: candidateGroup && replacementMode === "replace" ? replacementCounselorId : null,
          companyIds: [companyOpen.id],
        });
      }

      await refresh();
      const nextStaff = await loadStaff(sessionId);
      const nextPerson = nextStaff.find((item) => item.id === candidate.id) || { ...candidate, operationalRole: "assistant_coordinator", companyIds: [companyOpen.id] };
      setStaff(nextStaff);
      const nextAccessDirectory = await loadStaffAccessDirectory(sessionId).catch(() => []);
      setAccessDirectory(nextAccessDirectory);
      const access = nextAccessDirectory.find((item) => item.staffId === nextPerson.id) || null;
      setSaved({ person: nextPerson, access });
      setNotice(`${nextPerson.name} is now responsible for ${companyLabel(companyOpen)}.`);
    } catch (err) {
      setError(err.message || "This Assistant Coordinator assignment could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const openWebsiteSetup = () => {
    if (!saved?.person) return;
    setSetupTarget(setupPerson(saved.person, saved.access, companyById));
  };

  if (!sessionId) return null;

  return <section className="page assignments-live-v79" aria-label="Assistant Coordinator assignment desk">
    <article className="panel assignments-live-v79-panel">
      <header className="assignments-live-v79-head">
        <div>
          <span className="kicker">Day 2 · company leadership</span>
          <h2>Assign or change Assistant Coordinators</h2>
          <p>Choose a company, select the person who should lead it, then decide whether to prepare website access now or later.</p>
        </div>
        <div className="assignments-live-v79-summary" aria-label="Company coverage">
          <span><b>{loading ? "—" : `${coveredCount}/${companies.length}`}</b><small>companies covered</small></span>
          <span className={openCount ? "attention" : ""}><b>{loading ? "—" : openCount}</b><small>need an AC</small></span>
        </div>
      </header>

      {error && !companyOpen ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      {notice && !companyOpen ? <MutationFeedback>{notice}</MutationFeedback> : null}

      <div className="assignments-live-v79-tools">
        <SearchField value={query} onChange={setQuery} label="Find company or Assistant Coordinator" placeholder="Company 17, Godfred Osei…" />
        <small>{canManage ? "Changes are saved to the same company scope used by Groups, People and website access." : "You can review company coverage. An administrator is required to change it."}</small>
      </div>

      {loading ? <p role="status">Loading company leadership…</p> : filteredCompanies.length ? <div className="assignments-live-v79-list">
        {filteredCompanies.map((company) => {
          const owners = (company.assistantCoordinatorIds || []).map((id) => staffById.get(id)).filter(Boolean);
          const activeOwner = owners.find(canPlanStaff) || owners[0] || null;
          const access = activeOwner ? accessByStaff.get(activeOwner.id) : null;
          const covered = Boolean(activeOwner && canPlanStaff(activeOwner));
          return <div className={`assignments-live-v79-row ${covered ? "covered" : "open"}`} key={company.id}>
            <div className="assignments-live-v79-company"><b>{companyLabel(company)}</b><small>{company.groups?.length || 0} counselor group{company.groups?.length === 1 ? "" : "s"}</small></div>
            <div className="assignments-live-v79-owner">
              <small>Assistant Coordinator</small>
              {activeOwner ? <><b>{activeOwner.name}</b><span>{staffException(activeOwner) || (covered ? "Assigned" : "Needs review")}</span></> : <><b>Not assigned</b><span>Choose the person leading this company.</span></>}
            </div>
            <div className="assignments-live-v79-access">
              <small>Website</small>
              {activeOwner ? <Status tone={accessTone(access?.accessState)}>{accessStateLabel(access?.accessState || "not_enabled")}</Status> : <span>After assignment</span>}
            </div>
            <button type="button" className={activeOwner ? "secondary" : "primary"} disabled={!canManage} onClick={() => openCompany(company)}>{activeOwner ? "Change AC" : "Assign AC"}</button>
          </div>;
        })}
      </div> : <Empty title="No company found" text="Try another company number or Assistant Coordinator name." />}
    </article>

    {companyOpen ? <DismissibleLayer open onClose={() => !busy && setCompanyOpen(null)} title={`Assistant Coordinator for ${companyLabel(companyOpen)}`} sheet className="assignments-live-v79-layer">
      <div className="field-sheet assignments-live-v79-sheet">
        <header>
          <span className="kicker">Company responsibility</span>
          <h2>{companyLabel(companyOpen)}</h2>
          <p>{currentOwner ? `Currently assigned to ${currentOwner.name}. Choose the correct Assistant Coordinator below.` : "No Assistant Coordinator is assigned yet. Choose the correct person below."}</p>
        </header>

        {!candidate ? <>
          <SearchField value={candidateQuery} onChange={setCandidateQuery} label="Find staff member" placeholder="Name or ward / branch" />
          <div className="assignments-live-v79-candidates">
            {candidateChoices.map((person) => {
              const alreadyHere = currentOwner?.id === person.id;
              const atLimit = person.operationalRole === "assistant_coordinator" && !(person.companyIds || []).includes(companyOpen.id) && (person.companyIds?.length || 0) >= maxLoad;
              const group = groupByCounselor.get(person.id);
              return <button type="button" key={person.id} disabled={alreadyHere || atLimit} onClick={() => chooseCandidate(person)}>
                <span><b>{person.name}</b><small>{ROLE_LABELS[person.operationalRole] || person.operationalRole}{person.unit ? ` · ${person.unit}` : ""}</small><small>{person.operationalRole === "assistant_coordinator" ? `${person.companyIds?.length || 0}/${maxLoad} companies` : group ? `${groupLabel(group)} · will need a replacement Counselor` : "Can be made Assistant Coordinator"}</small></span>
                <strong>{alreadyHere ? "Current" : atLimit ? "At limit" : person.operationalRole === "assistant_coordinator" ? "Choose" : "Make AC"}</strong>
              </button>;
            })}
            {!candidateChoices.length ? <Empty title="No available staff found" text="Try another name. People who are no-show, left, excluded, not ready to serve, or in whole-session leadership are not offered here." /> : null}
          </div>
        </> : saved ? <section className="assignments-live-v79-success">
          <span className="kicker">Saved</span>
          <h3>{saved.person.name} → {companyLabel(companyOpen)}</h3>
          <p>{saved.access?.accessState === "active" ? "Website access was already active, so the company scope follows this assignment automatically." : saved.access?.accessState === "invited" ? "An invite already exists. The company responsibility is saved; you can prepare a fresh setup link if needed." : "The assignment is complete. Website access is still optional and can be prepared now or later."}</p>
          <div className="assignments-live-v79-success-actions">
            {saved.access?.accessState === "active" ? <Status tone="good">Access active</Status> : <button type="button" className="primary" onClick={openWebsiteSetup}>{saved.access?.accessState === "invited" ? "Prepare new setup link" : "Set up website access now"}</button>}
            <button type="button" className="secondary" onClick={() => setCompanyOpen(null)}>Done for now</button>
          </div>
        </section> : <>
          <button type="button" className="text-action assignments-live-v79-back" onClick={() => { setCandidate(null); setReplacementCounselorId(""); setError(""); }}>← Choose someone else</button>
          <section className="assignments-live-v79-review">
            <div><small>Company</small><b>{companyLabel(companyOpen)}</b></div>
            <div><small>New Assistant Coordinator</small><b>{candidate.name}</b><span>{ROLE_LABELS[candidate.operationalRole] || candidate.operationalRole} → Assistant Coordinator</span></div>
            {currentOwner && currentOwner.id !== candidate.id ? <div><small>Current AC</small><b>{currentOwner.name}</b><span>This company will move away from them.</span></div> : null}
          </section>

          {candidateGroup ? <section className="assignments-live-v79-replacement">
            <div><b>{candidate.name} currently leads {groupLabel(candidateGroup)}</b><small>Choose what should happen to that counselor group when this person becomes an Assistant Coordinator.</small></div>
            {replacementCounselors.length ? <div className="assignments-live-v79-choice">
              <label><input type="radio" name="ac-replacement" checked={replacementMode === "replace"} onChange={() => setReplacementMode("replace")} /><span><b>Replace the Counselor now</b><small>Recommended if the replacement is already known.</small></span></label>
              <label><input type="radio" name="ac-replacement" checked={replacementMode === "open"} onChange={() => setReplacementMode("open")} /><span><b>Leave the group open</b><small>It will appear under Needs Counselor immediately.</small></span></label>
            </div> : <p>No free matching Counselor is available. This group will be left open and surfaced in Assignments.</p>}
            {replacementMode === "replace" && replacementCounselors.length ? <label>Replacement Counselor<select value={replacementCounselorId} onChange={(event) => setReplacementCounselorId(event.target.value)}><option value="">Choose replacement…</option>{replacementCounselors.map((person) => <option key={person.id} value={person.id}>{person.name}{person.unit ? ` · ${person.unit}` : ""}</option>)}</select></label> : null}
          </section> : null}

          {candidateAtLimit ? <MutationFeedback tone="error">{candidate.name} already has the configured maximum of {maxLoad} companies. Move one of their current companies first.</MutationFeedback> : null}
          {transferWouldOrphanActiveOwner ? <MutationFeedback tone="warn">{currentOwner.name} has active website access and this is their only company. Assign their correct next company first, then return here. This prevents an active account from being left with no company scope.</MutationFeedback> : null}
          {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}

          <footer className="assignments-live-v79-actions">
            <button type="button" className="secondary" onClick={() => setCompanyOpen(null)} disabled={busy}>Cancel</button>
            <button type="button" className="primary" disabled={!canSave} onClick={saveAssignment}>{busy ? "Saving…" : candidate.operationalRole === "assistant_coordinator" ? "Assign to company" : "Make AC & assign"}</button>
          </footer>
        </>}
      </div>
    </DismissibleLayer> : null}

    {setupTarget ? <LeaderSetupFlow sessionId={sessionId} person={setupTarget} onClose={() => setSetupTarget(null)} onComplete={async (person) => { await refresh(); setSetupTarget(null); setNotice(`${person.name}'s website access is ready.`); setCompanyOpen(null); }} /> : null}
  </section>;
}

export function Assignments(props) {
  return <>
    <AssistantCoordinatorDesk sessionId={props.sessionId} canManage={props.canManage} />
    <AssignmentsV3 {...props} />
  </>;
}
