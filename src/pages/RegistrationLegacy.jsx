import { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "@phosphor-icons/react/Check";
import { CloudArrowUp } from "@phosphor-icons/react/CloudArrowUp";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { PageHead, Status } from "../components/UI.jsx";
import { parseParticipantFile } from "../lib/import.js";
import { loadParticipants } from "../lib/backend.js";
import { loadLatestImport, loadStaff } from "../lib/operations.js";
import { addOnSiteParticipantDetailed, addOnSiteStaff, loadOnSiteReferenceDate } from "../lib/onsite.js";
import { ageOnDate, validateManualParticipantDetailed, validateManualStaff } from "../lib/registration.js";
import "./operations.css";
import "./registration-ops.css";

const emptyManual = {
  firstName: "", lastName: "", preferredName: "", sex: "Female", birthday: "", age: "",
  unit: "", stake: "", phone: "", guardianName: "", guardianPhone: "", email: "",
  tshirtSize: "", medicalInformation: "", dietaryInformation: "", operationalRole: "counselor",
};

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function roleLabel(role) {
  return ({ counselor: "Counselor", assistant_coordinator: "Assistant Coordinator", committee_member: "Committee member", other: "Other staff" })[role] || role;
}

export function Registration({ imported, setImported, groups = [], onApply, onAdd, onVerify, onAssign, live = false, canManage = true, canAdd = true, canVerify = false, sessionId }) {
  const input = useRef();
  const [tab, setTab] = useState("snapshot");
  const [result, setResult] = useState(null);
  const [latestImport, setLatestImport] = useState(null);
  const [staff, setStaff] = useState([]);
  const [sessionStart, setSessionStart] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState({ tone: "", text: "" });
  const [search, setSearch] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualKind, setManualKind] = useState("participant");
  const [manual, setManual] = useState(emptyManual);
  const [groupChoice, setGroupChoice] = useState({});

  const refreshReferences = async () => {
    if (!live || !sessionId) return;
    const [latest, nextStaff, startsOn] = await Promise.all([
      loadLatestImport(sessionId), loadStaff(sessionId), loadOnSiteReferenceDate(sessionId),
    ]);
    setLatestImport(latest); setStaff(nextStaff); setSessionStart(startsOn);
  };
  useEffect(() => { refreshReferences().catch(() => {}); }, [live, sessionId]);

  const pending = imported.filter((person) => person.sourceKind === "on_site" && person.verificationStatus === "pending");
  const readyToAssign = groups.length ? imported.filter((person) => person.status === "Expected" && !person.groupId) : [];
  const quality = useMemo(() => ({
    awaiting: imported.filter((person) => person.registrationStatus === "awaiting").length,
    cancelled: imported.filter((person) => person.registrationStatus === "cancelled").length,
    omitted: imported.filter((person) => person.reconciliationStatus === "missing_from_latest").length,
    unassigned: imported.filter((person) => person.status === "Expected" && !person.groupId).length,
  }), [imported]);

  const unitStakeMap = useMemo(() => {
    const map = new Map();
    for (const person of [...imported, ...staff]) {
      const unit = String(person.unit || "").trim();
      const stake = String(person.stake || "").trim();
      if (!unit) continue;
      const key = unit.toLowerCase();
      if (!map.has(key)) map.set(key, { unit, stake });
      else if (!map.get(key).stake && stake) map.set(key, { unit: map.get(key).unit, stake });
    }
    return map;
  }, [imported, staff]);
  const unitSuggestions = useMemo(() => [...unitStakeMap.values()].sort((left, right) => left.unit.localeCompare(right.unit)), [unitStakeMap]);
  const stakeSuggestions = useMemo(() => [...new Set(unitSuggestions.map((item) => item.stake).filter(Boolean))].sort(), [unitSuggestions]);

  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query.length < 2) return [];
    const youth = imported.map((person) => ({ ...person, personKind: "Youth", searchable: `${person.fullName} ${person.preferredName || ""} ${person.registrationId || ""} ${person.unit || ""} ${person.stake || ""}` }));
    const staffMatches = staff.map((person) => ({ ...person, fullName: person.name, personKind: "Staff", searchable: `${person.name} ${person.preferredName || ""} ${person.unit || ""} ${person.stake || ""} ${roleLabel(person.operationalRole)}` }));
    return [...youth, ...staffMatches].filter((person) => person.searchable.toLowerCase().includes(query)).slice(0, 12);
  }, [imported, staff, search]);

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
      await refreshReferences();
      setMessage({ tone: "success", text: summary ? `${summary.participant_count} youth and ${summary.staff_count} staff records reconciled safely.` : `${result.records.length} records loaded.` });
      setResult(null); setUploadOpen(false);
    } catch (error) { setMessage({ tone: "error", text: error.message || "Unable to apply this snapshot." }); }
    finally { setApplying(false); }
  };

  const changeBirthday = (birthday) => {
    const reference = sessionStart || new Date().toISOString().slice(0, 10);
    const age = ageOnDate(birthday, reference);
    setManual((current) => ({ ...current, birthday, age: age === null ? "" : String(age) }));
  };

  const changeUnit = (unit) => {
    const known = unitStakeMap.get(unit.trim().toLowerCase());
    setManual((current) => ({ ...current, unit, stake: known?.stake || current.stake }));
  };

  const addManual = async (event) => {
    event.preventDefault(); setApplying(true); setMessage({ tone: "", text: "" });
    try {
      const errors = manualKind === "participant"
        ? validateManualParticipantDetailed(manual, true)
        : validateManualStaff(manual, true);
      if (errors.length) throw new Error(errors[0]);

      if (live && sessionId) {
        if (manualKind === "participant") {
          await addOnSiteParticipantDetailed({ sessionId, ...manual });
          setImported(await loadParticipants(sessionId));
        } else {
          await addOnSiteStaff({ sessionId, ...manual });
          setStaff(await loadStaff(sessionId));
        }
      } else if (manualKind === "participant") {
        await onAdd?.(manual);
      }

      setManual(emptyManual); setManualOpen(false); setSearch("");
      setMessage({
        tone: "success",
        text: manualKind === "participant"
          ? "On-site participant added for verification. Their age was calculated for the start of this FSY session."
          : "On-site staff member added and is now available for staff assignment.",
      });
    } catch (error) { setMessage({ tone: "error", text: error.message || "Unable to add this person." }); }
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
    <PageHead title="Registration" description="Keep one current registration list, update it safely, and resolve day-of exceptions without making people rebuild spreadsheets." />
    <div className="segmented registration-tabs" role="tablist">
      <button className={tab === "snapshot" ? "active" : ""} onClick={() => setTab("snapshot")}>Current list</button>
      <button className={tab === "onsite" ? "active" : ""} onClick={() => setTab("onsite")}>Add on-site{pending.length ? ` (${pending.length})` : ""}</button>
      <button className={tab === "quality" ? "active" : ""} onClick={() => setTab("quality")}>Data quality</button>
    </div>
    {message.text ? <div className={message.tone === "error" ? "form-error page-error" : "auth-success"} role="status">{message.tone === "success" ? <Check weight="bold" /> : <WarningCircle />}<span>{message.text}</span></div> : null}

    {tab === "snapshot" ? <>
      {latestImport ? <article className="panel current-registration-card"><div className="snapshot-main"><span className="snapshot-check"><Check weight="bold" size={22}/></span><div><span className="kicker">Current registration</span><h2>{latestImport.recordCount.toLocaleString()} people loaded</h2><p>Last updated {formatDate(latestImport.createdAt)} · {latestImport.sourceFilename}</p><div className="snapshot-metrics"><span><b>{latestImport.participantCount.toLocaleString()}</b><small>participants</small></span><span><b>{latestImport.staffCount.toLocaleString()}</b><small>staff</small></span><span><b>{latestImport.omittedCount}</b><small>omitted in update</small></span><span><b>{latestImport.exceptionCount}</b><small>protected exceptions</small></span></div></div></div>{canManage ? <button className="secondary" onClick={() => setUploadOpen((open) => !open)}><CloudArrowUp/>{uploadOpen ? "Close update" : "Upload updated export"}</button> : null}</article> : null}

      {!latestImport || uploadOpen ? <>
        <div className="notice"><WarningCircle size={21}/><div><b>{latestImport ? "This updates the current snapshot, not a second list" : "Your first export becomes the current snapshot"}</b><p>Matching people are updated, new people are added, and people omitted from a newer export are reconciled safely. On-site additions are protected from later imports.</p></div></div>
        <article className="panel import-card"><span className="kicker">{latestImport ? "Update registration" : "First import"}</span><h2>{latestImport ? "Choose the newer complete export" : "Choose the complete registration export"}</h2><p>The mixed Participant and Counselor CSV/Excel export is supported. The raw file stays on this device until you confirm the reviewed snapshot.</p><button className="dropzone" disabled={!canManage} onClick={() => input.current?.click()}><CloudArrowUp size={32}/><b>{busy ? "Reading file…" : latestImport ? "Choose updated CSV or Excel file" : "Choose CSV or Excel file"}</b><span>Up to 5,000 rows · nothing is applied until you review it</span></button><input ref={input} hidden type="file" accept=".csv,.xlsx,.xls" onChange={(event) => choose(event.target.files?.[0])}/></article>
      </> : null}

      {result ? <article className="panel"><div className="panel-head"><div><span className="kicker">Review before applying</span><h2>What this file contains</h2></div><Status tone={result.errors.length ? "danger" : "good"}>{result.errors.length ? `${result.errors.length} blocking` : "Ready to apply"}</Status></div><div className="metrics-grid compact import-summary"><div><span>Youth</span><strong>{result.summary.participants.toLocaleString()}</strong></div><div><span>Staff</span><strong>{result.summary.staff.toLocaleString()}</strong></div><div><span>Awaiting</span><strong>{result.summary.awaiting}</strong></div><div><span>Cancelled</span><strong>{result.summary.cancelled}</strong></div><div><span>FSY birthdays</span><strong>{result.summary.birthdays}</strong></div></div>{result.errors.length || result.warnings.length ? <div className="error-list">{[...result.errors, ...result.warnings].slice(0, 12).map((issue, index) => <p key={`${issue.row}-${index}`}><b>Row {issue.row}:</b> {issue.message}{issue.severity === "warning" ? " · review recommended" : ""}</p>)}</div> : null}<div className="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Unit</th></tr></thead><tbody>{result.records.slice(0, 8).map((person) => <tr key={person.sourceKey}><td><b>{person.fullName}</b></td><td>{person.personType === "counselor" ? "Staff" : "Youth"}</td><td>{person.registrationStatus}</td><td>{person.unit || "Missing"}</td></tr>)}</tbody></table></div><div className="panel-actions"><span>{result.warnings.length} review warnings · {result.summary.total.toLocaleString()} total</span><button className="primary" disabled={Boolean(result.errors.length) || applying || !canManage} onClick={apply}>{applying ? "Reconciling…" : latestImport ? "Apply updated snapshot" : "Apply complete snapshot"}<Check/></button></div></article> : null}
    </> : null}

    {tab === "onsite" ? <>
      <article className="panel"><span className="kicker">1 · Search first</span><h2>Find the person before adding them</h2><p className="form-hint">Searches both youth and staff already in this session. This keeps day-of fixes from creating duplicate records.</p><div className="search"><MagnifyingGlass/><input value={search} onChange={(event) => { setSearch(event.target.value); setManualOpen(false); }} placeholder="Search name, registration ID, ward, stake or staff role" autoComplete="off"/></div>{search.trim().length >= 2 ? <div className="check-list onsite-search-results">{matches.map((person) => <div className="onsite-match" key={`${person.personKind}-${person.id}`}><span className="person-avatar">{person.firstName?.[0]}{person.lastName?.[0]}</span><span><b>{person.fullName}</b><small>{person.personKind} · {person.unit || "Unit missing"}{person.personKind === "Staff" ? ` · ${roleLabel(person.operationalRole)}` : ` · ${person.registrationStatus}`}</small></span><Status tone={person.personKind === "Staff" || person.status === "Expected" ? "good" : "warn"}>{person.personKind === "Staff" ? "Already listed" : person.status}</Status></div>)}{!matches.length ? <div className="empty-inline"><b>No close match found</b><span>Check the spelling and ward or branch before creating a new record.</span></div> : null}</div> : null}{canAdd && search.trim().length >= 2 ? <button className="secondary add-after-search" onClick={() => setManualOpen(true)}><UserPlus/>Still not listed — add on-site</button> : null}</article>

      {manualOpen ? <form className="panel onsite-form manual-v2" onSubmit={addManual}>
        <div className="panel-head"><div><span className="kicker">2 · Capture the minimum useful record</span><h2>{manualKind === "participant" ? "On-site youth participant" : "On-site staff member"}</h2></div><Status tone={manualKind === "participant" ? "warn" : "good"}>{manualKind === "participant" ? "Needs verification" : "Available after save"}</Status></div>
        <div className="person-type-switch" role="group" aria-label="Person type"><button type="button" className={manualKind === "participant" ? "active" : ""} onClick={() => setManualKind("participant")}>Youth participant</button><button type="button" className={manualKind === "staff" ? "active" : ""} onClick={() => setManualKind("staff")}>Staff member</button></div>
        <div className="manual-section"><span className="manual-section-title">Identity</span><div className="form-grid"><label>First name<input required autoComplete="given-name" value={manual.firstName} onChange={(event) => setManual({ ...manual, firstName: event.target.value })}/></label><label>Last name<input required autoComplete="family-name" value={manual.lastName} onChange={(event) => setManual({ ...manual, lastName: event.target.value })}/></label><label>Preferred name<input value={manual.preferredName} onChange={(event) => setManual({ ...manual, preferredName: event.target.value })}/></label><label>Sex<select value={manual.sex} onChange={(event) => setManual({ ...manual, sex: event.target.value })}><option>Female</option><option>Male</option></select></label><label>Date of birth<input required type="date" value={manual.birthday} onChange={(event) => changeBirthday(event.target.value)}/><small>Age is calculated for {sessionStart ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${sessionStart}T00:00:00Z`)) : "the start of this FSY session"}.</small></label><label>Age at FSY start<input className="calculated-field" readOnly value={manual.age} placeholder="Calculated automatically"/></label></div></div>

        <div className="manual-section"><span className="manual-section-title">Church unit</span><div className="form-grid"><label>Ward or branch<input required list="fsy-unit-suggestions" value={manual.unit} onChange={(event) => changeUnit(event.target.value)} placeholder="Start typing the ward or branch"/><small>Choose an existing value when it appears to avoid spelling duplicates.</small></label><label>Stake or district<input list="fsy-stake-suggestions" value={manual.stake} onChange={(event) => setManual({ ...manual, stake: event.target.value })} placeholder="Often filled from the ward/branch"/></label></div><datalist id="fsy-unit-suggestions">{unitSuggestions.map((item) => <option value={item.unit} key={item.unit}>{item.stake || ""}</option>)}</datalist><datalist id="fsy-stake-suggestions">{stakeSuggestions.map((stake) => <option value={stake} key={stake}/>)}</datalist></div>

        {manualKind === "participant" ? <div className="manual-section"><span className="manual-section-title">Contact</span><p className="form-hint">At least one reachable phone number is required for a day-of youth addition.</p><div className="form-grid"><label>Participant phone<input inputMode="tel" autoComplete="tel" value={manual.phone} onChange={(event) => setManual({ ...manual, phone: event.target.value })} placeholder="Optional if guardian phone is given"/></label><label>Parent / guardian name<input value={manual.guardianName} onChange={(event) => setManual({ ...manual, guardianName: event.target.value })}/></label><label>Parent / guardian phone<input inputMode="tel" value={manual.guardianPhone} onChange={(event) => setManual({ ...manual, guardianPhone: event.target.value })} placeholder="Optional if participant phone is given"/></label></div></div> : <div className="manual-section"><span className="manual-section-title">Staff assignment & contact</span><div className="form-grid"><label>Staff type<select value={manual.operationalRole} onChange={(event) => setManual({ ...manual, operationalRole: event.target.value })}><option value="counselor">Counselor</option><option value="assistant_coordinator">Assistant Coordinator</option><option value="committee_member">Committee member</option><option value="other">Other staff</option></select></label><label>Phone<input inputMode="tel" autoComplete="tel" value={manual.phone} onChange={(event) => setManual({ ...manual, phone: event.target.value })} placeholder="Phone or email is required"/></label><label>Email<input type="email" autoComplete="email" value={manual.email} onChange={(event) => setManual({ ...manual, email: event.target.value })} placeholder="Phone or email is required"/></label></div></div>}

        <details className="manual-more"><summary>Additional details <span>optional</span></summary><div className="form-grid"><label>T-shirt size<input value={manual.tshirtSize} onChange={(event) => setManual({ ...manual, tshirtSize: event.target.value })} placeholder="e.g. M"/></label><label>Dietary information<textarea rows="3" value={manual.dietaryInformation} onChange={(event) => setManual({ ...manual, dietaryInformation: event.target.value })} placeholder="Only information needed for conference support"/></label><label>Medical / wellness information<textarea rows="3" value={manual.medicalInformation} onChange={(event) => setManual({ ...manual, medicalInformation: event.target.value })} placeholder="Only information needed for conference support"/></label></div><p className="sensitive-note">These optional details are stored in the restricted private-data area and are not shown in the normal people list.</p></details>
        <div className="panel-actions"><span>{manualKind === "participant" ? "Save → verify → assign group → check in." : "Save → assign staff responsibility in People or Groups & Companies."}</span><button className="primary" disabled={applying}>{applying ? "Saving…" : manualKind === "participant" ? "Add for verification" : "Add staff member"}<UserPlus/></button></div>
      </form> : null}

      {pending.length ? <article className="panel"><div className="panel-head"><div><span className="kicker">Verification queue</span><h2>{pending.length} pending</h2></div></div><div className="request-list">{pending.map((person) => <div className="pending-invite-row" key={person.id}><span className="person-avatar">{person.firstName?.[0]}{person.lastName?.[0]}</span><div><b>{person.fullName}</b><small>Age {person.age} · {person.unit}</small></div>{canVerify ? <div className="inline-actions"><button className="secondary compact-button" disabled={applying} onClick={() => verify(person.id, false)}>Reject</button><button className="primary compact-button" disabled={applying} onClick={() => verify(person.id, true)}>Verify</button></div> : <Status tone="warn">Awaiting admin</Status>}</div>)}</div></article> : null}
      {readyToAssign.length ? <article className="panel"><div className="panel-head"><div><span className="kicker">3 · Assign</span><h2>{readyToAssign.length} approved and unassigned</h2></div><Status tone="warn">Before check-in</Status></div><div className="assignment-queue">{readyToAssign.slice(0,30).map((person) => { const compatible = groups.filter((group) => group.sex === person.sex); return <div key={person.id}><span><b>{person.fullName}</b><small>{person.unit} · {person.sex}</small></span><select aria-label={`Group for ${person.fullName}`} value={groupChoice[person.id] || ""} onChange={(event) => setGroupChoice({ ...groupChoice, [person.id]: event.target.value })}><option value="">Choose group</option>{compatible.map((group) => <option key={group.id} value={group.id}>{group.displayName || group.name} · {group.memberCount} youth</option>)}</select><button className="primary compact-button" disabled={applying || !groupChoice[person.id]} onClick={() => assign(person)}>Assign</button></div>; })}</div></article> : null}
    </> : null}

    {tab === "quality" ? <article className="panel"><div className="panel-head"><div><span className="kicker">Operational exceptions</span><h2>Data quality</h2></div><Status tone={quality.awaiting + quality.cancelled + quality.omitted + pending.length ? "warn" : "good"}>Current snapshot</Status></div><div className="quality-grid"><div><strong>{quality.awaiting}</strong><span>Awaiting approval</span><small>Visible, not operationally eligible</small></div><div><strong>{quality.cancelled}</strong><span>Cancelled</span><small>Excluded from groups and check-in</small></div><div><strong>{quality.omitted}</strong><span>Missing from latest</span><small>Protected because operational work exists</small></div><div><strong>{quality.unassigned}</strong><span>Approved, unassigned</span><small>Needs a counselor group</small></div></div></article> : null}
  </section>;
}
