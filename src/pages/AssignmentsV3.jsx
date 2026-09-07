import { useEffect, useMemo, useState } from "react";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { LeaderSetupFlow } from "../components/LeaderSetupFlow.jsx";
import { ActionToast, ConfirmActionSheet, DismissibleLayer, Empty, MutationFeedback, PageHead, SearchField, SegmentedControl, Status } from "../components/UI.jsx";
import { StaffRoleTransitionSheet } from "../components/StaffRoleTransitionSheet.jsx";
import { applyStaffAssignmentPlan, assignCounselorToGroup, loadOperationalStructure, loadStaff, loadStructureSettings, setStaffCompanyAssignment, transitionStaffOperationalRole, unassignCounselorFromGroup } from "../lib/operations.js";
import { ACCOUNT_ROLES, accessStateLabel, loadStaffAccessDirectory } from "../lib/staff-access.js";
import "./assignments.css";

const ROLE_LABELS = { counselor: "Counselor", assistant_coordinator: "Assistant coordinator", coordinator: "Coordinator", committee_member: "Committee member", logistics_admin: "Logistical administrator", session_director: "Session directing couple", other: "Other staff" };
const ROLE_OPTIONS = Object.entries(ROLE_LABELS);
const WORKSPACES = [{ value: "people", label: "People" }, { value: "groups", label: "Counselor groups" }, { value: "companies", label: "Companies" }];

function companyLabel(company) { return company?.displayName || company?.name || "Company"; }
function groupLabel(group) { return group?.displayName || group?.name || "Counselor group"; }
function personInitials(name = "FSY") { return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase(); }

function goToAccess(filter = "all") {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("view", "access");
  if (filter && filter !== "all") url.searchParams.set("filter", filter);
  else url.searchParams.delete("filter");
  ["mode", "tab", "person", "staff", "company", "group"].forEach((key) => url.searchParams.delete(key));
  window.history.pushState({ view: "access", filter }, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new Event("popstate"));
}

function buildSuggestions(staff, groups, companies, maxCompanyLoad) {
  const freeCounselors = staff
    .filter((person) => person.operationalRole === "counselor" && person.registrationStatus === "approved" && person.isCurrent !== false && !person.counselorGroupId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const counselors = [];
  const used = new Set();
  for (const group of groups.filter((item) => !item.counselorId).sort((a, b) => groupLabel(a).localeCompare(groupLabel(b), undefined, { numeric: true }))) {
    const match = freeCounselors.find((person) => !used.has(person.id) && (!person.sex || person.sex === group.sex));
    if (match) {
      used.add(match.id);
      counselors.push({ staffId: match.id, staffName: match.name, groupId: group.id, groupName: groupLabel(group) });
    }
  }

  const assistants = staff
    .filter((person) => person.operationalRole === "assistant_coordinator" && person.registrationStatus === "approved" && person.isCurrent !== false)
    .sort((a, b) => a.name.localeCompare(b.name));
  const loads = new Map(assistants.map((person) => [person.id, person.companyIds?.length || 0]));
  const assistantAssignments = [];
  for (const company of companies.filter((item) => !item.assistantCoordinatorIds?.length).sort((a, b) => companyLabel(a).localeCompare(companyLabel(b), undefined, { numeric: true }))) {
    const candidate = [...assistants]
      .filter((person) => (loads.get(person.id) || 0) < maxCompanyLoad)
      .sort((a, b) => (loads.get(a.id) || 0) - (loads.get(b.id) || 0) || a.name.localeCompare(b.name))[0];
    if (!candidate) continue;
    assistantAssignments.push({ staffId: candidate.id, staffName: candidate.name, companyId: company.id, companyName: companyLabel(company) });
    loads.set(candidate.id, (loads.get(candidate.id) || 0) + 1);
  }
  return { counselors, assistants: assistantAssignments };
}

function AssignmentPicker({ title, description, query, setQuery, choices, emptyText, onPick, busy, onClose }) {
  return <DismissibleLayer open onClose={() => !busy && onClose()} title={title} sheet className="assignment-v2-picker-layer">
    <div className="field-sheet assignment-v2-picker">
      <button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} disabled={busy} aria-label="Close"><X /></button>
      <span className="kicker">Choose person</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <SearchField value={query} onChange={setQuery} label="Search available people" placeholder="Name or unit" />
      <div className="assignment-v2-picker-list">
        {choices.length ? choices.map((person) => <button type="button" key={person.id} className="assignment-v2-picker-row" disabled={busy} onClick={() => onPick(person)}>
          <span className="person-avatar">{personInitials(person.name)}</span>
          <span><b>{person.name}</b><small>{[person.unit, person.stake].filter(Boolean).join(" · ") || ROLE_LABELS[person.operationalRole]}</small></span>
          <strong>{busy === person.id ? "Assigning…" : "Choose"}</strong>
        </button>) : <Empty title="No available person found" text={emptyText} />}
      </div>
    </div>
  </DismissibleLayer>;
}

export function Assignments({ sessionId, canManage = false, initialWorkspace = "", initialFilter = "", initialStaffId = "", sessionName }) {
  const [staff, setStaff] = useState([]);
  const [structure, setStructure] = useState({ groups: [], companies: [], published: false });
  const [settings, setSettings] = useState({ companiesPerAssistantCoordinator: 4 });
  const [accessDirectory, setAccessDirectory] = useState([]);
  const [accessStatus, setAccessStatus] = useState("loading");
  const [workspace, setWorkspace] = useState(["people", "groups", "companies"].includes(initialWorkspace) ? initialWorkspace : "people");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [groupQuery, setGroupQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState(initialWorkspace === "groups" && initialFilter === "all" ? "all" : "needs");
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState("needs");
  const [visibleStaff, setVisibleStaff] = useState(30);
  const [visibleGroups, setVisibleGroups] = useState(24);
  const [visibleCompanies, setVisibleCompanies] = useState(24);
  const [transitionTarget, setTransitionTarget] = useState(null);
  const [setupTarget, setSetupTarget] = useState(null);
  const [picker, setPicker] = useState(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [removeGroup, setRemoveGroup] = useState(null);
  const [removeCompany, setRemoveCompany] = useState(null);
  const [suggestions, setSuggestions] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);

  const refresh = async () => {
    if (!sessionId) return;
    const [nextStaff, nextStructure, nextSettings] = await Promise.all([
      loadStaff(sessionId),
      loadOperationalStructure(sessionId),
      loadStructureSettings(sessionId),
    ]);
    setStaff(nextStaff);
    setStructure(nextStructure);
    setSettings(nextSettings);
    setAccessStatus("loading");
    try {
      setAccessDirectory(await loadStaffAccessDirectory(sessionId));
      setAccessStatus("ready");
    } catch {
      setAccessDirectory([]);
      setAccessStatus("unavailable");
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

  useEffect(() => {
    if (["people", "groups", "companies"].includes(initialWorkspace)) setWorkspace(initialWorkspace);
    if (initialWorkspace === "groups" && initialFilter) setGroupFilter(initialFilter === "all" ? "all" : "needs");
    if (initialWorkspace === "companies" && initialFilter) setCompanyFilter(initialFilter === "all" ? "all" : "needs");
  }, [initialWorkspace, initialFilter]);

  useEffect(() => setVisibleStaff(30), [query, roleFilter]);
  useEffect(() => setVisibleGroups(24), [groupQuery, groupFilter]);
  useEffect(() => setVisibleCompanies(24), [companyQuery, companyFilter]);

  const groups = structure.groups || [];
  const companies = structure.companies || [];
  const staffById = useMemo(() => new Map(staff.map((person) => [person.id, person])), [staff]);
  const companyById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const accessByStaff = useMemo(() => new Map(accessDirectory.map((item) => [item.staffId, item])), [accessDirectory]);
  const maxCompanyLoad = Number(settings.companiesPerAssistantCoordinator || 4);
  const currentStaff = staff.filter((person) => person.registrationStatus === "approved" && person.isCurrent !== false);
  const counselors = currentStaff.filter((person) => person.operationalRole === "counselor");
  const assistants = currentStaff.filter((person) => person.operationalRole === "assistant_coordinator");
  const openGroups = groups.filter((group) => !group.counselorId);
  const openCompanies = companies.filter((company) => !company.assistantCoordinatorIds?.length);
  const overloadedACs = assistants.filter((person) => (person.companyIds?.length || 0) > maxCompanyLoad);
  const accountSetupNeeded = accessStatus === "ready"
    ? currentStaff.filter((person) => ACCOUNT_ROLES.has(person.operationalRole)
      && (accessByStaff.get(person.id)?.accessState === "not_enabled"
        || (person.operationalRole === "assistant_coordinator" && !person.companyIds?.length))).length
    : 0;
  const issueCount = openGroups.length + openCompanies.length + overloadedACs.length;
  const hasAttention = issueCount > 0 || accountSetupNeeded > 0 || accessStatus === "unavailable";

  const filteredStaff = useMemo(() => {
    const text = query.trim().toLowerCase();
    return staff.filter((person) => (roleFilter === "all" || person.operationalRole === roleFilter)
      && (!text || `${person.name} ${person.unit || ""} ${person.stake || ""} ${ROLE_LABELS[person.operationalRole] || ""}`.toLowerCase().includes(text)));
  }, [staff, query, roleFilter]);

  const filteredGroups = useMemo(() => {
    const text = groupQuery.trim().toLowerCase();
    return groups
      .filter((group) => (groupFilter === "all" || (groupFilter === "needs" ? !group.counselorId : Boolean(group.counselorId)))
        && (!text || `${groupLabel(group)} ${companyLabel(companyById.get(group.companyId))} ${staffById.get(group.counselorId)?.name || ""}`.toLowerCase().includes(text)))
      .sort((a, b) => Number(Boolean(a.counselorId)) - Number(Boolean(b.counselorId)) || groupLabel(a).localeCompare(groupLabel(b), undefined, { numeric: true }));
  }, [groups, groupQuery, groupFilter, companyById, staffById]);

  const filteredCompanies = useMemo(() => {
    const text = companyQuery.trim().toLowerCase();
    return companies
      .filter((company) => (companyFilter === "all" || (companyFilter === "needs" ? !company.assistantCoordinatorIds?.length : Boolean(company.assistantCoordinatorIds?.length)))
        && (!text || `${companyLabel(company)} ${(company.assistantCoordinatorIds || []).map((id) => staffById.get(id)?.name || "").join(" ")}`.toLowerCase().includes(text)))
      .sort((a, b) => Number(Boolean(a.assistantCoordinatorIds?.length)) - Number(Boolean(b.assistantCoordinatorIds?.length)) || companyLabel(a).localeCompare(companyLabel(b), undefined, { numeric: true }));
  }, [companies, companyQuery, companyFilter, staffById]);

  useEffect(() => {
    if (!initialStaffId || !staff.length || setupTarget) return;
    const person = staff.find((item) => item.id === initialStaffId);
    if (person) {
      setWorkspace("people");
      setQuery(person.name);
    }
  }, [initialStaffId, staff]);

  const personContext = (person) => {
    if (person.operationalRole === "counselor") {
      const group = groups.find((item) => item.id === person.counselorGroupId);
      return group ? groupLabel(group) : "Available · no counselor group yet";
    }
    if (person.operationalRole === "assistant_coordinator") {
      const names = (person.companyIds || []).map((id) => companyLabel(companyById.get(id))).filter(Boolean);
      return names.length ? names.join(" · ") : "No companies assigned yet";
    }
    if (person.operationalRole === "committee_member") return "Committee responsibility";
    return "Whole session responsibility";
  };

  const setupPerson = (person) => {
    const access = accessByStaff.get(person.id) || {};
    return {
      staffId: person.id,
      name: person.name,
      operationalRole: person.operationalRole,
      companyIds: person.companyIds || [],
      companyNames: (person.companyIds || []).map((id) => companyLabel(companyById.get(id))).filter(Boolean),
      email: access.email || "",
      accountEmail: access.accountEmail || "",
      accessState: access.accessState || "not_enabled",
    };
  };

  const changeRole = async (payload) => {
    if (!transitionTarget) return;
    setError("");
    const personName = transitionTarget.person.name;
    const target = transitionTarget.targetRole;
    try {
      await transitionStaffOperationalRole({ staffId: transitionTarget.person.id, role: target, ...payload });
      setTransitionTarget(null);
      await refresh();
      setNotice(`${personName} is now ${ROLE_LABELS[target] || target}.`);
    } catch (err) {
      setError(err.message || "This responsibility could not be changed.");
      throw err;
    }
  };

  const assignGroup = async (group, person) => {
    setBusy(person.id);
    setError("");
    try {
      await assignCounselorToGroup(person.id, group.id);
      await refresh();
      setNotice(`${person.name} is assigned to ${groupLabel(group)}.`);
      setPicker(null);
    } catch (err) {
      setError(err.message || "Counselor could not be assigned.");
    } finally {
      setBusy("");
    }
  };

  const assignCompany = async (company, person) => {
    setBusy(person.id);
    setError("");
    try {
      await setStaffCompanyAssignment(person.id, company.id, true);
      await refresh();
      setNotice(`${person.name} is assigned to ${companyLabel(company)}.`);
      setPicker(null);
    } catch (err) {
      setError(err.message || "Assistant Coordinator could not be assigned.");
    } finally {
      setBusy("");
    }
  };

  const unassignGroup = async (group) => {
    setBusy(group.id);
    setError("");
    try {
      await unassignCounselorFromGroup(group.id);
      await refresh();
      setNotice(`${groupLabel(group)} now needs a Counselor.`);
      setRemoveGroup(null);
    } catch (err) {
      setError(err.message || "Counselor could not be removed.");
    } finally {
      setBusy("");
    }
  };

  const unassignCompany = async (company, person) => {
    setBusy(company.id);
    setError("");
    try {
      await setStaffCompanyAssignment(person.id, company.id, false);
      await refresh();
      setNotice(`${companyLabel(company)} now needs an Assistant Coordinator.`);
      setRemoveCompany(null);
    } catch (err) {
      setError(err.message || "Assistant Coordinator could not be removed.");
    } finally {
      setBusy("");
    }
  };

  const previewSuggestions = () => setSuggestions(buildSuggestions(staff, groups, companies, maxCompanyLoad));
  const suggestionRows = useMemo(() => suggestions ? [
    ...(suggestions.counselors || []).map((item) => ({ key: `group:${item.groupId}`, type: "Counselor", person: item.staffName, target: item.groupName })),
    ...(suggestions.assistants || []).map((item) => ({ key: `company:${item.companyId}`, type: "Assistant Coordinator", person: item.staffName, target: item.companyName })),
  ] : [], [suggestions]);

  const applySuggestions = async () => {
    if (!suggestions || !suggestionRows.length) return;
    setBusy("suggestions");
    setError("");
    try {
      await applyStaffAssignmentPlan(sessionId, suggestions);
      await refresh();
      setSuggestions(null);
      setNotice(`${suggestionRows.length} suggested assignments were applied.`);
    } catch (err) {
      setError(err.message || "Suggested assignments could not be applied.");
    } finally {
      setBusy("");
    }
  };

  const openPicker = (type, target) => {
    setPicker({ type, target });
    setPickerQuery("");
  };

  const pickerChoices = useMemo(() => {
    if (!picker) return [];
    const text = pickerQuery.trim().toLowerCase();
    const base = picker.type === "group"
      ? counselors.filter((person) => !person.counselorGroupId && (!person.sex || person.sex === picker.target.sex))
      : assistants.filter((person) => (person.companyIds?.length || 0) < maxCompanyLoad);
    return base.filter((person) => !text || `${person.name} ${person.unit || ""} ${person.stake || ""}`.toLowerCase().includes(text));
  }, [picker, pickerQuery, counselors, assistants, maxCompanyLoad]);

  const openWorkspace = (nextWorkspace, showNeeds = true) => {
    setWorkspace(nextWorkspace);
    if (nextWorkspace === "groups") setGroupFilter(showNeeds ? "needs" : "all");
    if (nextWorkspace === "companies") setCompanyFilter(showNeeds ? "needs" : "all");
    window.setTimeout(() => document.getElementById("assignments-v15-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  return <section className="page assignments-v3 assignments-v15">
    <PageHead
      title="Assignments"
      sessionName={sessionName}
      description="Set FSY responsibilities and coverage. Website access stays linked to the assignment."
      action={canManage ? <button className="primary" onClick={() => setSetupTarget({ newLeader: true })}><UserPlus />Add & set up leader</button> : null}
    />
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}

    <div className="assignments-v3-summary">
      <div>
        <span className="kicker">Session setup</span>
        <h2>{initialLoading ? "Loading assignments…" : hasAttention ? "A few things still need attention" : "Leader setup is ready"}</h2>
        <p>{openGroups.length} counselor groups open · {openCompanies.length} companies open · {accessStatus === "ready" ? `${accountSetupNeeded} leaders need access` : accessStatus === "loading" ? "checking website access" : "website access needs a check"}</p>
      </div>
      {canManage && issueCount ? <button className="secondary" type="button" onClick={previewSuggestions}><Sparkle />Suggest coverage</button> : null}
    </div>

    <div className="assignments-v15-quick" aria-label="Setup work">
      <button type="button" className={openGroups.length ? "needs" : "done"} onClick={() => openWorkspace("groups", Boolean(openGroups.length))}>
        <span>Counselor groups</span>
        <b>{openGroups.length ? `${openGroups.length} still need a Counselor` : "All counselor groups are covered"}</b>
        <small>{openGroups.length ? "Open the gaps first and assign eligible Counselors." : "Open all groups if you need to review coverage."}</small>
      </button>
      <button type="button" className={openCompanies.length || overloadedACs.length ? "needs" : "done"} onClick={() => openWorkspace("companies", Boolean(openCompanies.length))}>
        <span>Companies</span>
        <b>{openCompanies.length ? `${openCompanies.length} still need an Assistant Coordinator` : overloadedACs.length ? `${overloadedACs.length} Assistant Coordinator load issue${overloadedACs.length === 1 ? "" : "s"}` : "All companies are covered"}</b>
        <small>{overloadedACs.length ? `Keep each Assistant Coordinator at or below ${maxCompanyLoad} companies.` : "Review company coverage and Assistant Coordinator load."}</small>
      </button>
      <button type="button" className={accessStatus !== "ready" || accountSetupNeeded ? "needs" : "done"} onClick={() => goToAccess(accountSetupNeeded ? "needs" : "all")}>
        <span>Website access</span>
        <b>{accessStatus === "loading" ? "Checking sign-in status…" : accessStatus === "unavailable" ? "Check Access" : accountSetupNeeded ? `${accountSetupNeeded} leaders still need access` : "Leader access is ready"}</b>
        <small>{accessStatus === "unavailable" ? "Assignments loaded, but website access status did not. Open Access to check it directly." : "Invite people and manage sign-in from Access."}</small>
      </button>
    </div>

    {suggestions ? <article className="panel assignments-v15-suggestion">
      <div className="assignments-v15-suggestion-head">
        <div>
          <span className="kicker">Review before applying</span>
          <h3>{suggestionRows.length ? `${suggestionRows.length} gaps can be filled` : "No safe automatic matches"}</h3>
          <p>{suggestionRows.length ? "Check each proposed person and destination. Nothing changes until you apply it." : "There are gaps, but the current available staff cannot fill them safely within the rules."}</p>
        </div>
        <button type="button" className="secondary" disabled={busy === "suggestions"} onClick={() => setSuggestions(null)}>Close</button>
      </div>
      {suggestionRows.length ? <div className="assignments-v15-suggestion-list">
        {suggestionRows.slice(0, 12).map((item) => <div key={item.key}>
          <span><small>{item.type}</small><b>{item.person}</b></span>
          <strong aria-hidden="true">→</strong>
          <span><small>Assign to</small><b>{item.target}</b></span>
        </div>)}
      </div> : <Empty title="Nothing safe to apply automatically" text="Assign these gaps manually so you can choose the right person with the right context." />}
      {suggestionRows.length > 12 ? <p className="assignments-v15-more-suggestions">Plus {suggestionRows.length - 12} more assignments in this plan.</p> : null}
      <div className="assignment-v2-suggestion-actions">
        {suggestionRows.length ? <button className="primary" onClick={applySuggestions} disabled={busy === "suggestions"}>{busy === "suggestions" ? "Applying…" : `Apply ${suggestionRows.length} assignments`}</button> : null}
      </div>
    </article> : null}

    <div className="assignments-v3-nav">
      <SegmentedControl label="Assignment workspaces" value={workspace} onChange={setWorkspace} options={WORKSPACES} />
      <p>{workspace === "people" ? "Change a responsibility or finish a leader's setup in context." : workspace === "groups" ? "Cover counselor groups with eligible Counselors." : "Set which Assistant Coordinator supports each company."}</p>
    </div>

    {workspace === "people" ? <article id="assignments-v15-workspace" className="panel assignments-v3-workspace">
      <header className="assignments-v3-section-head">
        <div><span className="kicker">People</span><h2>Leaders & responsibilities</h2><p>Assignment is the source of truth. Website access is shown here only when it helps you finish the job.</p></div>
        <Status tone={staff.length ? "good" : "neutral"}>{staff.length} staff</Status>
      </header>
      <div className="assignments-v3-toolbar">
        <SearchField value={query} onChange={setQuery} label="Search staff" placeholder="Name, unit or responsibility" />
        <label>Responsibility<select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}><option value="all">All responsibilities</option>{ROLE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      {filteredStaff.length ? <div className="assignments-v3-people">
        {filteredStaff.slice(0, visibleStaff).map((person) => {
          const access = accessByStaff.get(person.id);
          const accountRole = ACCOUNT_ROLES.has(person.operationalRole);
          const committeeStaff = person.operationalRole === "committee_member";
          const incomplete = person.operationalRole === "assistant_coordinator" && !person.companyIds?.length;
          const setupNeeded = accessStatus === "ready" && accountRole && (incomplete || !access || access.accessState === "not_enabled");
          return <div className={`assignments-v3-person-row ${setupNeeded ? "needs-setup" : ""}`} key={person.id}>
            <div className="assignments-v3-person"><span className="person-avatar">{personInitials(person.name)}</span><span><b>{person.name}</b><small>{[person.unit, person.stake].filter(Boolean).join(" · ") || "Current staff"}</small></span></div>
            <div className="assignments-v3-context"><small>Assignment</small><b>{personContext(person)}</b></div>
            <label className="assignments-v3-role"><span>Responsibility</span><select value={person.operationalRole || "other"} disabled={!canManage} onChange={(event) => { const targetRole = event.target.value; if (targetRole !== person.operationalRole) setTransitionTarget({ person, targetRole }); }}>{ROLE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <div className="assignments-v3-access">
              {committeeStaff ? <>
                <small>Website</small>
                <span className="assignments-v15-committee-note">Committee access is managed in Access</span>
                <button type="button" className="text-action" onClick={() => goToAccess("all")}>Open Access</button>
              </> : accountRole ? accessStatus === "unavailable" ? <>
                <small>Website</small>
                <Status tone="neutral">Status unavailable</Status>
                <button type="button" className="text-action" onClick={() => goToAccess("all")}>Open Access</button>
              </> : <>
                <small>Website</small>
                <Status tone={access?.accessState === "active" ? "good" : access?.accessState === "invited" ? "warn" : "neutral"}>{accessStatus === "loading" ? "Checking…" : incomplete ? "Setup incomplete" : accessStateLabel(access?.accessState || "not_enabled")}</Status>
                {canManage && accessStatus === "ready" && (setupNeeded || access?.accessState === "invited") ? <button type="button" className="text-action" onClick={() => setSetupTarget(setupPerson(person))}>{incomplete ? "Finish setup" : access?.accessState === "invited" ? "New setup link" : "Set up access"}</button> : null}
              </> : <small className="assignments-v3-no-access">Website access is not part of this responsibility</small>}
            </div>
          </div>;
        })}
      </div> : <Empty title="No staff found" text="Try another name, unit or responsibility." />}
      {visibleStaff < filteredStaff.length ? <button type="button" className="secondary assignment-v2-show-more" onClick={() => setVisibleStaff((value) => value + 30)}>Show 30 more</button> : null}
    </article> : null}

    {workspace === "groups" ? <article id="assignments-v15-workspace" className="panel assignments-v3-workspace">
      <header className="assignments-v3-section-head">
        <div><span className="kicker">Counselor groups</span><h2>{openGroups.length ? `${openGroups.length} need a Counselor` : "Counselor groups are covered"}</h2><p>Open groups stay first so gaps are easy to finish.</p></div>
        <Status tone={openGroups.length ? "warn" : "good"}>{groups.length - openGroups.length}/{groups.length} covered</Status>
      </header>
      <div className="assignments-v3-toolbar">
        <SearchField value={groupQuery} onChange={setGroupQuery} label="Search counselor groups" placeholder="Group, company or Counselor" />
        <label>Show<select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}><option value="needs">Needs Counselor</option><option value="assigned">Assigned</option><option value="all">All groups</option></select></label>
      </div>
      {filteredGroups.length ? <div className="assignments-v3-coverage">
        {filteredGroups.slice(0, visibleGroups).map((group) => {
          const counselor = staffById.get(group.counselorId);
          return <div className={`assignments-v3-coverage-row ${counselor ? "covered" : "open"}`} key={group.id}>
            <div><b>{groupLabel(group)}</b><small>{companyLabel(companyById.get(group.companyId))} · {group.sex === "Female" ? "YW" : "YM"} · {group.memberCount} youth</small></div>
            <div>{counselor ? <><small>Counselor</small><b>{counselor.name}</b></> : <><small>Status</small><b>Needs Counselor</b></>}</div>
            <div>{counselor ? <button type="button" className="text-action danger-text" disabled={!canManage} onClick={() => setRemoveGroup({ group, counselor })}>Remove</button> : <button type="button" className="primary" disabled={!canManage} onClick={() => openPicker("group", group)}>Assign Counselor</button>}</div>
          </div>;
        })}
      </div> : <Empty title={groupFilter === "needs" ? "No counselor gaps" : "No groups found"} text={groupFilter === "needs" ? "Every counselor group currently has a Counselor." : "Change the filter or search."} />}
      {visibleGroups < filteredGroups.length ? <button type="button" className="secondary assignment-v2-show-more" onClick={() => setVisibleGroups((value) => value + 24)}>Show 24 more groups</button> : null}
    </article> : null}

    {workspace === "companies" ? <article id="assignments-v15-workspace" className="panel assignments-v3-workspace">
      <header className="assignments-v3-section-head">
        <div><span className="kicker">Companies</span><h2>{openCompanies.length ? `${openCompanies.length} need an Assistant Coordinator` : "Companies are covered"}</h2><p>Company assignment stays authoritative and linked website scope follows it automatically.</p></div>
        <Status tone={openCompanies.length ? "warn" : "good"}>{companies.length - openCompanies.length}/{companies.length} covered</Status>
      </header>
      <div className="assignments-v3-toolbar">
        <SearchField value={companyQuery} onChange={setCompanyQuery} label="Search companies" placeholder="Company or Assistant Coordinator" />
        <label>Show<select value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)}><option value="needs">Needs AC</option><option value="assigned">Assigned</option><option value="all">All companies</option></select></label>
      </div>
      {overloadedACs.length ? <div className="notice compact-notice"><WarningCircle /><div><b>{overloadedACs.length} Assistant Coordinator{overloadedACs.length === 1 ? " is" : "s are"} above the {maxCompanyLoad}-company limit</b><p>Move company coverage before relying on the assignment.</p></div></div> : null}
      {filteredCompanies.length ? <div className="assignments-v3-coverage">
        {filteredCompanies.slice(0, visibleCompanies).map((company) => {
          const assistant = staffById.get(company.assistantCoordinatorIds?.[0]);
          return <div className={`assignments-v3-coverage-row ${assistant ? "covered" : "open"}`} key={company.id}>
            <div><b>{companyLabel(company)}</b><small>{company.groups?.length || 0} counselor groups{company.meetingSpot ? ` · ${company.meetingSpot}` : ""}</small></div>
            <div>{assistant ? <><small>Assistant Coordinator · {assistant.companyIds?.length || 0}/{maxCompanyLoad} companies</small><b>{assistant.name}</b></> : <><small>Status</small><b>Needs Assistant Coordinator</b></>}</div>
            <div>{assistant ? <button type="button" className="text-action danger-text" disabled={!canManage} onClick={() => setRemoveCompany({ company, assistant })}>Remove</button> : <button type="button" className="primary" disabled={!canManage} onClick={() => openPicker("company", company)}>Assign AC</button>}</div>
          </div>;
        })}
      </div> : <Empty title={companyFilter === "needs" ? "No company gaps" : "No companies found"} text={companyFilter === "needs" ? "Every company currently has an Assistant Coordinator." : "Change the filter or search."} />}
      {visibleCompanies < filteredCompanies.length ? <button type="button" className="secondary assignment-v2-show-more" onClick={() => setVisibleCompanies((value) => value + 24)}>Show 24 more companies</button> : null}
    </article> : null}

    {setupTarget ? <LeaderSetupFlow sessionId={sessionId} person={setupTarget.newLeader ? null : setupTarget} onClose={() => setSetupTarget(null)} onComplete={async (person) => { await refresh(); setNotice(`${person.name}'s leader setup is complete.`); }} /> : null}
    {transitionTarget ? <StaffRoleTransitionSheet person={transitionTarget.person} targetRole={transitionTarget.targetRole} staff={staff} groups={groups} companies={companies} maxCompanyLoad={maxCompanyLoad} access={accessByStaff.get(transitionTarget.person.id)} onClose={() => setTransitionTarget(null)} onConfirm={changeRole} /> : null}
    {picker ? <AssignmentPicker title={picker.type === "group" ? `Assign ${groupLabel(picker.target)}` : `Assign ${companyLabel(picker.target)}`} description={picker.type === "group" ? "Choose an available same-sex Counselor. The assignment saves when you choose." : `Choose an Assistant Coordinator below the ${maxCompanyLoad}-company limit.`} query={pickerQuery} setQuery={setPickerQuery} choices={pickerChoices} emptyText={picker.type === "group" ? "No eligible available Counselor matches this group." : "No Assistant Coordinator currently has room for another company."} busy={busy} onClose={() => setPicker(null)} onPick={(person) => picker.type === "group" ? assignGroup(picker.target, person) : assignCompany(picker.target, person)} /> : null}
    {removeGroup ? <ConfirmActionSheet open title={`Remove ${removeGroup.counselor.name} from ${groupLabel(removeGroup.group)}?`} description="Their staff responsibility stays Counselor." impact="This counselor group will return to Needs Counselor until someone else is assigned." confirmLabel="Remove Counselor" cancelLabel="Keep assignment" busy={busy === removeGroup.group.id} onClose={() => setRemoveGroup(null)} onConfirm={() => unassignGroup(removeGroup.group)} /> : null}
    {removeCompany ? <ConfirmActionSheet open title={`Remove ${removeCompany.assistant.name} from ${companyLabel(removeCompany.company)}?`} description="Their Assistant Coordinator responsibility stays unchanged." impact="This company will return to Needs AC. Linked website scope updates automatically." confirmLabel="Remove from company" cancelLabel="Keep assignment" busy={busy === removeCompany.company.id} onClose={() => setRemoveCompany(null)} onConfirm={() => unassignCompany(removeCompany.company, removeCompany.assistant)} /> : null}
    <ActionToast message={notice} onDismiss={() => setNotice("")} />
  </section>;
}
