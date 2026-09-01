import { useEffect, useMemo, useState } from "react";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { Metric, PageHead } from "../components/UI.jsx";

export function Checkin({ participants, checkedIds = [], onRecord, live = false, canRecord = true }) {
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState(new Set(checkedIds));
  const [busyId, setBusyId] = useState("");
  const [confirmUndoId, setConfirmUndoId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { setChecked(new Set(checkedIds)); }, [checkedIds]);

  const results = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (text.length < 2) return participants.slice(0, 8);
    return participants.filter((p) => `${p.fullName} ${p.registrationId} ${p.unit}`.toLowerCase().includes(text)).slice(0, 12);
  }, [participants, query]);

  const toggle = async (id) => {
    if (!canRecord) return;
    const arriving = !checked.has(id);
    if (!arriving && confirmUndoId !== id) {
      setConfirmUndoId(id);
      return;
    }
    setBusyId(id);
    setError("");
    try {
      if (onRecord) await onRecord(id, arriving ? "arrived" : "expected");
      setChecked((current) => {
        const next = new Set(current);
        arriving ? next.add(id) : next.delete(id);
        return next;
      });
      setConfirmUndoId("");
    } catch (err) {
      setError(err.message || "Check-in could not be saved. Try again before moving to the next participant.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <section className="page">
      <PageHead title="Check-in" description="Search, confirm, tap once. Exceptions should move to a separate queue instead of slowing the main line." />
      {!canRecord ? <div className="notice"><WarningCircle/><div><b>View-only check-in</b><p>Your role can see current arrival information, but it cannot change check-in records.</p></div></div> : null}
      {error ? <div className="form-error page-error" role="alert"><WarningCircle />{error}</div> : null}
      <div className="metrics-grid compact">
        <Metric label="Expected" value={participants.length.toLocaleString()} note="approved participant list" />
        <Metric label="Checked in" value={checked.size.toLocaleString()} note={live ? "saved in Supabase" : "prototype device state"} tone="green" />
        <Metric label="Need attention" value="0" note="no unresolved arrivals" tone="yellow" />
      </div>
      <article className="panel">
        <div className="search"><MagnifyingGlass/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, registration ID or unit"/></div>
        <div className="check-list">
          {results.map((person) => (
            <button key={person.id} disabled={!canRecord || busyId === person.id} onClick={() => toggle(person.id)} className={checked.has(person.id) ? "checked" : ""}>
              <span className="person-avatar">{person.firstName[0]}{person.lastName[0]}</span>
              <span><b>{person.fullName}</b><small>{person.registrationId} · {person.unit}</small></span>
              <span className="check-action">{busyId === person.id ? "Saving…" : confirmUndoId === person.id ? "Tap again to undo" : checked.has(person.id) ? <><CheckCircle weight="fill"/>Arrived</> : canRecord ? "Check in" : "View only"}</span>
            </button>
          ))}
        </div>
      </article>
    </section>
  );
}
