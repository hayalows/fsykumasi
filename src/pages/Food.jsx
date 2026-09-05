import { useCallback, useEffect, useMemo, useState } from "react";
import { Check } from "@phosphor-icons/react/Check";
import { ForkKnife } from "@phosphor-icons/react/ForkKnife";
import { Plus } from "@phosphor-icons/react/Plus";
import { X } from "@phosphor-icons/react/X";
import { Empty, MutationFeedback, PageHead, SearchField, SegmentedControl, Status } from "../components/UI.jsx";
import {
  createMealService,
  hasCapability,
  loadFoodNeeds,
  loadMealAttendance,
  loadMealRoster,
  loadMealServices,
  setFoodAcknowledgement,
  setMealServiceStatus,
} from "../lib/field-operations.js";
import { loadMealProgress, setParticipantMealServed } from "../lib/meal-attendance.js";
import "./field-operations.css";
import "./meal-attendance.css";

const MEAL_TYPES = [["breakfast", "Breakfast"], ["lunch", "Lunch"], ["dinner", "Dinner"], ["snack", "Snack"], ["other", "Other"]];
const FILTERS = [
  { value: "remaining", label: "Not served" },
  { value: "all", label: "All" },
  { value: "served", label: "Served" },
];
const PAGE_SIZE = 120;
const mealLabel = (value) => MEAL_TYPES.find(([type]) => type === value)?.[1] || "Meal";
const personKey = (personType, personId) => `${personType}:${personId}`;
const formatTime = (value) => value ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "";
const formatDate = (value) => value ? new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)) : "";

function demoServices(date, expectedCount) {
  return [{ id: "demo-lunch", date, mealType: "lunch", label: "Lunch", status: "open", openedAt: new Date().toISOString(), closedAt: null, servedCount: 0, expectedCount }];
}

export function Food({ sessionId, capabilities = [], sessionName, participants = [], live = false }) {
  const hasFoodView = hasCapability(capabilities, "food_view");
  const canViewMeals = hasFoodView || hasCapability(capabilities, "meal_attendance_view");
  const canRecordMeals = hasCapability(capabilities, "food_manage") || hasCapability(capabilities, "meal_attendance_record");
  const canManage = hasCapability(capabilities, "food_manage");
  const canViewDietary = hasFoodView;

  const [tab, setTab] = useState("meals");
  const [needs, setNeeds] = useState([]);
  const [services, setServices] = useState([]);
  const [roster, setRoster] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [progress, setProgress] = useState([]);
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [serviceDate, setServiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [query, setQuery] = useState("");
  const [mealQuery, setMealQuery] = useState("");
  const [mealFilter, setMealFilter] = useState("remaining");
  const [companyFilter, setCompanyFilter] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const [busyRows, setBusyRows] = useState([]);
  const [serviceBusy, setServiceBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [newMeal, setNewMeal] = useState({ type: "lunch", label: "" });

  const setRowBusy = (participantId, isBusy) => setBusyRows((current) => isBusy
    ? current.includes(participantId) ? current : [...current, participantId]
    : current.filter((id) => id !== participantId));

  const showSaved = (message) => {
    setSaved(message);
    window.setTimeout(() => setSaved(""), 1800);
  };

  const reloadBase = useCallback(async () => {
    if (!canViewMeals) return;
    if (!live) {
      const demoRoster = participants.map((person) => ({
        personType: "participant",
        personId: person.id,
        name: person.fullName,
        fsyId: person.fsyId || "",
        company: person.company || person.companyName || "",
        group: person.group || person.groupName || "",
      }));
      setRoster(demoRoster);
      setServices(demoServices(serviceDate, demoRoster.length));
      if (canViewDietary) setNeeds([]);
      return;
    }
    const [nextServices, nextRoster, nextNeeds] = await Promise.all([
      loadMealServices(sessionId, null),
      loadMealRoster(sessionId),
      canViewDietary ? loadFoodNeeds(sessionId) : Promise.resolve([]),
    ]);
    setServices(nextServices);
    setRoster(nextRoster.filter((person) => person.personType === "participant"));
    setNeeds(nextNeeds);
  }, [canViewMeals, canViewDietary, live, participants, serviceDate, sessionId]);

  useEffect(() => {
    reloadBase().catch((err) => setError(err.message || "Unable to load meal service."));
  }, [reloadBase]);

  useEffect(() => {
    if (!live || !canViewMeals || selectedServiceId) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') loadMealServices(sessionId, null).then(setServices).catch(err=>setError(err.message));
    }, 12000);
    return () => window.clearInterval(timer);
  }, [live, canViewMeals, selectedServiceId, sessionId]);

  useEffect(() => {
    if (!canViewDietary && tab === "needs") setTab("meals");
  }, [canViewDietary, tab]);

  const selectedService = services.find((service) => service.id === selectedServiceId) || services[0] || null;
  useEffect(() => {
    if (!services.length) { setSelectedServiceId(""); return; }
    if (services.some((service) => service.id === selectedServiceId)) return;
    setSelectedServiceId((services.find((service) => service.status === "open") || services[0]).id);
  }, [services, selectedServiceId]);

  const refreshSelected = useCallback(async (serviceId, quiet = false) => {
    if (!serviceId) return;
    if (!live) return;
    try {
      const [nextAttendance, nextProgress, nextServices] = await Promise.all([
        loadMealAttendance(serviceId),
        loadMealProgress(serviceId),
        loadMealServices(sessionId, null),
      ]);
      setAttendance(nextAttendance.filter((person) => person.personType === "participant"));
      setProgress(nextProgress);
      setServices(nextServices);
    } catch (err) {
      setError(err.message || "Meal attendance could not refresh. The last confirmed figures are shown.");
    }
  }, [live, sessionId]);

  useEffect(() => {
    if (!selectedService?.id) { setAttendance([]); setProgress([]); return undefined; }
    if (!live) { setAttendance([]); setProgress([]); return undefined; }
    let active = true;
    refreshSelected(selectedService.id).catch(() => {});
    const timer = window.setInterval(() => {
      if (!active || document.visibilityState === "hidden") return;
      refreshSelected(selectedService.id, true).catch(() => {});
    }, 12000);
    return () => { active = false; window.clearInterval(timer); };
  }, [selectedService?.id, live, refreshSelected]);

  useEffect(() => { setVisibleLimit(PAGE_SIZE); }, [mealQuery, mealFilter, companyFilter, selectedService?.id]);

  const attendanceMap = useMemo(() => new Map(attendance.map((item) => [item.personId, item])), [attendance]);
  const dietaryRows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return needs.filter((item) => !text || `${item.name} ${item.dietaryInformation} ${item.group} ${item.company}`.toLowerCase().includes(text));
  }, [needs, query]);

  const companyOptions = useMemo(() => [...new Set(roster.map((person) => person.company || "Unassigned"))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [roster]);
  const filteredRoster = useMemo(() => {
    const text = mealQuery.trim().toLowerCase();
    return roster.filter((person) => {
      const served = attendanceMap.has(person.personId);
      if (mealFilter === "remaining" && served) return false;
      if (mealFilter === "served" && !served) return false;
      if (companyFilter && (person.company || "Unassigned") !== companyFilter) return false;
      if (!text) return true;
      return `${person.name} ${person.fsyId} ${person.company} ${person.group}`.toLowerCase().includes(text);
    });
  }, [roster, attendanceMap, mealFilter, companyFilter, mealQuery]);
  const visibleRoster = filteredRoster.slice(0, visibleLimit);
  const openCount = needs.filter((item) => !item.acknowledged).length;
  const hasOpenService = services.some((service) => service.status === "open");
  const selectedServed = Number(selectedService?.servedCount || attendance.length || 0);
  const selectedExpected = Number(selectedService?.expectedCount || roster.length || 0);
  const selectedRemaining = Math.max(0, selectedExpected - selectedServed);
  const completion = selectedExpected ? Math.min(100, Math.round((selectedServed / selectedExpected) * 100)) : 0;

  const toggleNeed = async (item) => {
    const key = personKey(item.personType, item.personId);
    const next = !item.acknowledged;
    setServiceBusy(`need:${key}`);
    setError("");
    setNeeds((current) => current.map((row) => personKey(row.personType, row.personId) === key ? { ...row, acknowledged: next, acknowledgedAt: next ? new Date().toISOString() : null } : row));
    try {
      if (live) await setFoodAcknowledgement({ sessionId, personType: item.personType, personId: item.personId, acknowledged: next });
      showSaved(next ? "Dietary item acknowledged." : "Dietary item reopened.");
    } catch (err) {
      setNeeds((current) => current.map((row) => personKey(row.personType, row.personId) === key ? item : row));
      setError(err.message || "Unable to save this dietary item.");
    } finally { setServiceBusy(""); }
  };

  const toggleServed = async (person, nextServed) => {
    if (!selectedService || selectedService.status !== "open" || !canRecordMeals) return;
    const participantId = person.personId;
    if (busyRows.includes(participantId)) return;
    setRowBusy(participantId, true);
    setError("");

    if (!live) {
    const optimistic = { ...person, id: `pending:${participantId}`, servedAt: new Date().toISOString() };
    setAttendance((current) => nextServed
      ? current.some((item) => item.personId === participantId) ? current : [optimistic, ...current]
      : current.filter((item) => item.personId !== participantId));
    setServices((current) => current.map((service) => service.id === selectedService.id
      ? { ...service, servedCount: Math.max(0, Number(service.servedCount || 0) + (nextServed ? 1 : -1)) }
      : service));
    setProgress((current) => current.map((row) => row.company === (person.company || "Unassigned")
      ? { ...row, servedCount: Math.max(0, Number(row.servedCount || 0) + (nextServed ? 1 : -1)) }
      : row));

    }
    try {
      if (live) await setParticipantMealServed({ serviceId: selectedService.id, participantId, served: nextServed });
      if (live) await refreshSelected(selectedService.id, true);
    } catch (err) {
      if (live) await refreshSelected(selectedService.id, true);
      setError(err.message || "Unable to save this participant's meal status.");
    } finally { setRowBusy(participantId, false); }
  };

  const changeServiceStatus = async (service, nextStatus) => {
    setServiceBusy(`service:${service.id}`);
    setError("");
    try {
      if (live) await setMealServiceStatus(service.id, nextStatus);
      await reloadBase();
      setSelectedServiceId(service.id);
      showSaved(nextStatus === "open" ? `${service.label} is open for serving.` : `${service.label} is closed.`);
    } catch (err) { setError(err.message || "Unable to update this meal service."); }
    finally { setServiceBusy(""); }
  };

  const createService = async (event) => {
    event.preventDefault();
    setServiceBusy("create-service");
    setError("");
    try {
      const id = live ? await createMealService({ sessionId, serviceDate, mealType: newMeal.type, label: newMeal.label }) : `demo-${newMeal.type}-${Date.now()}`;
      await reloadBase();
      setSelectedServiceId(id);
      setSetupOpen(false);
      setNewMeal({ type: "lunch", label: "" });
      showSaved("Meal service created.");
    } catch (err) { setError(err.message || "Unable to create this meal service."); }
    finally { setServiceBusy(""); }
  };

  if (!canViewMeals) return <section className="page"><PageHead title="Food" sessionName={sessionName} description="Meal attendance is limited to assigned FSY operations roles."/><article className="panel field-no-access"><ForkKnife size={30}/><h2>Food is not in your access</h2><p>Ask an administrator to confirm your operational assignment.</p></article></section>;

  const tabs = [{ value: "meals", label: "Meal service", count: services.length }];
  if (canViewDietary) tabs.push({ value: "needs", label: "Dietary needs", count: needs.length });

  return <section className="page field-page food-page meal-workspace">
    <PageHead title="Food" sessionName={sessionName} description={hasFoodView ? "Open meals, monitor progress, and keep participant service moving across the session." : "Mark meals served for participants in your assigned companies."} />
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
    {saved ? <div className="meal-save-note" role="status"><Check size={16}/>{saved}</div> : null}
    <SegmentedControl label="Food workflows" value={tab} onChange={setTab} options={tabs} className="food-tabs" />

    {tab === "meals" ? <>
      <div className="meal-workspace-toolbar">
        <div><span className="kicker">Participant meal attendance</span><p>{hasFoodView ? "Overall session view" : "Your assigned companies"}</p></div>
        {canManage ? <button type="button" className="secondary" onClick={() => setSetupOpen((value) => !value)}><Plus/>Set up a meal</button> : null}
      </div>

      {setupOpen && canManage ? <form className="panel food-setup-form meal-setup-form" onSubmit={createService}>
        <div><span className="kicker">Meal setup</span><h2>Add a meal service</h2><p>Create it first, then open it when serving begins.</p></div>
        <label>Service date<input type="date" value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} required /></label>
        <label>Meal type<select value={newMeal.type} onChange={(event) => setNewMeal({ ...newMeal, type: event.target.value })}>{MEAL_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Label (optional)<input maxLength="60" value={newMeal.label} onChange={(event) => setNewMeal({ ...newMeal, label: event.target.value })} placeholder="e.g. Lunch" /></label>
        <div className="field-sheet-actions"><button type="button" className="secondary" onClick={() => setSetupOpen(false)}><X/>Cancel</button><button className="primary" disabled={serviceBusy === "create-service"}>{serviceBusy === "create-service" ? "Creating…" : "Create meal"}</button></div>
      </form> : null}

      {!hasOpenService && !canManage ? <div className="meal-waiting" role="status"><ForkKnife size={20}/><span><b>No meal is open yet</b><small>When the Food team opens a meal, it will appear here automatically.</small></span></div> : null}

      {services.length ? <div className="meal-service-strip meal-service-list">{services.map((service) => <button type="button" className={selectedService?.id === service.id ? "meal-service-card selected" : "meal-service-card"} key={service.id} onClick={() => setSelectedServiceId(service.id)}>
        <span><b>{service.label}</b><small>{formatDate(service.date)} · {service.servedCount}/{service.expectedCount || 0} participants</small></span>
        <Status tone={service.status === "open" ? "good" : service.status === "closed" ? "muted" : "warn"}>{service.status === "open" ? "Open" : service.status === "closed" ? "Closed" : "Planned"}</Status>
      </button>)}</div> : <article className="panel"><Empty icon={ForkKnife} title="No meal services yet" text={canManage ? "Set up the first meal when the schedule is ready." : "The Food team has not opened a meal yet."} action={canManage ? <button type="button" className="primary" onClick={() => setSetupOpen(true)}><Plus/>Set up a meal</button> : null}/></article>}

      {selectedService ? <article className="panel meal-participant-panel">
        <div className="meal-active-head">
          <div><span className="kicker">{selectedService.status === "open" ? "Serving now" : selectedService.status === "planned" ? "Planned meal" : "Closed meal"}</span><h2>{selectedService.label}</h2><p>{formatDate(selectedService.date)} · {selectedService.status === "open" ? "Tick each participant as food is served. Each tick saves immediately." : selectedService.status === "planned" ? "Waiting for the Food team to open this meal." : "Attendance is read-only because this meal is closed."}</p></div>
          <Status tone={selectedService.status === "open" ? "good" : selectedService.status === "closed" ? "muted" : "warn"}>{selectedService.status}</Status>
        </div>

        <div className="meal-progress-block" aria-label={`${selectedServed} of ${selectedExpected} participants served`}>
          <div className="meal-progress-numbers"><span><strong>{selectedServed}</strong><small>served</small></span><span><strong>{selectedRemaining}</strong><small>remaining</small></span><span><strong>{completion}%</strong><small>complete</small></span></div>
          <div className="meal-progress-track" aria-hidden="true"><span style={{ width: `${completion}%` }}/></div>
        </div>

        {canManage && selectedService.status === "planned" ? <button type="button" className="primary meal-status-action" disabled={serviceBusy === `service:${selectedService.id}`} onClick={() => changeServiceStatus(selectedService, "open")}>{serviceBusy === `service:${selectedService.id}` ? "Opening…" : `Open ${selectedService.label}`}</button> : null}
        {canManage && selectedService.status === "open" ? <button type="button" className="secondary meal-status-action" disabled={serviceBusy === `service:${selectedService.id}`} onClick={() => changeServiceStatus(selectedService, "closed")}>{serviceBusy === `service:${selectedService.id}` ? "Closing…" : `Close ${selectedService.label}`}</button> : null}

        {progress.length ? <details className="meal-company-progress" open={progress.length <= 4}>
          <summary><span><b>Company progress</b><small>{progress.length} {progress.length === 1 ? "company" : "companies"} in your view</small></span><span>{selectedServed}/{selectedExpected}</span></summary>
          <div className="meal-company-grid">{progress.map((row) => { const pct = row.expectedCount ? Math.round((row.servedCount / row.expectedCount) * 100) : 0; return <div className="meal-company-card" key={row.companyId || row.company}><span><b>{row.company}</b><small>{row.servedCount}/{row.expectedCount} served</small></span><strong>{pct}%</strong><div aria-hidden="true"><span style={{ width: `${Math.min(100, pct)}%` }}/></div></div>; })}</div>
        </details> : null}

        <div className="meal-roster-controls">
          <SearchField value={mealQuery} onChange={setMealQuery} label="Search participants" placeholder="Search name, FSY ID, company or group" />
          <SegmentedControl label="Meal status filter" value={mealFilter} onChange={setMealFilter} options={FILTERS} className="meal-filter-tabs" />
          {companyOptions.length > 1 ? <label className="meal-company-filter"><span>Company</span><select value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)}><option value="">All in my view</option>{companyOptions.map((company) => <option key={company} value={company}>{company}</option>)}</select></label> : null}
        </div>

        <div className="meal-roster-summary"><span><b>{filteredRoster.length}</b> participants shown</span>{selectedService.status === "open" && canRecordMeals ? <small>Tap anywhere on a row to tick or untick. Saved immediately.</small> : <small>{selectedService.status === "open" ? "You have view-only access." : "Open meals are editable; closed meals are read-only."}</small>}</div>

        <div className="meal-checklist" aria-label={`${selectedService.label} participant meal checklist`}>
          {visibleRoster.map((person) => {
            const served = attendanceMap.get(person.personId);
            const rowBusy = busyRows.includes(person.personId);
            const editable = selectedService.status === "open" && canRecordMeals && !rowBusy;
            return <label key={person.personId} className={`meal-check-row ${served ? "served" : ""} ${rowBusy ? "saving" : ""}`}>
              <input type="checkbox" checked={Boolean(served)} disabled={!editable} onChange={(event) => toggleServed(person, event.target.checked)} aria-label={`${served ? "Mark not served" : "Mark served"}: ${person.name}`} />
              <span className="meal-checkbox-visual" aria-hidden="true">{served ? <Check size={18} weight="bold"/> : null}</span>
              <span className="meal-person-copy"><b>{person.name}</b><small>{[person.fsyId, person.company || "Unassigned", person.group].filter(Boolean).join(" · ")}</small></span>
              <span className="meal-row-state">{rowBusy ? "Saving…" : served ? `Served ${formatTime(served.servedAt)}` : selectedService.status === "open" ? "Not served" : "Not recorded"}</span>
            </label>;
          })}
          {!filteredRoster.length ? <div className="empty-inline"><b>No participants in this view</b><span>Try All, clear the search, or choose another company.</span></div> : null}
        </div>
        {visibleLimit < filteredRoster.length ? <button type="button" className="secondary meal-show-more" onClick={() => setVisibleLimit((value) => value + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, filteredRoster.length - visibleLimit)} more</button> : null}
      </article> : null}
    </> : <>
      <div className="field-metrics"><div><span>Dietary records</span><strong>{needs.length}</strong><small>Participants and staff</small></div><div><span>Needs acknowledgement</span><strong>{openCount}</strong><small>Food team attention</small></div><div><span>Acknowledged</span><strong>{needs.length - openCount}</strong><small>Reviewed by Food</small></div></div>
      <article className="panel"><div className="panel-head"><div><span className="kicker">Dietary operations</span><h2>Food needs</h2><p>Review dietary information separately from participant meal attendance.</p></div><ForkKnife size={22}/></div><SearchField value={query} onChange={setQuery} label="Search dietary needs" placeholder="Search name, company, group or restriction"/><div className="food-list">{dietaryRows.map((item) => <div key={personKey(item.personType, item.personId)} className={item.acknowledged ? "food-row acknowledged" : "food-row"}><div><b>{item.name}</b><small>{item.personType === "staff" ? "Staff" : [item.company, item.group].filter(Boolean).join(" · ") || "Participant"}</small></div><p>{item.dietaryInformation}</p><div className="food-row-action">{item.acknowledged ? <Status tone="good"><Check/>Acknowledged</Status> : <Status tone="warn">Needs review</Status>}{canManage ? <button type="button" className="secondary compact-button" disabled={serviceBusy === `need:${personKey(item.personType, item.personId)}`} onClick={() => toggleNeed(item)}>{serviceBusy === `need:${personKey(item.personType, item.personId)}` ? "Saving…" : item.acknowledged ? "Reopen" : "Acknowledge"}</button> : null}</div></div>)}{!dietaryRows.length ? <div className="empty-inline"><b>No matching dietary needs</b><span>{needs.length ? "Try a shorter search." : "No dietary restrictions are stored in your current scope."}</span></div> : null}</div></article>
    </>}
  </section>;
}
