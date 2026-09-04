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
  NO_SHOW_CONFIRMATION_SOURCES,
} from "../lib/identity-arrival.js";
import "./registration-operations.css";

const ARRIVAL_FILTERS = [
  { value: "all", label: "All" },
  { value: "arrived", label: "Checked in" },
  { value: "expected", label: "Expected" },
  { value: "expected_later", label: "Later" },
  { value: "unknown", label: "Follow up" },
  { value: "confirmed_not_attending", label: "Not attending" },
];

const ID_FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active IDs" },
  { value: "pending", label: "Pending ID" },
  { value: "origin", label: "Origin issue" },
  { value: "badge", label: "Badge review" },
];

function initials(name = "FSY") {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function meaningfullyDifferentPreferred(row) {
  if (!row.preferredName) return false;
  const preferred = row.preferredName.trim().toLowerCase();
  const full = row.fullName.trim().toLowerCase();
  const first = row.fullName.trim().split(/\s+/)[0]?.toLowerCase() || "";
  return preferred && preferred !== full && preferred !== first;
}

function arrivalLabel(row) {
  if (row.checkinStatus === "arrived") return "Checked in";
  if (row.attendanceStatus === "expected_later") return "Expected later";
  if (row.attendanceStatus === "confirmed_not_attending") return "Not attending";
  if (row.attendanceStatus === "unknown") return "Follow up";
  return "Expected";
}

function arrivalTone(row) {
  if (row.checkinStatus === "arrived") return "good";
  if (row.attendanceStatus === "confirmed_not_attending") return "danger";
  if (row.attendanceStatus === "unknown" || row.attendanceStatus === "expected_later") return "warn";
  return "muted";
}

function IdentityFilterChips({ rows, value, onChange }) {
  const counts = useMemo(() => ({
    all: rows.length,
    active: rows.filter((row) => Boolean(row.fsyId)).length,
    pending: rows.filter((row) => !row.fsyId).length,
    origin: rows.filter((row) => !row.originCode).length,
    badge: rows.filter((row) => row.nameReviewRequired || row.needsReprint).length,
  }), [rows]);

  return <div className="registration-filter-chips identity-filter-chips-v5" role="group" aria-label="Filter FSY IDs">
    {ID_FILTERS.map((filter) => <button type="button" key={filter.value} className={value === filter.value ? "active" : ""} aria-pressed={value === filter.value} onClick={() => onChange(filter.value)}><span>{filter.label}</span><b>{counts[filter.value].toLocaleString()}</b></button>)}
  </div>;
}

export function IdentityFoundation({ sessionId, capabilities = [], onChanged }) {
  const canManage = hasCapability(capabilities, "identity_manage") || hasCapability(capabilities, "registration_manage");
  const [readiness, setReadiness] = useState(null);
  const [origins, setOrigins] = useState([]);
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [editing, setEditing] = useState(null);
  const [badgeName, setBadgeName] = useState("");
  const [confirmingFinalize, setConfirmingFinalize] = useState(false);

  const reload = async () => {
    if (!sessionId) return;
    const [nextReadiness, nextOrigins, nextRows] = await Promise.all([
      loadIdentityReadiness(sessionId), loadOriginCodes(sessionId), loadIdentityRoster(sessionId),
    ]);
    setReadiness(nextReadiness);
    setOrigins(nextOrigins);
    setRows(nextRows);
  };

  useEffect(() => {
    reload().catch((error) => setMessage({ tone: "error", text: error.message }));
  }, [sessionId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === "active" && !row.fsyId) return false;
      if (filter === "pending" && row.fsyId) return false;
      if (filter === "origin" && row.originCode) return false;
      if (filter === "badge" && !row.nameReviewRequired && !row.needsReprint) return false;
      return !query || `${row.fsyId} ${row.fullName} ${row.preferredName} ${row.stake} ${row.unit} ${row.companyName} ${row.groupName} ${row.originCode}`.toLowerCase().includes(query);
    }).slice(0, 300);
  }, [rows, search, filter]);

  const prepared = Boolean(readiness?.draftIds || readiness?.finalizedIds);
  const finalized = Boolean(readiness?.finalizedIds);
  const originClear = Number(readiness?.unresolvedOrigin || 0) === 0;

  const prepare = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const count = await rebuildDraftFsyIds(sessionId);
      await reload();
      await onChanged?.();
      setMessage({ tone: "success", text: `${Number(count || 0).toLocaleString()} draft FSY IDs prepared. Review origin issues and badge names before finalizing.` });
    } catch (error) {
      setMessage({ tone: "error", text: error.message || "Unable to prepare FSY IDs." });
    } finally {
      setBusy(false);
    }
  };

  const finalize = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const count = await finalizeFsyIds(sessionId);
      await reload();
      await onChanged?.();
      setConfirmingFinalize(false);
      setMessage({ tone: "success", text: `${Number(count || 0).toLocaleString()} IDs finalized. Day-one changes now use the audited vacancy and replacement workflow.` });
    } catch (error) {
      setMessage({ tone: "error", text: error.message || "Unable to finalize FSY IDs." });
    } finally {
      setBusy(false);
    }
  };

  const saveBadgeName = async () => {
    if (!editing || !badgeName.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await updateBadgeName(editing.participantId, badgeName.trim());
      const name = editing.fullName;
      setEditing(null);
      setBadgeName("");
      await reload();
      await onChanged?.();
      setMessage({ tone: "success", text: `${name}'s badge name was updated. The original registration name was not changed.` });
    } catch (error) {
      setMessage({ tone: "error", text: error.message || "Unable to update badge name." });
    } finally {
      setBusy(false);
    }
  };

  if (!sessionId) return null;

  return <section className="ops-workspace identity-shell-v5">
    <article className="panel identity-readiness-v5">
      <div className="identity-readiness-head-v5">
        <div><span className="kicker">FSY identity workflow</span><h2>Prepare, review, then finalize</h2><p>FSY IDs are operational identifiers. The original Church registration ID and registered name stay untouched.</p></div>
        <Status tone={finalized ? "good" : prepared ? "warn" : "muted"}>{finalized ? "Finalized" : prepared ? "Draft ready" : "Not prepared"}</Status>
      </div>
      <div className="identity-stepper-v5" aria-label="FSY ID workflow">
        <div className={prepared ? "identity-step-v5 done" : "identity-step-v5 current"}><span>1</span><div><b>Prepare IDs</b><small>Create draft IDs from current group assignments.</small></div></div>
        <div className={prepared && originClear ? "identity-step-v5 done" : prepared ? "identity-step-v5 current" : "identity-step-v5"}><span>2</span><div><b>Review issues</b><small>{readiness?.unresolvedOrigin ? `${readiness.unresolvedOrigin.toLocaleString()} origin issue${readiness.unresolvedOrigin === 1 ? "" : "s"} blocking finalization` : "Origin codes are clear"}{readiness?.nameReviews ? ` · ${readiness.nameReviews.toLocaleString()} badge review${readiness.nameReviews === 1 ? "" : "s"}` : ""}</small></div></div>
        <div className={finalized ? "identity-step-v5 done" : prepared && originClear ? "identity-step-v5 current" : "identity-step-v5"}><span>3</span><div><b>Finalize</b><small>Lock the current origin, company and slot numbers.</small></div></div>
      </div>
      {canManage ? <div className="identity-primary-actions-v5">
        <button className="secondary" onClick={prepare} disabled={busy || finalized}><ArrowClockwise />{readiness?.draftIds ? "Rebuild draft IDs" : "Prepare draft IDs"}</button>
        <button className="primary" onClick={() => setConfirmingFinalize(true)} disabled={busy || !readiness?.draftIds || !originClear || finalized}><Check />{finalized ? "IDs finalized" : "Finalize IDs"}</button>
      </div> : null}
    </article>

    {message ? <MutationFeedback tone={message.tone}>{message.text}</MutationFeedback> : null}

    <div className="ops-metrics identity-metrics-v5">
      <button type="button" onClick={() => setFilter("all")} className={filter === "all" ? "active" : ""}><span>Ready for ID</span><strong>{readiness?.eligibleGrouped?.toLocaleString() || "—"}</strong><small>eligible + grouped</small></button>
      <button type="button" onClick={() => setFilter("active")} className={filter === "active" ? "active" : ""}><span>Active IDs</span><strong>{readiness?.activeIds?.toLocaleString() || "0"}</strong><small>{finalized ? `${readiness.finalizedIds.toLocaleString()} finalized` : `${readiness?.draftIds || 0} draft`}</small></button>
      <button type="button" onClick={() => setFilter("origin")} className={`${readiness?.unresolvedOrigin ? "needs-attention " : ""}${filter === "origin" ? "active" : ""}`.trim()}><span>Origin issues</span><strong>{readiness?.unresolvedOrigin ?? "—"}</strong><small>{readiness?.unresolvedOrigin ? "resolve before finalizing" : "clear"}</small></button>
      <button type="button" onClick={() => setFilter("badge")} className={`${readiness?.nameReviews ? "needs-attention " : ""}${filter === "badge" ? "active" : ""}`.trim()}><span>Badge review</span><strong>{readiness?.nameReviews ?? "—"}</strong><small>preferred names and reprints</small></button>
    </div>

    <article className="panel identity-roster-panel-v5">
      <div className="identity-roster-head-v5"><div><span className="kicker">Participant identity</span><h2>FSY IDs and badge names</h2><p>Search once, then narrow to the people who actually need attention.</p></div><IdentificationCard size={24}/></div>
      <div className="identity-controls-v5">
        <SearchField value={search} onChange={setSearch} label="Search FSY IDs" placeholder="Search FSY ID, name, unit, stake, company or group" />
        <IdentityFilterChips rows={rows} value={filter} onChange={setFilter} />
      </div>
      <div className="identity-result-summary-v5" role="status"><b>{filtered.length.toLocaleString()}</b><span>shown{search ? ` for “${search}”` : ""}</span>{filter !== "all" ? <button type="button" className="text-action" onClick={() => setFilter("all")}>Clear filter</button> : null}</div>
      <div className="identity-roster-v5">
        {filtered.map((row) => <div className={`identity-row-v5${row.nameReviewRequired || row.needsReprint ? " review" : ""}`} key={row.participantId}>
          <div className="identity-person-v5"><span className="person-avatar">{initials(row.fullName)}</span><span><b>{row.fullName}</b><small>{row.unit || "Unit not recorded"}{row.stake ? ` · ${row.stake}` : ""}</small></span></div>
          <div className="identity-id-v5"><span>FSY ID</span><b className="mono-id">{row.fsyId || "Pending"}</b><small>{row.originCode || "Origin unresolved"}</small></div>
          <div className="identity-group-v5"><span>Company / group</span><b>{row.companyName || "Unassigned"}</b><small>{row.groupName || "No counselor group"}</small></div>
          <div className="identity-badge-v5"><span>Badge</span><button type="button" className="identity-badge-button-v5" disabled={!canManage || !row.fsyId} onClick={() => { setEditing(row); setBadgeName(row.badgeName || row.fullName); }}>{row.badgeName || row.fullName}</button>{row.nameReviewRequired ? <small className="warning-copy"><WarningCircle /> Preferred name review</small> : row.needsReprint ? <small className="warning-copy">Reprint needed</small> : <small>Ready</small>}</div>
        </div>)}
        {!filtered.length ? <Empty icon={IdentificationCard} title="No matching identities" text={rows.length ? "Try another search or clear the current filter." : "Prepare FSY IDs to start the identity workflow."} /> : null}
      </div>
    </article>

    <details className="panel identity-origin-details-v5">
      <summary><span><b>Origin code registry</b><small>{origins.length.toLocaleString()} stake, district or mission code{origins.length === 1 ? "" : "s"}</small></span><span aria-hidden="true">+</span></summary>
      <div><p className="form-hint">Codes stay explicit rather than auto-generated, preventing places with similar names from sharing an abbreviation.</p><div className="origin-code-grid">{origins.map((origin) => <div key={origin.code}><b>{origin.code}</b><span>{origin.name}</span><small>{origin.participantCount.toLocaleString()} participant{origin.participantCount === 1 ? "" : "s"}{origin.aliases.length ? ` · aliases: ${origin.aliases.join(", ")}` : ""}</small></div>)}</div></div>
    </details>

    <DismissibleLayer open={Boolean(editing)} onClose={() => { if (!busy) { setEditing(null); setBadgeName(""); } }} title="Edit badge name" sheet className="identity-badge-modal-v5">
      {editing ? <div className="identity-badge-sheet-v5"><header><span className="kicker">Badge name</span><h2>{editing.fullName}</h2><p>Use the name the participant should see on their FSY badge. This does not change the original registration name.</p></header><div className="identity-badge-context-v5"><span><small>FSY ID</small><b className="mono-id">{editing.fsyId}</b></span><span><small>Registered name</small><b>{editing.fullName}</b></span>{meaningfullyDifferentPreferred(editing) ? <span><small>Preferred name</small><b>{editing.preferredName}</b></span> : null}</div><label className="ops-confirm-field"><span>Badge name</span><input autoFocus value={badgeName} onChange={(event) => setBadgeName(event.target.value)} /></label><div className="ops-confirm-actions"><button type="button" className="secondary" disabled={busy} onClick={() => { setEditing(null); setBadgeName(""); }}>Cancel</button><button type="button" className="primary" disabled={busy || !badgeName.trim()} onClick={saveBadgeName}>{busy ? "Saving…" : "Save badge name"}</button></div></div> : null}
    </DismissibleLayer>

    <DismissibleLayer open={confirmingFinalize} onClose={() => { if (!busy) setConfirmingFinalize(false); }} title="Finalize FSY IDs" sheet>
      <div className="ops-confirm-sheet"><header><span className="kicker">Final step</span><h2>Finalize FSY IDs?</h2><p>Finalization locks the current origin, company and slot numbers for this session. Day-one changes must then use the audited vacancy and replacement workflow.</p></header><div className="ops-confirm-warning"><b>{readiness?.draftIds?.toLocaleString() || 0} draft IDs</b><span>will become final. Original registration names stay unchanged.</span></div><div className="ops-confirm-actions"><button className="secondary" type="button" disabled={busy} onClick={() => setConfirmingFinalize(false)}>Cancel</button><button className="primary" type="button" disabled={busy} onClick={finalize}>{busy ? "Finalizing…" : "Confirm finalization"}</button></div></div>
    </DismissibleLayer>
  </section>;
}

function ArrivalFilterChips({ counts, value, onChange }) {
  return <div className="registration-filter-chips arrival-filter-chips-v5" role="group" aria-label="Filter arrival list">
    {ARRIVAL_FILTERS.map((filter) => <button type="button" key={filter.value} className={value === filter.value ? "active" : ""} aria-pressed={value === filter.value} onClick={() => onChange(filter.value)}><span>{filter.label}</span><b>{counts[filter.value].toLocaleString()}</b></button>)}
  </div>;
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
    const [nextRows, nextVacancies] = await Promise.all([
      loadArrivalRoster(sessionId),
      canManage ? loadArrivalVacancies(sessionId) : Promise.resolve([]),
    ]);
    setRows(nextRows);
    setVacancies(nextVacancies);
  };

  useEffect(() => {
    reload().catch((error) => setMessage({ tone: "error", text: error.message }));
  }, [sessionId, canManage]);

  const counts = useMemo(() => ({
    all: rows.length,
    arrived: rows.filter((row) => row.checkinStatus === "arrived").length,
    expected: rows.filter((row) => row.checkinStatus !== "arrived" && row.attendanceStatus === "expected").length,
    expected_later: rows.filter((row) => row.checkinStatus !== "arrived" && row.attendanceStatus === "expected_later").length,
    unknown: rows.filter((row) => row.checkinStatus !== "arrived" && row.attendanceStatus === "unknown").length,
    confirmed_not_attending: rows.filter((row) => row.checkinStatus !== "arrived" && row.attendanceStatus === "confirmed_not_attending").length,
  }), [rows]);

  const candidates = useMemo(() => rows.filter((row) => row.sourceKind === "on_site" && row.verificationStatus === "verified" && row.isCurrent && !row.companyName && row.attendanceStatus !== "confirmed_not_attending"), [rows]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (status === "arrived" && row.checkinStatus !== "arrived") return false;
      if (status !== "all" && status !== "arrived" && (row.checkinStatus === "arrived" || row.attendanceStatus !== status)) return false;
      return !query || `${row.fsyId} ${row.fullName} ${row.preferredName} ${row.stake} ${row.unit} ${row.companyName} ${row.groupName}`.toLowerCase().includes(query);
    }).slice(0, 400);
  }, [rows, search, status]);

  const outstanding = Math.max(0, rows.length - counts.arrived - counts.confirmed_not_attending);
  const arrivalProgress = rows.length ? Math.round((counts.arrived / Math.max(1, rows.length - counts.confirmed_not_attending)) * 100) : 0;

  const changeStatus = async (row, nextStatus) => {
    if (nextStatus === "confirmed_not_attending") {
      setConfirmingNoShow(row);
      setConfirmationSource("");
      setConfirmationDetails("");
      setConfirmationError("");
      return;
    }
    setBusyId(row.participantId);
    setMessage(null);
    try {
      await setArrivalStatus(row.participantId, nextStatus, "");
      await reload();
      await onChanged?.();
      setMessage({ tone: "success", text: `${row.fullName} is now ${nextStatus === "expected_later" ? "expected later" : nextStatus === "unknown" ? "flagged for follow-up" : "expected"}.` });
    } catch (error) {
      setMessage({ tone: "error", text: error.message || "Unable to update arrival status." });
    } finally {
      setBusyId("");
    }
  };

  const closeNoShowConfirmation = () => {
    if (busyId) return;
    setConfirmingNoShow(null);
    setConfirmationSource("");
    setConfirmationDetails("");
    setConfirmationError("");
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
    setBusyId(confirmingNoShow.participantId);
    setMessage(null);
    setConfirmationError("");
    try {
      await setArrivalStatus(confirmingNoShow.participantId, "confirmed_not_attending", note);
      const name = confirmingNoShow.fullName;
      await reload();
      await onChanged?.();
      setConfirmingNoShow(null);
      setConfirmationSource("");
      setConfirmationDetails("");
      setMessage({ tone: "success", text: `${name} is confirmed not attending. Their roster place can now be used for an approved replacement.` });
    } catch (error) {
      setConfirmationError(error.message || "Unable to confirm this no-show.");
    } finally {
      setBusyId("");
    }
  };

  const replace = async (vacancy) => {
    const newcomerId = replacementChoice[vacancy.participantId];
    if (!newcomerId) return;
    setBusyId(vacancy.participantId);
    setMessage(null);
    try {
      const fsyId = await replaceArrivalVacancy(vacancy.participantId, newcomerId);
      await reload();
      await onChanged?.();
      setMessage({ tone: "success", text: `Vacancy filled. The verified on-site participant now has ${fsyId}; the original participant remains in the audit history.` });
    } catch (error) {
      setMessage({ tone: "error", text: error.message || "Unable to fill this vacancy." });
    } finally {
      setBusyId("");
    }
  };

  return <section className="ops-workspace arrival-shell-v5">
    <article className="panel arrival-overview-v5">
      <div className="arrival-overview-copy-v5"><span className="kicker">Day-one arrival</span><h2>Know who is here and who still needs attention</h2><p>Use this page to reconcile the registration list. Actual check-in stays in Check-in; here you record expected later, follow-up, and authorized no-shows without losing the original record.</p></div>
      <div className="arrival-glance-v5"><div><strong>{counts.arrived.toLocaleString()}</strong><span>checked in</span></div><div><strong>{outstanding.toLocaleString()}</strong><span>still expected</span></div><div className={counts.unknown ? "attention" : ""}><strong>{counts.unknown.toLocaleString()}</strong><span>follow up</span></div></div>
      <div className="arrival-progress-v5"><span><i style={{ width: `${Math.max(0, Math.min(100, arrivalProgress))}%` }} /></span><small>{arrivalProgress}% of participants still attending have checked in</small></div>
    </article>

    {message ? <MutationFeedback tone={message.tone}>{message.text}</MutationFeedback> : null}

    <article className="panel arrival-worklist-v5">
      <div className="arrival-worklist-head-v5"><div><span className="kicker">Arrival worklist</span><h2>{filtered.length.toLocaleString()} participant{filtered.length === 1 ? "" : "s"} in view</h2><p>Search by the detail you have in front of you, then use one status filter to reduce the line.</p></div><UserSwitch size={26}/></div>
      <div className="arrival-controls-v5">
        <SearchField value={search} onChange={setSearch} label="Find participant" placeholder="Search name, FSY ID, ward/branch, stake, company or group" />
        <ArrivalFilterChips counts={counts} value={status} onChange={setStatus} />
      </div>
      <div className="arrival-result-summary-v5" role="status"><span><b>{filtered.length.toLocaleString()}</b> shown</span>{search ? <span>for “{search}”</span> : null}{status !== "all" ? <button type="button" className="text-action" onClick={() => setStatus("all")}>Clear filter</button> : null}</div>
      <div className="arrival-list arrival-list-v5">
        {filtered.map((row) => {
          const isBusy = busyId === row.participantId;
          const state = row.checkinStatus === "arrived" ? "arrived" : row.attendanceStatus;
          return <div className={`arrival-row arrival-row-v5 ${state}`} key={row.participantId}>
            <div className="arrival-person-v5"><span className="person-avatar">{initials(row.fullName)}</span><span><b>{row.fullName}</b><small>{row.unit || "Unit not recorded"}{row.stake ? ` · ${row.stake}` : ""}</small></span></div>
            <div className="arrival-assignment-v5"><span className="arrival-id-chip-v5">{row.fsyId || "FSY ID pending"}</span><small>{row.companyName || "No company"}{row.groupName ? ` · ${row.groupName}` : ""}</small></div>
            <Status tone={arrivalTone(row)}>{arrivalLabel(row)}</Status>
            {canManage && row.checkinStatus !== "arrived" ? <div className="arrival-actions arrival-row-actions-v5">
              {row.attendanceStatus !== "expected" ? <button className="arrival-action-v5" disabled={isBusy} onClick={() => changeStatus(row, "expected")}>Expected</button> : null}
              {row.attendanceStatus !== "expected_later" ? <button className="arrival-action-v5" disabled={isBusy} onClick={() => changeStatus(row, "expected_later")}>Later</button> : null}
              {row.attendanceStatus !== "unknown" ? <button className="arrival-action-v5" disabled={isBusy} onClick={() => changeStatus(row, "unknown")}>Follow up</button> : null}
              {row.attendanceStatus === "confirmed_not_attending" ? null : <button className="arrival-action-v5 danger" disabled={isBusy} onClick={() => changeStatus(row, "confirmed_not_attending")}>Not coming</button>}
            </div> : null}
          </div>;
        })}
        {!filtered.length ? <Empty icon={UserSwitch} title="No participants match this view" text="Try another search or clear the arrival filter." /> : null}
      </div>
    </article>

    {canManage ? <details className="panel arrival-vacancies-v5" open={Boolean(vacancies.length)}>
      <summary><span><b>Replacement vacancies</b><small>Only confirmed no-shows appear here</small></span><Status tone={vacancies.length ? "warn" : "good"}>{vacancies.length.toLocaleString()} available</Status></summary>
      <div className="arrival-vacancy-body-v5"><p className="form-hint">Use this only after a registered participant is confirmed not attending. The original person is preserved in the audit history.</p><div className="vacancy-list">{vacancies.map((vacancy) => { const available = candidates.filter((candidate) => candidate.sex === vacancy.sex); return <div className="vacancy-row vacancy-row-v5" key={vacancy.participantId}><div><b>{vacancy.fsyId} · {vacancy.fullName}</b><small>{vacancy.companyName} · {vacancy.groupName} · slot {String(vacancy.slotNumber).padStart(2, "0")}</small></div><select value={replacementChoice[vacancy.participantId] || ""} onChange={(event) => setReplacementChoice((current) => ({ ...current, [vacancy.participantId]: event.target.value }))}><option value="">Choose verified on-site participant</option>{available.map((candidate) => <option key={candidate.participantId} value={candidate.participantId}>{candidate.fullName} · {candidate.stake || candidate.unit || "origin missing"}</option>)}</select><button className="primary" disabled={!replacementChoice[vacancy.participantId] || busyId === vacancy.participantId} onClick={() => replace(vacancy)}>Fill vacancy</button></div>; })}{!vacancies.length ? <Empty icon={Check} title="No confirmed vacancies" text="A vacancy appears here only after an authorized no-show confirmation." /> : null}</div></div>
    </details> : null}

    <DismissibleLayer open={Boolean(confirmingNoShow)} onClose={closeNoShowConfirmation} title="Confirm participant not attending" sheet>
      <div className="ops-confirm-sheet"><header><span className="kicker">Arrival reconciliation</span><h2>Confirm not attending</h2><p>Use this only after an authorized source confirms the participant will not attend FSY. The participant stays in the audit history and their roster place becomes available for a verified on-site replacement.</p></header>{confirmingNoShow ? <div className="ops-confirm-person"><b>{confirmingNoShow.fullName}</b><small>{confirmingNoShow.fsyId || "FSY ID pending"} · {confirmingNoShow.unit || confirmingNoShow.stake || "Unit not recorded"}</small></div> : null}<label className="ops-confirm-field"><span>Who confirmed this?</span><select value={confirmationSource} onChange={(event) => { setConfirmationSource(event.target.value); setConfirmationError(""); }}><option value="">Choose confirmation source</option>{NO_SHOW_CONFIRMATION_SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}</select></label><label className="ops-confirm-field"><span>Short note <small>(optional unless “Other”)</small></span><textarea value={confirmationDetails} onChange={(event) => { setConfirmationDetails(event.target.value); setConfirmationError(""); }} placeholder="For example: Parent confirmed by phone at 8:15 AM." /></label><p className="ops-confirm-warning">This does not delete or overwrite the original participant. It creates a confirmed vacancy for the audited replacement workflow.</p>{confirmationError ? <p className="ops-confirm-error" role="alert">{confirmationError}</p> : null}<div className="ops-confirm-actions"><button className="secondary" type="button" disabled={Boolean(busyId)} onClick={closeNoShowConfirmation}>Cancel</button><button className="primary" type="button" disabled={Boolean(busyId) || !confirmationSource} onClick={confirmNoShow}>{busyId ? "Saving…" : "Confirm not attending"}</button></div></div>
    </DismissibleLayer>
  </section>;
}
