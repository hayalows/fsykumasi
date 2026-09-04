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
import { DismissibleLayer, Empty, MutationFeedback, PageHead, SearchField, Status } from "../components/UI.jsx";
import { loadStaff } from "../lib/operations.js";
import { checkoutWellnessEncounter, elapsedSince, hasCapability, loadWellnessEncounters, loadWellnessPersonDetails, loadWellnessStatus, resolveWellnessFollowUp, startWellnessVisit, updateWellnessEncounter } from "../lib/field-operations.js";
import "./field-operations.css";

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

function initials(name = "FSY") { return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase(); }
function time(value) { return value ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : ""; }
function personContext(person) { return [person.fsyId, person.company, person.group].filter(Boolean).join(" · ") || person.context || (person.kind === "staff" ? "Staff" : "Participant"); }
function outcomeTone(outcome) { return outcome === "receiving_support" || outcome === "follow_up_needed" ? "warn" : outcome === "emergency_escalation" ? "danger" : "good"; }

function WellnessEditor({ sessionId, person, encounter, onClose, onSaved, live = false }) {
  const [details, setDetails] = useState(null);
  const [form, setForm] = useState({ concern: encounter?.concern || "", careProvided: encounter?.careProvided || "", medicineProvided: encounter?.medicineProvided || "" });
  const [checkoutOutcome, setCheckoutOutcome] = useState("returned_to_activity");
  const [checkingOut, setCheckingOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isNew = !encounter?.id;
  const isOpen = Boolean(encounter && !encounter.closedAt);

  useEffect(() => {
    if (!person || !sessionId) return undefined;
    let mounted = true;
    loadWellnessPersonDetails(sessionId, person.kind, person.id).then((value) => { if (mounted) setDetails(value); }).catch((err) => { if (mounted) setError(err.message || "Private Wellness details could not be loaded."); });
    return () => { mounted = false; };
  }, [sessionId, person]);

  const saveDetails = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      let id = encounter?.id;
      if (!id && !live) {
        const now = new Date().toISOString();
        await onSaved("Wellness visit started.", { id: `demo-wellness-${Date.now()}`, personType: person.kind, personId: person.id, name: person.name, fsyId: person.fsyId || "", company: person.company || "", group: person.group || "", ...form, outcome: "receiving_support", startedAt: now, closedAt: null, followUpStatus: "not_required", updatedAt: now });
        onClose(); return;
      }
      if (!id) {
        const result = await startWellnessVisit({ sessionId, personType: person.kind, personId: person.id, ...form });
        if (!result.created) throw new Error("This person already has an active Wellness visit. Open it from the queue instead.");
        await onSaved("Wellness visit started."); onClose(); return;
      }
      if (!live) {
        await onSaved("Wellness details saved.", { ...encounter, ...form, updatedAt: new Date().toISOString() });
        onClose(); return;
      }
      await updateWellnessEncounter({ encounterId: id, ...form, outcome: encounter?.outcome || "receiving_support", close: false });
      await onSaved("Wellness details saved."); onClose();
    } catch (err) { setError(err.message || "Unable to save this Wellness visit."); }
    finally { setBusy(false); }
  };

  const checkout = async () => {
    if (!encounter?.id) return;
    setBusy(true); setError("");
    try {
      if (!live) {
        const checkedOutAt = new Date().toISOString();
        const followUpStatus = checkoutOutcome === "follow_up_needed" ? "open" : "not_required";
        await onSaved(checkoutOutcome === "follow_up_needed" ? "Visit checked out · follow-up added." : "Visit checked out.", { ...encounter, ...form, outcome: checkoutOutcome, closedAt: checkedOutAt, followUpStatus, updatedAt: checkedOutAt });
        onClose(); return;
      }
      await updateWellnessEncounter({ encounterId: encounter.id, ...form, outcome: encounter.outcome || "receiving_support", close: false });
      await checkoutWellnessEncounter({ encounterId: encounter.id, outcome: checkoutOutcome });
      await onSaved(checkoutOutcome === "follow_up_needed" ? "Visit checked out · follow-up added." : "Visit checked out."); onClose();
    } catch (err) { setError(err.message || "Unable to check out this Wellness visit."); }
    finally { setBusy(false); }
  };

  const resolve = async () => {
    setBusy(true); setError("");
    try {
      if (!live) { await onSaved("Follow-up marked resolved.", { ...encounter, followUpStatus: "resolved", followUpResolvedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); onClose(); return; }
      await resolveWellnessFollowUp(encounter.id); await onSaved("Follow-up marked resolved."); onClose();
    }
    catch (err) { setError(err.message || "Unable to resolve this follow-up."); }
    finally { setBusy(false); }
  };

  return <DismissibleLayer open onClose={onClose} title="Wellness visit" sheet>
    <form className="field-sheet wellness-sheet" onSubmit={saveDetails}>
      <button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} aria-label="Close"><X /></button>
      <div className="wellness-editor-heading"><span className="person-avatar">{initials(person.name)}</span><div><span className="kicker">Confidential Wellness record</span><h2>{person.name}</h2><p>{personContext(person)}</p>{encounter ? <Status tone={isOpen ? "warn" : outcomeTone(encounter.outcome)}>{isOpen ? "At Wellness now" : OUTCOME_LABEL[encounter.outcome] || "Closed"}</Status> : <span className="wellness-start-note"><CheckCircle weight="fill"/> Starting a new visit records the current time</span>}</div></div>
      {details ? <details className="sensitive-context"><summary><LockKey size={17}/> Health & emergency context</summary><div>{details.medicalInformation ? <p><b>Medical information</b><span>{details.medicalInformation}</span></p> : null}{details.dietaryInformation ? <p><b>Dietary / allergy information</b><span>{details.dietaryInformation}</span></p> : null}{details.phone ? <p><b>Phone</b><span>{details.phone}</span></p> : null}{details.emergencyContactName || details.emergencyContactPhone ? <p><b>Emergency contact</b><span>{[details.emergencyContactName, details.emergencyContactPhone].filter(Boolean).join(" · ")}</span></p> : null}{!Object.values(details).some(Boolean) ? <p>No additional private health/contact context is stored.</p> : null}</div></details> : null}
      <label>What brought them to Wellness?<textarea rows="3" value={form.concern} onChange={(event) => setForm({ ...form, concern: event.target.value })} placeholder="Keep notes factual and concise" /></label>
      <label>Support / care provided<textarea rows="3" value={form.careProvided} onChange={(event) => setForm({ ...form, careProvided: event.target.value })} placeholder="Add only what was provided" /></label>
      <label>Medicine provided<input value={form.medicineProvided} onChange={(event) => setForm({ ...form, medicineProvided: event.target.value })} placeholder="Only when appropriate and authorized" /></label>

      {isOpen ? <div className="wellness-checkout-block"><div className="wellness-action-heading"><span><b>Still at Wellness?</b><small>Keep the visit active until the person leaves care.</small></span><Clock size={20}/></div>{checkingOut ? <div className="wellness-checkout-form"><label>Checkout outcome<select value={checkoutOutcome} onChange={(event) => setCheckoutOutcome(event.target.value)}>{CHECKOUT_OUTCOMES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><div className="field-sheet-actions"><button type="button" className="secondary" onClick={() => setCheckingOut(false)}>Keep open</button><button type="button" className="primary" disabled={busy} onClick={checkout}>{busy ? "Saving…" : "Save & check out"}</button></div></div> : <button type="button" className="secondary wellness-checkout-trigger" onClick={() => setCheckingOut(true)}>Check out this visit</button>}</div> : null}
      {encounter?.followUpStatus === "open" ? <div className="wellness-followup-resolve"><div><b>Follow-up is open</b><small>Close the loop when the next action is complete.</small></div><button type="button" className="secondary" disabled={busy} onClick={resolve}>{busy ? "Saving…" : "Mark resolved"}</button></div> : null}
      <p className="form-hint">Private notes are visible only to authorized Wellness users. This log does not replace required incident-reporting processes.</p>
      {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      <div className="field-sheet-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Saving…" : isNew ? "Start visit" : "Save details"}</button></div>
    </form>
  </DismissibleLayer>;
}

function VisitRow({ item, canManage, onOpen, statusOnly = false }) {
  const content = <><span className="wellness-visit-primary"><b>{item.name}</b><small>{[item.fsyId, item.company, item.group].filter(Boolean).join(" · ") || (item.personType === "staff" ? "Staff" : "Participant")}</small></span><span className="wellness-visit-secondary"><span><Status tone={outcomeTone(item.outcome)}>{!item.closedAt ? "At Wellness now" : OUTCOME_LABEL[item.outcome] || item.outcome}</Status><small>{!item.closedAt ? `${time(item.startedAt)} · ${elapsedSince(item.startedAt)}` : `${time(item.closedAt || item.startedAt)} · started ${time(item.startedAt)}`}</small></span>{statusOnly ? <ShieldCheck size={18} aria-label="Operational status only"/> : item.concern ? <small className="wellness-private-preview">{item.concern}</small> : null}</span></>;
  return canManage && !statusOnly ? <button type="button" className="wellness-visit-row" onClick={() => onOpen(item)}>{content}</button> : <div className="wellness-visit-row static">{content}</div>;
}

export function Wellness({ sessionId, participants = [], capabilities = [], sessionName, live = false }) {
  const canViewPrivate = hasCapability(capabilities, "wellness_private");
  const canViewStatus = canViewPrivate || hasCapability(capabilities, "wellness_status");
  const canManage = hasCapability(capabilities, "wellness_manage");
  const [encounters, setEncounters] = useState([]);
  const [statusRows, setStatusRows] = useState([]);
  const [staff, setStaff] = useState([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const reload = async () => {
    if (!live || !sessionId || !canViewStatus) return;
    const [nextStatus, nextPrivate, nextStaff] = await Promise.all([
      canViewPrivate ? Promise.resolve([]) : loadWellnessStatus(sessionId),
      canViewPrivate ? loadWellnessEncounters(sessionId) : Promise.resolve([]),
      canManage ? loadStaff(sessionId) : Promise.resolve([]),
    ]);
    setStatusRows(nextStatus); setEncounters(nextPrivate); setStaff(nextStaff);
  };
  useEffect(() => { reload().catch((err) => setError(err.message || "Unable to load Wellness.")); }, [sessionId, canViewStatus, canViewPrivate, canManage, live]);

  const rows = canViewPrivate ? encounters : statusRows;
  const active = rows.filter((item) => !item.closedAt && item.outcome === "receiving_support");
  const followUp = rows.filter((item) => item.followUpStatus === "open" || (item.outcome === "follow_up_needed" && !item.followUpStatus));
  const today = new Date().toDateString();
  const returnedToday = rows.filter((item) => item.outcome === "returned_to_activity" && new Date(item.closedAt || item.startedAt).toDateString() === today).length;
  const activeKeys = useMemo(() => new Set(active.map((item) => `${item.personType}:${item.personId}`)), [active]);

  const people = useMemo(() => {
    const youth = participants.map((person) => ({ id: person.id, kind: "participant", name: person.fullName, fsyId: person.fsyId || "", company: person.company || person.companyName || "", group: person.group || person.groupName || "", context: `${person.unit || "Unit not recorded"} · Participant` }));
    const leaders = staff.map((person) => ({ id: person.id, kind: "staff", name: person.name, fsyId: "", company: "", group: "", context: `${person.operationalRole || "Staff"} · ${person.unit || "Unit not recorded"}` }));
    const text = query.trim().toLowerCase();
    return [...youth, ...leaders].filter((person) => text && `${person.name} ${person.fsyId} ${person.company} ${person.group} ${person.context}`.toLowerCase().includes(text)).slice(0, 30);
  }, [participants, staff, query]);

  const openEditor = (item) => setSelected({ person: { id: item.personId, kind: item.personType, name: item.name, fsyId: item.fsyId, company: item.company, group: item.group }, encounter: item });
  const showSaved = (message) => { setSaved(message); window.setTimeout(() => setSaved(""), 2600); };

  if (!canViewStatus) return <section className="page"><PageHead title="Wellness" sessionName={sessionName} description="Wellness status is limited to leaders assigned to the work." /><article className="panel field-no-access"><FirstAidKit size={30}/><h2>Wellness is not in your access</h2><p>Ask an administrator to add Wellness status or private-record access to your assignment.</p></article></section>;

  return <section className="page field-page wellness-page">
    <PageHead title="Wellness" sessionName={sessionName} description={canViewPrivate ? "Keep the active queue moving, capture only what matters, and close every visit clearly." : "Operational status only. Private Wellness notes stay with the authorized Wellness team."} />
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}{saved ? <MutationFeedback>{saved}</MutationFeedback> : null}
    <div className="field-metrics wellness-metrics"><div><span>At Wellness now</span><strong>{active.length}</strong><small>Active visits</small></div><div><span>Follow-up</span><strong>{followUp.length}</strong><small>{canViewPrivate ? "Open items" : "Operational status"}</small></div><div><span>Returned today</span><strong>{returnedToday}</strong><small>Back to activity</small></div></div>

    {canManage ? <article className="panel field-find wellness-start-card"><div className="panel-head"><div><span className="kicker">Fast field action</span><h2>Start a Wellness visit</h2><p>Search by name, FSY ID, company, or group.</p></div><Plus size={22}/></div><SearchField value={query} onChange={setQuery} label="Find person for Wellness" placeholder="Search a participant or staff member" autoFocus /><div className="field-person-list compact-results">{people.map((person) => { const alreadyActive = activeKeys.has(`${person.kind}:${person.id}`); return <button key={`${person.kind}:${person.id}`} type="button" disabled={alreadyActive} onClick={() => !alreadyActive && setSelected({ person, encounter: null })}><span className="person-avatar">{initials(person.name)}</span><span><b>{person.name}</b><small>{personContext(person)}</small></span>{alreadyActive ? <Status tone="warn">Already active</Status> : <Plus />}</button>; })}{query.trim() && !people.length ? <div className="empty-inline"><b>No one found</b><span>Try a shorter name or FSY ID.</span></div> : null}</div></article> : null}

    <article className="panel wellness-queue-panel"><div className="panel-head"><div><span className="kicker">Now</span><h2>At Wellness now</h2><p>{active.length ? "Keep this queue visible while care is in progress." : "No active Wellness visits."}</p></div><Heartbeat size={22}/></div><div className="wellness-queue-list">{active.map((item) => <VisitRow key={item.id} item={item} canManage={canManage} onOpen={openEditor} statusOnly={!canViewPrivate}/>) }{!active.length ? <Empty icon={FirstAidKit} title="The queue is clear" text={canManage ? "Search above when someone comes for support." : "No one is currently marked as receiving support."} /> : null}</div></article>

    <article className="panel wellness-followup-panel"><div className="panel-head"><div><span className="kicker">Next action</span><h2>Follow-up queue</h2><p>{followUp.length ? "Resolve these after the next action is complete." : "No open follow-ups."}</p></div><Clock size={22}/></div><div className="wellness-queue-list">{followUp.map((item) => <VisitRow key={item.id} item={item} canManage={canManage} onOpen={openEditor} statusOnly={!canViewPrivate}/>) }{!followUp.length ? <div className="empty-inline"><b>Nothing needs follow-up</b><span>Closed visits remain in the history for continuity.</span></div> : null}</div></article>

    <details className="panel wellness-history"><summary><span><span className="kicker">Continuity</span><b>Recent Wellness activity</b><small>{rows.length} visits in this session</small></span><CaretDown size={20}/></summary><div className="wellness-queue-list">{rows.filter((item) => !activeKeys.has(`${item.personType}:${item.personId}`) && !followUp.some((follow) => follow.id === item.id)).slice(0, 60).map((item) => <VisitRow key={item.id} item={item} canManage={canManage} onOpen={openEditor} statusOnly={!canViewPrivate}/>) }{!rows.length ? <Empty icon={FirstAidKit} title="No Wellness visits yet" text={canManage ? "Start the first visit from the search above." : "The authorized Wellness team has not recorded a visit yet."} /> : null}</div></details>
    {selected ? <WellnessEditor sessionId={sessionId} person={selected.person} encounter={selected.encounter} live={live} onClose={() => setSelected(null)} onSaved={async (message, record) => { if (live) await reload(); else if (record) setEncounters((current) => [record, ...current.filter((item) => item.id !== record.id)]); showSaved(message); }} /> : null}
  </section>;
}
