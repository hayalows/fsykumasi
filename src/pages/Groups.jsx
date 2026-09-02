import { useEffect, useMemo, useState } from "react";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { CloudArrowUp } from "@phosphor-icons/react/CloudArrowUp";
import { FloppyDisk } from "@phosphor-icons/react/FloppyDisk";
import { GearSix } from "@phosphor-icons/react/GearSix";
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
  updateCompanyDetails,
  updateGroupDetails,
} from "../lib/operations.js";
import "./operations.css";

function CompanyCard({ company, staff, canManage, onRefresh }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState({ customName: company.customName || "", scriptureReference: company.scriptureReference || "", meetingSpot: company.meetingSpot || "" });
  const counselors = staff.filter((person) => person.operationalRole === "counselor" && person.registrationStatus === "approved" && person.isCurrent !== false);
  const assistants = company.assistantCoordinatorIds.map((id) => staff.find((person) => person.id === id)).filter(Boolean);
  const youthCount = company.groups.reduce((sum, group) => sum + Number(group.memberCount || 0), 0);

  const saveCompany = async () => {
    setSaving(true);
    try { await updateCompanyDetails(company.id, values); await onRefresh(); setEditing(false); }
    finally { setSaving(false); }
  };

  return <div className="company-operation-card">
    <header><div><h3>{company.displayName}</h3><small>{company.name}{company.customName ? " · custom name saved" : ""} · {youthCount} youth</small></div><Status tone={company.groups.length >= 2 ? "good" : "warn"}>{company.groups.length} groups</Status></header>
    <div className="company-group-list">{company.groups.map((group) => {
      const assigned = staff.find((person) => person.id === group.counselorId);
      const compatible = counselors.filter((person) => !person.sex || person.sex === group.sex);
      return <div className="company-group-row" key={group.id}><span><b>{group.displayName}</b><small>{group.sex === "Female" ? "YW" : "YM"} · {group.memberCount} youth · {assigned ? assigned.name : "Counselor not assigned"}</small></span>{canManage ? <select aria-label={`Counselor for ${group.displayName}`} value={group.counselorId || ""} onChange={async (event) => { if (!event.target.value) return; await assignCounselorToGroup(event.target.value, group.id); await onRefresh(); }}><option value="">Choose counselor</option>{compatible.map((person) => <option value={person.id} key={person.id}>{person.name}{person.counselorGroupId && person.counselorGroupId !== group.id ? " · already assigned" : ""}</option>)}</select> : null}</div>;
    })}</div>
    <div className="staff-progress">{assistants.length ? assistants.map((person) => <span key={person.id}>{person.name} · AC</span>) : <span className="warn">No assistant coordinator assigned</span>}</div>
    {canManage ? <>{editing ? <div className="company-editor"><div className="editor-grid"><label>Company name<input value={values.customName} placeholder={company.name} onChange={(e) => setValues({ ...values, customName: e.target.value })}/></label><label>Scripture<input value={values.scriptureReference} placeholder="Optional" onChange={(e) => setValues({ ...values, scriptureReference: e.target.value })}/></label></div><label>Company meeting spot<input value={values.meetingSpot} placeholder="Optional location" onChange={(e) => setValues({ ...values, meetingSpot: e.target.value })}/></label><div className="inline-actions"><button className="secondary compact-button" onClick={() => setEditing(false)}>Cancel</button><button className="primary compact-button" disabled={saving} onClick={saveCompany}><FloppyDisk/>{saving ? "Saving…" : "Save details"}</button></div></div> : <button className="secondary compact-button" onClick={() => setEditing(true)}>Edit company details</button>}</> : null}
  </div>;
}

export function Groups({ participants, assignment, onPublish, live = false, canManage = false, sessionId, onNavigatePeople }) {
  const [settings, setSettings] = useState(DEFAULT_STRUCTURE_SETTINGS);
  const [draftSettings, setDraftSettings] = useState(DEFAULT_STRUCTURE_SETTINGS);
  const [structure, setStructure] = useState({ groups: [], companies: [], published: false });
  const [staff, setStaff] = useState([]);
  const [draft, setDraft] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [savingRules, setSavingRules] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    if (!live || !sessionId) return;
    const [nextSettings, nextStructure, nextStaff] = await Promise.all([loadStructureSettings(sessionId), loadOperationalStructure(sessionId), loadStaff(sessionId)]);
    setSettings(nextSettings); setDraftSettings(nextSettings); setStructure(nextStructure); setStaff(nextStaff);
  };
  useEffect(() => { refresh().catch((err) => setError(err.message || "Unable to load the current structure.")); }, [sessionId, live, assignment?.published]);

  const currentPublished = live ? structure.published : Boolean(assignment?.published);
  const currentGroups = live ? structure.groups : (assignment?.groups || []);
  const currentCompanies = live ? structure.companies : (assignment?.companies || []);
  const counselorsAssigned = currentGroups.filter((group) => group.counselorId).length;
  const assistantCoordinatorsAssigned = staff.filter((person) => person.operationalRole === "assistant_coordinator" && person.companyIds.length).length;
  const publishedYouth = currentGroups.reduce((sum, group) => sum + Number(group.memberCount || 0), 0);

  const preview = useMemo(() => draft || null, [draft]);
  const generate = () => {
    setError("");
    setDraft(buildBalancedAssignments(participants, {
      minSize: Number(draftSettings.groupMinSize), maxSize: Number(draftSettings.groupMaxSize),
      groupsPerCompany: Number(draftSettings.groupsPerCompany), useAgeBands: Boolean(draftSettings.useAgeBands),
      avoidSameUnit: Boolean(draftSettings.avoidSameUnit), balanceSexes: Boolean(draftSettings.balanceSexes),
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
    if (!preview || preview.issues?.length || !onPublish || !canManage) return;
    setPublishing(true); setError("");
    try { await onPublish(preview); setDraft(null); await refresh(); }
    catch (err) { setError(err.message || "Unable to publish this structure."); }
    finally { setPublishing(false); }
  };

  return <section className="page">
    <PageHead title="Groups & companies" description="Admins can try different structures safely. Nothing changes for the conference until a reviewed draft is published." action={canManage ? <button className="primary" onClick={generate} disabled={!participants.length}><Sparkle/>{currentPublished ? "Try a new structure" : "Build draft"}</button> : currentPublished ? <Status>Published</Status> : null}/>
    {error ? <div className="form-error page-error" role="alert">{error}</div> : null}

    <article className="panel">
      <div className="panel-head"><div><span className="kicker">Structure rules</span><h2>Decide how this session should be organized</h2></div><GearSix size={23}/></div>
      <p className="form-hint">You can change these numbers and generate as many previews as needed. Saving rules does not move anyone; publishing the draft does.</p>
      <div className="structure-settings"><label>Minimum youth per counselor group<input type="number" min="6" max="12" disabled={!canManage} value={draftSettings.groupMinSize} onChange={(e) => setDraftSettings({ ...draftSettings, groupMinSize: Number(e.target.value) })}/></label><label>Maximum youth per counselor group<input type="number" min={draftSettings.groupMinSize} max="15" disabled={!canManage} value={draftSettings.groupMaxSize} onChange={(e) => setDraftSettings({ ...draftSettings, groupMaxSize: Number(e.target.value) })}/></label><label>Counselor groups per company<select disabled={!canManage} value={draftSettings.groupsPerCompany} onChange={(e) => setDraftSettings({ ...draftSettings, groupsPerCompany: Number(e.target.value) })}>{[1,2,3,4,5,6].map((n) => <option value={n} key={n}>{n}{n === 4 ? " · e.g. 2 YW + 2 YM" : ""}</option>)}</select></label><label className="toggle-setting"><input type="checkbox" disabled={!canManage} checked={draftSettings.useAgeBands} onChange={(e) => setDraftSettings({ ...draftSettings, useAgeBands: e.target.checked })}/><span>Keep 14–15 and 16–18 companies separate</span></label><label className="toggle-setting"><input type="checkbox" disabled={!canManage} checked={draftSettings.avoidSameUnit} onChange={(e) => setDraftSettings({ ...draftSettings, avoidSameUnit: e.target.checked })}/><span>Avoid same ward/branch inside a counselor group</span></label><label className="toggle-setting"><input type="checkbox" disabled={!canManage} checked={draftSettings.balanceSexes} onChange={(e) => setDraftSettings({ ...draftSettings, balanceSexes: e.target.checked })}/><span>Balance YW and YM groups inside companies</span></label></div>
      <div className="structure-rule-summary"><span>{settings.groupMinSize}–{settings.groupMaxSize} youth/group</span><span>{settings.groupsPerCompany} groups/company</span><span>{settings.useAgeBands ? "Age bands on" : "Age bands off"}</span><span>{settings.avoidSameUnit ? "Unit mixing on" : "Unit repeats allowed"}</span></div>
      {canManage ? <div className="panel-actions"><span>Current saved rules are shown above.</span><button className="secondary" disabled={savingRules} onClick={saveRules}><FloppyDisk/>{savingRules ? "Saving…" : "Save rules & preview"}</button></div> : null}
    </article>

    {preview ? <>
      <div className="draft-banner"><div><b>Draft only · your current published structure is untouched</b><p>Review the numbers below. Publish only when you want this draft to become the operational structure.</p></div><Status tone={preview.issues.length ? "warn" : "good"}>{preview.issues.length ? `${preview.issues.length} conflicts` : "Ready to publish"}</Status></div>
      <div className="metrics-grid"><Metric label="Draft counselor groups" value={preview.groups.length} note={`${draftSettings.groupMinSize}–${draftSettings.groupMaxSize} target`} /><Metric label="Draft companies" value={preview.companies.length} note={`${draftSettings.groupsPerCompany} groups preferred`} tone="light-blue"/><Metric label="Blocking conflicts" value={preview.issues.length} note={preview.issues.length ? "resolve before publishing" : "automated checks passed"} tone={preview.issues.length ? "yellow" : "green"}/><Metric label="Draft youth" value={participants.length.toLocaleString()} note={`${preview.warnings?.length || 0} non-blocking warnings`} tone="green"/></div>
      <article className="panel"><div className="panel-head"><div><span className="kicker">Preview</span><h2>First companies in this draft</h2></div></div><div className="company-operations-grid">{preview.companies.slice(0,8).map((company) => <div className="company-operation-card" key={company.id}><header><div><h3>{company.name}</h3><small>{company.ageBand} · {company.groups.reduce((sum,g)=>sum+g.members.length,0)} youth</small></div><Status tone={company.groups.length === Number(draftSettings.groupsPerCompany) ? "good" : "warn"}>{company.groups.length} groups</Status></header><div className="company-group-list">{company.groups.map((group) => <div className="company-group-row" key={group.id}><span><b>{group.name}</b><small>{group.members.length} youth · {group.sex === "Female" ? "YW" : "YM"}</small></span></div>)}</div></div>)}</div><div className="panel-actions"><span>Showing {Math.min(8,preview.companies.length)} of {preview.companies.length} draft companies.</span><button className="primary" disabled={!canManage || publishing || Boolean(preview.issues.length)} onClick={publish}><CloudArrowUp/>{publishing ? "Publishing…" : currentPublished ? "Replace published structure" : "Publish reviewed structure"}</button></div></article>
    </> : null}

    {currentPublished ? <>
      <div className="metrics-grid"><Metric label="Published groups" value={currentGroups.length} note={`${publishedYouth.toLocaleString()} youth assigned`} /><Metric label="Companies" value={currentCompanies.length} note="current operational structure" tone="light-blue"/><Metric label="Counselors assigned" value={`${counselorsAssigned}/${currentGroups.length}`} note={counselorsAssigned === currentGroups.length ? "complete" : "staffing still needed"} tone={counselorsAssigned === currentGroups.length ? "green" : "yellow"}/><Metric label="Assistant coordinators" value={assistantCoordinatorsAssigned} note="with at least one company" tone="yellow"/></div>
      <article className="panel"><div className="panel-head"><div><span className="kicker">Live structure</span><h2>Companies, counselor groups & staff</h2></div>{canManage && onNavigatePeople ? <button className="secondary" onClick={onNavigatePeople}><UsersThree/>Open people & staff</button> : null}</div><p className="form-hint">Company names, scriptures and meeting spots can be updated without rebuilding groups. Counselor and assistant coordinator assignments are also editable.</p><div className="company-operations-grid">{currentCompanies.map((company) => <CompanyCard key={company.id} company={company} staff={staff} canManage={canManage} onRefresh={refresh}/>)}</div></article>
    </> : !preview ? <article className="panel"><Empty icon={Buildings} title={participants.length ? "Ready to create the session structure" : "Import participants first"} text={participants.length ? `${participants.length.toLocaleString()} approved participants are ready. Choose the rules above and build a draft.` : "A grouping plan needs the approved participant list."}/></article> : null}
  </section>;
}
