import { useEffect, useMemo, useState } from "react";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { UsersThree } from "@phosphor-icons/react/UsersThree";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { ConfirmActionSheet, DismissibleLayer, Empty, MutationFeedback, PageHead, SearchField, SegmentedControl, Status } from "../components/UI.jsx";
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
import { createManualStaffLeader, loadStaffAccessDirectory } from "../lib/staff-access.js";
import "./assignments.css";

const ROLE_LABELS = {
  counselor: "Counselor",
  assistant_coordinator: "Assistant coordinator",
  coordinator: "Coordinator",
  committee_member: "Committee member",
  logistics_admin: "Logistical administrator",
  session_director: "Session directing couple",
  other: "Other staff",
};
const ROLE_OPTIONS = Object.entries(ROLE_LABELS);
const WORKSPACES = [
  { value: "people", label: "People" },
  { value: "groups", label: "Counselor groups" },
  { value: "companies", label: "Companies" },
];

function companyLabel(company) { return company?.displayName || company?.name || "Company"; }
function groupLabel(group) { return group?.displayName || group?.name || "Counselor group"; }
function personInitials(name = "FSY") { return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase(); }

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
    counselors.push({ staffId: match.id, staffName: match.name, groupId: group.id, groupName: groupLabel(group) });
  }
  const assistants = staff.filter((person) => person.operationalRole === "assistant_coordinator"
    && person.registrationStatus === "approved" && person.isCurrent !== false);
  const loads = new Map(assistants.map((person) => [person.id, person.companyIds?.length || 0]));
  const assistantAssignments = [];
  for (const company of shuffled(companies.filter((item) => !item.assistantCoordinatorIds?.length))) {
    const candidate = [...assistants]
      .filter((person) => (loads.get(person.id) || 0) < maxCompanyLoad)
      .sort((left, right) => (loads.get(left.id) || 0) - (loads.get(right.id) || 0) || left.name.localeCompare(right.name))[0];
    if (!candidate) continue;
    assistantAssignments.push({ staffId: candidate.id, staffName: candidate.name, companyId: company.id, companyName: companyLabel(company) });
    loads.set(candidate.id, (loads.get(candidate.id) || 0) + 1);
  }
  return { counselors, assistants: assistantAssignments };
}

function goToAccess() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("view", "access");
  url.searchParams.delete("person");
  window.history.pushState({ view: "access" }, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new Event("popstate"));
}

function NewLeaderSheet({ sessionId, onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", role: "coordinator" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await createManualStaffLeader({ sessionId, name: form.name.trim(), role: form.role });
      await onCreated?.(form.role);
      onClose();
    } catch (err) { setError(err.message || "The leader could not be added."); }
    finally { setBusy(false); }
  };
  return <DismissibleLayer open onClose={() => !busy && onClose()} title="Add session leader" sheet className="assignment-v2-new-leader">
    <form className="field-sheet assignment-v2-new-leader-form" onSubmit={submit}>
      <button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} disabled={busy} aria-label="Close"><X /></button>
      <span className="kicker">Assignments</span>
      <h2>Add a session leader</h2>
      <p>Create their FSY responsibility here. Website sign-in is managed separately in Access after the assignment is ready.</p>
      <label>Full name<input autoFocus required minLength={2} maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} autoComplete="name" /></label>
      <label>FSY responsibility<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>{ROLE_OPTIONS.filter(([value]) => value !== "other").map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      {form.role === "assistant_coordinator" ? <div className="notice compact-notice"><Buildings /><div><b>Company scope comes next</b><p>After adding this person, use Companies to choose the companies they support.</p></div></div> : null}
      {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      <footer className="field-sheet-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="primary" disabled={busy || !form.name.trim()}><UserPlus />{busy ? "Adding…" : "Add leader"}</button></footer>
    </form>
  </DismissibleLayer>;
}

function AssignmentPicker({ title, description, query, setQuery, choices, emptyText, onPick, busy, onClose }) {
  return <DismissibleLayer open onClose={() => !busy && onClose()} title={title} sheet className="assignment-v2-picker-layer">
    <div className="field-sheet assignment-v2-picker">
      <button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} disabled={busy} aria-label="Close"><X /></button>
      <span className="kicker">Choose person</span><h2>{title}</h2><p>{description}</p>
      <SearchField value={query} onChange={setQuery} label="Search available people" placeholder="Name or unit" />
      <div className="assignment-v2-picker-list">{choices.length ? choices.map((person) => <button type="button" key={person.id} className="assignment-v2-picker-row" disabled={busy} onClick={() => onPick(person)}><span className="person-avatar">{personInitials(person.name)}</span><span><b>{person.name}</b><small>{[person.unit, person.stake].filter(Boolean).join(" · ") || ROLE_LABELS[person.operationalRole]}</small></span><strong>{busy === person.id ? "Assigning…" : "Choose"}</strong></button>) : <Empty title="No available person found" text={emptyText} />}</div>
    </div>
  </DismissibleLayer>;
}

export function Assignments({ sessionId, canManage = false, sessionName }) {
  const [staff, setStaff] = useState([]);
  const [structure, setStructure] = useState({ groups: [], companies: [], published: false });
  const [settings, setSettings] = useState({ companiesPerAssistantCoordinator: 4 });
  const [accessDirectory, setAccessDirectory] = useState([]);
  const [workspace, setWorkspace] = useState("people");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [groupQuery, setGroupQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("needs");
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState("needs");
  const [visibleStaff, setVisibleStaff] = useState(30);
  const [visibleGroups, setVisibleGroups] = useState(24);
  const [visibleCompanies, setVisibleCompanies] = useState(24);
  const [transitionTarget, setTransitionTarget] = useState(null);
  const [newLeaderOpen, setNewLeaderOpen] = useState(false);
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
    const [nextStaff, nextStructure, nextSettings] = await Promise.all([loadStaff(sessionId), loadOperationalStructure(sessionId), loadStructureSettings(sessionId)]);
    setStaff(nextStaff); setStructure(nextStructure); setSettings(nextSettings);
    try { setAccessDirectory(await loadStaffAccessDirectory(sessionId)); } catch { setAccessDirectory([]); }
  };

  useEffect(() => {
    let active = true;
    setInitialLoading(true); setError("");
    refresh().catch((err) => { if (active) setError(err.message || "Assignments could not be loaded."); }).finally(() => { if (active) setInitialLoading(false); });
    return () => { active = false; };
  }, [sessionId]);
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
  const issueCount = openGroups.length + openCompanies.length + overloadedACs.length;

  const filteredStaff = useMemo(() => {
    const text = query.trim().toLowerCase();
    return staff.filter((person) => (roleFilter === "all" || person.operationalRole === roleFilter)
      && (!text || `${person.name} ${person.unit || ""} ${person.stake || ""} ${ROLE_LABELS[person.operationalRole] || ""}`.toLowerCase().includes(text)));
  }, [staff, query, roleFilter]);

  const filteredGroups = useMemo(() => {
    const text = groupQuery.trim().toLowerCase();
    return groups.filter((group) => (groupFilter === "all" || (groupFilter === "needs" ? !group.counselorId : Boolean(group.counselorId)))
      && (!text || `${groupLabel(group)} ${companyLabel(companyById.get(group.companyId))} ${staffById.get(group.counselorId)?.name || ""}`.toLowerCase().includes(text)))
      .sort((a, b) => Number(Boolean(a.counselorId)) - Number(Boolean(b.counselorId)) || groupLabel(a).localeCompare(groupLabel(b), undefined, { numeric: true }));
  }, [groups, groupQuery, groupFilter, companyById, staffById]);

  const filteredCompanies = useMemo(() => {
    const text = companyQuery.trim().toLowerCase();
    return companies.filter((company) => (companyFilter === "all" || (companyFilter === "needs" ? !company.assistantCoordinatorIds?.length : Boolean(company.assistantCoordinatorIds?.length)))
      && (!text || `${companyLabel(company)} ${(company.assistantCoordinatorIds || []).map((id) => staffById.get(id)?.name || "").join(" ")}`.toLowerCase().includes(text)))
      .sort((a, b) => Number(Boolean(a.assistantCoordinatorIds?.length)) - Number(Boolean(b.assistantCoordinatorIds?.length)) || companyLabel(a).localeCompare(companyLabel(b), undefined, { numeric: true }));
  }, [companies, companyQuery, companyFilter, staffById]);

  const personContext = (person) => {
    if (person.operationalRole === "counselor") {
      const group = groups.find((item) => item.id === person.counselorGroupId);
      return group ? groupLabel(group) : "Available · no counselor group yet";
    }
    if (person.operationalRole === "assistant_coordinator") {
      const names = (person.companyIds || []).map((id) => companyLabel(companyById.get(id))).filter(Boolean);
      return names.length ? names.join(" · ") : "No companies assigned yet";
    }
    return "Whole session responsibility";
  };

  const changeRole = async (payload) => {
    if (!transitionTarget) return;
    setError("");
    await transitionStaffOperationalRole({ staffId: transitionTarget.person.id, role: transitionTarget.targetRole, ...payload });
    const target = transitionTarget.targetRole;
    setTransitionTarget(null);
    await refresh();
    setNotice(`${transitionTarget.person.name} is now ${ROLE_LABELS[target] || target}.`);
    if (target === "counselor") setWorkspace("groups");
    if (target === "assistant_coordinator") setWorkspace("companies");
  };

  const assignGroup = async (group, person) => {
    setBusy(person.id); setError("");
    try { await assignCounselorToGroup(person.id, group.id); await refresh(); setNotice(`${person.name} is now assigned to ${groupLabel(group)}.`); setPicker(null); }
    catch (err) { setError(err.message || "Counselor could not be assigned."); }
    finally { setBusy(""); }
  };

  const assignCompany = async (company, person) => {
    setBusy(person.id); setError("");
    try { await setStaffCompanyAssignment(person.id, company.id, true); await refresh(); setNotice(`${person.name} is now assigned to ${companyLabel(company)}.`); setPicker(null); }
    catch (err) { setError(err.message || "Assistant Coordinator could not be assigned."); }
    finally { setBusy(""); }
  };

  const unassignGroup = async (group) => {
    setBusy(group.id); setError("");
    try { await unassignCounselorFromGroup(group.id); await refresh(); setNotice(`${groupLabel(group)} now needs a Counselor.`); setRemoveGroup(null); }
    catch (err) { setError(err.message || "Counselor could not be removed."); }
    finally { setBusy(""); }
  };

  const unassignCompany = async (company, person) => {
    setBusy(company.id); setError("");
    try { await setStaffCompanyAssignment(person.id, company.id, false); await refresh(); setNotice(`${companyLabel(company)} now needs an Assistant Coordinator.`); setRemoveCompany(null); }
    catch (err) { setError(err.message || "Assistant Coordinator could not be removed."); }
    finally { setBusy(""); }
  };

  const previewSuggestions = () => setSuggestions(buildSuggestions(staff, groups, companies, maxCompanyLoad));
  const applySuggestions = async () => {
    if (!suggestions) return;
    setBusy("suggestions"); setError("");
    try { await applyStaffAssignmentPlan(sessionId, suggestions); await refresh(); setSuggestions(null); setNotice("Suggested coverage was applied. Review the remaining gaps before the session."); }
    catch (err) { setError(err.message || "Suggested assignments could not be applied."); }
    finally { setBusy(""); }
  };

  const openPicker = (type, target) => { setPicker({ type, target }); setPickerQuery(""); };
  const pickerChoices = useMemo(() => {
    if (!picker) return [];
    const text = pickerQuery.trim().toLowerCase();
    const base = picker.type === "group"
      ? counselors.filter((person) => !person.counselorGroupId && (!person.sex || person.sex === picker.target.sex))
      : assistants.filter((person) => (person.companyIds?.length || 0) < maxCompanyLoad);
    return base.filter((person) => !text || `${person.name} ${person.unit || ""} ${person.stake || ""}`.toLowerCase().includes(text));
  }, [picker, pickerQuery, counselors, assistants, maxCompanyLoad]);

  const pageAction = canManage ? <button className="primary" onClick={() => setNewLeaderOpen(true)}><UserPlus />Add leader</button> : null;

  return <section className="page assignments-v2">
    <PageHead title="Assignments" sessionName={sessionName} description="Set who serves where. Website sign-in is managed separately in Access." action={pageAction} />
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
    {notice ? <MutationFeedback>{notice}</MutationFeedback> : null}

    <div className="assignment-v2-overview">
      <div className="assignment-v2-overview-main"><span className="kicker">Assignment status</span><h2>{initialLoading ? "Loading assignments…" : issueCount ? `${issueCount} item${issueCount === 1 ? "" : "s"} need attention` : "Coverage is ready"}</h2><p>{openGroups.length} counselor groups open · {openCompanies.length} companies open{overloadedACs.length ? ` · ${overloadedACs.length} AC over limit` : ""}</p></div>
      <div className="assignment-v2-overview-actions">
        {canManage && issueCount ? <button className="secondary" type="button" onClick={previewSuggestions}><Sparkle />Suggest coverage</button> : null}
        <button className="secondary" type="button" onClick={goToAccess}>Open Access</button>
      </div>
    </div>

    {suggestions ? <article className="panel assignment-v2-suggestion">
      <div><span className="kicker">Review suggestion</span><h3>{suggestions.counselors.length + suggestions.assistants.length} gaps can be filled</h3><p>{suggestions.counselors.length} counselor groups · {suggestions.assistants.length} companies. Nothing changes until you apply it.</p></div>
      <div className="assignment-v2-suggestion-actions"><button className="secondary" onClick={() => setSuggestions(null)} disabled={busy === "suggestions"}>Cancel</button><button className="primary" onClick={applySuggestions} disabled={busy === "suggestions"}>{busy === "suggestions" ? "Applying…" : "Apply suggestion"}</button></div>
    </article> : null}

    <div className="assignment-v2-workspace-nav">
      <SegmentedControl label="Assignment workspaces" value={workspace} onChange={setWorkspace} options={WORKSPACES} />
      <p>{workspace === "people" ? "Change a person's FSY responsibility." : workspace === "groups" ? "Cover counselor groups with eligible Counselors." : "Set which Assistant Coordinator supports each company."}</p>
    </div>

    {workspace === "people" ? <article className="panel assignment-v2-workspace" id="assignment-staff-roles">
      <header className="assignment-v2-section-head"><div><span className="kicker">People</span><h2>FSY responsibilities</h2><p>Change responsibility here once. Linked website access follows automatically.</p></div><Status tone={staff.length ? "good" : "neutral"}>{staff.length} staff</Status></header>
      <div className="assignment-v2-toolbar"><SearchField value={query} onChange={setQuery} label="Search staff" placeholder="Name, unit or responsibility" /><label>Responsibility<select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}><option value="all">All responsibilities</option>{ROLE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      {filteredStaff.length ? <div className="assignment-v2-people-list">{filteredStaff.slice(0, visibleStaff).map((person) => <div className="assignment-v2-person-row" key={person.id}>
        <div className="assignment-v2-person"><span className="person-avatar">{personInitials(person.name)}</span><span><b>{person.name}</b><small>{[person.unit, person.stake].filter(Boolean).join(" · ") || "Current staff"}</small></span></div>
        <div className="assignment-v2-person-context"><small>Current assignment</small><b>{personContext(person)}</b></div>
        <label className="assignment-v2-role-select"><span>Responsibility</span><select value={person.operationalRole || "other"} disabled={!canManage} onChange={(event) => { const targetRole = event.target.value; if (targetRole !== person.operationalRole) setTransitionTarget({ person, targetRole }); }}><option value="counselor">Counselor</option><option value="assistant_coordinator">Assistant coordinator</option><option value="coordinator">Coordinator</option><option value="committee_member">Committee member</option><option value="logistics_admin">Logistical administrator</option><option value="session_director">Session directing couple</option><option value="other">Other staff</option></select></label>
      </div>)}</div> : <Empty title="No staff found" text="Try another name, unit or responsibility." />}
      {visibleStaff < filteredStaff.length ? <button type="button" className="secondary assignment-v2-show-more" onClick={() => setVisibleStaff((value) => value + 30)}>Show 30 more</button> : null}
    </article> : null}

    {workspace === "groups" ? <article className="panel assignment-v2-workspace" id="assignment-counselor-groups">
      <header className="assignment-v2-section-head"><div><span className="kicker">Counselor groups</span><h2>{openGroups.length ? `${openGroups.length} need a Counselor` : "Counselor groups are covered"}</h2><p>Open groups stay first so gaps are easy to finish.</p></div><Status tone={openGroups.length ? "warn" : "good"}>{groups.length - openGroups.length}/{groups.length} covered</Status></header>
      <div className="assignment-v2-toolbar"><SearchField value={groupQuery} onChange={setGroupQuery} label="Search counselor groups" placeholder="Group, company or Counselor" /><label>Show<select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}><option value="needs">Needs Counselor</option><option value="assigned">Assigned</option><option value="all">All groups</option></select></label></div>
      {filteredGroups.length ? <div className="assignment-v2-coverage-list">{filteredGroups.slice(0, visibleGroups).map((group) => { const counselor = staffById.get(group.counselorId); return <div className={`assignment-v2-coverage-row ${counsel ? "covered" : "open"}`} key={group.id}>
        <div><b>{groupLabel(group)}</b><small>{companyLabel(companyById.get(group.companyId))} · {group.sex === "Female" ? "YW" : "YM"} · {group.memberCount} youth</small></div>
        <div className="assignment-v2-current-person">{counselor ? <><span className="person-avatar">{personInitials(counselor.name)}</span><span><small>Counselor</small><b>{counselor.name}</b></span></> : <span><small>Status</small><b>Needs Counselor</b></span>}</div>
        <div className="assignment-v2-coverage-action">{counselor ? <button type="button" className="text-action danger-text" disabled={!canManage} onClick={() => setRemoveGroup({ group, counselor })}>Remove</button> : <button type="button" className="primary" disabled={!canManage} onClick={() => openPicker("group", group)}>Assign Counselor</button>}</div>
      </div>; })}</div> : <Empty title={groupFilter === "needs" ? "No counselor gaps" : "No groups found"} text={groupFilter === "needs" ? "Every counselor group currently has a Counselor." : "Change the filter or search."} />}
      {visibleGroups < filteredGroups.length ? <button type="button" className="secondary assignment-v2-show-more" onClick={() => setVisibleGroups((value) => value + 24)}>Show 24 more groups</button> : null}
    </article> : null}

    {workspace === "companies" ? <article className="panel assignment-v2-workspace" id="assignment-company-supervision">
      <header className="assignment-v2-section-head"><div><span className="kicker">Companies</span><h2>{openCompanies.length ? `${openCompanies.length} need an Assistant Coordinator` : "Companies are covered"}</h2><p>Company scope is defined here and automatically becomes the linked account's scope.</p></div><Status tone={openCompanies.length ? "warn" : "good"}>{companies.length - openCompanies.length}/{companies.length} covered</Status></header>
      <div className="assignment-v2-toolbar"><SearchField value={companyQuery} onChange={setCompanyQuery} label="Search companies" placeholder="Company or Assistant Coordinator" /><label>Show<select value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)}><option value="needs">Needs AC</option><option value="assigned">Assigned</option><option value="all">All companies</option></select></label></div>
      {overloadedACs.length ? <div className="notice compact-notice"><WarningCircle /><div><b>{overloadedACs.length} Assistant Coordinator{overloadedACs.length === 1 ? " is" : "s are"} above the {maxCompanyLoad}-company limit</b><p>Move company coverage before relying on the published assignment.</p></div></div> : null}
      {filteredCompanies.length ? <div className="assignment-v2-coverage-list">{filteredCompanies.slice(0, visibleCompanies).map((company) => { const assistant = staffById.get(company.assistantCoordinatorIds?.[0]); return <div className={`assignment-v2-coverage-row ${assistant ? "covered" : "open"}`} key={company.id}>
        <div><b>{companyLabel(company)}</b><small>{company.groups?.length || 0} counselor groups{company.meetingSpot ? ` · ${company.meetingSpot}` : ""}</small></div>
        <div className="assignment-v2-current-person">{assistant ? <><span className="person-avatar">{personInitials(assistant.name)}</span><span><small>Assistant Coordinator · {assistant.companyIds?.length || 0}/{maxCompanyLoad} companies</small><b>{assistant.name}</b></span></> : <span><small>Status</small><b>Needs Assistant Coordinator</b></span>}</div>
        <div className="assignment-v2-coverage-action">{assistant ? <button type="button" className="text-action danger-text" disabled={!canManage} onClick={() => setRemoveCompany({ company, assistant })}>Remove</button> : <button type="button" className="primary" disabled={!canManage} onClick={() => openPicker("company", company)}>Assign AC</button>}</div>
      </div>; })}</div> : <Empty title={companyFilter === "needs" ? "No company gaps" : "No companies found"} text={companyFilter === "needs" ? "Every company currently has an Assistant Coordinator." : "Change the filter or search."} />}
      {visibleCompanies < filteredCompanies.length ? <button type="button" className="secondary assignment-v2-show-more" onClick={() => setVisibleCompanies((value) => value + 24)}>Show 24 more companies</button> : null}
    </article> : null}

    {newLeaderOpen ? <NewLeaderSheet sessionId={sessionId} onClose={() => setNewLeaderOpen(false)} onCreated={async (role) => { await refresh(); setNotice("Leader added to Assignments."); if (role === "assistant_coordinator") setWorkspace("companies"); }} /> : null}
    {transitionTarget ? <StaffRoleTransitionSheet person={transitionTarget.person} targetRole={transitionTarget.targetRole} staff={staff} groups={groups} companies={companies} maxCompanyLoad={maxCompanyLoad} access={accessByStaff.get(transitionTarget.person.id)} onClose={() => setTransitionTarget(null)} onConfirm={changeRole} /> : null}
    {picker ? <AssignmentPicker title={picker.type === "group" ? `Assign ${groupLabel(picker.target)}` : `Assign ${companyLabel(picker.target)}`} description={picker.type === "group" ? "Choose an available same-sex Counselor. The assignment saves when you choose." : `Choose an Assistant Coordinator below the ${maxCompanyLoad}-company limit.`} query={pickerQuery} setQuery={setPickerQuery} choices={pickerChoices} emptyText={picker.type === "group" ? "No eligible available Counselor matches this group." : "No Assistant Coordinator currently has room for another company."} busy={busy} onClose={() => setPicker(null)} onPick={(person) => picker.type === "group" ? assignGroup(picker.target, person) : assignCompany(picker.target, person)} /> : null}
    {removeGroup ? <ConfirmActionSheet open title={`Remove ${removeGroup.counselor.name} from ${groupLabel(removeGroup.group)}?`} description="Their staff responsibility stays Counselor." impact="This counselor group will immediately return to Needs Counselor until someone else is assigned." confirmLabel="Remove Counselor" cancelLabel="Keep assignment" busy={busy === removeGroup.group.id} onClose={() => setRemoveGroup(null)} onConfirm={() => unassignGroup(removeGroup.group)} /> : null}
    {removeCompany ? <ConfirmActionSheet open title={`Remove ${removeCompany.assistant.name} from ${companyLabel(removeCompany.company)}?`} description="Their Assistant Coordinator responsibility stays unchanged." impact="This company will immediately return to Needs AC. Linked website scope will update with the assignment." confirmLabel="Remove from company" cancelLabel="Keep assignment" busy={busy === removeCompany.company.id} onClose={() => setRemoveCompany(null)} onConfirm={() => unassignCompany(removeCompany.company, removeCompany.assistant)} /> : null}
  </section>;
}
