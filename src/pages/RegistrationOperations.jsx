import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { Check } from "@phosphor-icons/react/Check";
import { IdentificationCard } from "@phosphor-icons/react/IdentificationCard";
import { UserSwitch } from "@phosphor-icons/react/UserSwitch";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { DismissibleLayer, Empty, MutationFeedback, SearchField, Status } from "../components/UI.jsx";
import { hasCapability } from "../lib/field-operations.js";
import {
  finalizeFsyIds,
  loadArrivalRoster,
  loadArrivalVacancies,
  loadIdentityReadiness,
  loadIdentityRoster,
  loadOriginCodes,
  rebuildDraftFsyIds,
  replaceArrivalVacancy,
  setArrivalStatus,
  updateBadgeName,
} from "../lib/identity-arrival.js";
import "./registration-operations.css";

const NO_SHOW_CONFIRMATION_SOURCES = [
  "Parent or guardian confirmed",
  "Participant confirmed",
  "Unit or stake leader confirmed",
  "Other authorized confirmation",
];

function meaningfullyDifferentPreferred(row) {
  if (!row.preferredName) return false;
  const preferred = row.preferredName.trim().toLowerCase();
  const full = row.fullName.trim().toLowerCase();
  const first = row.fullName.trim().split(/\s+/)[0]?.toLowerCase() || "";
  return preferred && preferred !== full && preferred !== first;
}

export function IdentityFoundation({ sessionId, capabilities = [], onChanged }) {
  const canManage = hasCapability(capabilities, "identity_manage") || hasCapability(capabilities, "registration_manage");
  const [readiness, setReadiness] = useState(null);
  const [origins, setOrigins] = useState([]);
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [editing, setEditing] = useState(null);
  const [badgeName, setBadgeName] = useState("");

  const reload = async () => {
    if (!sessionId) return;
    const [nextReadiness, nextOrigins, nextRows] = await Promise.all([
      loadIdentityReadiness(sessionId), loadOriginCodes(sessionId), loadIdentityRoster(sessionId),
    ]);
    setReadiness(nextReadiness); setOrigins(nextOrigins); setRows(nextRows);
  };
  useEffect(() => { reload().catch((error) => setMessage({ tone: "error", text: error.message })); }, [sessionId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows.filter((row) => row.fsyId || row.nameReviewRequired).slice(0, 250);
    return rows.filter((row) => `${row.fsyId} ${row.fullName} ${row.preferredName} ${row.stake} ${row.unit} ${row.companyName} ${row.groupName}`.toLowerCase().includes(query)).slice(0, 250);
  }, [rows, search]);

  const prepare = async () => {
    setBusy(true); setMessage(null);
    try {
      const count = await rebuildDraftFsyIds(sessionId);
      await reload(); await onChanged?.();
      setMessage({ tone: "success", text: `${Number(count || 0).toLocaleString()} draft FSY IDs prepared using female groups first, then male groups.` });
    } catch (error) { setMessage({ tone: "error", text: error.message || "Unable to prepare FSY IDs." }); }
    finally { setBusy(false); }
  };

  const finalize = async () => {
    setBusy(true); setMessage(null);
    try {
      const count = await finalizeFsyIds(sessionId);
      await reload(); await onChanged?.();
      setMessage({ tone: "success", text: `${Number(count || 0).toLocaleString()} IDs finalized. Day-of changes will now use the vacancy/replacement workflow instead of renumbering everyone.` });
    } catch (error) { setMessage({ tone: "error", text: error.message || "Unable to finalize FSY IDs." }); }
    finally { setBusy(false); }
  };

  const saveBadgeName = async () => {
    if (!editing || !badgeName.trim()) return;
    setBusy(true); setMessage(null);
    try {
      await updateBadgeName(editing.participantId, badgeName.trim());
      setEditing(null); setBadgeName(""); await reload(); await onChanged?.();
      setMessage({ tone: "success", text: "Badge name updated without changing the original registration name." });
    } catch (error) { setMessage({ tone: "error", text: error.message || "Unable to update badge name." }); }
    finally { setBusy(false); }
  };

  if (!sessionId) return null;
  return <section className="ops-workspace">
    <article className="panel ops-hero-panel">
      <div>
        <span className="kicker">Operational identity</span>
        <h2>FSY IDs and badge names</h2>
        <p>Keep the Church/source registration ID untouched. FSY IDs are a separate field tool: origin + company + roster slot, with Young Women numbered before Young Men.</p>
      </div>
      {canManage ? <div className="ops-actions">
        <button className="secondary" onClick={prepare} disabled={busy || readiness?.finalizedIds > 0}><ArrowClockwise />{readiness?.draftIds ? "Rebuild draft IDs" : "Prepare IDs"}</button>
        <button className="primary" onClick={finalize} disabled={busy || !readiness?.draftIds || readiness?.unresolvedOrigin > 0}><Check />Finalize IDs</button>
      </div> : null}
    </article>

    {message ? <MutationFeedback tone={message.tone}>{message.text}</MutationFeedback> : null}

    <div className="ops-metrics">
      <div><span>Eligible + grouped</span><strong>{readiness?.eligibleGrouped?.toLocaleString() || "—"}</strong><small>participants ready for an ID</small></div>
      <div><span>Active IDs</span><strong>{readiness?.activeIds?.toLocaleString() || "0"}</strong><small>{readiness?.finalizedIds ? `${readiness.finalizedIds.toLocaleString()} finalized` : `${readiness?.draftIds || 0} draft`}</small></div>
      <div className={readiness?.unresolvedOrigin ? "needs-attention" : ""}><span>Origin issues</span><strong>{readiness?.unresolvedOrigin ?? "—"}</strong><small>must be resolved before finalizing</small></div>
      <div className={readiness?.nameReviews ? "needs-attention" : ""}><span>Badge-name review</span><strong>{readiness?.nameReviews ?? "—"}</strong><small>preferred name differs from registered name</small></div>
    </div>

    <article className="panel">
      <div className="panel-head"><div><span className="kicker">Origin code registry</span><h2>Stake, district and mission codes</h2></div><IdentificationCard size={22}/></div>
      <p className="form-hint">Codes are explicit rather than auto-generated, so Tamale and Techiman cannot accidentally share the same abbreviation.</p>
      <div className="origin-code-grid">{origins.map((origin) => <div key={origin.code}><b>{origin.code}</b><span>{origin.name}</span><small>{origin.participantCount.toLocaleString()} participant{origin.participantCount === 1 ? "" : "s"}{origin.aliases.length ? ` · aliases: ${origin.aliases.join(", ")}` : ""}</small></div>)}</div>
    </article>

    <article className="panel">
      <div className="panel-head"><div><span className="kicker">Participant identity</span><h2>Preview and name review</h2></div><Status tone={readiness?.finalizedIds ? "good" : readiness?.draftIds ? "warn" : "neutral"}>{readiness?.finalizedIds ? "Finalized" : readiness?.draftIds ? "Draft" : "Not prepared"}</Status></div>
      <SearchField value={search} onChange={setSearch} label="Search FSY IDs" placeholder="Search FSY ID, full name, preferred name, unit, stake or company" />
      <div className="table-wrap ops-table"><table><thead><tr><th>FSY ID</th><th>Name</th><th>Company / group</th><th>Badge</th></tr></thead><tbody>
        {filtered.map((row) => <tr key={row.participantId} className={row.nameReviewRequired ? "review-row" : ""}>
          <td><b className="mono-id">{row.fsyId || "Pending"}</b><small>{row.originCode || "Origin unresolved"}</small></td>
          <td><b>{row.fullName}</b>{meaningfullyDifferentPreferred(row) ? <small>Preferred: {row.preferredName}</small> : <small>{row.unit || "Unit not recorded"}</small>}</td>
          <td><b>{row.companyName || "Unassigned"}</b><small>{row.groupName || "No counselor group"}</small></td>
          <td><button type="button" className="text-action" disabled={!canManage || !row.fsyId} onClick={() => { setEditing(row); setBadgeName(row.badgeName || row.fullName); }}>{row.badgeName || row.fullName}{row.needsReprint ? " · reprint" : ""}</button>{row.nameReviewRequired ? <small className="warning-copy"><WarningCircle /> Review preferred name</small> : null}</td>
        </tr>)}
      </tbody></table></div>
      {!filtered.length ? <Empty icon={IdentificationCard} title="No matching identities" text="Prepare FSY IDs or change the search." /> : null}
    </article>

    {editing ? <div className="ops-inline-editor" role="dialog" aria-label="Edit badge name"><div><span className="kicker">Badge name</span><h3>{editing.fullName}</h3><p>The original registration name stays unchanged.</p></div><input value={badgeName} onChange={(event) => setBadgeName(event.target.value)} aria-label="Badge name"/><div className="ops-actions"><button className="secondary" onClick={() => setEditing(null)}>Cancel</button><button className="primary" disabled={busy || !badgeName.trim()} onClick={saveBadgeName}>Save badge name</button></div></div> : null}
  </section>;
}

export function ArrivalOperations({ sessionId, capabilities = [], onChanged }) {
  const canManage = hasCapability(capabilities, "arrival_manage") || hasCapability(capabilities, "registration_manage");
  const [rows, setRows] = useState([]);
  const [vacancies, setVacancies] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState(null);
  const [replacementChoice, setReplacementChoice] = useState({});
  const [confirmingNoShow, setConfirmingNoShow] = useState(null);
  const [confirmationSource, setConfirmationSource] = useState("");
  const [confirmationDetails, setConfirmationDetails] = useState("");
  const [confirmationError, setConfirmationError] = useState("");

  const reload = async () => {
    if (!sessionId) return;
    const [nextRows, nextVacancies] = await Promise.all([loadArrivalRoster(sessionId), canManage ? loadArrivalVacancies(sessionId) : Promise.resolve([])]);
    setRows(nextRows); setVacancies(nextVacancies);
  };
  useEffect(() => { reload().catch((error) => setMessage({ tone: "error", text: error.message })); }, [sessionId, canManage]);

  const candidates = useMemo(() => rows.filter((row) => row.sourceKind === "on_site" && row.verificationStatus === "verified" && row.isCurrent && !row.companyName && row.attendanceStatus !== "confirmed_not_attending"), [rows]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (status !== "all") {
        if (status === "arrived" && row.checkinStatus !== "arrived") return false;
        if (status !== "arrived" && row.attendanceStatus !== status) return false;
      }
      return !query || `${row.fsyId} ${row.fullName} ${row.preferredName} ${row.stake} ${row.unit} ${row.companyName} ${row.groupName}`.toLowerCase().includes(query);
    }).slice(0, 350);
  }, [rows, search, status]);

  const closeNoShowConfirmation = () => {
    if (busyId) return;
    setConfirmingNoShow(null);
    setConfirmationSource("");
    setConfirmationDetails("");
    setConfirmationError("");
  };

  const changeStatus = async (row, nextStatus) => {
    if (nextStatus === "confirmed_not_attending") {
      setConfirmingNoShow(row);
      setConfirmationSource("");
      setConfirmationDetails("");
      setConfirmationError("");
      return;
    }
    setBusyId(row.participantId); setMessage(null);
    try {
      await setArrivalStatus(row.participantId, nextStatus, "");
      await reload(); await onChanged?.();
      setMessage({ tone: "success", text: `${row.fullName} updated.` });
    } catch (error) { setMessage({ tone: "error", text: error.message || "Unable to update arrival status." }); }
    finally { setBusyId(""); }
  };

  const confirmNoShow = async () => {
    if (!confirmingNoShow) return;
    if (!confirmationSource) {
      setConfirmationError("Choose who confirmed that the participant is not coming.");
      return;
    }
    if (confirmationSource === "Other authorized confirmation" && !confirmationDetails.trim()) {
      setConfirmationError("Add a short note explaining the authorized confirmation source.");
      return;
    }
    const note = confirmationDetails.trim() ? `${confirmationSource}: ${confirmationDetails.trim()}` : confirmationSource;
    setBusyId(confirmingNoShow.participantId); setMessage(null); setConfirmationError("");
    try {
      await setArrivalStatus(confirmingNoShow.participantId, "confirmed_not_attending", note);
      const name = confirmingNoShow.fullName;
      await reload(); await onChanged?.();
      setConfirmingNoShow(null); setConfirmationSource(""); setConfirmationDetails("");
      setMessage({ tone: "success", text: `${name} marked confirmed not attending. Their roster place is now available for an approved replacement.` });
    } catch (error) {
      setConfirmationError(error.message || "Unable to confirm this no-show.");
    } finally { setBusyId(""); }
  };

  const replace = async (vacancy) => {
    const newcomerId = replacementChoice[vacancy.participantId];
    if (!newcomerId) return;
    setBusyId(vacancy.participantId); setMessage(null);
    try {
      const fsyId = await replaceArrivalVacancy(vacancy.participantId, newcomerId);
      await reload(); await onChanged?.();
      setMessage({ tone: "success", text: `Vacancy filled. The verified on-site participant now has ${fsyId} and the original participant remains in the audit history.` });
    } catch (error) { setMessage({ tone: "error", text: error.message || "Unable to fill this vacancy." }); }
    finally { setBusyId(""); }
  };

  return <section className="ops-workspace">
    <article className="panel ops-hero-panel"><div><span className="kicker">Day-one arrival</span><h2>Arrival reconciliation</h2><p>Work from Stake, District, Ward or Branch lists. Record who arrived, who is expected later, and only confirm a no-show when an authorized source verifies it.</p></div><UserSwitch size={28}/></article>
    {message ? <MutationFeedback tone={message.tone}>{message.text}</MutationFeedback> : null}
    <div className="arrival-toolbar"><SearchField value={search} onChange={setSearch} label="Find participant" placeholder="Search name, FSY ID, unit, stake, company or group"/><select aria-label="Arrival status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All participants</option><option value="arrived">Checked in</option><option value="expected">Expected</option><option value="expected_later">Expected later</option><option value="unknown">Needs follow-up</option><option value="confirmed_not_attending">Confirmed not attending</option></select></div>

    <article className="panel"><div className="panel-head"><div><span className="kicker">Current arrival list</span><h2>{filtered.length.toLocaleString()} in view</h2></div></div>
      <div className="arrival-list">{filtered.map((row) => <div className="arrival-row" key={row.participantId}><div className="arrival-main"><b>{row.fullName}</b><small>{row.fsyId || "FSY ID pending"} · {row.unit || "Unit missing"} · {row.companyName || "No company"}{row.groupName ? ` · ${row.groupName}` : ""}</small></div><div className="arrival-state"><Status tone={row.checkinStatus === "arrived" ? "good" : row.attendanceStatus === "confirmed_not_attending" ? "danger" : row.attendanceStatus === "unknown" ? "warn" : "neutral"}>{row.checkinStatus === "arrived" ? "Arrived" : row.attendanceStatus === "expected_later" ? "Expected later" : row.attendanceStatus === "confirmed_not_attending" ? "Not attending" : row.attendanceStatus === "unknown" ? "Follow up" : "Expected"}</Status></div>{canManage && row.checkinStatus !== "arrived" ? <div className="arrival-actions"><button className="text-action" disabled={busyId === row.participantId} onClick={() => changeStatus(row, "expected_later")}>Later</button><button className="text-action" disabled={busyId === row.participantId} onClick={() => changeStatus(row, "unknown")}>Follow up</button>{row.attendanceStatus === "confirmed_not_attending" ? <button className="text-action" disabled={busyId === row.participantId} onClick={() => changeStatus(row, "expected")}>Undo no-show</button> : <button className="text-action danger-text" disabled={busyId === row.participantId} onClick={() => changeStatus(row, "confirmed_not_attending")}>Not coming</button>}</div> : null}</div>)}</div>
    </article>

    {canManage ? <article className="panel"><div className="panel-head"><div><span className="kicker">Verified vacancies</span><h2>Fill a confirmed no-show place</h2></div><Status tone={vacancies.length ? "warn" : "good"}>{vacancies.length} available</Status></div><p className="form-hint">The original person is never overwritten. Their old slot is retired, the approved on-site participant takes the company/group place, and the change is audited.</p>
      <div className="vacancy-list">{vacancies.map((vacancy) => { const available = candidates.filter((candidate) => candidate.sex === vacancy.sex); return <div className="vacancy-row" key={vacancy.participantId}><div><b>{vacancy.fsyId} · {vacancy.fullName}</b><small>{vacancy.companyName} · {vacancy.groupName} · slot {String(vacancy.slotNumber).padStart(2,"0")}</small></div><select value={replacementChoice[vacancy.participantId] || ""} onChange={(event) => setReplacementChoice((current) => ({ ...current, [vacancy.participantId]: event.target.value }))}><option value="">Choose verified on-site participant</option>{available.map((candidate) => <option key={candidate.participantId} value={candidate.participantId}>{candidate.fullName} · {candidate.stake || candidate.unit || "origin missing"}</option>)}</select><button className="primary" disabled={!replacementChoice[vacancy.participantId] || busyId === vacancy.participantId} onClick={() => replace(vacancy)}>Fill vacancy</button></div>; })}{!vacancies.length ? <Empty icon={Check} title="No confirmed vacancies" text="A vacancy appears only after a registered participant is confirmed not attending." /> : null}</div>
    </article> : null}

    <DismissibleLayer open={Boolean(confirmingNoShow)} onClose={closeNoShowConfirmation} title="Confirm participant not attending" sheet>
      <div className="ops-confirm-sheet">
        <header><span className="kicker">Arrival reconciliation</span><h2>Confirm not attending</h2><p>Use this only after an authorized source confirms the participant will not attend FSY. The participant stays in the audit history and their roster place becomes available for a verified on-site replacement.</p></header>
        {confirmingNoShow ? <div className="ops-confirm-person"><b>{confirmingNoShow.fullName}</b><small>{confirmingNoShow.fsyId || "FSY ID pending"} · {confirmingNoShow.unit || confirmingNoShow.stake || "Unit not recorded"}</small></div> : null}
        <label className="ops-confirm-field"><span>Who confirmed this?</span><select value={confirmationSource} onChange={(event) => { setConfirmationSource(event.target.value); setConfirmationError(""); }}><option value="">Choose confirmation source</option>{NO_SHOW_CONFIRMATION_SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}</select></label>
        <label className="ops-confirm-field"><span>Short note <small>(optional unless “Other”)</small></span><textarea value={confirmationDetails} onChange={(event) => { setConfirmationDetails(event.target.value); setConfirmationError(""); }} placeholder="For example: Mother confirmed by phone at 8:15 AM." /></label>
        <p className="ops-confirm-warning">This action does not delete or overwrite the original participant. It creates a confirmed vacancy that can later be filled through the audited replacement workflow.</p>
        {confirmationError ? <p className="ops-confirm-error" role="alert">{confirmationError}</p> : null}
        <div className="ops-confirm-actions"><button className="secondary" type="button" disabled={Boolean(busyId)} onClick={closeNoShowConfirmation}>Cancel</button><button className="primary" type="button" disabled={Boolean(busyId) || !confirmationSource} onClick={confirmNoShow}>{busyId ? "Saving…" : "Confirm not attending"}</button></div>
      </div>
    </DismissibleLayer>
  </section>;
}