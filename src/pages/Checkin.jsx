import { useMemo, useState } from "react";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { Metric, PageHead } from "../components/UI.jsx";

export function Checkin({ participants }) {
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState(new Set());
  const results = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (text.length < 2) return participants.slice(0, 8);
    return participants.filter((p) => `${p.fullName} ${p.registrationId} ${p.unit}`.toLowerCase().includes(text)).slice(0, 12);
  }, [participants, query]);

  const toggle = (id) => setChecked((current) => {
    const next = new Set(current);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return (
    <section className="page">
      <PageHead title="Check-in" description="Search, confirm, tap once. Exceptions should move to a separate queue instead of slowing the main line." />
      <div className="metrics-grid compact">
        <Metric label="Expected" value={participants.length.toLocaleString()} note="approved participant list" />
        <Metric label="Checked in" value={checked.size.toLocaleString()} note="prototype device state" tone="green" />
        <Metric label="Need attention" value="0" note="no unresolved arrivals" tone="yellow" />
      </div>
      <article className="panel">
        <div className="search"><MagnifyingGlass/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, registration ID or unit"/></div>
        <div className="check-list">
          {results.map((person) => (
            <button key={person.id} onClick={() => toggle(person.id)} className={checked.has(person.id) ? "checked" : ""}>
              <span className="person-avatar">{person.firstName[0]}{person.lastName[0]}</span>
              <span><b>{person.fullName}</b><small>{person.registrationId} · {person.unit}</small></span>
              <span className="check-action">{checked.has(person.id) ? <><CheckCircle weight="fill"/>Arrived</> : "Check in"}</span>
            </button>
          ))}
        </div>
      </article>
    </section>
  );
}
