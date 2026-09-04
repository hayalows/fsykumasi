import { useEffect, useMemo, useState } from "react";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { Check } from "@phosphor-icons/react/Check";
import { ForkKnife } from "@phosphor-icons/react/ForkKnife";
import { Plus } from "@phosphor-icons/react/Plus";
import { Timer } from "@phosphor-icons/react/Timer";
import { X } from "@phosphor-icons/react/X";
import { Empty, MutationFeedback, PageHead, SearchField, SegmentedControl, Status } from "../components/UI.jsx";
import { hasCapability, loadFoodNeeds, loadMealAttendance, loadMealRoster, loadMealServices, markMealServed, createMealService, setFoodAcknowledgement, setMealServiceStatus } from "../lib/field-operations.js";
import "./field-operations.css";

const MEAL_TYPES = [["breakfast", "Breakfast"], ["lunch", "Lunch"], ["dinner", "Dinner"], ["snack", "Snack"], ["other", "Other"]];
const mealLabel = (value) => MEAL_TYPES.find(([type]) => type === value)?.[1] || "Meal";
const personKey = (personType, personId) => `${personType}:${personId}`;
const formatTime = (value) => value ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "";

function demoServices(date) { return [{ id: "demo-lunch", date, mealType: "lunch", label: "Lunch", status: "open", openedAt: new Date().toISOString(), closedAt: null, servedCount: 0, expectedCount: 1640 }]; }

export function Food({ sessionId, capabilities = [], sessionName, participants = [], live = false }) {
  const canView = hasCapability(capabilities, "food_view");
  const canManage = hasCapability(capabilities, "food_manage");
  const [tab, setTab] = useState("meals");
  const [needs, setNeeds] = useState([]);
  const [services, setServices] = useState([]);
  const [roster, setRoster] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [serviceDate, setServiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [query, setQuery] = useState("");
  const [mealQuery, setMealQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [newMeal, setNewMeal] = useState({ type: "lunch", label: "" });

  const reload = async () => {
    if (!canView) return;
    if (!live) {
      setServices(demoServices(serviceDate));
      setRoster(participants.slice(0, 300).map((person) => ({ personType: "participant", personId: person.id, name: person.fullName, fsyId: person.fsyId || "", company: person.company || person.companyName || "", group: person.group || person.groupName || "" })));
      return;
    }
    const [nextNeeds, nextServices, nextRoster] = await Promise.all([loadFoodNeeds(sessionId), loadMealServices(sessionId, serviceDate), loadMealRoster(sessionId)]);
    setNeeds(nextNeeds); setServices(nextServices); setRoster(nextRoster);
  };
  useEffect(() => { reload().catch((err) => setError(err.message || "Unable to load Food operations.")); }, [sessionId, canView, live, serviceDate]);

  const selectedService = services.find((service) => service.id === selectedServiceId) || services[0] || null;
  useEffect(() => { if (selectedService && selectedService.id !== selectedServiceId) setSelectedServiceId(selectedService.id); }, [selectedService, selectedServiceId]);
  useEffect(() => {
    if (!selectedService || !live) { setAttendance([]); return undefined; }
    let mounted = true;
    loadMealAttendance(selectedService.id).then((rows) => { if (mounted) setAttendance(rows); }).catch((err) => { if (mounted) setError(err.message || "Unable to load meal attendance."); });
    return () => { mounted = false; };
  }, [selectedService?.id, live]);

  const attendanceMap = useMemo(() => new Map(attendance.map((item) => [personKey(item.personType, item.personId), item])), [attendance]);
  const dietaryRows = useMemo(() => { const text = query.trim().toLowerCase(); return needs.filter((item) => !text || `${item.name} ${item.dietaryInformation} ${item.group} ${item.company}`.toLowerCase().includes(text)); }, [needs, query]);
  const mealPeople = useMemo(() => {
    const text = mealQuery.trim().toLowerCase();
    if (!text) return [];
    return roster.filter((person) => `${person.name} ${person.fsyId} ${person.company} ${person.group}`.toLowerCase().includes(text)).slice(0, 30);
  }, [roster, mealQuery]);
  const openCount = needs.filter((item) => !item.acknowledged).length;

  const showSaved = (message) => { setSaved(message); window.setTimeout(() => setSaved(""), 2400); };

  const toggleNeed = async (item) => {
    const key = personKey(item.personType, item.personId); const next = !item.acknowledged;
    setBusy(`need:${key}`); setError("");
    setNeeds((current) => current.map((row) => personKey(row.personType, row.personId) === key ? { ...row, acknowledged: next, acknowledgedAt: next ? new Date().toISOString() : null } : row));
    try { if (live) await setFoodAcknowledgement({ sessionId, personType: item.personType, personId: item.personId, acknowledged: next }); showSaved(next ? "Dietary item acknowledged." : "Dietary item reopened."); }
    catch (err) { setNeeds((current) => current.map((row) => personKey(row.personType, row.personId) === key ? item : row)); setError(err.message || "Unable to save this dietary item."); }
    finally { setBusy(""); }
  };

  const markServed = async (person) => {
    if (!selectedService || selectedService.status !== "open") return;
    const key = personKey(person.personType, person.personId); if (attendanceMap.has(key)) return;
    setBusy(`meal:${key}`); setError("");
    try {
      const result = live ? await markMealServed({ serviceId: selectedService.id, personType: person.personType, personId: person.personId }) : { id: `demo-attendance-${key}`, servedAt: new Date().toISOString(), alreadyServed: false };
      const row = { ...person, id: result.id, servedAt: result.servedAt };
      if (!result.alreadyServed) { setAttendance((current) => [row, ...current]); setServices((current) => current.map((service) => service.id === selectedService.id ? { ...service, servedCount: Number(service.servedCount || 0) + 1 } : service)); }
      showSaved(`${person.name} · ${selectedService.label} served.`);
    } catch (err) { setError(err.message || "Unable to mark meal attendance."); }
    finally { setBusy(""); }
  };

  const changeServiceStatus = async (service, nextStatus) => {
    setBusy(`service:${service.id}`); setError("");
    try { if (live) await setMealServiceStatus(service.id, nextStatus); setServices((current) => current.map((item) => item.id === service.id ? { ...item, status: nextStatus, openedAt: nextStatus === "open" ? item.openedAt || new Date().toISOString() : item.openedAt, closedAt: nextStatus === "closed" ? new Date().toISOString() : null } : item)); showSaved(nextStatus === "open" ? `${service.label} is open.` : `${service.label} is closed.`); }
    catch (err) { setError(err.message || "Unable to update this meal service."); }
    finally { setBusy(""); }
  };

  const createService = async (event) => {
    event.preventDefault(); setBusy("create-service"); setError("");
    try {
      const id = live ? await createMealService({ sessionId, serviceDate, mealType: newMeal.type, label: newMeal.label }) : `demo-${newMeal.type}-${Date.now()}`;
      const created = { id, date: serviceDate, mealType: newMeal.type, label: newMeal.label.trim() || mealLabel(newMeal.type), status: "planned", openedAt: null, closedAt: null, servedCount: 0, expectedCount: roster.length || 1640 };
      setServices((current) => [...current.filter((item) => item.id !== id), created]); setSelectedServiceId(id); setSetupOpen(false); setNewMeal({ type: "lunch", label: "" }); showSaved(`${created.label} service created.`);
    } catch (err) { setError(err.message || "Unable to create this meal service."); }
    finally { setBusy(""); }
  };

  if (!canView) return <section className="page"><PageHead title="Food" sessionName={sessionName} description="Food operations are limited to the people assigned to this work."/><article className="panel field-no-access"><ForkKnife size={30}/><h2>Food is not in your access</h2><p>Ask an administrator to add the Food team if meal and dietary support is part of your assignment.</p></article></section>;

  return <section className="page field-page food-page">
    <PageHead title="Food" sessionName={sessionName} description="Run meal service quickly, then keep dietary needs in their own review flow." />
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}{saved ? <MutationFeedback>{saved}</MutationFeedback> : null}
    <SegmentedControl label="Food workflows" value={tab} onChange={setTab} options={[{ value: "meals", label: "Meal service", count: services.length }, { value: "needs", label: "Dietary needs", count: needs.length }]} className="food-tabs" />

    {tab === "meals" ? <>
      <div className="food-date-row"><label>Service date<input type="date" value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} /></label>{canManage ? <button type="button" className="secondary" onClick={() => setSetupOpen((value) => !value)}><Plus/>Set up a meal</button> : null}</div>
      {setupOpen && canManage ? <form className="panel food-setup-form" onSubmit={createService}><div><span className="kicker">Advanced setup</span><h2>Add a meal service</h2><p>Create the service before opening its attendance list.</p></div><label>Meal type<select value={newMeal.type} onChange={(event) => setNewMeal({ ...newMeal, type: event.target.value })}>{MEAL_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Label (optional)<input maxLength="60" value={newMeal.label} onChange={(event) => setNewMeal({ ...newMeal, label: event.target.value })} placeholder="e.g. Lunch" /></label><div className="field-sheet-actions"><button type="button" className="secondary" onClick={() => setSetupOpen(false)}><X/>Cancel</button><button className="primary" disabled={busy === "create-service"}>{busy === "create-service" ? "Creating…" : "Create service"}</button></div></form> : null}
      {services.length ? <div className="meal-service-strip">{services.map((service) => <button type="button" className={selectedService?.id === service.id ? "meal-service-card selected" : "meal-service-card"} key={service.id} onClick={() => setSelectedServiceId(service.id)}><span><b>{service.label}</b><small>{mealLabel(service.mealType)} · {service.servedCount}/{service.expectedCount || "—"} served</small></span><Status tone={service.status === "open" ? "good" : service.status === "closed" ? "muted" : "warn"}>{service.status === "open" ? "Open" : service.status === "closed" ? "Closed" : "Planned"}</Status></button>)}</div> : <article className="panel"><Empty icon={ForkKnife} title="No meal service for this date" text={canManage ? "Set up a service when the kitchen is ready to plan it." : "The Food team has not set up a service for this date."} action={canManage ? <button type="button" className="primary" onClick={() => setSetupOpen(true)}><Plus/>Set up a meal</button> : null}/></article>}
      {selectedService ? <article className="panel meal-dashboard"><div className="panel-head"><div><span className="kicker">Active meal dashboard</span><h2>{selectedService.label}</h2><p>{selectedService.status === "open" ? "Search a person, then mark them served once." : selectedService.status === "planned" ? "Open the service when serving begins." : "This service is closed; attendance remains available for review."}</p></div><Timer size={22}/></div><div className="meal-dashboard-glance"><span><b>{selectedService.servedCount}</b><small>served</small></span><span><b>{Math.max(0, Number(selectedService.expectedCount || 0) - Number(selectedService.servedCount || 0))}</b><small>remaining</small></span><span><b>{attendance.length}</b><small>loaded here</small></span></div>{canManage && selectedService.status === "planned" ? <button type="button" className="primary meal-status-action" disabled={busy === `service:${selectedService.id}`} onClick={() => changeServiceStatus(selectedService, "open")}>{busy === `service:${selectedService.id}` ? "Opening…" : `Open ${selectedService.label}`}</button> : null}{canManage && selectedService.status === "open" ? <button type="button" className="secondary meal-status-action" disabled={busy === `service:${selectedService.id}`} onClick={() => changeServiceStatus(selectedService, "closed")}>{busy === `service:${selectedService.id}` ? "Closing…" : `Close ${selectedService.label}`}</button> : null}{selectedService.status === "open" ? <div className="meal-mark-area"><SearchField value={mealQuery} onChange={setMealQuery} label="Find person for meal service" placeholder={`Search to mark ${selectedService.label.toLowerCase()} served`} /><div className="field-person-list compact-results">{mealPeople.map((person) => { const served = attendanceMap.get(personKey(person.personType, person.personId)); return <button type="button" key={personKey(person.personType, person.personId)} disabled={Boolean(served) || !canManage || busy === `meal:${personKey(person.personType, person.personId)}`} onClick={() => markServed(person)}><span className="person-avatar">{person.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span><span><b>{person.name}</b><small>{[person.fsyId, person.company, person.group].filter(Boolean).join(" · ") || "Participant"}</small></span>{served ? <Status tone="good"><Check/>Served {formatTime(served.servedAt)}</Status> : <span className="meal-mark-label">{busy === `meal:${personKey(person.personType, person.personId)}` ? "Saving…" : `Mark ${selectedService.label.toLowerCase()} served`}</span>}</button>; })}{mealQuery.trim() && !mealPeople.length ? <div className="empty-inline"><b>No one found</b><span>Search by full name or FSY ID.</span></div> : null}</div></div> : null}<details className="meal-attendance-history"><summary><span><span className="kicker">Recorded</span><b>People served</b><small>{attendance.length} loaded for this service</small></span><CaretDown size={19}/></summary><div className="meal-attendance-list">{attendance.slice(0, 80).map((person) => <div key={person.id} className="meal-attendance-row"><span><b>{person.name}</b><small>{[person.fsyId, person.company, person.group].filter(Boolean).join(" · ") || "Participant"}</small></span><time>{formatTime(person.servedAt)}</time></div>)}{!attendance.length ? <p className="form-hint">No attendance recorded yet.</p> : null}</div></details></article> : null}
    </> : <>
      <div className="field-metrics"><div><span>Dietary records</span><strong>{needs.length}</strong><small>Participants and staff</small></div><div><span>Needs acknowledgement</span><strong>{openCount}</strong><small>Food team attention</small></div><div><span>Acknowledged</span><strong>{needs.length - openCount}</strong><small>Reviewed by Food</small></div></div>
      <article className="panel"><div className="panel-head"><div><span className="kicker">Dietary operations</span><h2>Food needs</h2><p>Review dietary information separately from meal attendance.</p></div><ForkKnife size={22}/></div><SearchField value={query} onChange={setQuery} label="Search dietary needs" placeholder="Search name, company, group or restriction"/><div className="food-list">{dietaryRows.map((item) => <div key={personKey(item.personType, item.personId)} className={item.acknowledged ? "food-row acknowledged" : "food-row"}><div><b>{item.name}</b><small>{item.personType === "staff" ? "Staff" : [item.company, item.group].filter(Boolean).join(" · ") || "Participant"}</small></div><p>{item.dietaryInformation}</p><div className="food-row-action">{item.acknowledged ? <Status tone="good"><Check/>Acknowledged</Status> : <Status tone="warn">Needs review</Status>}{canManage ? <button type="button" className="secondary compact-button" disabled={busy === `need:${personKey(item.personType, item.personId)}`} onClick={() => toggleNeed(item)}>{busy === `need:${personKey(item.personType, item.personId)}` ? "Saving…" : item.acknowledged ? "Reopen" : "Acknowledge"}</button> : null}</div></div>)}{!dietaryRows.length ? <div className="empty-inline"><b>No matching dietary needs</b><span>{needs.length ? "Try a shorter search." : "No dietary restrictions are stored in your current scope."}</span></div> : null}</div></article>
    </>}
  </section>;
}
