import { useEffect, useMemo, useState } from "react";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { DownloadSimple } from "@phosphor-icons/react/DownloadSimple";
import { Printer } from "@phosphor-icons/react/Printer";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { SearchField, Status } from "./UI.jsx";
import { downloadCsv, printReport } from "../lib/report-files.js";
import {
  MEMBERSHIP_OPTIONS,
  MEMBERSHIP_SOURCES,
  loadParticipantMembershipStatuses,
  loadParticipantMembershipSummary,
  membershipLabel,
  setParticipantMembershipStatus,
} from "../lib/membership.js";
import "./participant-membership.css";

const REPORT_COLUMNS = [
  ["category", "Participant category", "text"],
  ["roster", "Roster", "number"],
  ["checkedIn", "Checked in", "number"],
];

function matchesParticipant(person, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  return [person.fullName, person.preferredName, person.fsyId, person.registrationId, person.unit, person.stake]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}

function deriveSummary(participants, statuses) {
  return MEMBERSHIP_OPTIONS.map((option) => {
    const rows = participants.filter((person) => (statuses.get(person.id || person.participantId)?.status || "unconfirmed") === option.value);
    return { status: option.value, label: option.label, roster: rows.length, checkedIn: rows.filter((person) => person.checkinStatus === "arrived").length };
  });
}

export function ParticipantMembershipPanel({ sessionId, participants = [], capabilities = [], live = false, mode = "desk", sessionName = "FSY Kumasi" }) {
  const [open, setOpen] = useState(mode === "readiness");
  const [statuses, setStatuses] = useState(new Map());
  const [summary, setSummary] = useState([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [source, setSource] = useState(mode === "desk" ? "checkin_confirmation" : "participant_or_guardian");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const canEdit = live && (capabilities.includes("registration_manage") || capabilities.includes("checkin_record"));
  const canReport = capabilities.includes("registration_view") || capabilities.includes("registration_manage") || capabilities.includes("reports_export") || !live;

  useEffect(() => {
    setSource(mode === "desk" ? "checkin_confirmation" : "participant_or_guardian");
    if (mode === "readiness") setOpen(true);
  }, [mode]);

  const refresh = async () => {
    if (!live || !sessionId) {
      setStatuses(new Map());
      setSummary(deriveSummary(participants, new Map()));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [nextStatuses, nextSummary] = await Promise.all([
        loadParticipantMembershipStatuses(sessionId),
        canReport ? loadParticipantMembershipSummary(sessionId) : Promise.resolve([]),
      ]);
      setStatuses(nextStatuses);
      setSummary(nextSummary.length ? nextSummary : deriveSummary(participants, nextStatuses));
    } catch (err) {
      setError("Membership status could not be loaded. Check-in can continue while this is retried.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [sessionId, live]);

  const counts = useMemo(() => {
    const rows = summary.length ? summary : deriveSummary(participants, statuses);
    return Object.fromEntries(rows.map((row) => [row.status, row.roster]));
  }, [participants, statuses, summary]);

  const matches = useMemo(() => query.trim()
    ? participants.filter((person) => matchesParticipant(person, query)).slice(0, 10)
    : [], [participants, query]);
  const selected = participants.find((person) => (person.id || person.participantId) === selectedId) || null;
  const selectedStatus = selected ? (statuses.get(selectedId)?.status || "unconfirmed") : "unconfirmed";

  const choosePerson = (person) => {
    const id = person.id || person.participantId;
    setSelectedId(id);
    setQuery("");
    setMessage("");
    setError("");
  };

  const save = async (status) => {
    if (!selected || !canEdit || busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await setParticipantMembershipStatus(selectedId, status, source);
      const next = new Map(statuses);
      next.set(selectedId, { status, source: status === "unconfirmed" ? "not_recorded" : source, verifiedAt: status === "unconfirmed" ? null : new Date().toISOString() });
      setStatuses(next);
      setSummary(deriveSummary(participants, next));
      setMessage(`${selected.fullName || "Participant"}: ${membershipLabel(status)} saved.`);
      if (live && canReport) loadParticipantMembershipSummary(sessionId).then(setSummary).catch(() => {});
    } catch (err) {
      setError("That membership status was not saved. Try again or ask a Registration leader.");
    } finally {
      setBusy(false);
    }
  };

  const reportRows = (summary.length ? summary : deriveSummary(participants, statuses)).map((row) => ({
    category: row.label || membershipLabel(row.status),
    roster: row.roster,
    checkedIn: row.checkedIn,
  }));
  const reportMeta = { sessionName, title: "Participant membership summary", generatedAt: new Date().toISOString(), generatedBy: "FSY Kumasi Operations", scope: "Authorized participant operations · aggregate only" };

  return <article className={`participant-membership-panel panel${open ? " open" : ""}`}>
    <button type="button" className="participant-membership-summary" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <span className="participant-membership-title"><ShieldCheck size={20} weight="fill"/><span><b>Participant membership</b><small>Quick status for check-in and end-of-session reporting</small></span></span>
      <span className="participant-membership-counts" aria-label="Membership status counts">
        <span><b>{loading ? "—" : (counts.non_member || 0)}</b><small>Non-member</small></span>
        <span><b>{loading ? "—" : (counts.recent_convert || 0)}</b><small>Recent</small></span>
        <span><b>{loading ? "—" : (counts.member_12_plus || 0)}</b><small>12+ months</small></span>
        <span className={(counts.unconfirmed || 0) ? "needs-review" : ""}><b>{loading ? "—" : (counts.unconfirmed || 0)}</b><small>Not confirmed</small></span>
      </span>
      <CaretDown size={18} className="participant-membership-caret" aria-hidden="true"/>
    </button>

    {open ? <div className="participant-membership-body">
      <div className="participant-membership-guidance"><ShieldCheck size={18}/><span><b>Participants only.</b> Record an explicit answer from the participant or parent/guardian, or confirmation from an authorized Church leader. Do not guess from ward, surname, Church account or registration history.</span></div>
      {error ? <p className="participant-membership-feedback error" role="alert">{error}</p> : null}
      {message ? <p className="participant-membership-feedback success" role="status"><CheckCircle weight="fill"/> {message}</p> : null}

      <div className="participant-membership-workspace">
        <section className="participant-membership-picker" aria-label="Find participant membership status">
          <h3>Find participant</h3>
          <SearchField value={query} onChange={setQuery} label="Find participant for membership status" placeholder="Name, FSY ID, ward or stake" />
          {query.trim() ? <div className="participant-membership-results">
            {matches.map((person) => { const id = person.id || person.participantId; const status = statuses.get(id)?.status || "unconfirmed"; return <button type="button" key={id} onClick={() => choosePerson(person)}>
              <span><b>{person.fullName}</b><small>{person.unit || "Ward / branch not recorded"}{person.fsyId ? ` · ${person.fsyId}` : ""}</small></span>
              <Status tone={status === "unconfirmed" ? "warn" : "good"}>{membershipLabel(status, { short: true })}</Status>
            </button>; })}
            {!matches.length ? <p>No participant matches this search.</p> : null}
          </div> : <p className="participant-membership-search-hint">Search only when you need to confirm or change a participant's status.</p>}
        </section>

        <section className="participant-membership-editor" aria-label="Participant membership classification">
          {selected ? <>
            <header><span><small>Selected participant</small><h3>{selected.fullName}</h3><p>{selected.unit || "Ward / branch not recorded"}{selected.stake ? ` · ${selected.stake}` : ""}</p></span><Status tone={selectedStatus === "unconfirmed" ? "warn" : "good"}>{membershipLabel(selectedStatus, { short: true })}</Status></header>
            {canEdit ? <>
              <label className="participant-membership-source"><span>How was this confirmed?</span><select value={source} onChange={(event) => setSource(event.target.value)}>{MEMBERSHIP_SOURCES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <div className="participant-membership-options" role="group" aria-label={`Membership status for ${selected.fullName}`}>
                {MEMBERSHIP_OPTIONS.map((option) => <button type="button" key={option.value} className={selectedStatus === option.value ? "selected" : ""} aria-pressed={selectedStatus === option.value} disabled={busy} onClick={() => save(option.value)}><span>{option.label}</span>{selectedStatus === option.value ? <CheckCircle weight="fill"/> : null}</button>)}
              </div>
              <small className="participant-membership-save-note">Tap one option. It saves immediately. “Not confirmed” is valid and never changes check-in eligibility.</small>
            </> : <p className="participant-membership-readonly">Your access can view this status but cannot change it.</p>}
          </> : <div className="participant-membership-empty"><b>Select a participant</b><span>The four clear choices appear here. Check-in stays separate so a missing answer does not stop the arrival line.</span></div>}
        </section>
      </div>

      {canReport ? <footer className="participant-membership-report"><span><b>Aggregate report</b><small>Names are left out. Export roster and checked-in totals for the four participant categories.</small></span><div><button type="button" className="secondary" disabled={!reportRows.length} onClick={() => downloadCsv("Participant membership summary", REPORT_COLUMNS, reportRows)}><DownloadSimple/>CSV</button><button type="button" className="secondary" disabled={!reportRows.length} onClick={() => printReport({ ...reportMeta, columns: REPORT_COLUMNS, rows: reportRows })}><Printer/>Print / PDF</button></div></footer> : null}
    </div> : null}
  </article>;
}
