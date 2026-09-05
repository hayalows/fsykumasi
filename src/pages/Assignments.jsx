import { useEffect, useMemo, useState } from "react";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { UsersThree } from "@phosphor-icons/react/UsersThree";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { DismissibleLayer, MutationFeedback, PageHead, SearchField, Status } from "../components/UI.jsx";
import { StaffAccessInvite } from "../components/StaffAccessInvite.jsx";
import { StaffRoleTransitionSheet } from "../components/StaffRoleTransitionSheet.jsx";
import {
  applyStaffAssignmentPlan,
  assignCounselorToGroup,
  loadOperationalStructure,
  loadStaff,
  loadStructureSettings,
  setStaffCompanyAssignment,
  transitionStaffOperationalRole,
  unassignCounselorFromGroup,
} from "../lib/operations.js";
import {
  ACCOUNT_ROLES,
  accessStateLabel,
  createManualStaffLeader,
  loadStaffAccessDirectory,
  staffScopeLabel,
} from "../lib/staff-access.js";
import "./assignments.css";
import "./staff-access.css";

const ROLE_LABELS = {
  counselor: "Counselor",
  assistant_coordinator: "Assistant coordinator",
  coordinator: "Coordinator",
  committee_member: "Committee member",
  logistics_admin: "Logistical administrator",
  session_director: "Session directing couple",
  other: "Other staff",
};

const ACCOUNT_ROLE_OPTIONS = [
  ["assistant_coordinator", "Assistant coordinator"],
  ["coordinator", "Coordinator"],
  ["logistics_admin", "Logistical administrator"],
  ["session_director", "Session directing couple"],
];

function shuffled(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapWith]] = [copy[swapWith], copy[index]];
  }
  return copy;
}

function buildSuggestions(staff, groups, companies, maxCompanyLoad) {
  const unstaffedGroups = groups.filter((group) => !group.counselorId);
  const freeCounselors = staff.filter((person) => person.operationalRole === "counselor"
    && person.registrationStatus === "approved" && person.isCurrent !== false && !person.counselorGroupId);
  const counselors = [];
  const usedCounselors = new Set();
  for (const group of shuffled(unstaffedGroups)) {
    const match = shuffled(freeCounselors).find((person) => !usedCounselors.has(person.id) && (!person.sex || person.sex === group.sex));
    if (!match) continue;
    usedCounselors.add(match.id);
    counselors.push({ staffId: match.id, staffName: match.name, groupId: group.id, groupName: group.displayName || group.name });
  }

  const assistantCoordinators = staff.filter((person) => person.operationalRole === "assistant_coordinator"
    && person.registrationStatus === "approved" && person.isCurrent !== false);
  const loads = new Map(assistantCoordinators.map((person) => [person.id, person.companyIds.length]));
  const assistants = [];
  for (const company of shuffled(companies.filter((item) => !item.assistantCoordinatorIds.length))) {
    const candidate = [...assistantCoordinators]
      .filter((person) => (loads.get(person.id) || 0) < maxCompanyLoad)
      .sort((left, right) => (loads.get(left.id) || 0) - (loads.get(right.id) || 0) || left.name.localeCompare(right.name))[0];
    if (!candidate) continue;
    assistants.push({ staffId: candidate.id, staffName: candidate.name, companyId: company.id, companyName: company.displayName || company.name });
    loads.set(candidate.id, (loads.get(candidate.id) || 0) + 1);
  }
  return { counselors, assistants };
}

function scrollToAssignmentSection(id) {
  const target = document.getElementById(id);
  if (!target) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}

function NewLeaderSheet({ sessionId, onClose, onCreated, onGiveAccess }) {
  const [form, setForm] = useState({ name: "", email: "", role: "coordinator" });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const create = async (giveAccess) => {
    setBusy(giveAccess ? "access" : "save"); setError("");
    try {
      const staffId = await createManualStaffLeader({ sessionId, ...form });
      await onCreated?.();
      if (giveAccess) {
        onGiveAccess({
          staffId,
          name: form.name.trim(),
          email: form.email.trim(),
          accountEmail: "",
          operationalRole: form.role,
          companyIds: [],
          companyNames: [],
          accessState: "not_enabled",
        });
      } else onClose();
    } catch (err) { setError(err.message || "The leader could not be added."); }
    finally { setBusy(""); }
  };
  return <DismissibleLayer open onClose={onClose} title="Add session leader" sheet><div className="field-sheet manual-leader-form">
    <button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} aria-label="Close"><X/></button>
    <span className="kicker">Add to Assignments</span>
    <h2>Add a session leader</h2>
    <p className="manual-leader-help">Create the FSY assignment first. Website access can be added now or later.</p>
    <label>Full name<input autoFocus required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} autoComplete="name"/></label>
    <label>Email <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Optional unless giving website access" autoComplete="email"/></label>
    <label>FSY role<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>{ACCOUNT_ROLE_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
    {form.role === "assistant_coordinator" ? <div className="notice compact-notice"><WarningCircle/><div><b>Company scope comes next</b><p>Add the Assistant Coordinator first, then Assignments will help you choose the companies they support before website access is enabled.</p></div></div> : null}
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
    <div className="field-sheet-actions">
      <button className="secondary" disabled={Boolean(busy) || !form.name.trim()} onClick={() => create(false)}>{busy === "save" ? "Adding…" : "Add without access"}</button>
      <button className="primary" disabled={Boolean(busy) || !form.name.trim() || !form.email.trim() || form.role === "assistant_coordinator"} onClick={() => create(true)}><UserPlus/>{busy === "access" ? "Adding…" : "Add & give access"}</button>
    </div>
  </div></DismissibleLayer>;
}

export function Assignments({ sessionId, canManage = false, sessionName }) {
  const [staff, setStaff] = useState([]);
  const [structure, setStructure] = useState({ groups: [], companies: [], published: false });
  const [settings, setSettings] = useState({ companiesPerAssistantCoordinator: 4 });
  const [accessDirectory, setAccessDirectory] = useState([]);
  const [canManageWebsiteAccess, setCanManageWebsiteAccess] = useState(false);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [visibleStaff, setVisibleStaff] = useState(30);
  const [groupFilter, setGroupFilter] = useState("all");
  const [groupQuery, setGroupQuery] = useState("");
  const [visibleGroups, setVisibleGroups] = useState(24);
  const [companyFilter, setCompanyFilter] = useState("all");
  const [companyQuery, setCompanyQuery] = useState("");
  const [visibleCompanies, setVisibleCompanies] = useState(24);
  const [suggestions, setSuggestions] = useState(null);
  const [inviteTarget, setInviteTarget] = useState(null);
  const [transitionTarget, setTransitionTarget] = useState(null);
  const [newLeaderOpen, setNewLeaderOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);

  const refresh = async () => {
    if (!sessionId) return;
    const [nextStaff, nextStructure, nextSettings] = await Promise.all([
      loadStaff(sessionId), loadOperationalStructure(sessionId), loadStructureSettings(sessionId),
    ]);
    setStaff(nextStaff);
    setStructure(nextStructure);
    setSettings(nextSettings);
    try {
      const directory = await loadStaffAccessDirectory(sessionId);
      setAccessDirectory(directory);
      setCanManageWebsiteAccess(true);
    } catch {
      setAccessDirectory([]);
      setCanManageWebsiteAccess(false);
    }
  };

  useEffect(() => {
    let active = true;
    setInitialLoading(true);
    setError("");
    refresh()
      .catch((err) => { if (active) setError(err.message || "Assignments could not be loaded."); })
      .finally(() => { if (active) setInitialLoading(false); });
    return () => { active = false; };
  }, [sessionId]);

  useEffect(() => { setVisibleStaff(30); }, [query, roleFilter]);
  useEffect(() => { setVisibleGroups(24); }, [groupQuery, groupFilter]);
  useEffect(() => { setVisibleCompanies(24); }, [companyQuery, companyFilter]);

  const accessByStaff = useMemo(() => new Map(accessDirectory.map((item) => [item.staffId, item])), [accessDirectory]);
  const groups = structure.groups || [];
  const companies = structure.companies || [];
  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const companiesById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const staffById = useMemo(() => new Map(staff.map((person) => [person.id, person])), [staff]);
  const counselors = staff.filter((person) => person.operationalRole === "counselor" && person.registrationStatus === "approved" && person.isCurrent !== false);
  const assistants = staff.filter((person) => person.operationalRole === "assistant_coordinator" && person.registrationStatus === "approved" && person.isCurrent !== false);
  const availableCounselors = counselors.filter((person) => !person.counselorGroupId);
  const staffedGroups = groups.filter((group) => group.counselorId).length;
  const staffedCompanies = companies.filter((company) => company.assistantCoordinatorIds.length).length;
  const groupsNeedingCounselor = Math.max(0, groups.length - staffedGroups);
  const companiesNeedingAC = Math.max(0, companies.length - staffedCompanies);
  const roleNeeds = staff.filter((person) => person.registrationStatus === "approved" && person.isCurrent !== false && !person.operationalRole).length;
  const maxCompanyLoad = Number(settings.companiesPerAssistantCoordinator || 4);
  const requiredACs = companies.length ? Math.ceil(companies.length / Math.max(1, maxCompanyLoad)) : 0;
  const overloadedACs = assistants.filter((person) => person.companyIds.length > maxCompanyLoad);
  const assignmentIssues = groupsNeedingCounselor + companiesNeedingAC + overloadedACs.length;
  const setupComplete = structure.published && assignmentIssues === 0;
  const groupProgress = groups.length ? Math.round((staffedGroups / groups.length) * 100) : 0;
  const companyProgress = companies.length ? Math.round((staffedCompanies / companies.length) * 100) : 0;

  const roleCounts = useMemo(() => staff.reduce((counts, person) => {
    const key = person.operationalRole || "other";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {}), [staff]);

  const filteredStaff = useMemo(() => {
    const text = query.trim().toLowerCase();
    return staff.filter((person) => {
      if (roleFilter !== "all" && person.operationalRole !== roleFilter) return false;
      const group = groupsById.get(person.counselorGroupId);
      const companyNames = (person.companyIds || []).map((id) => companiesById.get(id)?.displayName || companiesById.get(id)?.name || "").join(" ");
      const haystack = `${person.name} ${person.unit || ""} ${person.stake || ""} ${person.operationalRole || ""} ${group?.displayName || ""} ${companyNames}`.toLowerCase();
      return !text || haystack.includes(text);
    });
  }, [staff, query, roleFilter, groupsById, companiesById]);

  const filteredGroups = useMemo(() => {
    const text = groupQuery.trim().toLowerCase();
    return groups.filter((group) => {
      if (groupFilter === "needs" && group.counselorId) return false;
      if (groupFilter === "filled" && !group.counselorId) return false;
      const counselor = staffById.get(group.counselorId);
      const company = companiesById.get(group.companyId);
      return !text || `${group.displayName || group.name} ${counselor?.name || ""} ${company?.displayName || company?.name || ""} ${group.sex}`.toLowerCase().includes(text);
    }).sort((a, b) => Number(Boolean(a.counselorId)) - Number(Boolean(b.counselorId)) || (a.displayName || a.name).localeCompare(b.displayName || b.name, undefined, { numeric: true }));
  }, [groups, groupFilter, groupQuery, staffById, companiesById]);

  const filteredCompanies = useMemo(() => {
    const text = companyQuery.trim().toLowerCase();
    return companies.filter((company) => {
      if (companyFilter === "needs" && company.assistantCoordinatorIds.length) return false;
      if (companyFilter === "filled" && !company.assistantCoordinatorIds.length) return false;
      const current = staffById.get(company.assistantCoordinatorIds[0]);
      const groupNames = company.groups.map((group) => group.displayName || group.name).join(" ");
      return !text || `${company.displayName || company.name} ${current?.name || ""} ${groupNames}`.toLowerCase().includes(text);
    }).sort((a, b) => Number(Boolean(a.assistantCoordinatorIds.length)) - Number(Boolean(b.assistantCoordinatorIds.length)) || (a.displayName || a.name).localeCompare(b.displayName || b.name, undefined, { numeric: true }));
  }, [companies, companyFilter, companyQuery, staffById]);

  const staffRows = filteredStaff.slice(0, visibleStaff);
  const shownGroups = filteredGroups.slice(0, visibleGroups);
  const shownCompanies = filteredCompanies.slice(0, visibleCompanies);

  const mutate = async (key, action, success) => {
    setBusy(key); setError(""); setNotice("");
    try {
      await action();
      await refresh();
      setSuggestions(null);
      if (success) setNotice(success);
    } catch (err) { setError(err.message || "Assignment could not be saved."); }
    finally { setBusy(""); }
  };

  const suggest = () => {
    setError("");
    setNotice("");
    setSuggestions(buildSuggestions(staff, groups, companies, maxCompanyLoad));
  };

  const applySuggestions = async () => {
    if (!suggestions) return;
    await mutate("suggestions", () => applyStaffAssignmentPlan(sessionId, suggestions), "Reviewed staff suggestions were applied.");
  };

  const confirmRoleTransition = async (payload) => {
    const { person, targetRole } = transitionTarget;
    const currentGroup = groupsById.get(person.counselorGroupId);
    await transitionStaffOperationalRole({
      staffId: person.id,
      role: targetRole,
      replacementCounselorId: payload.replacementCounselorId,
      counselorGroupId: payload.counselorGroupId,
      companyIds: payload.companyIds,
    });
    await refresh();
    setSuggestions(null);
    setTransitionTarget(null);
    setNotice(`${person.name} is now ${ROLE_LABELS[targetRole] || targetRole}. Connected assignments and linked website scope were updated together.`);
    if (payload.leaveGroupOpen && currentGroup) {
      setGroupFilter("needs");
      setGroupQuery(currentGroup.displayName || currentGroup.name || "");
      window.setTimeout(() => scrollToAssignmentSection("assignment-counselor-groups"), 60);
    } else if (targetRole === "assistant_coordinator") {
      setCompanyFilter("all");
      setCompanyQuery(person.name);
      window.setTimeout(() => scrollToAssignmentSection("assignment-company-supervision"), 60);
    } else if (person.operationalRole === "assistant_coordinator" && targetRole !== "assistant_coordinator") {
      setCompanyFilter("needs");
      setCompanyQuery("");
      window.setTimeout(() => scrollToAssignmentSection("assignment-company-supervision"), 60);
    }
  };

  const pageAction = canManage ? <div className="assignment-page-actions">
    {canManageWebsiteAccess ? <a className="secondary assignment-access-link" href="?view=access">Website access</a> : null}
    {canManageWebsiteAccess ? <button className="primary assignment-page-action" onClick={() => setNewLeaderOpen(true)}><UserPlus/>Add session leader</button> : null}
  </div> : null;

  return <section className="page assignments-page" aria-busy={initialLoading}>
    <PageHead
      title="Assignments"
      sessionName={sessionName}
      description="Set who serves where. Role changes guide you through the connected group or company work before anything is saved."
      action={pageAction}
    />

    {!canManage ? <div className="notice"><WarningCircle/><div><b>View-only assignments</b><p>Administrative access is required to change staff roles or responsibilities.</p></div></div> : null}
    {error ? <MutationFeedback tone="error" className="assignment-page-feedback">{error}</MutationFeedback> : null}
    {notice ? <MutationFeedback className="assignment-page-feedback"><b>Saved</b> · {notice}</MutationFeedback> : null}

    <article className={`panel assignment-overview ${setupComplete ? "is-complete" : ""}`}>
      <div className="assignment-overview-head">
        <div>
          <span className="kicker">Staffing at a glance</span>
          <h2>{setupComplete ? "Every current group and company has coverage" : initialLoading ? "Loading assignment status…" : assignmentIssues ? `${assignmentIssues} coverage ${assignmentIssues === 1 ? "item" : "items"} need attention` : "Review staff responsibilities"}</h2>
          <p>{structure.published ? "Start with a person when responsibilities change. The system will guide the handoff instead of sending you to another section to fix dependencies first." : "Classify staff roles now. Counselor-group and company scope unlock after Groups & companies is published."}</p>
        </div>
        {setupComplete ? <span className="assignment-complete-badge"><CheckCircle weight="fill"/>Covered</span> : null}
      </div>

      <div className="assignment-flow" aria-label="Assignment workflow">
        <button type="button" className={roleNeeds ? "assignment-flow-step needs" : "assignment-flow-step"} onClick={() => scrollToAssignmentSection("assignment-staff-roles")}>
          <span className="assignment-step-number">1</span>
          <span><b>People & roles</b><small>{roleNeeds ? `${roleNeeds} still need a clear role` : `${staff.length} staff classified`}</small></span>
          {roleNeeds ? <strong>{roleNeeds}</strong> : <CheckCircle weight="fill"/>}
        </button>
        <button type="button" className={groupsNeedingCounselor ? "assignment-flow-step needs" : "assignment-flow-step"} disabled={!structure.published} onClick={() => scrollToAssignmentSection("assignment-counselor-groups")}>
          <span className="assignment-step-number">2</span>
          <span><b>Counselor groups</b><small>{structure.published ? `${staffedGroups}/${groups.length} covered · ${availableCounselors.length} available` : "Available after publish"}</small></span>
          {structure.published ? (groupsNeedingCounselor ? <strong>{groupsNeedingCounselor}</strong> : <CheckCircle weight="fill"/>) : <span className="assignment-step-lock">Locked</span>}
        </button>
        <button type="button" className={companiesNeedingAC ? "assignment-flow-step needs" : "assignment-flow-step"} disabled={!structure.published} onClick={() => scrollToAssignmentSection("assignment-company-supervision")}>
          <span className="assignment-step-number">3</span>
          <span><b>AC company scope</b><small>{structure.published ? `${staffedCompanies}/${companies.length} covered` : "Available after publish"}</small></span>
          {structure.published ? (companiesNeedingAC ? <strong>{companiesNeedingAC}</strong> : <CheckCircle weight="fill"/>) : <span className="assignment-step-lock">Locked</span>}
        </button>
      </div>

      {structure.published ? <div className="assignment-overview-foot">
        <span>{assistants.length} Assistant Coordinators · current operating limit {maxCompanyLoad} companies each</span>
        {overloadedACs.length ? <span className="assignment-load-warning"><WarningCircle/>{overloadedACs.length} above the {maxCompanyLoad}-company limit</span> : <span className="assignment-load-ok"><CheckCircle/>No AC load conflicts</span>}
      </div> : null}
    </article>

    {canManage && structure.published && (groupsNeedingCounselor || companiesNeedingAC) ? <details className="panel progressive-section assignment-assistant-disclosure">
      <summary>
        <span><span className="kicker">Optional shortcut</span><b>Suggest assignments for the remaining gaps</b><small>Existing assignments are never replaced</small></span>
        <span className="summary-action">{groupsNeedingCounselor + companiesNeedingAC} gaps</span>
      </summary>
      <div className="progressive-section-body"><div className="assignment-assistant-card">
        <div className="panel-head"><div><span className="kicker">Assignment assistant</span><h2>Fill only empty places</h2></div><Sparkle size={22}/></div>
        <p>Suggestions match available Counselors to groups and spread open company scope across Assistant Coordinators without exceeding {maxCompanyLoad} companies.</p>
        {!suggestions ? <div className="panel-actions"><span>{groupsNeedingCounselor} groups and {companiesNeedingAC} companies still need staff.</span><button className="secondary" onClick={suggest}><Sparkle/>Suggest assignments</button></div> : <>
          <div className="assignment-suggestion-summary"><span><b>{suggestions.counselors.length}</b><small>Counselor matches</small></span><span><b>{suggestions.assistants.length}</b><small>AC/company matches</small></span></div>
          {(suggestions.counselors.length || suggestions.assistants.length) ? <div className="assignment-preview-list">{[...suggestions.counselors.slice(0,4).map((item) => `${item.staffName} → ${item.groupName}`), ...suggestions.assistants.slice(0,4).map((item) => `${item.staffName} → ${item.companyName}`)].map((text) => <span key={text}>{text}</span>)}</div> : <p className="form-hint">No safe automatic matches are available. Review staff roles or resolve the remaining assignments manually.</p>}
          <div className="panel-actions"><button className="secondary" disabled={busy === "suggestions"} onClick={suggest}>Shuffle</button><button className="primary" disabled={busy === "suggestions" || (!suggestions.counselors.length && !suggestions.assistants.length)} onClick={applySuggestions}>{busy === "suggestions" ? "Applying…" : "Apply reviewed suggestions"}</button></div>
        </>}
      </div></div>
    </details> : null}

    <article id="assignment-staff-roles" className="panel assignment-role-panel assignment-workflow-section">
      <div className="assignment-section-head">
        <div className="assignment-section-title">
          <span className="assignment-section-step">1</span>
          <div><span className="kicker">Start with the person</span><h2>People & responsibilities</h2><p>Changing a role opens one guided review. If the person already has a group or companies, you resolve that handoff before the change saves.</p></div>
        </div>
        <Status tone={roleNeeds ? "warn" : "good"}>{roleNeeds ? `${roleNeeds} need review` : "Roles ready"}</Status>
      </div>

      <div className="assignment-separation-note"><div><b>Assignments</b><span>Who serves where</span></div><span aria-hidden="true">·</span><div><b>Website access</b><span>Who can sign in and which extra committee tools they have</span></div>{canManageWebsiteAccess ? <a href="?view=access">Open Access</a> : null}</div>

      <div className="assignment-toolbar">
        <SearchField value={query} onChange={setQuery} label="Search staff assignments" placeholder="Name, unit, group or company"/>
        <select aria-label="Filter staff roles" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
          <option value="all">All staff ({staff.length})</option>
          {Object.entries(ROLE_LABELS).map(([value, label]) => <option value={value} key={value}>{label} ({roleCounts[value] || 0})</option>)}
        </select>
      </div>

      <div className="assignment-list-meta"><span>{filteredStaff.length ? `Showing ${Math.min(staffRows.length, filteredStaff.length)} of ${filteredStaff.length}` : "No matching staff"}</span><small>Role changes are reviewed before saving</small></div>

      {staffRows.length ? <div className="assignment-staff-list">{staffRows.map((person) => {
        const group = groupsById.get(person.counselorGroupId);
        const companyNames = (person.companyIds || []).map((id) => companiesById.get(id)?.displayName || companiesById.get(id)?.name).filter(Boolean);
        const assignmentText = person.operationalRole === "counselor"
          ? group ? `${group.displayName || group.name}${companiesById.get(group.companyId) ? ` · ${companiesById.get(group.companyId).displayName || companiesById.get(group.companyId).name}` : ""}` : "Available Counselor · no group yet"
          : person.operationalRole === "assistant_coordinator"
            ? companyNames.length ? `${companyNames.length} compan${companyNames.length === 1 ? "y" : "ies"} · ${companyNames.slice(0,2).join(", ")}${companyNames.length > 2 ? ` +${companyNames.length - 2}` : ""}` : "No company scope yet"
            : "No group or company assignment required";
        const access = accessByStaff.get(person.id);
        const accountEligible = ACCOUNT_ROLES.has(person.operationalRole);
        const accessState = access?.accessState || "not_enabled";
        const invitePerson = access || {
          staffId: person.id,
          name: person.name,
          operationalRole: person.operationalRole,
          email: "",
          accountEmail: "",
          companyIds: person.companyIds || [],
          companyNames: [],
          accessState: "not_enabled",
        };
        return <div className="assignment-staff-row" key={person.id}>
          <div className="assignment-person">
            <b>{person.name}</b>
            <small>{person.unit || "Unit not recorded"}{person.stake ? ` · ${person.stake}` : ""}</small>
            <span className={`assignment-context ${person.operationalRole === "counselor" && !group ? "available" : ""}`}>{assignmentText}</span>
          </div>
          <div className="assignment-row-controls">
            <label className="assignment-control">
              <span>FSY responsibility</span>
              <select
                aria-label={`FSY role for ${person.name}`}
                disabled={!canManage}
                value={person.operationalRole}
                onChange={(event) => event.target.value !== person.operationalRole && setTransitionTarget({ person, targetRole: event.target.value })}
              >{Object.entries(ROLE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
              <small className="assignment-control-hint">Connected assignments are handled in the next sheet.</small>
            </label>

            {accountEligible && canManageWebsiteAccess ? <div className="assignment-access-block">
              <div className="assignment-access-heading"><span>Website access</span><span className={`staff-access-state ${accessState}`}>{accessStateLabel(accessState)}</span></div>
              <small>{access ? staffScopeLabel(access) : person.operationalRole === "assistant_coordinator" ? `${person.companyIds.length} assigned companies` : "Whole session"}</small>
              {(!access || access.accessState === "not_enabled") ? <button
                className="secondary assignment-access-button"
                disabled={!canManage || (person.operationalRole === "assistant_coordinator" && !person.companyIds.length)}
                title={person.operationalRole === "assistant_coordinator" && !person.companyIds.length ? "Assign at least one company first" : undefined}
                onClick={() => setInviteTarget(invitePerson)}
              ><UserPlus/>Give access</button> : access.accessState === "invited" ? <button className="secondary assignment-access-button" disabled={!canManage} onClick={() => setInviteTarget(access)}>Setup link</button> : null}
            </div> : null}
          </div>
        </div>;
      })}</div> : <div className="assignment-filter-empty"><UsersThree/><b>No staff match this view</b><span>Try a different search or role filter.</span></div>}

      {staffRows.length < filteredStaff.length ? <button className="secondary show-more" onClick={() => setVisibleStaff((value) => value + 30)}>Show 30 more</button> : null}
    </article>

    {structure.published ? <div className="assignment-columns">
      <article id="assignment-counselor-groups" className="panel assignment-responsibility-panel assignment-workflow-section">
        <div className="assignment-section-head">
          <div className="assignment-section-title">
            <span className="assignment-section-step">2</span>
            <div><span className="kicker">Counselor coverage</span><h2>Counselor groups</h2><p>Search by group, company or Counselor. Open groups are always sorted to the top.</p></div>
          </div>
          <Status tone={groupsNeedingCounselor ? "warn" : "good"}>{groupsNeedingCounselor ? `${groupsNeedingCounselor} open` : `${availableCounselors.length} Counselors available`}</Status>
        </div>
        <div className="assignment-progress" aria-label={`${groupProgress}% of counselor groups assigned`}><span style={{ width: `${groupProgress}%` }}/></div>
        <div className="assignment-responsibility-tools">
          <div className="filter-chips assignment-filter-chips" role="group" aria-label="Filter counselor groups">
            <button type="button" className={groupFilter === "all" ? "active" : ""} onClick={() => setGroupFilter("all")}>All <b>{groups.length}</b></button>
            <button type="button" className={groupFilter === "needs" ? "active" : ""} onClick={() => setGroupFilter("needs")}>Needs Counselor <b>{groupsNeedingCounselor}</b></button>
            <button type="button" className={groupFilter === "filled" ? "active" : ""} onClick={() => setGroupFilter("filled")}>Assigned <b>{staffedGroups}</b></button>
          </div>
          <SearchField value={groupQuery} onChange={setGroupQuery} label="Search counselor groups" placeholder="Group, company or Counselor"/>
        </div>
        <div className="assignment-list-meta"><span>{filteredGroups.length ? `Showing ${Math.min(shownGroups.length, filteredGroups.length)} of ${filteredGroups.length}` : "No matching groups"}</span><small>{availableCounselors.length} current approved Counselors are not assigned to a group</small></div>
        {shownGroups.length ? <div className="assignment-responsibility-list">{shownGroups.map((group) => {
          const current = staffById.get(group.counselorId);
          const company = companiesById.get(group.companyId);
          const options = counselors.filter((person) => (!person.counselorGroupId || person.counselorGroupId === group.id) && (!person.sex || person.sex === group.sex));
          const rowBusy = busy === `group-${group.id}`;
          return <div className={current ? "is-assigned" : "needs-assignment"} key={group.id}>
            <span><b>{group.displayName}</b><small>{group.sex === "Female" ? "YW" : "YM"} · {group.memberCount} youth{company ? ` · ${company.displayName || company.name}` : ""}</small></span>
            {current ? <div className="assigned-person"><span><small>Counselor</small><b>{current.name}</b></span>{canManage ? <button className="assignment-remove" disabled={rowBusy} onClick={() => mutate(`group-${group.id}`, () => unassignCounselorFromGroup(group.id), `${current.name} was removed from ${group.displayName}. The group is now open.`)}>{rowBusy ? "Removing…" : "Remove"}</button> : null}</div> : <div className="assignment-select-wrap"><select
              aria-label={`Assign Counselor to ${group.displayName}`}
              disabled={!canManage || rowBusy || !options.length}
              defaultValue=""
              onChange={(event) => event.target.value && mutate(`group-${group.id}`, () => assignCounselorToGroup(event.target.value, group.id), `Counselor assigned to ${group.displayName}.`)}
            ><option value="">{options.length ? "Choose available Counselor…" : "No eligible Counselors"}</option>{options.map((person) => <option value={person.id} key={person.id}>{person.name}{person.unit ? ` · ${person.unit}` : ""}</option>)}</select>{rowBusy ? <small role="status">Saving…</small> : null}</div>}
          </div>;
        })}</div> : <div className="assignment-filter-empty success"><CheckCircle weight="fill"/><b>{groupFilter === "needs" ? "All counselor groups are covered" : "Nothing matches this view"}</b><span>{groupQuery ? "Try a different group, company or Counselor name." : "Choose another filter."}</span></div>}
        {shownGroups.length < filteredGroups.length ? <button className="secondary show-more assignment-responsibility-more" onClick={() => setVisibleGroups((value) => value + 24)}>Show 24 more groups</button> : null}
      </article>

      <article id="assignment-company-supervision" className="panel assignment-responsibility-panel assignment-workflow-section">
        <div className="assignment-section-head">
          <div className="assignment-section-title">
            <span className="assignment-section-step">3</span>
            <div><span className="kicker">Assistant Coordinator scope</span><h2>Company coverage</h2><p>Choose the companies each Assistant Coordinator supports in this session. Linked website scope follows these assignments.</p></div>
          </div>
          <Status tone={companiesNeedingAC ? "warn" : "good"}>{companiesNeedingAC ? `${companiesNeedingAC} open` : "All covered"}</Status>
        </div>
        <div className="assignment-progress" aria-label={`${companyProgress}% of companies assigned`}><span style={{ width: `${companyProgress}%` }}/></div>
        <div className="assignment-capacity-note"><span>Current session rule</span><b>Up to {maxCompanyLoad} companies per AC</b><small>{assistants.length} current approved ACs · {requiredACs} minimum at this limit</small></div>
        <div className="assignment-responsibility-tools">
          <div className="filter-chips assignment-filter-chips" role="group" aria-label="Filter company supervision">
            <button type="button" className={companyFilter === "all" ? "active" : ""} onClick={() => setCompanyFilter("all")}>All <b>{companies.length}</b></button>
            <button type="button" className={companyFilter === "needs" ? "active" : ""} onClick={() => setCompanyFilter("needs")}>Needs AC <b>{companiesNeedingAC}</b></button>
            <button type="button" className={companyFilter === "filled" ? "active" : ""} onClick={() => setCompanyFilter("filled")}>Assigned <b>{staffedCompanies}</b></button>
          </div>
          <SearchField value={companyQuery} onChange={setCompanyQuery} label="Search companies" placeholder="Company, group or Assistant Coordinator"/>
        </div>
        <div className="assignment-list-meta"><span>{filteredCompanies.length ? `Showing ${Math.min(shownCompanies.length, filteredCompanies.length)} of ${filteredCompanies.length}` : "No matching companies"}</span><small>Moving company scope updates a linked AC account automatically</small></div>
        {shownCompanies.length ? <div className="assignment-responsibility-list">{shownCompanies.map((company) => {
          const currentId = company.assistantCoordinatorIds[0];
          const current = staffById.get(currentId);
          const options = assistants.filter((person) => person.companyIds.includes(company.id) || person.companyIds.length < maxCompanyLoad);
          const rowBusy = busy === `company-${company.id}`;
          return <div className={current ? "is-assigned" : "needs-assignment"} key={company.id}>
            <span><b>{company.displayName}</b><small>{company.groups.length} counselor groups{company.groups.length ? ` · ${company.groups.slice(0,2).map((group) => group.displayName || group.name).join(", ")}${company.groups.length > 2 ? ` +${company.groups.length - 2}` : ""}` : ""}</small></span>
            {current ? <div className="assigned-person"><span><small>Assistant Coordinator</small><b>{current.name}</b><em>{current.companyIds.length}/{maxCompanyLoad} companies</em></span>{canManage ? <button className="assignment-remove" disabled={rowBusy} onClick={() => mutate(`company-${company.id}`, () => setStaffCompanyAssignment(current.id, company.id, false), `${current.name} was removed from ${company.displayName}${accessByStaff.get(current.id)?.accessState === "active" ? " and their website scope was updated" : ""}.`)}>{rowBusy ? "Removing…" : "Remove"}</button> : null}</div> : <div className="assignment-select-wrap"><select
              aria-label={`Assign Assistant Coordinator to ${company.displayName}`}
              disabled={!canManage || rowBusy || !options.length}
              defaultValue=""
              onChange={(event) => event.target.value && mutate(`company-${company.id}`, () => setStaffCompanyAssignment(event.target.value, company.id, true), `Assistant Coordinator assigned to ${company.displayName}.`)}
            ><option value="">{options.length ? "Choose Assistant Coordinator…" : "No AC has available capacity"}</option>{options.map((person) => <option value={person.id} key={person.id}>{person.name} · {person.companyIds.length}/{maxCompanyLoad}</option>)}</select>{rowBusy ? <small role="status">Saving…</small> : null}</div>}
          </div>;
        })}</div> : <div className="assignment-filter-empty success"><CheckCircle weight="fill"/><b>{companyFilter === "needs" ? "All companies have coverage" : "Nothing matches this view"}</b><span>{companyQuery ? "Try a different company, group or Assistant Coordinator name." : "Choose another filter."}</span></div>}
        {shownCompanies.length < filteredCompanies.length ? <button className="secondary show-more assignment-responsibility-more" onClick={() => setVisibleCompanies((value) => value + 24)}>Show 24 more companies</button> : null}
      </article>
    </div> : <article className="panel assignment-publish-gate"><div className="assignment-filter-empty"><WarningCircle/><b>Publish Groups & companies to continue</b><span>Staff roles can be set now. Counselor-group and company assignments become available after the youth structure is published.</span></div></article>}

    {inviteTarget ? <StaffAccessInvite staff={inviteTarget} onClose={() => setInviteTarget(null)} onInvited={refresh}/> : null}
    {transitionTarget ? <StaffRoleTransitionSheet
      key={`${transitionTarget.person.id}-${transitionTarget.targetRole}`}
      person={transitionTarget.person}
      targetRole={transitionTarget.targetRole}
      staff={staff}
      groups={groups}
      companies={companies}
      maxCompanyLoad={maxCompanyLoad}
      access={accessByStaff.get(transitionTarget.person.id)}
      onClose={() => setTransitionTarget(null)}
      onConfirm={confirmRoleTransition}
    /> : null}
    {newLeaderOpen ? <NewLeaderSheet
      sessionId={sessionId}
      onClose={() => setNewLeaderOpen(false)}
      onCreated={async () => { await refresh(); setNotice("The leader was added to Assignments. Website access is still separate until you enable it."); }}
      onGiveAccess={(person) => { setNewLeaderOpen(false); setInviteTarget(person); }}
    /> : null}
  </section>;
}
