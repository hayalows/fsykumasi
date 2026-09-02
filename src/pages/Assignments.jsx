import { useEffect, useMemo, useState } from "react";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { UsersThree } from "@phosphor-icons/react/UsersThree";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { Metric, PageHead, Status } from "../components/UI.jsx";
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

export function Assignments({ sessionId, canManage = false }) {
  const [staff, setStaff] = useState([]);
  const [structure, setStructure] = useState({ groups: [], companies: [], published: false });
  const [settings, setSettings] = useState({ companiesPerAssistantCoordinator: 4 });
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [visibleStaff, setVisibleStaff] = useState(30);
  const [groupFilter, setGroupFilter] = useState("needs");
  const [companyFilter, setCompanyFilter] = useState("needs");
  const [suggestions, setSuggestions] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = async () => {
    if (!sessionId) return;
    const [nextStaff, nextStructure, nextSettings] = await Promise.all([
      loadStaff(sessionId), loadOperationalStructure(sessionId), loadStructureSettings(sessionId),
    ]);
    setStaff(nextStaff); setStructure(nextStructure); setSettings(nextSettings);
  };

  useEffect(() => { refresh().catch((err) => setError(err.message || "Assignments could not be loaded.")); }, [sessionId]);
  useEffect(() => { setVisibleStaff(30); }, [query, roleFilter]);

  const groups = structure.groups || [];
  const companies = structure.companies || [];
  const counselors = staff.filter((person) => person.operationalRole === "counselor" && person.registrationStatus === "approved" && person.isCurrent !== false);
  const assistants = staff.filter((person) => person.operationalRole === "assistant_coordinator" && person.registrationStatus === "approved" && person.isCurrent !== false);
  const staffedGroups = groups.filter((group) => group.counselorId).length;
  const staffedCompanies = companies.filter((company) => company.assistantCoordinatorIds.length).length;
  const maxCompanyLoad = Number(settings.companiesPerAssistantCoordinator || 4);
  const requiredACs = companies.length ? Math.ceil(companies.length / Math.max(1, maxCompanyLoad)) : 0;
  const overloadedACs = assistants.filter((person) => person.companyIds.length > maxCompanyLoad);

  const staffRows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return staff.filter((person) => {
      if (roleFilter !== "all" && person.operationalRole !== roleFilter) return false;
      const haystack = `${person.name} ${person.unit || ""} ${person.stake || ""} ${person.operationalRole || ""}`.toLowerCase();
      return !text || haystack.includes(text);
    }).slice(0, visibleStaff);
  }, [staff, query, roleFilter, visibleStaff]);

  const shownGroups = groups.filter((group) => groupFilter === "all" || (groupFilter === "needs" ? !group.counselorId : Boolean(group.counselorId))).slice(0, 40);
  const shownCompanies = companies.filter((company) => companyFilter === "all" || (companyFilter === "needs" ? !company.assistantCoordinatorIds.length : Boolean(company.assistantCoordinatorIds.length))).slice(0, 40);

  const mutate = async (key, action, success) => {
    setBusy(key); setError(""); setNotice("");
    try { await action(); await refresh(); setSuggestions(null); if (success) setNotice(success); }
    catch (err) { setError(err.message || "Assignment could not be saved."); }
    finally { setBusy(""); }
  };

  const suggest = () => {
    setError(""); setNotice("");
    setSuggestions(buildSuggestions(staff, groups, companies, maxCompanyLoad));
  };

  const applySuggestions = async () => {
    if (!suggestions) return;
    await mutate("suggestions", () => applyStaffAssignmentPlan(sessionId, suggestions), "Reviewed staff suggestions were applied.");
  };

  return <section className="page assignments-page">
    <PageHead title="Assignments" description="First decide each staff member's FSY role. Then assign Counselors to counselor groups and Assistant Coordinators to companies without hidden or duplicate assignments." />
    {!canManage ? <div className="notice"><WarningCircle/><div><b>View-only assignments</b><p>Administrative access is required to change staff roles or responsibilities.</p></div></div> : null}
    {error ? <div className="form-error page-error" role="alert"><WarningCircle/>{error}</div> : null}
    {notice ? <div className="notice green" role="status"><CheckCircle/><div><b>Saved</b><p>{notice}</p></div></div> : null}

    <div className="metrics-grid compact assignment-metrics">
      <Metric label="Counselor groups" value={`${staffedGroups}/${groups.length}`} note={groups.length - staffedGroups ? `${groups.length - staffedGroups} need a Counselor` : "complete"} tone={groups.length - staffedGroups ? "yellow" : "green"}/>
      <Metric label="Assistant coordinators" value={assistants.length} note={`${requiredACs} needed at ${maxCompanyLoad} companies each`} tone={assistants.length < requiredACs ? "yellow" : "green"}/>
      <Metric label="Company supervision" value={`${staffedCompanies}/${companies.length}`} note={companies.length - staffedCompanies ? `${companies.length - staffedCompanies} still unassigned` : "complete"} tone={companies.length - staffedCompanies ? "yellow" : "green"}/>
      <Metric label="Load conflicts" value={overloadedACs.length} note={overloadedACs.length ? `above ${maxCompanyLoad}-company limit` : "none"} tone={overloadedACs.length ? "yellow" : "green"}/>
    </div>

    {canManage && structure.published ? <article className="panel assignment-assistant-card">
      <div className="panel-head"><div><span className="kicker">Assignment assistant</span><h2>Fill only the empty places</h2></div><Sparkle size={22}/></div>
      <p>Suggestions never replace existing Counselors or company supervision. An Assistant Coordinator stops receiving suggestions after {maxCompanyLoad} companies.</p>
      {!suggestions ? <div className="panel-actions"><span>{groups.length - staffedGroups} groups and {companies.length - staffedCompanies} companies still need staff.</span><button className="secondary" onClick={suggest}><Sparkle/>Suggest assignments</button></div> : <>
        <div className="assignment-suggestion-summary"><span><b>{suggestions.counselors.length}</b><small>Counselor matches</small></span><span><b>{suggestions.assistants.length}</b><small>AC/company matches</small></span></div>
        {(suggestions.counselors.length || suggestions.assistants.length) ? <div className="assignment-preview-list">{[...suggestions.counselors.slice(0,4).map((item) => `${item.staffName} → ${item.groupName}`), ...suggestions.assistants.slice(0,4).map((item) => `${item.staffName} → ${item.companyName}`)].map((text) => <span key={text}>{text}</span>)}</div> : <p className="form-hint">No safe automatic matches are available. Classify more staff roles or resolve the existing assignments below.</p>}
        <div className="panel-actions"><button className="secondary" disabled={busy === "suggestions"} onClick={suggest}>Shuffle</button><button className="primary" disabled={busy === "suggestions" || (!suggestions.counselors.length && !suggestions.assistants.length)} onClick={applySuggestions}>{busy === "suggestions" ? "Applying…" : "Apply reviewed suggestions"}</button></div>
      </>}
    </article> : null}

    <article className="panel assignment-role-panel">
      <div className="panel-head"><div><span className="kicker">Step 1</span><h2>Classify staff roles</h2></div><UsersThree size={22}/></div>
      <p className="form-hint">Changing a role does not create a responsibility. Existing responsibilities must be removed before a person's role can change.</p>
      <div className="assignment-toolbar"><div className="search"><MagnifyingGlass/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search original full name, ward or stake"/></div><select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}><option value="all">All staff roles</option>{Object.entries(ROLE_LABELS).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></div>
      <div className="assignment-staff-list">{staffRows.map((person) => {
        const assignmentText = person.counselorGroupId ? "Counselor group assigned" : person.companyIds.length ? `${person.companyIds.length} compan${person.companyIds.length === 1 ? "y" : "ies"}` : "No operational assignment";
        return <div className="assignment-staff-row" key={person.id}><span className="assignment-person"><b>{person.name}</b><small>{person.unit || "Unit not recorded"} · {assignmentText}</small></span><select disabled={!canManage || busy === `role-${person.id}`} value={person.operationalRole} onChange={(event) => mutate(`role-${person.id}`, () => setStaffOperationalRole(person.id,event.target.value), `${person.name}'s role was updated.`)}>{Object.entries(ROLE_LABELS).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></div>;
      })}</div>
      {staffRows.length < staff.filter((person) => roleFilter === "all" || person.operationalRole === roleFilter).length ? <button className="secondary show-more" onClick={() => setVisibleStaff((value) => value + 30)}>Show 30 more</button> : null}
    </article>

    {structure.published ? <div className="assignment-columns">
      <article className="panel assignment-responsibility-panel">
        <div className="panel-head"><div><span className="kicker">Step 2</span><h2>Counselor groups</h2></div><Status tone={groups.length === staffedGroups ? "good" : "warn"}>{staffedGroups}/{groups.length}</Status></div>
        <div className="filter-chips"><button className={groupFilter === "needs" ? "active" : ""} onClick={() => setGroupFilter("needs")}>Needs Counselor</button><button className={groupFilter === "filled" ? "active" : ""} onClick={() => setGroupFilter("filled")}>Assigned</button><button className={groupFilter === "all" ? "active" : ""} onClick={() => setGroupFilter("all")}>All</button></div>
        <div className="assignment-responsibility-list">{shownGroups.map((group) => {
          const current = staff.find((person) => person.id === group.counselorId);
          const options = counselors.filter((person) => (!person.counselorGroupId || person.counselorGroupId === group.id) && (!person.sex || person.sex === group.sex));
          return <div key={group.id}><span><b>{group.displayName}</b><small>{group.sex === "Female" ? "YW" : "YM"} · {group.memberCount} youth</small></span>{current ? <div className="assigned-person"><b>{current.name}</b>{canManage ? <button disabled={busy === `group-${group.id}`} onClick={() => mutate(`group-${group.id}`,() => unassignCounselorFromGroup(group.id),`${current.name} was removed from ${group.displayName}.`)}>Remove</button> : null}</div> : <select disabled={!canManage || busy === `group-${group.id}`} defaultValue="" onChange={(event) => event.target.value && mutate(`group-${group.id}`,() => assignCounselorToGroup(event.target.value,group.id),`Counselor assigned to ${group.displayName}.`)}><option value="">Assign Counselor…</option>{options.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select>}</div>;
        })}</div>
      </article>

      <article className="panel assignment-responsibility-panel">
        <div className="panel-head"><div><span className="kicker">Step 3</span><h2>Company supervision</h2></div><Status tone={companies.length === staffedCompanies ? "good" : "warn"}>{staffedCompanies}/{companies.length}</Status></div>
        <p className="form-hint">One primary Assistant Coordinator per company. One AC may supervise up to {maxCompanyLoad} companies.</p>
        <div className="filter-chips"><button className={companyFilter === "needs" ? "active" : ""} onClick={() => setCompanyFilter("needs")}>Needs AC</button><button className={companyFilter === "filled" ? "active" : ""} onClick={() => setCompanyFilter("filled")}>Assigned</button><button className={companyFilter === "all" ? "active" : ""} onClick={() => setCompanyFilter("all")}>All</button></div>
        <div className="assignment-responsibility-list">{shownCompanies.map((company) => {
          const currentId = company.assistantCoordinatorIds[0];
          const current = staff.find((person) => person.id === currentId);
          const options = assistants.filter((person) => person.companyIds.includes(company.id) || person.companyIds.length < maxCompanyLoad);
          return <div key={company.id}><span><b>{company.displayName}</b><small>{company.groups.length} counselor groups</small></span>{current ? <div className="assigned-person"><b>{current.name}</b><small>{current.companyIds.length}/{maxCompanyLoad} companies</small>{canManage ? <button disabled={busy === `company-${company.id}`} onClick={() => mutate(`company-${company.id}`,() => setStaffCompanyAssignment(current.id,company.id,false),`${current.name} was removed from ${company.displayName}.`)}>Remove</button> : null}</div> : <select disabled={!canManage || busy === `company-${company.id}`} defaultValue="" onChange={(event) => event.target.value && mutate(`company-${company.id}`,() => setStaffCompanyAssignment(event.target.value,company.id,true),`Assistant Coordinator assigned to ${company.displayName}.`)}><option value="">Assign Assistant Coordinator…</option>{options.map((person) => <option value={person.id} key={person.id}>{person.name} · {person.companyIds.length}/{maxCompanyLoad}</option>)}</select>}</div>;
        })}</div>
      </article>
    </div> : <article className="panel"><div className="empty-inline"><b>Publish Groups & companies first</b><span>Staff responsibilities become available after the youth structure exists.</span></div></article>}
  </section>;
}
