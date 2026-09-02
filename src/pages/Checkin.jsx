import { useEffect, useMemo, useState } from "react";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { Metric, MutationFeedback, PageHead, SearchField, Status } from "../components/UI.jsx";
import { operationalEligibility } from "../lib/registration.js";
import { formatCount } from "../lib/cohort.js";
import "./operations.css";

function eligibility(person, groupsPublished, structureSettings) {
  const base = operationalEligibility(person, structureSettings);
  if (!base.ok) return { ok: false, label: base.reason };
  if (groupsPublished && !person.groupId) return { ok: false, label: "Needs group assignment" };
  return { ok: true, label: "Ready" };
}

export function Checkin({ participants, cohort, checkedIds = [], onRecord, onAddMissing, live = false, canRecord = true, groupsPublished = false, structureSettings = {}, sessionName }) {
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState(new Set(checkedIds));
  const [busyId, setBusyId] = useState("");
  const [confirmUndoId, setConfirmUndoId] = useState("");
  const [lastAction, setLastAction] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => { setChecked(new Set(checkedIds)); }, [checkedIds]);

  const withEligibility = useMemo(() => participants.map((person) => ({ person, eligibility: eligibility(person, groupsPublished, structureSettings) })), [participants, groupsPublished, structureSettings]);
  const eligibleCount = withEligibility.filter((item) => item.eligibility.ok).length;
  const attentionCount = withEligibility.filter((item) => !item.eligibility.ok).length;
  const ageReviewCount = withEligibility.filter((item) => item.eligibility.label?.startsWith("Age review")).length;
  const expectedCount = groupsPublished ? eligibleCount : (cohort?.eligible ?? eligibleCount);
  const results = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (text.length < 2) return withEligibility.filter((item) => item.eligibility.ok).slice(0, 8);
    return withEligibility.filter(({ person }) => `${person.fullName} ${person.preferredName || ""} ${person.registrationId || ""} ${person.unit || ""} ${person.stake || ""}`.toLowerCase().includes(text)).slice(0, 15);
  }, [withEligibility, query]);

  const saveStatus = async (person, arriving) => {
    setBusyId(person.id); setError("");
    try {
      if (onRecord) await onRecord(person.id, arriving ? "arrived" : "expected");
      setChecked((current) => { const next = new Set(current); arriving ? next.add(person.id) : next.delete(person.id); return next; });
      setConfirmUndoId("");
      setLastAction(arriving ? { id: person.id, name: person.fullName } : null);
    } catch (err) { setError(err.message || "Check-in could not be saved. Try again before moving to the next participant."); }
    finally { setBusyId(""); }
  };

  const toggle = async (person, isEligible) => {
    if (!canRecord || !isEligible) return;
    const arriving = !checked.has(person.id);
    if (!arriving && confirmUndoId !== person.id) { setConfirmUndoId(person.id); return; }
    await saveStatus(person, arriving);
  };

  const undoLast = async () => {
    if (!lastAction) return;
    const person = participants.find((item) => item.id === lastAction.id);
    if (person) await saveStatus(person, false);
    setLastAction(null);
  };

  return <section className="page">
    <PageHead title="Check-in" sessionName={sessionName} description="Find the person by their original registration name, confirm the record, and mark them arrived. Exceptions stay visible without slowing the main line." />
    {!canRecord ? <div className="notice"><WarningCircle/><div><b>View-only check-in</b><p>Your role can see current arrival information, but it cannot change check-in records.</p></div></div> : null}
    {error ? <div className="form-error page-error" role="alert"><WarningCircle/>{error}</div> : null}
    <div className="cohort-context checkin-cohort-context"><b>{formatCount(expectedCount)} expected today</b><span>{cohort ? `${formatCount(cohort.records)} registration records · ${formatCount(attentionCount)} need attention` : "Search by the original registration details"}</span></div>
    <div className="metrics-grid compact"><Metric label="Expected" value={expectedCount.toLocaleString()} note={groupsPublished ? "eligible and assigned" : "operationally eligible"}/><Metric label="Checked in" value={checked.size.toLocaleString()} note={live ? "saved in Supabase" : "prototype device state"} tone="green"/><Metric label="Need attention" value={attentionCount.toLocaleString()} note={ageReviewCount ? `${ageReviewCount} age review` : attentionCount ? "approval, verification or group assignment" : "no unresolved blockers"} tone="yellow"/></div>
    <article className="panel"><SearchField value={query} onChange={(value) => { setQuery(value); setConfirmUndoId(""); }} label="Search check-in" placeholder="Search name, registration ID, ward, branch or stake"/><div className="check-list">{results.map(({ person, eligibility: state }) => {
      const arrived = checked.has(person.id);
      return <button key={person.id} disabled={!canRecord || busyId === person.id || !state.ok} onClick={() => toggle(person, state.ok)} className={`${arrived ? "checked" : ""}${state.ok ? "" : " ineligible"}`}><span className="person-avatar">{person.firstName?.[0]}{person.lastName?.[0]}</span><span><b>{person.fullName}</b><small>{person.registrationId || "No registration ID"} · {person.unit || "Unit not recorded"}</small></span><span className="check-action">{busyId === person.id ? "Saving…" : !state.ok ? <Status tone="warn">{state.label}</Status> : confirmUndoId === person.id ? "Tap again to undo" : arrived ? <><CheckCircle weight="fill"/>Arrived</> : canRecord ? "Check in" : "View only"}</span></button>;
    })}{query.trim().length >= 2 && !results.length ? <div className="checkin-no-result"><b>No person found</b><p>Try a shorter spelling or search by ward, branch or stake. Preferred names are searchable, but the original registration full name is always shown.</p>{onAddMissing ? <button className="secondary" onClick={onAddMissing}>Add missing participant</button> : null}</div> : null}</div></article>
    {lastAction ? <div className="action-feedback-row"><MutationFeedback><b>{lastAction.name}</b> marked arrived and saved.</MutationFeedback><button className="secondary compact-button" disabled={busyId === lastAction.id} onClick={undoLast}>Undo</button></div> : null}
  </section>;
}

