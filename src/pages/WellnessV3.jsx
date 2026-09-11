import { useEffect, useMemo, useState } from "react";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Clock } from "@phosphor-icons/react/Clock";
import { FirstAidKit } from "@phosphor-icons/react/FirstAidKit";
import { Heartbeat } from "@phosphor-icons/react/Heartbeat";
import { LockKey } from "@phosphor-icons/react/LockKey";
import { Plus } from "@phosphor-icons/react/Plus";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { X } from "@phosphor-icons/react/X";
import { PersonName } from "../components/PersonPeek.jsx";
import { DismissibleLayer, Empty, MutationFeedback, PageHead, SearchField, Status } from "../components/UI.jsx";
import { loadStaff } from "../lib/operations.js";
import { searchPeople } from "../lib/person-search.js";
import {
  checkoutWellnessEncounter,
  elapsedSince,
  hasCapability,
  loadWellnessEncounters,
  loadWellnessPersonDetails,
  loadWellnessStatus,
  resolveWellnessFollowUp,
  startWellnessVisit,
  updateWellnessEncounter,
} from "../lib/field-operations.js";
import "./field-operations.css";
import "./wellness-v3.css";

const OUTCOMES = [
  ["receiving_support", "Receiving support"],
  ["follow_up_needed", "Follow-up needed"],
  ["returned_to_activity", "Returned to activity"],
  ["sent_home", "Sent home"],
  ["referred_off_site", "Referred / off-site care"],
  ["emergency_escalation", "Emergency escalation"],
];
const CHECKOUT_OUTCOMES = OUTCOMES.filter(([value]) => value !== "receiving_support");
const OUTCOME_LABEL = Object.fromEntries(OUTCOMES);
const ESCALATED_OUTCOMES = new Set(["referred_off_site", "emergency_escalation"]);

function initials(name = "FSY") {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function time(value) {
  return value ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "";
}

function personContext(person) {
  return [person.fsyId, person.company, person.group].filter(Boolean).join(" · ") || person.context || (person.kind === "staff" ? "Staff" : "Participant");
}

function outcomeTone(outcome) {
  if (outcome === "emergency_escalation" || outcome === "referred_off_site") return "danger";
  if (outcome === "receiving_support" || outcome === "follow_up_needed" || outcome === "sent_home") return "warn";
  return "good";
}

function dateKey(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function todayKey() {
  return dateKey(new Date());
}

function wellnessDateLabel(value) {
  if (!value) return "Date unavailable";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date(year, month - 1, day, 12));
}

function shiftDate(value, days) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function isFollowUpOpen(item) {
  return item.followUpStatus === "open" || (item.outcome === "follow_up_needed" && !item.followUpStatus);
}

function mostRecentTimestamp(item) {
  return new Date(item.closedAt || item.startedAt || 0).getTime();
}

function checkoutGuidance(outcome) {
  if (outcome === "emergency_escalation") return "If emergency help is needed, call emergency services first. Record the visit here, then complete the required incident-reporting process.";
  if (outcome === "referred_off_site") return "Care beyond basic first aid may require Global Incident Reporting. Record the visit here and follow the session reporting process.";
  if (outcome === "sent_home") return "Record the outcome here and follow the session process for leader and parent or guardian coordination.";
  return "The visit stays in history after checkout. Choose follow-up only when another action still needs to happen.";
}

function WellnessEditor({ sessionId, person, encounter, onClose, onSaved, live = false }) {
  const [details, setDetails] = useState(null);
  const [form, setForm] = useState({
    concern: encounter?.concern || "",
    careProvided: encounter?.careProvided || "",
    medicineProvided: encounter?.medicineProvided || "",
  });
  const [checkoutOutcome, setCheckoutOutcome] = useState("returned_to_activity");
  const [checkingOut, setCheckingOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isNew = !encounter?.id;
  const isOpen = Boolean(encounter && !encounter.closedAt);

  useEffect(() => {
    if (!person || !sessionId) return undefined;
    let mounted = true;
    loadWellnessPersonDetails(sessionId, person.kind, person.id)
      .then((value) => mounted && setDetails(value))
      .catch((err) => mounted && setError(err.message || "Private Wellness details could not be loaded."));
    return () => { mounted = false; };
  }, [sessionId, person]);

  const saveDetails = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      let id = encounter?.id;
      if (!id && !live) {
        const now = new Date().toISOString();
        await onSaved("Wellness visit started.", {
          id: `demo-wellness-${Date.now()}`,
          personType: person.kind,
          personId: person.id,
          name: person.name,
          fsyId: person.fsyId || "",
          company: person.company || "",
          group: person.group || "",
          ...form,
          outcome: "receiving_support",
          startedAt: now,
          closedAt: null,
          followUpStatus: "not_required",
          updatedAt: now,
        });
        onClose();
        return;
      }
      if (!id) {
        const result = await startWellnessVisit({ sessionId, personType: person.kind, personId: person.id, ...form });
        if (!result.created) throw new Error("This person already has an active Wellness visit. Open it from the current queue instead.");
        await onSaved("Wellness visit started.");
        onClose();
        return;
      }
      if (!live) {
        await onSaved("Wellness details saved.", { ...encounter, ...form, updatedAt: new Date().toISOString() });
        onClose();
        return;
      }
      await updateWellnessEncounter({ encounterId: id, ...form, outcome: encounter?.outcome || "receiving_support", close: false });
      await onSaved("Wellness details saved.");
      onClose();
    } catch (err) {
      setError(err.message || "Unable to save this Wellness visit.");
    } finally {
      setBusy(false);
    }
  };

  const checkout = async () => {
    if (!encounter?.id) return;
    setBusy(true);
    setError("");
    try {
      if (!live) {
        const checkedOutAt = new Date().toISOString();
        const followUpStatus = checkoutOutcome === "follow_up_needed" ? "open" : "not_required";
        await onSaved(checkoutOutcome === "follow_up_needed" ? "Visit checked out · follow-up added." : "Visit checked out.", {
          ...encounter,
          ...form,
          outcome: checkoutOutcome,
          closedAt: checkedOutAt,
          followUpStatus,
          updatedAt: checkedOutAt,
        });
        onClose();
        return;
      }
      await updateWellnessEncounter({ encounterId: encounter.id, ...form, outcome: encounter.outcome || "receiving_support", close: false });
      await checkoutWellnessEncounter({ encounterId: encounter.id, outcome: checkoutOutcome });
      await onSaved(checkoutOutcome === "follow_up_needed" ? "Visit checked out · follow-up added." : "Visit checked out.");
      onClose();
    } catch (err) {
      setError(err.message || "Unable to check out this Wellness visit.");
    } finally {
      setBusy(false);
    }
  };

  const resolve = async () => {
    setBusy(true);
    setError("");
    try {
      if (!live) {
        await onSaved("Follow-up marked resolved.", {
          ...encounter,
          followUpStatus: "resolved",
          followUpResolvedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        onClose();
        return;
      }
      await resolveWellnessFollowUp(encounter.id);
      await onSaved("Follow-up marked resolved.");
      onClose();
    } catch (err) {
      setError(err.message || "Unable to resolve this follow-up.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DismissibleLayer open onClose={onClose} title="Wellness visit" sheet className="wellness-editor-layer">
      <form className="field-sheet wellness-sheet" onSubmit={saveDetails}>
        <button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} aria-label="Close"><X /></button>

        <header className="wellness-editor-heading">
          <span className="person-avatar wellness-editor-avatar">{initials(person.name)}</span>
          <div>
            <span className="kicker">Confidential Wellness record</span>
            <h2>{person.name}</h2>
            <p>{personContext(person)}</p>
            {encounter
              ? <Status tone={isOpen ? "warn" : outcomeTone(encounter.outcome)}>{isOpen ? "At Wellness now" : OUTCOME_LABEL[encounter.outcome] || "Closed"}</Status>
              : <span className="wellness-start-note"><CheckCircle weight="fill" /> Start time is recorded when you save this visit</span>}
          </div>
        </header>

        {details ? (
          <details className="sensitive-context wellness-health-context">
            <summary><LockKey size={17} /> Health & emergency context</summary>
            <div>
              {details.medicalInformation ? <p><b>Medical information</b><span>{details.medicalInformation}</span></p> : null}
              {details.dietaryInformation ? <p><b>Dietary / allergy information</b><span>{details.dietaryInformation}</span></p> : null}
              {details.phone ? <p><b>Phone</b><span>{details.phone}</span></p> : null}
              {details.emergencyContactName || details.emergencyContactPhone ? <p><b>Emergency contact</b><span>{[details.emergencyContactName, details.emergencyContactPhone].filter(Boolean).join(" · ")}</span></p> : null}
              {!Object.values(details).some(Boolean) ? <p>No additional private health/contact context is stored.</p> : null}
            </div>
          </details>
        ) : null}

        <section className="wellness-editor-section" aria-labelledby="wellness-visit-notes-title">
          <div className="wellness-editor-section-head">
            <span>
              <small>Visit notes</small>
              <b id="wellness-visit-notes-title">Record what happened</b>
            </span>
            <FirstAidKit size={19} aria-hidden="true" />
          </div>
          <label>What brought them to Wellness?
            <textarea rows="3" value={form.concern} onChange={(event) => setForm({ ...form, concern: event.target.value })} placeholder="Keep notes factual and concise" />
          </label>
          <label>Support / care provided
            <textarea rows="3" value={form.careProvided} onChange={(event) => setForm({ ...form, careProvided: event.target.value })} placeholder="Add only what was provided" />
          </label>
          <label>Medicine provided
            <input value={form.medicineProvided} onChange={(event) => setForm({ ...form, medicineProvided: event.target.value })} placeholder="Only when appropriate and authorized" />
          </label>
        </section>

        {isOpen ? (
          <section className="wellness-checkout-block" aria-labelledby="wellness-checkout-title">
            <div className="wellness-action-heading">
              <span>
                <small>Finish the visit</small>
                <b id="wellness-checkout-title">What happened next?</b>
              </span>
              <Clock size={20} aria-hidden="true" />
            </div>
            {checkingOut ? (
              <div className="wellness-checkout-form">
                <label>Checkout outcome
                  <select value={checkoutOutcome} onChange={(event) => setCheckoutOutcome(event.target.value)}>
                    {CHECKOUT_OUTCOMES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <p className={`wellness-outcome-guidance ${ESCALATED_OUTCOMES.has(checkoutOutcome) ? "attention" : ""}`}>{checkoutGuidance(checkoutOutcome)}</p>
                <div className="field-sheet-actions">
                  <button type="button" className="secondary" onClick={() => setCheckingOut(false)}>Keep visit open</button>
                  <button type="button" className="primary" disabled={busy} onClick={checkout}>{busy ? "Saving…" : "Save & check out"}</button>
                </div>
              </div>
            ) : (
              <button type="button" className="secondary wellness-checkout-trigger" onClick={() => setCheckingOut(true)}>Check out this visit</button>
            )}
          </section>
        ) : null}

        {encounter?.followUpStatus === "open" ? (
          <section className="wellness-followup-resolve">
            <div><b>Follow-up is still open</b><small>Mark it resolved after the next action is complete.</small></div>
            <button type="button" className="secondary" disabled={busy} onClick={resolve}>{busy ? "Saving…" : "Mark resolved"}</button>
          </section>
        ) : null}

        <p className="form-hint wellness-privacy-note"><LockKey size={15} aria-hidden="true" /> Private notes stay with authorized Wellness users. This log does not replace required incident reporting.</p>
        {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
        <div className="field-sheet-actions wellness-editor-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? "Saving…" : isNew ? "Start visit" : "Save details"}</button>
        </div>
      </form>
    </DismissibleLayer>
  );
}

function VisitRow({ item, canEdit, onOpen, statusOnly = false, historical = false }) {
  const openLabel = historical ? "Still open after this day" : "At Wellness now";
  const content = (
    <>
      <span className="wellness-visit-primary">
        <b>{item.name}</b>
        <small>{[item.fsyId, item.company, item.group].filter(Boolean).join(" · ") || (item.personType === "staff" ? "Staff" : "Participant")}</small>
      </span>
      <span className="wellness-visit-secondary">
        <span>
          <Status tone={outcomeTone(item.outcome)}>{!item.closedAt ? openLabel : OUTCOME_LABEL[item.outcome] || item.outcome}</Status>
          <small>{!item.closedAt ? `${elapsedSince(item.startedAt)} open · since ${time(item.startedAt)}` : `${time(item.closedAt || item.startedAt)} · started ${time(item.startedAt)}`}</small>
        </span>
        {statusOnly ? <ShieldCheck size={18} aria-label="Operational status only" /> : item.concern ? <small className="wellness-private-preview">{item.concern}</small> : null}
      </span>
    </>
  );
  return canEdit && !statusOnly
    ? <button type="button" className="wellness-visit-row" onClick={() => onOpen(item)}>{content}</button>
    : <div className="wellness-visit-row static">{content}</div>;
}

function WellnessLoading() {
  return (
    <div className="wellness-loading" aria-live="polite" aria-busy="true">
      <div className="wellness-loading-metrics" aria-hidden="true">{[0, 1, 2, 3].map((item) => <span key={item} />)}</div>
      <article className="panel wellness-loading-panel">
        <span className="wellness-loading-line wide" />
        <span className="wellness-loading-line" />
        <div className="wellness-loading-rows">{[0, 1, 2].map((item) => <span key={item} />)}</div>
        <p>Loading current Wellness activity…</p>
      </article>
    </div>
  );
}

function StartVisitPicker({ people, query, onQuery, activeKeys, onClose, onSelect }) {
  return (
    <DismissibleLayer open onClose={onClose} title="Start Wellness visit" sheet className="wellness-picker-layer">
      <div className="wellness-picker">
        <button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} aria-label="Close"><X /></button>
        <div className="wellness-picker-head">
          <span className="wellness-picker-icon"><Plus size={22} /></span>
          <div><span className="kicker">New visit</span><h2>Find the person</h2><p>Search participants or staff by name, FSY ID, unit, company or group.</p></div>
        </div>
        <SearchField value={query} onChange={onQuery} label="Find person for Wellness" placeholder="Name, FSY ID, unit, company or group" autoFocus />
        <div className="field-person-list compact-results wellness-picker-results">
          {people.map((person) => {
            const alreadyActive = activeKeys.has(`${person.kind}:${person.id}`);
            return (
              <button key={`${person.kind}:${person.id}`} type="button" disabled={alreadyActive} onClick={() => !alreadyActive && onSelect(person)}>
                <span className="person-avatar">{initials(person.name)}</span>
                <span><b><PersonName person={person} kind={person.kind} interactive={false} /></b><small>{personContext(person)}</small></span>
                {alreadyActive ? <Status tone="warn">Already active</Status> : <span className="wellness-picker-result-action">Start visit<Plus size={17} aria-hidden="true" /></span>}
              </button>
            );
          })}
          {!query.trim() ? <div className="wellness-search-prompt"><b>Search to start a visit</b><span>The current queue is checked first so one person cannot be started twice.</span></div> : null}
          {query.trim() && !people.length ? <div className="empty-inline"><b>No one found</b><span>Try a shorter name, reversed name order, unit or FSY ID.</span></div> : null}
        </div>
      </div>
    </DismissibleLayer>
  );
}

function DayActivity({ activityDate, setActivityDate, rows, canEdit, canViewPrivate, onOpen }) {
  const isToday = activityDate === todayKey();
  const dayRows = useMemo(
    () => rows
      .filter((item) => dateKey(item.startedAt) === activityDate || dateKey(item.closedAt) === activityDate)
      .sort((a, b) => mostRecentTimestamp(b) - mostRecentTimestamp(a)),
    [rows, activityDate],
  );
  const firstRows = dayRows.slice(0, 12);
  const remainingRows = dayRows.slice(12);

  return (
    <article className="panel wellness-day-panel">
      <header className="wellness-day-head">
        <div><span className="kicker">Daily record</span><h2>{isToday ? "Today’s activity" : wellnessDateLabel(activityDate)}</h2><p>{dayRows.length} {dayRows.length === 1 ? "visit" : "visits"} recorded for this day.</p></div>
        {isToday ? <Status tone="good">Today</Status> : null}
      </header>

      <div className="wellness-date-nav" aria-label="Wellness activity date">
        <button type="button" className="secondary" onClick={() => setActivityDate(shiftDate(activityDate, -1))} aria-label="Previous day">Previous</button>
        <label><span>Review day</span><input type="date" value={activityDate} max={todayKey()} onChange={(event) => setActivityDate(event.target.value || todayKey())} /></label>
        <button type="button" className="secondary" onClick={() => setActivityDate(shiftDate(activityDate, 1))} disabled={isToday} aria-label="Next day">Next</button>
      </div>
      {!isToday ? <button type="button" className="text-action wellness-today-button" onClick={() => setActivityDate(todayKey())}>Back to Today</button> : null}

      <div className="wellness-day-list">
        {firstRows.map((item) => <VisitRow key={item.id} item={item} canEdit={canEdit} onOpen={onOpen} statusOnly={!canViewPrivate} historical={!isToday} />)}
        {!dayRows.length ? <Empty icon={FirstAidKit} title="No visits recorded" text={isToday ? "Wellness activity recorded today will appear here." : "Choose another day to review its Wellness activity."} /> : null}
        {remainingRows.length ? (
          <details className="wellness-more-history">
            <summary>Show {remainingRows.length} more <CaretDown size={17} /></summary>
            <div className="wellness-day-list more">{remainingRows.map((item) => <VisitRow key={item.id} item={item} canEdit={canEdit} onOpen={onOpen} statusOnly={!canViewPrivate} historical={!isToday} />)}</div>
          </details>
        ) : null}
      </div>
    </article>
  );
}

export function Wellness({ sessionId, participants = [], capabilities = [], sessionName, live = false }) {
  const canViewPrivate = hasCapability(capabilities, "wellness_private");
  const canViewStatus = canViewPrivate || hasCapability(capabilities, "wellness_status");
  const canManage = hasCapability(capabilities, "wellness_manage");
  const canEdit = canManage && canViewPrivate;
  const [encounters, setEncounters] = useState([]);
  const [statusRows, setStatusRows] = useState([]);
  const [staff, setStaff] = useState([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [activityDate, setActivityDate] = useState(() => todayKey());
  const [loadState, setLoadState] = useState(() => (live && canViewStatus ? "loading" : "ready"));

  const reload = async ({ initial = false } = {}) => {
    if (!live || !sessionId || !canViewStatus) {
      setLoadState("ready");
      return;
    }
    if (initial) setLoadState("loading");
    setError("");
    try {
      const [nextStatus, nextPrivate, nextStaff] = await Promise.all([
        canViewPrivate ? Promise.resolve([]) : loadWellnessStatus(sessionId),
        canViewPrivate ? loadWellnessEncounters(sessionId) : Promise.resolve([]),
        canEdit ? loadStaff(sessionId) : Promise.resolve([]),
      ]);
      setStatusRows(nextStatus);
      setEncounters(nextPrivate);
      setStaff(nextStaff);
      setLoadState("ready");
    } catch (err) {
      setError(err.message || "Unable to load Wellness.");
      setLoadState((current) => current === "ready" ? "ready" : "error");
    }
  };

  useEffect(() => {
    reload({ initial: true });
  }, [sessionId, canViewStatus, canViewPrivate, canEdit, live]);

  const rows = canViewPrivate ? encounters : statusRows;
  const today = todayKey();
  const active = useMemo(
    () => rows.filter((item) => !item.closedAt && item.outcome === "receiving_support").sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt)),
    [rows],
  );
  const followUp = useMemo(
    () => rows.filter(isFollowUpOpen).sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt)),
    [rows],
  );
  const returnedToday = rows.filter((item) => item.outcome === "returned_to_activity" && dateKey(item.closedAt || item.startedAt) === today).length;
  const escalatedToday = rows.filter((item) => ESCALATED_OUTCOMES.has(item.outcome) && dateKey(item.closedAt || item.startedAt) === today).length;
  const activeKeys = useMemo(() => new Set(active.map((item) => `${item.personType}:${item.personId}`)), [active]);

  const people = useMemo(() => {
    const youth = participants.map((person) => ({
      id: person.id,
      kind: "participant",
      name: person.fullName,
      fullName: person.fullName,
      age: person.age,
      fsyId: person.fsyId || "",
      company: person.company || person.companyName || "",
      group: person.group || person.groupName || "",
      unit: person.unit || "",
      context: `${person.unit || "Unit not recorded"} · Participant`,
    }));
    const leaders = staff.map((person) => ({
      id: person.id,
      kind: "staff",
      name: person.name,
      fullName: person.name,
      unit: person.unit || "",
      operationalRole: person.operationalRole,
      fsyId: "",
      company: "",
      group: "",
      context: `${person.operationalRole || "Staff"} · ${person.unit || "Unit not recorded"}`,
    }));
    return query.trim() ? searchPeople([...youth, ...leaders], query, (person) => [person.context]).slice(0, 30) : [];
  }, [participants, staff, query]);

  const openEditor = (item) => setSelected({
    person: { id: item.personId, kind: item.personType, name: item.name, fsyId: item.fsyId, company: item.company, group: item.group },
    encounter: item,
  });
  const showSaved = (message) => {
    setSaved(message);
    window.setTimeout(() => setSaved(""), 2600);
  };
  const startVisit = (person) => {
    setPickerOpen(false);
    setQuery("");
    setSelected({ person, encounter: null });
  };

  if (!canViewStatus) {
    return (
      <section className="page">
        <PageHead title="Wellness" sessionName={sessionName} description="Wellness status is limited to leaders assigned to the work." />
        <article className="panel field-no-access"><FirstAidKit size={30} /><h2>Wellness is not in your access</h2><p>Ask an administrator to add Wellness status or private-record access to your assignment.</p></article>
      </section>
    );
  }

  const headAction = canEdit ? (
    <button type="button" className="primary wellness-head-action" disabled={loadState !== "ready"} onClick={() => { setQuery(""); setPickerOpen(true); }}>
      <Plus size={18} /> Start visit
    </button>
  ) : null;

  return (
    <section className="page field-page wellness-page wellness-v2 wellness-v4">
      <PageHead
        title="Wellness"
        sessionName={sessionName}
        description={canViewPrivate ? "Current care first. Keep follow-up visible until it is finished, and use the daily record when you need history." : "Operational status only. Private Wellness notes stay with the authorized Wellness team."}
        action={headAction}
      />

      {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      {saved ? <MutationFeedback>{saved}</MutationFeedback> : null}

      {loadState === "loading" ? <WellnessLoading /> : null}
      {loadState === "error" && !rows.length ? (
        <article className="panel wellness-load-error">
          <FirstAidKit size={28} />
          <div><h2>Wellness activity did not load</h2><p>Nothing has been shown as clear or zero because the live record is unavailable.</p></div>
          <button type="button" className="secondary" onClick={() => reload({ initial: true })}>Try again</button>
        </article>
      ) : null}

      {loadState === "ready" ? (
        <>
          <section className="wellness-summary-strip" aria-label="Current Wellness summary">
            <div className={active.length ? "attention" : ""}><span>At Wellness now</span><strong>{active.length}</strong><small>Active visits</small></div>
            <div className={followUp.length ? "attention" : ""}><span>Open follow-up</span><strong>{followUp.length}</strong><small>Until resolved</small></div>
            <div><span>Returned today</span><strong>{returnedToday}</strong><small>Back to activity</small></div>
            <div className={escalatedToday ? "urgent" : ""}><span>Off-site / emergency</span><strong>{escalatedToday}</strong><small>Today</small></div>
          </section>

          <div className="wellness-workspace">
            <main className="wellness-priority-column">
              <article className={`panel wellness-queue-panel wellness-v2-priority ${active.length ? "has-active" : ""}`}>
                <div className="panel-head wellness-priority-head">
                  <div><span className="kicker">Current care</span><h2>At Wellness now</h2><p>{active.length ? "Oldest active visit is first so the team can see who has been here longest." : "No one is currently marked as receiving support."}</p></div>
                  <span className="wellness-panel-icon"><Heartbeat size={22} /></span>
                </div>
                <div className="wellness-queue-list">
                  {active.map((item) => <VisitRow key={item.id} item={item} canEdit={canEdit} onOpen={openEditor} statusOnly={!canViewPrivate} />)}
                  {!active.length ? (
                    <Empty
                      icon={FirstAidKit}
                      title="The current queue is clear"
                      text={canEdit ? "Start a visit when someone comes to Wellness." : "No one is currently marked as receiving support."}
                      action={canEdit ? <button type="button" className="primary" onClick={() => { setQuery(""); setPickerOpen(true); }}><Plus size={17} /> Start visit</button> : null}
                    />
                  ) : null}
                </div>
              </article>

              {followUp.length ? (
                <article className="panel wellness-followup-panel">
                  <div className="panel-head">
                    <div><span className="kicker">Still needs action</span><h2>Open follow-up</h2><p>These stay here across days until someone marks the follow-up resolved.</p></div>
                    <span className="wellness-panel-icon followup"><Clock size={22} /></span>
                  </div>
                  <div className="wellness-queue-list">
                    {followUp.map((item) => <VisitRow key={item.id} item={item} canEdit={canEdit} onOpen={openEditor} statusOnly={!canViewPrivate} />)}
                  </div>
                </article>
              ) : null}
            </main>

            <aside className="wellness-activity-column">
              <DayActivity activityDate={activityDate} setActivityDate={setActivityDate} rows={rows} canEdit={canEdit} canViewPrivate={canViewPrivate} onOpen={openEditor} />
              <div className="wellness-reporting-note"><ShieldCheck size={18} /><p><b>Incident reporting stays separate.</b><span>Illness or injury beyond basic first aid may need Global Incident Reporting. Emergency services come first when needed.</span></p></div>
            </aside>
          </div>
        </>
      ) : null}

      {pickerOpen && canEdit ? <StartVisitPicker people={people} query={query} onQuery={setQuery} activeKeys={activeKeys} onClose={() => { setPickerOpen(false); setQuery(""); }} onSelect={startVisit} /> : null}
      {selected && canEdit ? (
        <WellnessEditor
          sessionId={sessionId}
          person={selected.person}
          encounter={selected.encounter}
          live={live}
          onClose={() => setSelected(null)}
          onSaved={async (message, record) => {
            if (live) await reload();
            else if (record) setEncounters((current) => [record, ...current.filter((item) => item.id !== record.id)]);
            showSaved(message);
          }}
        />
      ) : null}
    </section>
  );
}
