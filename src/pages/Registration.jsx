import { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "@phosphor-icons/react/Check";
import { CloudArrowUp } from "@phosphor-icons/react/CloudArrowUp";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { PageHead, Status } from "../components/UI.jsx";
import { parseParticipantFile } from "../lib/import.js";
import { loadLatestImport } from "../lib/operations.js";
import { validateManualParticipant } from "../lib/registration.js";
import "./operations.css";

const emptyManual = { firstName: "", lastName: "", preferredName: "", sex: "Female", age: "", unit: "", stake: "", birthday: "" };

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function Registration({ imported, setImported, groups = [], onApply, onAdd, onVerify, onAssign, live = false, canManage = true, canAdd = true, canVerify = false, sessionId }) {
  const input = useRef();
  const [tab, setTab] = useState("snapshot");
  const [result, setResult] = useState(null);
  const [latestImport, setLatestImport] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState({ tone: "", text: "" });
  const [search, setSearch] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState(emptyManual);
  const [groupChoice, setGroupChoice] = useState({});

  const refreshLatest = async () => {
    if (live && sessionId) setLatestImport(await loadLatestImport(sessionId));
  };
  useEffect(() => { refreshLatest().catch(() => {}); }, [live, sessionId]);

  const pending = imported.filter((person) => person.sourceKind === "on_site" && person.verificationStatus === "pending");
  const readyToAssign = groups.length ? imported.filter((person) => person.status === "Expected" && !person.groupId) : [];
  const quality = useMemo(() => ({
    awaiting: imported.filter((p) => p.registrationStatus === "awaiting").length,
    cancelled: imported.filter((p) => p.registrationStatus === "cancelled").length,
    omitted: imported.filter((p) => p.reconciliationStatus === "missing_from_latest").length,
    unassigned: imported.filter((p) => p.status === "Expected" && !p.groupId).length,
  }), [imported]);
  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query.length < 2) return [];
    return imported.filter((p) => `${p.fullName} ${p.preferredName || ""} ${p.registrationId || ""} ${p.unit || ""} ${p.stake || ""}`.toLowerCase().includes(query)).slice(0, 10);
  }, [imported, search]);

  const choose = async (file) => {
    if (!file) return;
    setBusy(true); setMessage({ tone: "", text: "" }); setFilename(file.name); setUploadOpen(true);
    try { setResult(await parseParticipantFile(file)); }
    catch (error) { setResult(null); setMessage({ tone: "error", text: error.message }); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!result?.records?.length || result.errors.length || !canManage) return;
    setApplying(true); setMessage({ tone: "", text: "" });
    try {
      const summary = onApply ? await onApply({ records: result.records, sourceFilename: filename, sourceSha256: result.sourceSha256 }) : null;
      if (!onApply) setImported(result.approvedParticipants);
      await refreshLatest();
      setMessage({ tone: "success", text: summary ? `${summary.participant_count} youth and ${summary.staff_count} staff records reconciled safely.` : `${result.records.length} records loaded.` });
      setResult(null); setUploadOpen(false);
    } catch (error) { setMessage({ tone: "error", text: error.message || "Unable to apply this snapshot." }); }
    finally { setApplying(false); }
  };
  const addManual = async (event) => {
    event.preventDefault(); setApplying(true); setMessage({ tone: "", text: "" });
    try {
      const errors = validateManualParticipant(manual, true);
      if (errors.length) throw new Error(errors[0]);
      await onAdd?.(manual); setManual(emptyManual); setManualOpen(false); setSearch("");
      setMessage({ tone: "success", text: "On-site participant added for verification. They are not checked in yet." });
    } catch (error) { setMessage({ tone: "error", text: error.message || "Unable to add this participant." }); }
    finally { setApplying(false); }
  };
  const verify = async (id, approved) => {
    setApplying(true); setMessage({ tone: "", text: "" });
    try { await onVerify?.(id, approved); setMessage({ tone: "success", text: approved ? "Participant verified and ready for assignment." : "Addition rejected and kept in the audit history." }); }
    catch (error) { setMessage({ tone: "error", text: error.message || "Unable to complete verification." }); }
    finally { setApplying(false); }
  };
  const assign = async (person) => {
    const groupId = groupChoice[person.id];
    if (!groupId) return setMessage({ tone: "error", text: "Choose a compatible group first." });
    setApplying(true); setMessage({ tone: "", text: "" });
    try { await onAssign?.(person.id, groupId); setMessage({ tone: "success", text: `${person.fullName} is assigned and ready for check-in.` }); }
    catch (error) { setMessage({ tone: "error", text: error.message || "Unable to assign this participant." }); }
    finally { setApplying(false); }
  };

  return <section className="page">
    <PageHead title="Registration" description="Keep one current registration list, update it safely when a newer export arrives, and handle day-of additions without duplicate work." />
    <div className="segmented registration-tabs" role="tablist">
      <button className={tab === "snapshot" ? "active" : ""} onClick={() => setTab("snapshot")}>Current list</button>
      <button className={tab === "onsite" ? "active" : ""} onClick={() => setTab("onsite")}>Add on-site{pending.length ? ` (${pending.length})` : ""}</button>
      <button className={tab === "quality" ? "active" : ""} onClick={() => setTab("quality")}>Data quality</button>
    </div>
    {message.text ? <div className={message.tone === "error" ? "form-error page-error" : "auth-success"} role="status">{message.tone === "success" ? <Check weight="bold" /> : <WarningCircle />}<span>{message.text}</span></div> : null}

    {tab === "snapshot" ? <>
      {latestImport ? <article className="panel current-registration-card"><div className="snapshot-main"><span className="snapshot-check"><Check weight="bold" size={22}/></span><div><span className="kicker">Current registration</span><h2>{latestImport.recordCount.toLocaleString()} people loaded</h2><p>Last updated {formatDate(latestImport.createdAt)} · {latestImport.sourceFilename}</p><div className="snapshot-metrics"><span><b>{latestImport.participantCount.toLocaleString()}</b><small>participants</small></span><span><b>{latestImport.staffCount.toLocaleString()}</b><small>staff</small></span><span><b>{latestImport.omittedCount}</b><small>omitted in update</small></span><span><b>{latestImport.exceptionCount}</b><small>protected exceptions</small></span></div></div></div>{canManage ? <button className="secondary" onClick={() => setUploadOpen((open) => !open)}><CloudArrowUp/>{uploadOpen ? "Close update" : "Upload updated export"}</button> : null}</article> : null}

      {!latestImport || uploadOpen ? <>
        <div className="notice"><WarningCircle size={21}/><div><b>{latestImport ? "This will update the current snapshot, not create a second list" : "Your first export becomes the current snapshot"}</b><p>Matching people are updated, new people are added, and people omitted from a newer export are reconciled safely. On-site additions are never overwritten.</p></div></div>
        <article className="panel import-card"><span className="kicker">{latestImport ? "Update registration" : "First import"}</span><h2>{latestImport ? "Choose the newer complete export" : "Choose the complete registration export"}</h2><p>The mixed Participant and Counselor CSV/Excel export is supported. The raw file stays on this device until you confirm the reviewed snapshot.</p><button className="dropzone" disabled={!canManage} onClick={() => input.current?.click()}><CloudArrowUp size={32}/><b>{busy ? "Reading file…" : latestImport ? "Choose updated CSV or Excel file" : "Choose CSV or Excel file"}</b><span>Up to 5,000 rows · nothing is applied until you review it</span></button><input ref={input} hidden type="file" accept=".csv,.xlsx,.xls" onChange={(event) => choose(event.target.files?.[0])}/></article>
      </> : null}

      {result ? <article className="panel"><div className="panel-head"><div><span className="kicker">Review before applying</span><h2>What this file contains</h2></div><Status tone={result.errors.length ? "danger" : "good"}>{result.errors.length ? `${result.errors.length} blocking` : "Ready to apply"}</Status></div><div className="metrics-grid compact import-summary"><div><span>Youth</span><strong>{result.summary.participants.toLocaleString()}</strong></div><div><span>Staff</span><strong>{result.summary.staff.toLocaleString()}</strong></div><div><span>Awaiting</span><strong>{result.summary.awaiting}</strong></div><div><span>Cancelled</span><strong>{result.summary.cancelled}</strong></div><div><span>FSY birthdays</span><strong>{result.summary.birthdays}</strong></div></div>{result.errors.length || result.warnings.length ? <div className="error-list">{[...result.errors, ...result.warnings].slice(0, 12).map((issue, index) => <p key={`${issue.row}-${index}`}><b>Row {issue.row}:</b> {issue.message}{issue.severity === "warning" ? " · review recommended" : ""}</p>)}</div> : null}<div className="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Unit</th></tr></thead><tbody>{result.records.slice(0, 8).map((person) => <tr key={person.sourceKey}><td><b>{person.fullName}</b></td><td>{person.personType === "counselor" ? "Staff" : "Youth"}</td><td>{person.registrationStatus}</td><td>{person.unit || "Missing"}</td></tr>)}</tbody></table></div><div className="panel-actions"><span>{result.warnings.length} review warnings · {result.summary.total.toLocaleString()} total</span><button className="primary" disabled={Boolean(result.errors.length) || applying || !canManage} onClick={apply}>{applying ? "Reconciling…" : latestImport ? "Apply updated snapshot" : "Apply complete snapshot"}<Check/></button></div></article> : null}
    </> : null}

    {tab === "onsite" ? <>
      <article className="panel"><span className="kicker">1 · Search first</span><h2>Find the person before adding them</h2><p className="form-hint">This searches the registration list you already imported, so a day-of addition does not become duplicate work.</p><div className="search"><MagnifyingGlass/><input value={search} onChange={(e) => { setSearch(e.target.value); setManualOpen(false); }} placeholder="Search name, preferred name, registration ID, ward or stake" autoComplete="off"/></div>{search.trim().length >= 2 ? <div className="check-list onsite-search-results">{matches.map((person) => <div className="onsite-match" key={person.id}><span className="person-avatar">{person.firstName?.[0]}{person.lastName?.[0]}</span><span><b>{person.fullName}</b><small>{person.unit || "Unit missing"} · {person.registrationStatus}</small></span><Status tone={person.status === "Expected" ? "good" : "warn"}>{person.status}</Status></div>)}{!matches.length ? <div className="empty-inline"><b>No close match found</b><span>Check spelling and unit before creating a new record.</span></div> : null}</div> : null}{canAdd && search.trim().length >= 2 ? <button className="secondary add-after-search" onClick={() => setManualOpen(true)}><UserPlus/>Still not listed — add on-site</button> : null}</article>
      {manualOpen ? <form className="panel onsite-form" onSubmit={addManual}><div className="panel-head"><div><span className="kicker">2 · Add pending record</span><h2>On-site participant</h2></div><Status tone="warn">Needs verification</Status></div><div className="form-grid"><label>First name<input required value={manual.firstName} onChange={(e) => setManual({ ...manual, firstName: e.target.value })}/></label><label>Last name<input required value={manual.lastName} onChange={(e) => setManual({ ...manual, lastName: e.target.value })}/></label><label>Preferred name<input value={manual.preferredName} onChange={(e) => setManual({ ...manual, preferredName: e.target.value })}/></label><label>Sex<select value={manual.sex} onChange={(e) => setManual({ ...manual, sex: e.target.value })}><option>Female</option><option>Male</option></select></label><label>Age<input required min="1" max="120" inputMode="numeric" type="number" value={manual.age} onChange={(e) => setManual({ ...manual, age: e.target.value })}/></label><label>Date of birth<input type="date" value={manual.birthday} onChange={(e) => setManual({ ...manual, birthday: e.target.value })}/></label><label>Ward or branch<input required value={manual.unit} onChange={(e) => setManual({ ...manual, unit: e.target.value })}/></label><label>Stake or district<input value={manual.stake} onChange={(e) => setManual({ ...manual, stake: e.target.value })}/></label></div><div className="panel-actions"><span>Adding does not check the person in.</span><button className="primary" disabled={applying}>Add for verification<UserPlus/></button></div></form> : null}
      {pending.length ? <article className="panel"><div className="panel-head"><div><span className="kicker">Verification queue</span><h2>{pending.length} pending</h2></div></div><div className="request-list">{pending.map((person) => <div className="pending-invite-row" key={person.id}><span className="person-avatar">{person.firstName?.[0]}{person.lastName?.[0]}</span><div><b>{person.fullName}</b><small>{person.age} · {person.unit}</small></div>{canVerify ? <div className="inline-actions"><button className="secondary compact-button" disabled={applying} onClick={() => verify(person.id, false)}>Reject</button><button className="primary compact-button" disabled={applying} onClick={() => verify(person.id, true)}>Verify</button></div> : <Status tone="warn">Awaiting admin</Status>}</div>)}</div></article> : null}
      {readyToAssign.length ? <article className="panel"><div className="panel-head"><div><span className="kicker">3 · Assign</span><h2>{readyToAssign.length} approved and unassigned</h2></div><Status tone="warn">Before check-in</Status></div><div className="assignment-queue">{readyToAssign.slice(0,30).map((person) => { const compatible = groups.filter((group) => group.sex === person.sex); return <div key={person.id}><span><b>{person.fullName}</b><small>{person.unit} · {person.sex}</small></span><select aria-label={`Group for ${person.fullName}`} value={groupChoice[person.id] || ""} onChange={(event) => setGroupChoice({ ...groupChoice, [person.id]: event.target.value })}><option value="">Choose group</option>{compatible.map((group) => <option key={group.id} value={group.id}>{group.displayName || group.name} · {group.memberCount} youth</option>)}</select><button className="primary compact-button" disabled={applying || !groupChoice[person.id]} onClick={() => assign(person)}>Assign</button></div>; })}</div></article> : null}
    </> : null}

    {tab === "quality" ? <article className="panel"><div className="panel-head"><div><span className="kicker">Operational exceptions</span><h2>Data quality</h2></div><Status tone={quality.awaiting + quality.cancelled + quality.omitted + pending.length ? "warn" : "good"}>Current snapshot</Status></div><div className="quality-grid"><div><strong>{quality.awaiting}</strong><span>Awaiting approval</span><small>Visible, not operationally eligible</small></div><div><strong>{quality.cancelled}</strong><span>Cancelled</span><small>Excluded from groups and check-in</small></div><div><strong>{quality.omitted}</strong><span>Missing from latest</span><small>Protected because operational work exists</small></div><div><strong>{quality.unassigned}</strong><span>Approved, unassigned</span><small>Needs a counselor group</small></div></div></article> : null}
  </section>;
}
