import { useMemo, useState } from "react";
import { Cake } from "@phosphor-icons/react/Cake";
import { Check } from "@phosphor-icons/react/Check";
import { ArrowCounterClockwise } from "@phosphor-icons/react/ArrowCounterClockwise";
import { Empty, PageHead, Status } from "../components/UI.jsx";
import "./operations.css";

function formatDate(value) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", weekday: "short", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)); }

export function Birthdays({ birthdays = [], onSetAcknowledgement, sessionName }) {
  const [busyId, setBusyId] = useState(""); const [error, setError] = useState("");
  const grouped = useMemo(() => birthdays.reduce((days, birthday) => { (days[birthday.date] ||= []).push(birthday); return days; }, {}), [birthdays]);
  const update = async (person, acknowledged) => {
    setBusyId(person.participantId); setError("");
    try { await onSetAcknowledgement?.(person.participantId, acknowledged); }
    catch (err) { setError(err.message || "Unable to save this acknowledgment."); }
    finally { setBusyId(""); }
  };
  return <section className="page">
    <PageHead title="Birthdays this FSY" sessionName={sessionName} description="A quiet leadership view for participants celebrating during 14–19 September. If somebody is marked by mistake, the acknowledgement can be undone." />
    {error ? <div className="form-error page-error" role="alert">{error}</div> : null}
    {!birthdays.length ? <article className="panel"><Empty icon={Cake} title="No birthdays in your current scope" text="Birthdays appear after a registration snapshot with dates of birth is applied." /></article> : Object.entries(grouped).map(([date, people]) => <article className="panel birthday-day" key={date}>
      <div className="panel-head"><div><span className="kicker">{formatDate(date)}</span><h2>{people.length} celebrating</h2></div><Cake size={24}/></div>
      <div className="birthday-list">{people.map((person) => <div key={person.participantId}><span className="person-avatar">{person.name.split(/\s+/).map((part) => part[0]).slice(0,2).join("")}</span><span><b>{person.name}</b><small>Turning {person.turningAge} · {person.unit || "Unit not recorded"}{person.company ? ` · ${person.company}` : ""}{person.group ? ` / ${person.group}` : ""}</small></span><div className="birthday-actions">{person.acknowledged ? <><Status tone="good"><Check/>Acknowledged</Status><button className="secondary compact-button" disabled={busyId === person.participantId} onClick={() => update(person, false)}><ArrowCounterClockwise/>{busyId === person.participantId ? "Saving…" : "Undo"}</button></> : <button className="secondary compact-button" disabled={busyId === person.participantId} onClick={() => update(person, true)}>{busyId === person.participantId ? "Saving…" : "Acknowledge"}</button>}</div></div>)}</div>
    </article>)}
  </section>;
}

