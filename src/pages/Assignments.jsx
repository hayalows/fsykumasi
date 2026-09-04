import { useEffect, useMemo, useState } from "react";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { UsersThree } from "@phosphor-icons/react/UsersThree";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { DismissibleLayer, MutationFeedback, PageHead, SearchField, Status } from "../components/UI.jsx";
import { StaffAccessInvite } from "../components/StaffAccessInvite.jsx";
import {
  applyStaffAssignmentPlan,
  assignCounselorToGroup,
  loadOperationalStructure,
  loadStaff,
  loadStructureSettings,
  setStaffCompanyAssignment,
  setStaffOperationalRole,
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
    {form.role === "assistant_coordinator" ? <div className="notice compact-notice"><WarningCircle/><div><b>Assign companies before website access</b><p>Add the Assistant Coordinator first, choose their companies, then give access so their account starts with the right scope.</p></div></div> : null}
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
  const [groupFilter, setGroupFilter] = useState("needs");
  const [companyFilter, setCompanyFilter] = useState("needs");
  const [suggestions, setSuggestions] = useState(null);
  const [inviteTarget, setInviteTarget] = useState(null);
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

  const accessByStaff = useMemo(() => new Map(accessDirectory.map((item) => [item.staffId, item])), [accessDirectory]);
  const groups = structure.groups || [];
  const companies = structure.companies || [];
  const counselors = staff.filter((person) => person.operationalRole === "counselor" && person.registrationStatus === "approved" && person.isCurrent !== false);
  const assistants = staff.filter((person) => person.operationalRole === "assistant_coordinator" && person.registrationStatus === "approved" && person.isCurrent !== false);
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
      const haystack = `${person.name} ${person.unit || ""} ${person.stake || ""} ${person.operationalRole || ""}`.toLowerCase();
      return !text || haystack.includes(text);
    });
  }, [staff, query, roleFilter]);

  const staffRows = filteredStaff.slice(0, visibleStaff);
  const shownGroups = groups.filter((group) => groupFilter === "all" || (groupFilter === "needs" ? !group.counselorId : Boolean(group.counselorId))).slice(0, 40);
  const shownCompanies = companies.filter((company) => companyFilter === "all" || (companyFilter === "needs" ? !company.assistantCoordinatorIds.length : Boolean(company.assistantCoordinatorIds.length))).slice(0, 40);

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

  const pageAction = canManage && canManageWebsiteAccess
    ? <button className="primary assignment-page-action" onClick={() => setNewLeaderOpen(true)}><UserPlus/>Add session leader</button>
    : null;

  return <section className="page assignments-page" aria-busy={initialLoading}>
    <PageHead
      title="Assignments"
      sessionName={sessionName}
      description="Set each person's FSY responsibility, then connect Counselors to groups and Assistant Coordinators to companies."
      action={pageAction}
    />

    {!canManage ? <div className="notice"><WarningCircle/><div><b>View-only assignments</b><p>Administrative access is required to change staff roles or responsibilities.</p></div></div> : null}
    {error ? <MutationFeedback tone="error" className="assignment-page-feedback">{error}</MutationFeedback> : null}
    {notice ? <MutationFeedback className="assignment-page-feedback"><b>Saved</b> · {notice}</MutationFeedback> : null}

    <article className={`panel assignment-overview ${setupComplete ? "is-complete" : ""}`}>
      <div className="assignment-overview-head">
        <div>
          <span className="kicker">Assignment setup</span>
          <h2>{setupComplete ? "Staffing structure is complete" : initialLoading ? "Loading assignment status…" : assignmentIssues ? `${assignmentIssues} assignment ${assignmentIssues === 1 ? "item" : "items"} need attention` : "Review staff roles and responsibilities"}</h2>
          <p>{structure.published ? "Use the three steps below in any order. Changes save immediately." : "Start with staff roles. Group and company assignments unlock after Groups & companies is published."}</p>
        </div>
        {setupComplete ? <span className="assignment-complete-badge"><CheckCircle weight="fill"/>Complete</span> : null}
      </div>

      <div className="assignment-flow" aria-label="Assignment setup steps">
        <button type="button" className={roleNeeds ? "assignment-flow-step needs" : "assignment-flow-step"} onClick={() => scrollToAssignmentSection("assignment-staff-roles")}>
          <span className="assignment-step-number">1</span>
          <span><b>Staff roles</b><small>{roleNeeds ? `${roleNeeds} still need a clear role` : `${staff.length} staff classified`}</small></span>
          {roleNeeds ? <strong>{roleNeeds}</strong> : <CheckCircle weight="fill"/>}
        </button>
        <button type="button" className={groupsNeedingCounselor ? "assignment-flow-step needs" : "assignment-flow-step"} disabled={!structure.published} onClick={() => scrollToAssignmentSection("assignment-counselor-groups")}>
          <span className="assignment-step-number">2</span>
          <span><b>Counselor groups</b><small>{structure.published ? `${staffedGroups}/${groups.length} assigned` : "Available after publish"}</small></span>
          {structure.published ? (groupsNeedingCounselor ? <strong>{groupsNeedingCounselor}</strong> : <CheckCircle weight="fill"/>) : <span className="assignment-step-lock">Locked</span>}
        </button>
        <button type="button" className={companiesNeedingAC ? "assignment-flow-step needs" : "assignment-flow-step"} disabled={!structure.published} onClick={() => scrollToAssignmentSection("assignment-company-supervision")}>
          <span className="assignment-step-number">3</span>
          <span><b>Company supervision</b><small>{structure.published ? `${staffedCompanies}/${companies.length} assigned` : "Available after publish"}</small></span>
          {structure.published ? (companiesNeedingAC ? <strong>{companiesNeedingAC}</strong> : <CheckCircle weight="fill"/>) : <span className="assignment-step-lock">Locked</span>}
        </button>
      </div>

      {structure.published ? <div className="assignment-overview-foot">
        <span>{assistants.length} Assistant Coordinators · {requiredACs} recommended at {maxCompanyLoad} companies each</span>
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
        <p>Suggestions match available Counselors to groups and spread company supervision across Assistant Coordinators without exceeding {maxCompanyLoad} companies.</p>
        {!suggestions ? <div className="panel-actions"><span>{groupsNeedingCounselor} groups and {companiesNeedingAC} companies still need staff.</span><button className="secondary" onClick={suggest}><Sparkle/>Suggest assignments</button></div> : <>
          <div className="assignment-suggestion-summary"><span><b>{suggestions.counselors.length}</b><small>Counselor matches</small></span><span><b>{suggestions.assistants.length}</b><small>AC/company matches</small></span></div>
          {(suggestions.counselors.length || suggestions.assistants.length) ? <div className="assignment-preview-list">{[...suggestions.counselors.slice(0,4).map((item) => `${item.staffName} → ${item.groupName}`), ...suggestions.assistants.slice(0,4).map((item) => `${item.staffName} → ${item.companyName}`)].map((text) => <span key={text}>{text}</span>)}</div> : <p className="form-hint">No safe automatic matches are available. Classify more staff roles or resolve the remaining assignments manually.</p>}
          <div className="panel-actions"><button className="secondary" disabled={busy === "suggestions"} onClick={suggest}>Shuffle</button><button className="primary" disabled={busy === "suggestions" || (!suggestions.counselors.length && !suggestions.assistants.length)} onClick={applySuggestions}>{busy === "suggestions" ? "Applying…" : "Apply reviewed suggestions"}</button></div>
        </>}
      </div></div>
    </details> : null}

    <article id="assignment-staff-roles" className="panel assignment-role-panel assignment-workflow-section">
      <div className="assignment-section-head">
        <div className="assignment-section-title">
          <span className="assignment-section-step">1</span>
          <div><span className="kicker">Staff responsibility</span><h2>Staff roles</h2><p>Assignment and website access are separate. Choose each person's FSY responsibility here, then give app access only when needed.</p></div>
        </div>
        <Status tone={roleNeeds ? "warn" : "good"}>{roleNeeds ? `${roleNeeds} need review` : "Roles ready"}</Status>
      </div>

      <div className="assignment-toolbar">
        <SearchField value={query} onChange={setQuery} label="Search staff assignments" placeholder="Search name, unit or stake"/>
        <select aria-label="Filter staff roles" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
          <option value="all">All staff ({staff.length})</option>
          {Object.entries(ROLE_LABELS).map(([value, label]) => <option value={value} key={value}>{label} ({roleCounts[value] || 0})</option>)}
        </select>
      </div>

      <div className="assignment-list-meta"><span>{filteredStaff.length ? `Showing ${Math.min(staffRows.length, filteredStaff.length)} of ${filteredStaff.length}` : "No matching staff"}</span><small>Role changes save automatically</small></div>

      {staffRows.length ? <div className="assignment-staff-list">{staffRows.map((person) => {
        const assignmentText = person.counselorGroupId
          ? "Counselor group assigned"
          : person.companyIds.length
            ? `${person.companyIds.length} compan${person.companyIds.length === 1 ? "y" : "ies"}`
            : "No group or company assignment yet";
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
        const roleBusy = busy === `role-${person.id}`;
        return <div className={`assignment-staff-row ${roleBusy ? "is-saving" : ""}`} key={person.id}>
          <div className="assignment-person">
            <b>{person.name}</b>
            <small>{person.unit || "Unit not recorded"}{person.stake ? ` · ${person.stake}` : ""}</small>
            <span className="assignment-context">{assignmentText}</span>
          </div>
          <div className="assignment-row-controls">
            <label className="assignment-control">
              <span>FSY role</span>
              <select
                aria-label={`FSY role for ${person.name}`}
                disabled={!canManage || roleBusy}
                value={person.operationalRole}
                onChange={(event) => mutate(
                  `role-${person.id}`,
                  () => setStaffOperationalRole(person.id, event.target.value),
                  `${person.name}'s role was updated${access?.accessState === "active" ? " and website permissions were synchronized" : ""}.`,
                )}
              >{Object.entries(ROLE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
              {roleBusy ? <small className="assignment-saving" role="status">Saving…</small> : null}
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
            <div><span className="kicker">Youth support</span><h2>Counselor groups</h2><p>Connect one available Counselor to each counselor group.</p></div>
          </div>
          <Status tone={groupsNeedingCounselor ? "warn" : "good"}>{groupsNeedingCounselor ? `${groupsNeedingCounselor} left` : "Complete"}</Status>
        </div>
        <div className="assignment-progress" aria-label={`${groupProgress}% of counselor groups assigned`}><span style={{ width: `${groupProgress}%` }}/></div>
        <div className="filter-chips assignment-filter-chips" role="group" aria-label="Filter counselor groups">
          <button type="button" className={groupFilter === "needs" ? "active" : ""} onClick={() => setGroupFilter("needs")}>Needs Counselor <b>{groupsNeedingCounselor}</b></button>
          <button type="button" className={groupFilter === "filled" ? "active" : ""} onClick={() => setGroupFilter("filled")}>Assigned <b>{staffedGroups}</b></button>
          <button type="button" className={groupFilter === "all" ? "active" : ""} onClick={() => setGroupFilter("all")}>All <b>{groups.length}</b></button>
        </div>
        {shownGroups.length ? <div className="assignment-responsibility-list">{shownGroups.map((group) => {
          const current = staff.find((person) => person.id === group.counselorId);
          const options = counselors.filter((person) => (!person.counselorGroupId || person.counselorGroupId === group.id) && (!person.sex || person.sex === group.sex));
          const rowBusy = busy === `group-${group.id}`;
          return <div className={current ? "is-assigned" : "needs-assignment"} key={group.id}>
            <span><b>{group.displayName}</b><small>{group.sex === "Female" ? "YW" : "YM"} · {group.memberCount} youth</small></span>
            {current ? <div className="assigned-person"><span><small>Counselor</small><b>{current.name}</b></span>{canManage ? <button className="assignment-remove" disabled={rowBusy} onClick={() => mutate(`group-${group.id}`, () => unassignCounselorFromGroup(group.id), `${current.name} was removed from ${group.displayName}.`)}>{rowBusy ? "Removing…" : "Remove"}</button> : null}</div> : <div className="assignment-select-wrap"><select
              aria-label={`Assign Counselor to ${group.displayName}`}
              disabled={!canManage || rowBusy || !options.length}
              defaultValue=""
              onChange={(event) => event.target.value && mutate(`group-${group.id}`, () => assignCounselorToGroup(event.target.value, group.id), `Counselor assigned to ${group.displayName}.`)}
            ><option value="">{options.length ? "Choose Counselor…" : "No eligible Counselors"}</option>{options.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select>{rowBusy ? <small role="status">Saving…</small> : null}</div>}
          </div>;
        })}</div> : <div className="assignment-filter-empty success"><CheckCircle weight="fill"/><b>{groupFilter === "needs" ? "All counselor groups are assigned" : "Nothing in this view"}</b><span>{groupFilter === "needs" ? "There are no open Counselor spots right now." : "Choose another filter."}</span></div>}
      </article>

      <article id="assignment-company-supervision" className="panel assignment-responsibility-panel assignment-workflow-section">
        <div className="assignment-section-head">
          <div className="assignment-section-title">
            <span className="assignment-section-step">3</span>
            <div><span className="kicker">Leadership coverage</span><h2>Company supervision</h2><p>Assign one primary Assistant Coordinator to every company.</p></div>
          </div>
          <Status tone={companiesNeedingAC ? "warn" : "good"}>{companiesNeedingAC ? `${companiesNeedingAC} left` : "Complete"}</Status>
        </div>
        <div className="assignment-progress" aria-label={`${companyProgress}% of companies assigned`}><span style={{ width: `${companyProgress}%` }}/></div>
        <div className="assignment-capacity-note"><span>Capacity</span><b>{maxCompanyLoad} companies per AC</b><small>{assistants.length} ACs available · {requiredACs} recommended</small></div>
        <div className="filter-chips assignment-filter-chips" role="group" aria-label="Filter company supervision">
          <button type="button" className={companyFilter === "needs" ? "active" : ""} onClick={() => setCompanyFilter("needs")}>Needs AC <b>{companiesNeedingAC}</b></button>
          <button type="button" className={companyFilter === "filled" ? "active" : ""} onClick={() => setCompanyFilter("filled")}>Assigned <b>{staffedCompanies}</b></button>
          <button type="button" className={companyFilter === "all" ? "active" : ""} onClick={() => setCompanyFilter("all")}>All <b>{companies.length}</b></button>
        </div>
        {shownCompanies.length ? <div className="assignment-responsibility-list">{shownCompanies.map((company) => {
          const currentId = company.assistantCoordinatorIds[0];
          const current = staff.find((person) => person.id === currentId);
          const options = assistants.filter((person) => person.companyIds.includes(company.id) || person.companyIds.length < maxCompanyLoad);
          const rowBusy = busy === `company-${company.id}`;
          return <div className={current ? "is-assigned" : "needs-assignment"} key={company.id}>
            <span><b>{company.displayName}</b><small>{company.groups.length} counselor groups</small></span>
            {current ? <div className="assigned-person"><span><small>Assistant Coordinator</small><b>{current.name}</b><em>{current.companyIds.length}/{maxCompanyLoad} companies</em></span>{canManage ? <button className="assignment-remove" disabled={rowBusy} onClick={() => mutate(`company-${company.id}`, () => setStaffCompanyAssignment(current.id, company.id, false), `${current.name} was removed from ${company.displayName}${accessByStaff.get(current.id)?.accessState === "active" ? " and their website scope was updated" : ""}.`)}>{rowBusy ? "Removing…" : "Remove"}</button> : null}</div> : <div className="assignment-select-wrap"><select
              aria-label={`Assign Assistant Coordinator to ${company.displayName}`}
              disabled={!canManage || rowBusy || !options.length}
              defaultValue=""
              onChange={(event) => event.target.value && mutate(`company-${company.id}`, () => setStaffCompanyAssignment(event.target.value, company.id, true), `Assistant Coordinator assigned to ${company.displayName}.`)}
            ><option value="">{options.length ? "Choose Assistant Coordinator…" : "No AC has available capacity"}</option>{options.map((person) => <option value={person.id} key={person.id}>{person.name} · {person.companyIds.length}/{maxCompanyLoad}</option>)}</select>{rowBusy ? <small role="status">Saving…</small> : null}</div>}
          </div>;
        })}</div> : <div className="assignment-filter-empty success"><CheckCircle weight="fill"/><b>{companyFilter === "needs" ? "All companies have supervision" : "Nothing in this view"}</b><span>{companyFilter === "needs" ? "There are no open Assistant Coordinator spots right now." : "Choose another filter."}</span></div>}
      </article>
    </div> : <article className="panel assignment-publish-gate"><div className="assignment-filter-empty"><WarningCircle/><b>Publish Groups & companies to continue</b><span>Staff roles can be set now. Counselor-group and company assignments become available after the youth structure is published.</span></div></article>}

    {inviteTarget ? <StaffAccessInvite staff={inviteTarget} onClose={() => setInviteTarget(null)} onInvited={refresh}/> : null}
    {newLeaderOpen ? <NewLeaderSheet
      sessionId={sessionId}
      onClose={() => setNewLeaderOpen(false)}
      onCreated={async () => { await refresh(); setNotice("The leader was added to Assignments. Website access is still separate until you enable it."); }}
      onGiveAccess={(person) => { setNewLeaderOpen(false); setInviteTarget(person); }}
    /> : null}
  </section>;
}
