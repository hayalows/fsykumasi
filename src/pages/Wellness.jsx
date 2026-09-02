import { useEffect, useMemo, useState } from "react";
import { FirstAidKit } from "@phosphor-icons/react/FirstAidKit";
import { Heartbeat } from "@phosphor-icons/react/Heartbeat";
import { Plus } from "@phosphor-icons/react/Plus";
import { X } from "@phosphor-icons/react/X";
import { DismissibleLayer, Empty, MutationFeedback, PageHead, SearchField, Status } from "../components/UI.jsx";
import { loadStaff } from "../lib/operations.js";
import { createWellnessEncounter, hasCapability, loadWellnessEncounters, loadWellnessPersonDetails, updateWellnessEncounter } from "../lib/field-operations.js";
import "./field-operations.css";

const OUTCOMES = [
  ["receiving_support", "Receiving support"],
  ["follow_up_needed", "Follow-up needed"],
  ["returned_to_activity", "Returned to activity"],
  ["sent_home", "Sent home"],
  ["referred_off_site", "Referred / off-site care"],
  ["emergency_escalation", "Emergency escalation"],
];
const OUTCOME_LABEL = Object.fromEntries(OUTCOMES);
function initials(name = "FSY") { return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase(); }
function time(value) { return value ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : ""; }

function WellnessEditor({ sessionId, person, encounter, onClose, onSaved }) {
  const [details, setDetails] = useState(null);
  const [form, setForm] = useState({ concern: encounter?.concern || "", careProvided: encounter?.careProvided || "", medicineProvided: encounter?.medicineProvided || "", outcome: encounter?.outcome || "receiving_support" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (person) loadWellnessPersonDetails(sessionId, person.kind, person.id).then(setDetails).catch((err) => setError(err.message || "Private Wellness details could not be loaded.")); }, [sessionId, person]);
  const save = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      let id = encounter?.id;
      if (!id) id = await createWellnessEncounter({ sessionId, personType: person.kind, personId: person.id, concern: form.concern });
      await updateWellnessEncounter({ encounterId: id, ...form, close: ["returned_to_activity","sent_home","referred_off_site","emergency_escalation"].includes(form.outcome) });
      await onSaved(); onClose();
    } catch (err) { setError(err.message || "Unable to save this Wellness visit."); }
    finally { setBusy(false); }
  };
  return <DismissibleLayer open onClose={onClose} title="Wellness visit" sheet>
    <form className="field-sheet wellness-sheet" onSubmit={save}>
      <button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} aria-label="Close"><X /></button>
      <span className="kicker">Confidential Wellness record</span><h2>{person.name}</h2><p>{person.context}</p>
      {details ? <details className="sensitive-context"><summary>Health & emergency context</summary><div>{details.medicalInformation ? <p><b>Medical information</b><span>{details.medicalInformation}</span></p> : null}{details.dietaryInformation ? <p><b>Dietary / allergy information</b><span>{details.dietaryInformation}</span></p> : null}{details.phone ? <p><b>Phone</b><span>{details.phone}</span></p> : null}{details.emergencyContactName || details.emergencyContactPhone ? <p><b>Emergency contact</b><span>{[details.emergencyContactName, details.emergencyContactPhone].filter(Boolean).join(" · ")}</span></p> : null}{!Object.values(details).some(Boolean) ? <p>No additional private health/contact context is stored.</p> : null}</div></details> : null}
      <label>What brought them to Wellness?<textarea rows="3" value={form.concern} onChange={(e) => setForm({ ...form, concern: e.target.value })} placeholder="Keep notes factual and concise" /></label>
      <label>Support / care provided<textarea rows="3" value={form.careProvided} onChange={(e) => setForm({ ...form, careProvided: e.target.value })} /></label>
      <label>Medicine provided<input value={form.medicineProvided} onChange={(e) => setForm({ ...form, medicineProvided: e.target.value })} placeholder="Only when appropriate and authorized" /></label>
      <label>Outcome<select value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })}>{OUTCOMES.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <p className="form-hint">This operational log does not replace required Church or local incident-reporting processes.</p>
      {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      <div className="field-sheet-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Saving…" : encounter ? "Save visit" : "Start visit"}</button></div>
    </form>
  </DismissibleLayer>;
}

export function Wellness({ sessionId, participants = [], capabilities = [], sessionName }) {
  const canViewPrivate = hasCapability(capabilities, "wellness_private");
  const canManage = hasCapability(capabilities, "wellness_manage");
  const [encounters, setEncounters] = useState([]);
  const [staff, setStaff] = useState([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const reload = async () => {
    if (!sessionId || !canViewPrivate) return;
    const [nextEncounters, nextStaff] = await Promise.all([loadWellnessEncounters(sessionId), loadStaff(sessionId)]);
    setEncounters(nextEncounters); setStaff(nextStaff);
  };
  useEffect(() => { reload().catch((err) => setError(err.message || "Unable to load Wellness.")); }, [sessionId, canViewPrivate]);

  const people = useMemo(() => {
    const youth = participants.map((person) => ({ id: person.id, kind: "participant", name: person.fullName, context: `${person.unit || "Unit not recorded"} · Participant` }));
    const leaders = staff.map((person) => ({ id: person.id, kind: "staff", name: person.name, context: `${person.operationalRole || "Staff"} · ${person.unit || "Unit not recorded"}` }));
    const text = query.trim().toLowerCase();
    return [...youth, ...leaders].filter((person) => text && `${person.name} ${person.context}`.toLowerCase().includes(text)).slice(0, 40);
  }, [participants, staff, query]);
  const active = encounters.filter((item) => !item.closedAt && item.outcome === "receiving_support");
  const followUp = encounters.filter((item) => item.outcome === "follow_up_needed" && !item.closedAt);
  const today = new Date().toDateString();
  const returnedToday = encounters.filter((item) => item.outcome === "returned_to_activity" && new Date(item.closedAt || item.startedAt).toDateString() === today).length;

  if (!canViewPrivate) return <section className="page"><PageHead title="Wellness" sessionName={sessionName} description="Wellness records are restricted to the people assigned to this work." /><article className="panel"><Empty icon={FirstAidKit} title="Wellness is not in your access" text="The current status can be shared operationally, but confidential Wellness notes require a specific Wellness assignment." /></article></section>;

  return <section className="page field-page">
    <PageHead title="Wellness" sessionName={sessionName} description="Record support clearly, keep private notes restricted, and surface only the operational status others need." />
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}{saved ? <MutationFeedback>{saved}</MutationFeedback> : null}
    <div className="field-metrics"><div><span>At Wellness now</span><strong>{active.length}</strong><small>Receiving support</small></div><div><span>Follow-up</span><strong>{followUp.length}</strong><small>Open follow-up items</small></div><div><span>Returned today</span><strong>{returnedToday}</strong><small>Back to activity</small></div></div>
    {canManage ? <article className="panel field-find"><div className="panel-head"><div><span className="kicker">Fast field action</span><h2>Start a Wellness visit</h2></div><Plus size={22}/></div><SearchField value={query} onChange={setQuery} label="Find person for Wellness" placeholder="Search a participant or staff member" autoFocus /><div className="field-person-list compact-results">{people.map((person) => <button key={`${person.kind}:${person.id}`} type="button" onClick={() => setSelected({ person, encounter: null })}><span className="person-avatar">{initials(person.name)}</span><span><b>{person.name}</b><small>{person.context}</small></span><Plus /></button>)}</div></article> : null}
    <article className="panel"><div className="panel-head"><div><span className="kicker">Visit log</span><h2>Recent Wellness activity</h2></div><Heartbeat size={22}/></div><div className="encounter-list">{encounters.map((item) => <button key={item.id} type="button" onClick={() => canManage && setSelected({ person: { id:item.personId, kind:item.personType, name:item.name, context:item.personType === "participant" ? "Participant" : "Staff" }, encounter:item })}><span><b>{item.name}</b><small>{time(item.startedAt)} · recorded by {item.recordedBy}</small></span><span><Status tone={item.outcome === "receiving_support" || item.outcome === "follow_up_needed" ? "warn" : "good"}>{OUTCOME_LABEL[item.outcome] || item.outcome}</Status>{item.concern ? <small>{item.concern}</small> : null}</span></button>)}{!encounters.length ? <Empty icon={FirstAidKit} title="No Wellness visits yet" text="When someone comes for support, start a visit from the search above." /> : null}</div></article>
    {selected ? <WellnessEditor sessionId={sessionId} person={selected.person} encounter={selected.encounter} onClose={() => setSelected(null)} onSaved={async () => { await reload(); setSaved("Wellness visit saved."); }} /> : null}
  </section>;
}
