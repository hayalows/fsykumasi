import { useEffect, useMemo, useState } from "react";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { CloudArrowUp } from "@phosphor-icons/react/CloudArrowUp";
import { FloppyDisk } from "@phosphor-icons/react/FloppyDisk";
import { GearSix } from "@phosphor-icons/react/GearSix";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { UsersThree } from "@phosphor-icons/react/UsersThree";
import { Empty, Metric, PageHead, Status } from "../components/UI.jsx";
import { buildBalancedAssignments } from "../lib/grouping.js";
import {
  DEFAULT_STRUCTURE_SETTINGS,
  assignCounselorToGroup,
  loadOperationalStructure,
  loadStaff,
  loadStructureSettings,
  saveStructureSettings,
  setStaffCompanyAssignment,
  unassignCounselorFromGroup,
  updateCompanyDetails,
  updateGroupDetails,
} from "../lib/operations.js";
import "./operations.css";

function shuffled(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapWith]] = [copy[swapWith], copy[index]];
  }
  return copy;
}

async function runInBatches(items, batchSize, action) {
  for (let index = 0; index < items.length; index += batchSize) {
    await Promise.all(items.slice(index, index + batchSize).map(action));
  }
}

function ageSummary(members = []) {
  const ages = members.map((person) => Number(person.age)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!ages.length) return "Ages not recorded";
  const distinct = [...new Set(ages)];
  if (distinct.length === 1) return `Age ${distinct[0]}`;
  return `Ages ${distinct[0]}–${distinct[distinct.length - 1]} · ${distinct.length} ages mixed`;
}

function makeStaffSuggestions(groups, companies, staff) {
  const unstaffedGroups = groups.filter((group) => !group.counselorId);
  const availableCounselors = staff.filter((person) =>
    person.operationalRole === "counselor"
    && person.registrationStatus === "approved"
    && person.isCurrent !== false
    && !person.counselorGroupId
  );

  const counselorSuggestions = [];
  for (const sex of ["Female", "Male"]) {
    const matchingGroups = shuffled(unstaffedGroups.filter((group) => group.sex === sex));
    const matchingStaff = shuffled(availableCounselors.filter((person) => !person.sex || person.sex === sex));
    const count = Math.min(matchingGroups.length, matchingStaff.length);
    for (let index = 0; index < count; index += 1) {
      counselorSuggestions.push({
        groupId: matchingGroups[index].id,
        groupName: matchingGroups[index].displayName || matchingGroups[index].name,
        staffId: matchingStaff[index].id,
        staffName: matchingStaff[index].name,
      });
    }
  }

  const assistantCoordinators = shuffled(staff.filter((person) =>
    person.operationalRole === "assistant_coordinator"
    && person.registrationStatus === "approved"
    && person.isCurrent !== false
  ));
  const companyLoads = new Map(assistantCoordinators.map((person) => [person.id, person.companyIds.length]));
  const assistantSuggestions = [];
  if (assistantCoordinators.length) {
    for (const company of shuffled(companies.filter((item) => !item.assistantCoordinatorIds.length))) {
      const selected = [...assistantCoordinators].sort((left, right) =>
        (companyLoads.get(left.id) || 0) - (companyLoads.get(right.id) || 0)
        || left.name.localeCompare(right.name)
      )[0];
      assistantSuggestions.push({
        companyId: company.id,
        companyName: company.displayName || company.name,
        staffId: selected.id,
        staffName: selected.name,
      });
      companyLoads.set(selected.id, (companyLoads.get(selected.id) || 0) + 1);
    }
  }

  return { counselors: shuffled(counselorSuggestions), assistants: shuffled(assistantSuggestions) };
}

function GroupRow({ group, members, staff, canManage, onRefresh }) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [customName, setCustomName] = useState(group.customName || "");
  const [busy, setBusy] = useState(false);
  const counselors = staff.filter((person) => person.operationalRole === "counselor" && person.registrationStatus === "approved" && person.isCurrent !== false && (!person.sex || person.sex === group.sex));
  const assigned = staff.find((person) => person.id === group.counselorId);

  const changeCounselor = async (value) => {
    setBusy(true);
    try {
      if (value) await assignCounselorToGroup(value, group.id);
      else await unassignCounselorFromGroup(group.id);
      await onRefresh();
    } finally { setBusy(false); }
  };
  const saveName = async () => {
    setBusy(true);
    try { await updateGroupDetails(group.id, customName); await onRefresh(); setRenaming(false); }
    finally { setBusy(false); }
  };

  return <div className={open ? "group-operation-block open" : "group-operation-block"}>
    <button className="group-disclosure" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <span className="disclosure-chevron" aria-hidden="true">{open ? "⌄" : "›"}</span>
      <span><b>{group.displayName}</b><small>{group.sex === "Female" ? "YW" : "YM"} · {group.memberCount} youth · {ageSummary(members)}</small></span>
      <Status tone={assigned ? "good" : "warn"}>{assigned ? "Staffed" : "Needs counselor"}</Status>
    </button>
    {open ? <div className="group-disclosed-content">
      <div className="group-members-head"><div><span className="kicker">Youth in this group</span><b>{members.length} assigned</b></div><small>Same-sex counselor group, ages intentionally blended where the data allows.</small></div>
      <div className="group-member-list">{members.map((person) => <div key={person.id}><span className="person-avatar">{`${person.firstName?.[0] || ""}${person.lastName?.[0] || ""}`}</span><span><b>{person.fullName}</b><small>Age {person.age ?? "?"} · {person.unit || "Unit not recorded"}</small></span></div>)}</div>
      {canManage ? <div className="group-manage-box"><label>Counselor<select disabled={busy} aria-label={`Counselor for ${group.displayName}`} value={group.counselorId || ""} onChange={(event) => changeCounselor(event.target.value)}><option value="">No counselor assigned</option>{counselors.map((person) => <option value={person.id} key={person.id}>{person.name}{person.counselorGroupId && person.counselorGroupId !== group.id ? " · already assigned" : ""}</option>)}</select></label>{renaming ? <div className="group-editor"><label>Group name<input value={customName} placeholder={group.name} onChange={(event) => setCustomName(event.target.value)}/></label><div className="inline-actions"><button className="secondary compact-button" onClick={() => { setCustomName(group.customName || ""); setRenaming(false); }}>Cancel</button><button className="primary compact-button" disabled={busy} onClick={saveName}><FloppyDisk/>{busy ? "Saving…" : "Save name"}</button></div></div> : <button className="text-action compact-text-action" onClick={() => setRenaming(true)}>Rename counselor group</button>}</div> : null}
    </div> : null}
  </div>;
}

function CompanyCard({ company, participantsByGroup, staff, canManage, onRefresh }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState({ customName: company.customName || "", scriptureReference: company.scriptureReference || "", meetingSpot: company.meetingSpot || "" });
  const assistants = company.assistantCoordinatorIds.map((id) => staff.find((person) => person.id === id)).filter(Boolean);
  const youthCount = company.groups.reduce((sum, group) => sum + Number(group.memberCount || 0), 0);
  const counselorCount = company.groups.filter((group) => group.counselorId).length;
  const fullyStaffed = assistants.length > 0 && counselorCount === company.groups.length;
  const saveCompany = async () => {
    setSaving(true);
    try { await updateCompanyDetails(company.id, values); await onRefresh(); setEditing(false); }
    finally { setSaving(false); }
  };

  return <article className={open ? "company-operation-card progressive-company open" : "company-operation-card progressive-company"}>
    <button className="company-disclosure" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <span className="disclosure-chevron" aria-hidden="true">{open ? "⌄" : "›"}</span>
      <span className="company-disclosure-copy"><b>{company.displayName}</b><small>{youthCount} youth · {company.groups.length} groups · {counselorCount}/{company.groups.length} counselors</small></span>
      <Status tone={fullyStaffed ? "good" : "warn"}>{fullyStaffed ? "Ready" : "Needs staff"}</Status>
    </button>
    {open ? <div className="company-disclosed-content">
      {(company.scriptureReference || company.meetingSpot) ? <div className="company-context-row">{company.scriptureReference ? <span><small>Scripture</small><b>{company.scriptureReference}</b></span> : null}{company.meetingSpot ? <span><small>Meeting spot</small><b>{company.meetingSpot}</b></span> : null}</div> : null}
      <div className="company-group-list">{company.groups.map((group) => <GroupRow key={group.id} group={group} members={participantsByGroup.get(group.id) || []} staff={staff} canManage={canManage} onRefresh={onRefresh}/>)}</div>
      <div className="company-staff-summary"><span className="kicker">Assistant coordinator</span>{assistants.length ? <div className="staff-progress">{assistants.map((person) => <span key={person.id}>{person.name}</span>)}</div> : <p>No assistant coordinator assigned yet.</p>}</div>
      {canManage ? <>{editing ? <div className="company-editor"><div className="editor-grid"><label>Company name<input value={values.customName} placeholder={company.name} onChange={(event) => setValues({ ...values, customName: event.target.value })}/></label><label>Scripture<input value={values.scriptureReference} placeholder="Optional" onChange={(event) => setValues({ ...values, scriptureReference: event.target.value })}/></label></div><label>Company meeting spot<input value={values.meetingSpot} placeholder="Optional location" onChange={(event) => setValues({ ...values, meetingSpot: event.target.value })}/></label><div className="inline-actions"><button className="secondary compact-button" onClick={() => setEditing(false)}>Cancel</button><button className="primary compact-button" disabled={saving} onClick={saveCompany}><FloppyDisk/>{saving ? "Saving…" : "Save details"}</button></div></div> : <button className="secondary compact-button" onClick={() => setEditing(true)}>Edit company details</button>}</> : null}
    </div> : null}
  </article>;
}

function DraftCompany({ company, targetGroups }) {
  const [open, setOpen] = useState(false);
  const youthCount = company.groups.reduce((sum, group) => sum + group.members.length, 0);
  return <div className="draft-company-row"><button onClick={() => setOpen((value) => !value)} aria-expanded={open}><span className="disclosure-chevron">{open ? "⌄" : "›"}</span><span><b>{company.name}</b><small>{youthCount} youth · {company.groups.length} groups</small></span><Status tone={company.groups.length === targetGroups ? "good" : "warn"}>{company.groups.length}/{targetGroups}</Status></button>{open ? <div className="draft-company-groups">{company.groups.map((group) => <div key={group.id}><b>{group.name}</b><small>{group.members.length} youth · {group.sex === "Female" ? "YW" : "YM"} · {ageSummary(group.members)}</small></div>)}</div> : null}</div>;
}

export function Groups({ participants, assignment, onPublish, live = false, canManage = false, sessionId, onNavigatePeople }) {
  const [settings, setSettings] = useState(DEFAULT_STRUCTURE_SETTINGS);
  const [draftSettings, setDraftSettings] = useState(DEFAULT_STRUCTURE_SETTINGS);
  const [structure, setStructure] = useState({ groups: [], companies: [], published: false });
  const [staff, setStaff] = useState([]);
  const [draft, setDraft] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [savingRules, setSavingRules] = useState(false);
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [visibleLimit, setVisibleLimit] = useState(20);
  const [staffSuggestions, setStaffSuggestions] = useState(null);
  const [staffingBusy, setStaffingBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    if (!live || !sessionId) return;
    const [nextSettings, nextStructure, nextStaff] = await Promise.all([loadStructureSettings(sessionId), loadOperationalStructure(sessionId), loadStaff(sessionId)]);
    setSettings(nextSettings); setDraftSettings(nextSettings); setStructure(nextStructure); setStaff(nextStaff);
  };
  useEffect(() => { refresh().catch((err) => setError(err.message || "Unable to load the current structure.")); }, [sessionId, live, assignment?.published]);
  useEffect(() => { setVisibleLimit(20); }, [companyQuery, companyFilter]);

  const currentPublished = live ? structure.published : Boolean(assignment?.published);
  const currentGroups = live ? structure.groups : (assignment?.groups || []);
  const currentCompanies = live ? structure.companies : (assignment?.companies || []);
  const counselorsAssigned = currentGroups.filter((group) => group.counselorId).length;
  const assistantCoordinatorsAssigned = staff.filter((person) => person.operationalRole === "assistant_coordinator" && person.companyIds.length).length;
  const publishedYouth = currentGroups.reduce((sum, group) => sum + Number(group.memberCount || 0), 0);
  const participantsByGroup = useMemo(() => participants.reduce((map, person) => {
    if (!person.groupId) return map;
    if (!map.has(person.groupId)) map.set(person.groupId, []);
    map.get(person.groupId).push(person);
    return map;
  }, new Map()), [participants]);

  const filteredCompanies = useMemo(() => {
    const text = companyQuery.trim().toLowerCase();
    return currentCompanies.filter((company) => {
      const needsStaff = !company.assistantCoordinatorIds.length || company.groups.some((group) => !group.counselorId);
      if (companyFilter === "needs" && !needsStaff) return false;
      if (companyFilter === "ready" && needsStaff) return false;
      if (!text) return true;
      const memberText = company.groups.flatMap((group) => participantsByGroup.get(group.id) || []).map((person) => `${person.fullName} ${person.unit || ""}`).join(" ");
      return `${company.name} ${company.displayName} ${company.scriptureReference || ""} ${company.meetingSpot || ""} ${company.groups.map((group) => group.displayName).join(" ")} ${memberText}`.toLowerCase().includes(text);
    });
  }, [currentCompanies, companyQuery, companyFilter, participantsByGroup]);
  const shownCompanies = filteredCompanies.slice(0, visibleLimit);

  const generate = () => {
    setError("");
    setDraft(buildBalancedAssignments(participants, {
      minSize: Number(draftSettings.groupMinSize), maxSize: Number(draftSettings.groupMaxSize), groupsPerCompany: Number(draftSettings.groupsPerCompany),
      useAgeBands: Boolean(draftSettings.useAgeBands), avoidSameUnit: Boolean(draftSettings.avoidSameUnit), balanceSexes: Boolean(draftSettings.balanceSexes),
    }));
  };
  const saveRules = async () => {
    if (!canManage || !sessionId) return;
    setSavingRules(true); setError("");
    try { await saveStructureSettings(sessionId, draftSettings); setSettings({ ...draftSettings }); generate(); }
    catch (err) { setError(err.message || "Grouping rules could not be saved."); }
    finally { setSavingRules(false); }
  };
  const publish = async () => {
    if (!draft || draft.issues?.length || !onPublish || !canManage) return;
    setPublishing(true); setError("");
    try { await onPublish(draft); setDraft(null); setStaffSuggestions(null); await refresh(); }
    catch (err) { setError(err.message || "Unable to publish this structure."); }
    finally { setPublishing(false); }
  };
  const suggestStaff = () => {
    setError("");
    setStaffSuggestions(makeStaffSuggestions(currentGroups, currentCompanies, staff));
  };
  const applyStaff = async () => {
    if (!staffSuggestions || !canManage) return;
    setStaffingBusy(true); setError("");
    try {
      await runInBatches(staffSuggestions.counselors, 6, (item) => assignCounselorToGroup(item.staffId, item.groupId));
      await runInBatches(staffSuggestions.assistants, 6, (item) => setStaffCompanyAssignment(item.staffId, item.companyId, true));
      setStaffSuggestions(null);
      await refresh();
    } catch (err) {
      setError(err.message || "Some staff assignments could not be saved. Refresh to review what was applied.");
      await refresh().catch(() => {});
    } finally { setStaffingBusy(false); }
  };

  const needCounselors = Math.max(0, currentGroups.length - counselorsAssigned);
  const needCompanyAC = currentCompanies.filter((company) => !company.assistantCoordinatorIds.length).length;

  return <section className="page groups-page">
    <PageHead title="Groups & companies" description="Start with the structure you need, then open only the company or group you want to work on." action={canManage ? <button className="primary" onClick={generate} disabled={!participants.length}><Sparkle/>{currentPublished ? "Try another structure" : "Build draft"}</button> : currentPublished ? <Status>Published</Status> : null}/>
    {error ? <div className="form-error page-error" role="alert">{error}</div> : null}

    <details className="panel progressive-section rules-disclosure" open={!currentPublished}>
      <summary><span><span className="kicker">Structure rules</span><b>{settings.groupMinSize}–{settings.groupMaxSize} youth/group · {settings.groupsPerCompany} groups/company</b><small>{settings.useAgeBands ? "Age bands currently separated" : "Ages mixed fairly by default"}</small></span><span className="summary-action">{currentPublished ? "Edit rules" : "Set rules"}</span></summary>
      <div className="progressive-section-body"><div className="notice green compact-notice"><UsersThree/><div><b>Mix ages, keep counselor groups same sex</b><p>The default spreads ages such as 14 and 17 across the same YW or YM counselor pool while still protecting the same-sex counselor-group structure.</p></div></div><div className="structure-settings core-structure-settings"><label>Minimum youth per group<input type="number" min="6" max="12" disabled={!canManage} value={draftSettings.groupMinSize} onChange={(event) => setDraftSettings({ ...draftSettings, groupMinSize: Number(event.target.value) })}/></label><label>Maximum youth per group<input type="number" min={draftSettings.groupMinSize} max="15" disabled={!canManage} value={draftSettings.groupMaxSize} onChange={(event) => setDraftSettings({ ...draftSettings, groupMaxSize: Number(event.target.value) })}/></label><label>Groups per company<select disabled={!canManage} value={draftSettings.groupsPerCompany} onChange={(event) => setDraftSettings({ ...draftSettings, groupsPerCompany: Number(event.target.value) })}>{[1,2,3,4,5,6].map((number) => <option value={number} key={number}>{number}{number === 4 ? " · e.g. 2 YW + 2 YM" : ""}</option>)}</select></label><label className="toggle-setting prominent-toggle"><input type="checkbox" disabled={!canManage} checked={!draftSettings.useAgeBands} onChange={(event) => setDraftSettings({ ...draftSettings, useAgeBands: !event.target.checked })}/><span><b>Mix ages fairly</b><small>Spread the available ages across counselor groups instead of clustering similar ages.</small></span></label></div><details className="advanced-settings"><summary>Advanced mixing options</summary><div className="structure-settings advanced-structure-grid"><label className="toggle-setting"><input type="checkbox" disabled={!canManage} checked={draftSettings.avoidSameUnit} onChange={(event) => setDraftSettings({ ...draftSettings, avoidSameUnit: event.target.checked })}/><span>Avoid repeating the same ward/branch in a counselor group where possible</span></label><label className="toggle-setting"><input type="checkbox" disabled={!canManage} checked={draftSettings.balanceSexes} onChange={(event) => setDraftSettings({ ...draftSettings, balanceSexes: event.target.checked })}/><span>Balance YW and YM counselor groups inside companies</span></label></div></details>{canManage ? <div className="panel-actions"><span>Nothing changes until you review and publish a draft.</span><button className="secondary" disabled={savingRules} onClick={saveRules}><FloppyDisk/>{savingRules ? "Saving…" : "Save rules & preview"}</button></div> : null}</div>
    </details>

    {draft ? <><div className="draft-banner"><div><b>Draft only · published structure stays unchanged</b><p>{draftSettings.useAgeBands ? "This draft separates age bands because age mixing is off." : "This draft deliberately spreads ages across each same-sex counselor pool."}</p></div><Status tone={draft.issues.length ? "warn" : "good"}>{draft.issues.length ? `${draft.issues.length} conflicts` : "Ready to publish"}</Status></div><div className="metrics-grid"><Metric label="Draft groups" value={draft.groups.length} note={`${draftSettings.groupMinSize}–${draftSettings.groupMaxSize} youth target`}/><Metric label="Draft companies" value={draft.companies.length} note={`${draftSettings.groupsPerCompany} groups preferred`} tone="light-blue"/><Metric label="Blocking conflicts" value={draft.issues.length} note={draft.issues.length ? "resolve before publishing" : "checks passed"} tone={draft.issues.length ? "yellow" : "green"}/><Metric label="Age approach" value={draftSettings.useAgeBands ? "Bands" : "Mixed"} note={draftSettings.useAgeBands ? "separated" : "fairly distributed"} tone="green"/></div><article className="panel"><div className="panel-head"><div><span className="kicker">Preview</span><h2>Open a draft company to inspect it</h2></div></div><div className="draft-company-list">{draft.companies.slice(0,10).map((company) => <DraftCompany key={company.id} company={company} targetGroups={Number(draftSettings.groupsPerCompany)}/>)}</div><div className="panel-actions"><span>Showing 10 of {draft.companies.length}. Publish only after the mix looks right.</span><button className="primary" disabled={!canManage || publishing || Boolean(draft.issues.length)} onClick={publish}><CloudArrowUp/>{publishing ? "Publishing…" : currentPublished ? "Replace published structure" : "Publish reviewed structure"}</button></div></article></> : null}

    {currentPublished ? <><div className="metrics-grid"><Metric label="Published groups" value={currentGroups.length} note={`${publishedYouth.toLocaleString()} youth assigned`}/><Metric label="Companies" value={currentCompanies.length} note="current structure" tone="light-blue"/><Metric label="Counselors" value={`${counselorsAssigned}/${currentGroups.length}`} note={needCounselors ? `${needCounselors} still needed` : "complete"} tone={needCounselors ? "yellow" : "green"}/><Metric label="Company AC coverage" value={`${currentCompanies.length - needCompanyAC}/${currentCompanies.length}`} note={needCompanyAC ? `${needCompanyAC} companies need an AC` : "complete"} tone={needCompanyAC ? "yellow" : "green"}/></div>
      {canManage ? <article className="panel staffing-assistant"><div className="panel-head"><div><span className="kicker">Staffing assistant</span><h2>Fill the unassigned places without picking one by one</h2></div><Sparkle size={22}/></div><p>Suggestions only fill empty assignments. Existing counselor and Assistant Coordinator assignments stay untouched.</p>{staffSuggestions ? <div className="staff-suggestion-review"><div className="staff-suggestion-counts"><span><b>{staffSuggestions.counselors.length}</b><small>counselor matches</small></span><span><b>{staffSuggestions.assistants.length}</b><small>company AC matches</small></span></div><div className="suggestion-sample">{[...staffSuggestions.counselors.slice(0,3).map((item) => `${item.staffName} → ${item.groupName}`), ...staffSuggestions.assistants.slice(0,3).map((item) => `${item.staffName} → ${item.companyName}`)].map((text) => <span key={text}>{text}</span>)}</div><div className="panel-actions"><button className="secondary" disabled={staffingBusy} onClick={suggestStaff}>Shuffle suggestions</button><button className="primary" disabled={staffingBusy || (!staffSuggestions.counselors.length && !staffSuggestions.assistants.length)} onClick={applyStaff}>{staffingBusy ? "Applying…" : "Apply reviewed suggestions"}</button></div></div> : <div className="panel-actions"><span>{needCounselors} counselor groups and {needCompanyAC} companies currently need staff.</span><button className="secondary" onClick={suggestStaff}><Sparkle/>Suggest assignments</button></div>}</article> : null}
      <article className="panel structure-directory"><div className="panel-head"><div><span className="kicker">Live structure</span><h2>Companies</h2></div>{canManage && onNavigatePeople ? <button className="secondary" onClick={onNavigatePeople}><UsersThree/>People & staff</button> : null}</div><div className="progressive-toolbar"><div className="search company-search"><MagnifyingGlass/><input value={companyQuery} onChange={(event) => setCompanyQuery(event.target.value)} placeholder="Search company, group, youth, ward or meeting spot"/></div><div className="filter-chips" role="group" aria-label="Filter companies"><button className={companyFilter === "all" ? "active" : ""} onClick={() => setCompanyFilter("all")}>All</button><button className={companyFilter === "needs" ? "active" : ""} onClick={() => setCompanyFilter("needs")}>Needs staff</button><button className={companyFilter === "ready" ? "active" : ""} onClick={() => setCompanyFilter("ready")}>Ready</button></div></div><p className="form-hint">Open one company, then one counselor group. Search also finds a company by a youth name or ward.</p><div className="progressive-company-list">{shownCompanies.map((company) => <CompanyCard key={company.id} company={company} participantsByGroup={participantsByGroup} staff={staff} canManage={canManage} onRefresh={refresh}/>)}{!shownCompanies.length ? <div className="empty-inline"><b>No company found</b><span>Try another search or filter.</span></div> : null}</div>{filteredCompanies.length > visibleLimit ? <button className="secondary show-more" onClick={() => setVisibleLimit((value) => value + 20)}>Show 20 more · {filteredCompanies.length - visibleLimit} remaining</button> : null}</article></> : !draft ? <article className="panel"><Empty icon={Buildings} title={participants.length ? "Ready to create the session structure" : "Import participants first"} text={participants.length ? `${participants.length.toLocaleString()} approved participants are ready. Choose the rules above and build a draft.` : "A grouping plan needs the approved participant list."}/></article> : null}
  </section>;
}
