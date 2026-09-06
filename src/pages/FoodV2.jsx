import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check } from "@phosphor-icons/react/Check";
import { ForkKnife } from "@phosphor-icons/react/ForkKnife";
import { Plus } from "@phosphor-icons/react/Plus";
import { X } from "@phosphor-icons/react/X";
import { DismissibleLayer, Empty, MutationFeedback, PageHead, SearchField, SegmentedControl, Status } from "../components/UI.jsx";
import { createMealService, hasCapability, setFoodAcknowledgement, setMealServiceStatus } from "../lib/field-operations.js";
import {
  loadFoodNeedsV2,
  loadMealProgressV2,
  loadMealRosterPageV2,
  loadMealServicesV2,
  setParticipantMealServedV2,
} from "../lib/food-workspace.js";
import "./field-operations.css";
import "./food-v2.css";

const PAGE_SIZE = 80;
const REFRESH_INTERVAL = 20000;
const SEARCH_DELAY = 180;
const MEAL_TYPES = [["breakfast", "Breakfast"], ["lunch", "Lunch"], ["dinner", "Dinner"], ["snack", "Snack"], ["other", "Other"]];
const MEAL_FILTERS = [
  { value: "remaining", label: "Not served" },
  { value: "all", label: "All" },
  { value: "served", label: "Served" },
];
const DIETARY_FILTERS = [
  { value: "open", label: "Needs review" },
  { value: "all", label: "All" },
  { value: "reviewed", label: "Reviewed" },
];
const personKey = (personType, personId) => `${personType}:${personId}`;
const formatTime = (value) => value ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "";
const formatDate = (value) => value ? new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)) : "";

function demoServices(date, expectedCount) {
  return [{ id: "demo-lunch", date, mealType: "lunch", label: "Lunch", status: "open", openedAt: new Date().toISOString(), closedAt: null, servedCount: 0, expectedCount }];
}

function FoodSkeletonRows() {
  return <div className="food-roster-skeleton" aria-hidden="true">
    {Array.from({ length: 7 }, (_, index) => <div key={index}><i/><span><b/><small/></span></div>)}
  </div>;
}

function uniqueAppend(current, incoming) {
  const seen = new Set(current.map((row) => row.personId));
  return [...current, ...incoming.filter((row) => !seen.has(row.personId))];
}

export function Food({ sessionId, capabilities = [], sessionName, participants = [], live = false }) {
  const hasFoodView = hasCapability(capabilities, "food_view");
  const canViewMeals = hasFoodView || hasCapability(capabilities, "meal_attendance_view");
  const canRecordMeals = hasCapability(capabilities, "food_manage") || hasCapability(capabilities, "meal_attendance_record");
  const canManage = hasCapability(capabilities, "food_manage");
  const canViewDietary = hasFoodView;

  const [tab, setTab] = useState("meals");
  const [services, setServices] = useState([]);
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [progress, setProgress] = useState([]);
  const [rows, setRows] = useState([]);
  const [rosterTotal, setRosterTotal] = useState(0);
  const [mealQuery, setMealQuery] = useState("");
  const [debouncedMealQuery, setDebouncedMealQuery] = useState("");
  const [mealFilter, setMealFilter] = useState("remaining");
  const [companyFilter, setCompanyFilter] = useState("");
  const [servicesLoading, setServicesLoading] = useState(true);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [busyRows, setBusyRows] = useState([]);
  const [serviceBusy, setServiceBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [needs, setNeeds] = useState([]);
  const [needsLoaded, setNeedsLoaded] = useState(false);
  const [needsLoading, setNeedsLoading] = useState(false);
  const [dietaryQuery, setDietaryQuery] = useState("");
  const [dietaryFilter, setDietaryFilter] = useState("open");
  const [dietaryLimit, setDietaryLimit] = useState(PAGE_SIZE);

  const [setupOpen, setSetupOpen] = useState(false);
  const [serviceDate, setServiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newMeal, setNewMeal] = useState({ type: "lunch", label: "" });
  const rosterRequest = useRef(0);

  const setRowBusy = (participantId, value) => setBusyRows((current) => value
    ? current.includes(participantId) ? current : [...current, participantId]
    : current.filter((id) => id !== participantId));

  const loadServices = useCallback(async ({ quiet = false } = {}) => {
    if (!canViewMeals) return;
    if (!quiet) setServicesLoading(true);
    try {
      const next = live
        ? await loadMealServicesV2(sessionId)
        : demoServices(serviceDate, participants.length);
      setServices(next);
      setSelectedServiceId((current) => {
        if (next.some((service) => service.id === current)) return current;
        return (next.find((service) => service.status === "open") || next[0])?.id || "";
      });
    } catch (err) {
      setError(err.message || "Meal services could not load.");
    } finally {
      if (!quiet) setServicesLoading(false);
    }
  }, [canViewMeals, live, participants.length, serviceDate, sessionId]);

  useEffect(() => { loadServices(); }, [loadServices]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedMealQuery(mealQuery.trim()), SEARCH_DELAY);
    return () => window.clearTimeout(timer);
  }, [mealQuery]);

  const selectedService = services.find((service) => service.id === selectedServiceId) || null;

  const loadProgress = useCallback(async ({ quiet = false } = {}) => {
    if (!selectedServiceId) { setProgress([]); return; }
    try {
      if (!live) {
        const grouped = new Map();
        participants.forEach((person) => {
          const name = person.company || person.companyName || "Unassigned";
          const id = person.companyId || name;
          const current = grouped.get(id) || { companyId: id, company: name, expectedCount: 0, servedCount: 0 };
          current.expectedCount += 1;
          grouped.set(id, current);
        });
        setProgress([...grouped.values()]);
        return;
      }
      setProgress(await loadMealProgressV2(selectedServiceId));
    } catch (err) {
      if (!quiet) setError(err.message || "Company meal progress could not load.");
    }
  }, [live, participants, selectedServiceId]);

  const loadRoster = useCallback(async ({ offset = 0, append = false, quiet = false, limit = PAGE_SIZE } = {}) => {
    if (!selectedServiceId) { setRows([]); setRosterTotal(0); return; }
    const requestId = ++rosterRequest.current;
    if (!quiet) append ? setMoreLoading(true) : setRosterLoading(true);
    try {
      let result;
      if (live) {
        result = await loadMealRosterPageV2({
          serviceId: selectedServiceId,
          query: debouncedMealQuery,
          companyId: companyFilter,
          status: mealFilter,
          limit,
          offset,
        });
      } else {
        const text = debouncedMealQuery.toLowerCase();
        const source = participants.map((person) => ({
          personId: person.id,
          name: person.fullName,
          fsyId: person.fsyId || "",
          companyId: person.companyId || "",
          company: person.company || person.companyName || "Unassigned",
          group: person.group || person.groupName || "",
          servedAt: null,
        })).filter((person) => {
          if (companyFilter && person.companyId !== companyFilter) return false;
          if (!text) return true;
          return `${person.name} ${person.fsyId} ${person.company} ${person.group}`.toLowerCase().includes(text);
        });
        result = { rows: source.slice(offset, offset + limit), total: source.length };
      }
      if (requestId !== rosterRequest.current) return;
      setRows((current) => append ? uniqueAppend(current, result.rows) : result.rows);
      setRosterTotal(result.total);
    } catch (err) {
      if (requestId === rosterRequest.current) setError(err.message || "Participant meal list could not load.");
    } finally {
      if (requestId === rosterRequest.current && !quiet) append ? setMoreLoading(false) : setRosterLoading(false);
    }
  }, [companyFilter, debouncedMealQuery, live, mealFilter, participants, selectedServiceId]);

  useEffect(() => {
    setRows([]);
    setRosterTotal(0);
    if (selectedServiceId) loadRoster();
  }, [loadRoster, selectedServiceId]);

  useEffect(() => { loadProgress(); }, [loadProgress]);

  useEffect(() => {
    if (!live || !selectedServiceId) return undefined;
    const refresh = () => {
      if (document.visibilityState === "hidden" || busyRows.length) return;
      loadServices({ quiet: true });
      loadProgress({ quiet: true });
      if (rows.length <= 200) loadRoster({ quiet: true, limit: Math.max(PAGE_SIZE, rows.length || PAGE_SIZE) });
    };
    const timer = window.setInterval(refresh, REFRESH_INTERVAL);
    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [busyRows.length, live, loadProgress, loadRoster, loadServices, rows.length, selectedServiceId]);

  const loadNeeds = useCallback(async () => {
    if (!canViewDietary || needsLoaded || needsLoading) return;
    setNeedsLoading(true);
    try {
      setNeeds(live ? await loadFoodNeedsV2(sessionId) : []);
      setNeedsLoaded(true);
    } catch (err) {
      setError(err.message || "Dietary needs could not load.");
    } finally {
      setNeedsLoading(false);
    }
  }, [canViewDietary, live, needsLoaded, needsLoading, sessionId]);

  useEffect(() => {
    if (tab === "needs") loadNeeds();
  }, [loadNeeds, tab]);

  useEffect(() => {
    if (!canViewDietary && tab === "needs") setTab("meals");
  }, [canViewDietary, tab]);

  useEffect(() => { setDietaryLimit(PAGE_SIZE); }, [dietaryFilter, dietaryQuery]);

  const companyOptions = useMemo(() => progress.filter((row) => row.companyId), [progress]);
  const selectedServed = Number(selectedService?.servedCount || 0);
  const selectedExpected = Number(selectedService?.expectedCount || 0);
  const selectedRemaining = Math.max(0, selectedExpected - selectedServed);
  const completion = selectedExpected ? Math.min(100, Math.round((selectedServed / selectedExpected) * 100)) : 0;

  const openDietaryCount = needs.filter((item) => !item.acknowledged).length;
  const dietaryRows = useMemo(() => {
    const text = dietaryQuery.trim().toLowerCase();
    return needs.filter((item) => {
      if (dietaryFilter === "open" && item.acknowledged) return false;
      if (dietaryFilter === "reviewed" && !item.acknowledged) return false;
      if (!text) return true;
      return `${item.name} ${item.dietaryInformation} ${item.group} ${item.company}`.toLowerCase().includes(text);
    });
  }, [dietaryFilter, dietaryQuery, needs]);
  const visibleDietaryRows = dietaryRows.slice(0, dietaryLimit);

  const updateLocalCounts = (person, delta) => {
    setServices((current) => current.map((service) => service.id === selectedServiceId
      ? { ...service, servedCount: Math.max(0, Number(service.servedCount || 0) + delta) }
      : service));
    setProgress((current) => current.map((row) => row.companyId === person.companyId
      ? { ...row, servedCount: Math.max(0, Number(row.servedCount || 0) + delta) }
      : row));
  };

  const toggleServed = async (person, nextServed) => {
    if (!selectedService || selectedService.status !== "open" || !canRecordMeals || busyRows.includes(person.personId)) return;
    const previousAt = person.servedAt;
    const optimisticAt = nextServed ? new Date().toISOString() : null;
    const delta = nextServed ? 1 : -1;
    setError("");
    setNotice("");
    setRowBusy(person.personId, true);
    setRows((current) => current.map((row) => row.personId === person.personId ? { ...row, servedAt: optimisticAt } : row));
    updateLocalCounts(person, delta);

    try {
      if (live) {
        const saved = await setParticipantMealServedV2({ serviceId: selectedService.id, participantId: person.personId, served: nextServed });
        setRows((current) => current.map((row) => row.personId === person.personId ? { ...row, servedAt: saved.servedAt || null } : row));
      }
    } catch (err) {
      setRows((current) => current.map((row) => row.personId === person.personId ? { ...row, servedAt: previousAt } : row));
      updateLocalCounts(person, -delta);
      setError(err.message || "This meal status could not be saved.");
    } finally {
      setRowBusy(person.personId, false);
    }
  };

  const toggleNeed = async (item) => {
    const key = personKey(item.personType, item.personId);
    const next = !item.acknowledged;
    setServiceBusy(`need:${key}`);
    setError("");
    setNeeds((current) => current.map((row) => personKey(row.personType, row.personId) === key
      ? { ...row, acknowledged: next, acknowledgedAt: next ? new Date().toISOString() : null }
      : row));
    try {
      if (live) await setFoodAcknowledgement({ sessionId, personType: item.personType, personId: item.personId, acknowledged: next });
    } catch (err) {
      setNeeds((current) => current.map((row) => personKey(row.personType, row.personId) === key ? item : row));
      setError(err.message || "This dietary item could not be saved.");
    } finally {
      setServiceBusy("");
    }
  };

  const changeServiceStatus = async (service, nextStatus) => {
    setServiceBusy(`service:${service.id}`);
    setError("");
    setNotice("");
    try {
      if (live) await setMealServiceStatus(service.id, nextStatus);
      await loadServices({ quiet: true });
      await loadProgress({ quiet: true });
      setNotice(nextStatus === "open" ? `${service.label} is ready for serving.` : `${service.label} is closed.`);
    } catch (err) {
      setError(err.message || "Meal status could not be updated.");
    } finally {
      setServiceBusy("");
    }
  };

  const createService = async (event) => {
    event.preventDefault();
    setServiceBusy("create-service");
    setError("");
    setNotice("");
    try {
      const id = live
        ? await createMealService({ sessionId, serviceDate, mealType: newMeal.type, label: newMeal.label })
        : `demo-${newMeal.type}-${Date.now()}`;
      await loadServices({ quiet: true });
      setSelectedServiceId(id);
      setSetupOpen(false);
      setNewMeal({ type: "lunch", label: "" });
      setNotice("Meal created. Open it when serving begins.");
    } catch (err) {
      setError(err.message || "Meal could not be created.");
    } finally {
      setServiceBusy("");
    }
  };

  if (!canViewMeals) return <section className="page"><PageHead title="Food" sessionName={sessionName} description="Meal attendance is limited to assigned FSY operations roles."/><article className="panel field-no-access"><ForkKnife size={30}/><h2>Food is not in your access</h2><p>Ask an administrator to confirm your operational assignment.</p></article></section>;

  const workflowTabs = [{ value: "meals", label: "Serve meals" }];
  if (canViewDietary) workflowTabs.push({ value: "needs", label: "Dietary needs" });

  return <section className="page field-page food-v2">
    <PageHead
      title="Food"
      sessionName={sessionName}
      description={tab === "meals" ? "Serve the current meal quickly and see what still needs attention." : "Review dietary accommodations separately from meal attendance."}
    />

    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
    {notice ? <MutationFeedback>{notice}</MutationFeedback> : null}

    <SegmentedControl label="Food workflows" value={tab} onChange={(value) => { setNotice(""); setTab(value); }} options={workflowTabs} className="food-workflow-tabs" />

    {tab === "meals" ? <>
      <div className="food-meal-toolbar">
        <label className="food-meal-picker">
          <span>Meal</span>
          <select value={selectedServiceId} onChange={(event) => { setNotice(""); setCompanyFilter(""); setSelectedServiceId(event.target.value); }} disabled={servicesLoading || !services.length}>
            {!services.length ? <option value="">No meal selected</option> : null}
            {services.map((service) => <option key={service.id} value={service.id}>{service.label} · {formatDate(service.date)} · {service.status}</option>)}
          </select>
        </label>
        {canManage ? <button type="button" className="secondary food-new-meal" onClick={() => setSetupOpen(true)}><Plus/>New meal</button> : null}
      </div>

      {servicesLoading && !services.length ? <article className="panel food-loading-card"><div className="food-loading-line wide"/><div className="food-loading-line"/><FoodSkeletonRows/></article> : null}

      {!servicesLoading && !services.length ? <article className="panel"><Empty icon={ForkKnife} title="No meals set up yet" text={canManage ? "Create the first meal. Open it only when the serving team is ready." : "The Food team has not opened a meal yet."} action={canManage ? <button type="button" className="primary" onClick={() => setSetupOpen(true)}><Plus/>New meal</button> : null}/></article> : null}

      {selectedService ? <article className="panel food-service-workspace">
        <header className="food-service-head">
          <div>
            <span className="kicker">{selectedService.status === "open" ? "Serving now" : selectedService.status === "planned" ? "Not open yet" : "Meal closed"}</span>
            <h2>{selectedService.label}</h2>
            <p>{formatDate(selectedService.date)}{selectedService.status === "open" ? " · Tap a participant once when food is handed to them." : selectedService.status === "planned" ? " · Open this meal when serving starts." : " · Attendance is read-only."}</p>
          </div>
          <Status tone={selectedService.status === "open" ? "good" : selectedService.status === "closed" ? "muted" : "warn"}>{selectedService.status === "open" ? "Open" : selectedService.status === "closed" ? "Closed" : "Planned"}</Status>
        </header>

        <div className="food-meal-summary" aria-label={`${selectedServed} served, ${selectedRemaining} remaining`}>
          <div className="primary"><strong>{selectedRemaining}</strong><span>{selectedService.status === "open" ? "left to serve" : "not recorded"}</span></div>
          <div><strong>{selectedServed}</strong><span>served</span></div>
          <div className="food-meal-progress"><span><b>{completion}% complete</b><small>{selectedExpected} participants in this view</small></span><div aria-hidden="true"><i style={{ width: `${completion}%` }}/></div></div>
        </div>

        {canManage && selectedService.status === "planned" ? <button type="button" className="primary food-open-meal" disabled={serviceBusy === `service:${selectedService.id}`} onClick={() => changeServiceStatus(selectedService, "open")}>{serviceBusy === `service:${selectedService.id}` ? "Opening…" : `Open ${selectedService.label}`}</button> : null}

        {canManage && selectedService.status === "open" ? <details className="food-meal-controls"><summary>Meal controls</summary><div><p>Close the meal only after serving has finished. The participant list becomes read-only.</p><button type="button" className="secondary" disabled={serviceBusy === `service:${selectedService.id}`} onClick={() => changeServiceStatus(selectedService, "closed")}>{serviceBusy === `service:${selectedService.id}` ? "Closing…" : `Close ${selectedService.label}`}</button></div></details> : null}

        {progress.length > 1 ? <details className="food-company-progress">
          <summary><span><b>Company progress</b><small>{progress.length} companies in your view</small></span><span>{selectedServed}/{selectedExpected}</span></summary>
          <div className="food-company-grid">{progress.map((row) => {
            const pct = row.expectedCount ? Math.round((row.servedCount / row.expectedCount) * 100) : 0;
            return <div className="food-company-card" key={row.companyId || row.company}><span><b>{row.company}</b><small>{row.servedCount}/{row.expectedCount} served</small></span><strong>{pct}%</strong><div aria-hidden="true"><i style={{ width: `${Math.min(100, pct)}%` }}/></div></div>;
          })}</div>
        </details> : null}

        <section className="food-roster-section" aria-labelledby="food-roster-title">
          <div className="food-roster-heading"><div><span className="kicker">Serving list</span><h3 id="food-roster-title">Participants</h3></div><small>{rosterLoading && rows.length ? "Updating…" : `${rosterTotal.toLocaleString()} match${rosterTotal === 1 ? "" : "es"}`}</small></div>

          <div className="food-roster-tools">
            <SearchField value={mealQuery} onChange={setMealQuery} label="Search participants" placeholder="Name or FSY ID" />
            <SegmentedControl label="Meal status" value={mealFilter} onChange={(value) => { setNotice(""); setMealFilter(value); }} options={MEAL_FILTERS} className="food-status-tabs" />
            {companyOptions.length > 1 ? <label className="food-company-filter"><span>Company</span><select value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)}><option value="">All in my view</option>{companyOptions.map((company) => <option key={company.companyId} value={company.companyId}>{company.company}</option>)}</select></label> : null}
          </div>

          <div className="food-list-note">{selectedService.status === "open" && canRecordMeals ? <><Check size={16}/><span>Tap the whole row to mark served. It saves immediately.</span></> : <span>{selectedService.status === "open" ? "You have view-only access." : "Only open meals can be edited."}</span>}</div>

          <div className="food-meal-list" aria-label={`${selectedService.label} participant meal checklist`}>
            {rosterLoading && !rows.length ? <FoodSkeletonRows/> : rows.map((person) => {
              const served = Boolean(person.servedAt);
              const rowBusy = busyRows.includes(person.personId);
              const editable = selectedService.status === "open" && canRecordMeals && !rowBusy;
              return <label key={person.personId} className={`food-meal-row ${served ? "served" : ""} ${rowBusy ? "saving" : ""}`}>
                <input type="checkbox" checked={served} disabled={!editable} onChange={(event) => toggleServed(person, event.target.checked)} aria-label={`${served ? "Mark not served" : "Mark served"}: ${person.name}`} />
                <span className="food-check" aria-hidden="true">{served ? <Check size={18} weight="bold"/> : null}</span>
                <span className="food-person"><b>{person.name}</b><small>{[person.fsyId, person.company, person.group].filter(Boolean).join(" · ")}</small></span>
                <span className="food-row-state">{rowBusy ? "Saving…" : served ? formatTime(person.servedAt) : selectedService.status === "closed" ? "Not recorded" : ""}</span>
              </label>;
            })}
            {!rosterLoading && !rows.length ? <div className="empty-inline"><b>{mealFilter === "remaining" ? "Everyone in this view is served" : "No participants found"}</b><span>{mealQuery || companyFilter ? "Clear a filter or try another search." : mealFilter === "remaining" ? "There is nothing left to tick here." : "Choose another meal status."}</span></div> : null}
          </div>

          {rows.length < rosterTotal ? <button type="button" className="secondary food-show-more" disabled={moreLoading} onClick={() => loadRoster({ offset: rows.length, append: true })}>{moreLoading ? "Loading…" : `Show ${Math.min(PAGE_SIZE, rosterTotal - rows.length)} more`}</button> : null}
        </section>
      </article> : null}
    </> : <section className="food-dietary-workspace">
      <div className="food-dietary-intro">
        <div><span className="kicker">Dietary accommodations</span><h2>{needsLoaded ? `${openDietaryCount} need review` : "Dietary needs"}</h2><p>Keep this separate from the live serving list. Review restrictions and mark each item when the Food team has accounted for it.</p></div>
        {needsLoaded ? <div className="food-dietary-counts"><span><b>{openDietaryCount}</b> needs review</span><span><b>{needs.length - openDietaryCount}</b> reviewed</span></div> : null}
      </div>

      {needsLoading ? <article className="panel food-loading-card"><div className="food-loading-line wide"/><div className="food-loading-line"/><FoodSkeletonRows/></article> : null}

      {needsLoaded ? <article className="panel food-dietary-panel">
        <div className="food-dietary-tools">
          <SearchField value={dietaryQuery} onChange={setDietaryQuery} label="Search dietary needs" placeholder="Name, company or restriction" />
          <SegmentedControl label="Dietary review status" value={dietaryFilter} onChange={setDietaryFilter} options={DIETARY_FILTERS} className="food-dietary-tabs" />
        </div>

        <div className="food-dietary-list">{visibleDietaryRows.map((item) => {
          const key = personKey(item.personType, item.personId);
          const busy = serviceBusy === `need:${key}`;
          return <div key={key} className={`food-dietary-row ${item.acknowledged ? "reviewed" : ""}`}>
            <div className="food-dietary-person"><b>{item.name}</b><small>{item.personType === "staff" ? "Staff" : [item.company, item.group].filter(Boolean).join(" · ") || "Participant"}</small></div>
            <p>{item.dietaryInformation}</p>
            <div className="food-dietary-action">{item.acknowledged ? <span className="food-reviewed"><Check/>Reviewed</span> : <span className="food-needs-review">Needs review</span>}{canManage ? <button type="button" className="secondary" disabled={busy} onClick={() => toggleNeed(item)}>{busy ? "Saving…" : item.acknowledged ? "Reopen" : "Mark reviewed"}</button> : null}</div>
          </div>;
        })}</div>
        {!dietaryRows.length ? <div className="empty-inline"><b>{dietaryFilter === "open" ? "No dietary items need review" : "No matching dietary needs"}</b><span>{needs.length ? "Change the filter or try another search." : "No dietary restrictions are stored in your current scope."}</span></div> : null}
        {dietaryLimit < dietaryRows.length ? <button type="button" className="secondary food-show-more" onClick={() => setDietaryLimit((value) => value + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, dietaryRows.length - dietaryLimit)} more</button> : null}
      </article> : null}
    </section>}

    <DismissibleLayer open={setupOpen && canManage} onClose={() => { if (serviceBusy !== "create-service") setSetupOpen(false); }} title="Set up a meal" sheet className="food-setup-sheet-v2">
      <form className="food-setup-form-v2" onSubmit={createService}>
        <button type="button" data-layer-close className="icon-button modal-close" onClick={() => setSetupOpen(false)} disabled={serviceBusy === "create-service"} aria-label="Close"><X/></button>
        <header><span className="kicker">Meal setup</span><h2>New meal</h2><p>Create the meal now. Opening it is a separate step so nobody starts recording by mistake.</p></header>
        <label>Service date<input type="date" value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} required /></label>
        <label>Meal type<select value={newMeal.type} onChange={(event) => setNewMeal({ ...newMeal, type: event.target.value })}>{MEAL_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Label <span>optional</span><input maxLength="60" value={newMeal.label} onChange={(event) => setNewMeal({ ...newMeal, label: event.target.value })} placeholder="e.g. Lunch" /></label>
        <footer className="field-sheet-actions"><button type="button" className="secondary" onClick={() => setSetupOpen(false)} disabled={serviceBusy === "create-service"}>Cancel</button><button className="primary" disabled={serviceBusy === "create-service"}>{serviceBusy === "create-service" ? "Creating…" : "Create meal"}</button></footer>
      </form>
    </DismissibleLayer>
  </section>;
}