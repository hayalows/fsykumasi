import { PersonName } from "../components/PersonPeek.jsx";
import { matchesPersonSearch } from "../lib/person-search.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check } from "@phosphor-icons/react/Check";
import { DotsThree } from "@phosphor-icons/react/DotsThree";
import { ForkKnife } from "@phosphor-icons/react/ForkKnife";
import { Plus } from "@phosphor-icons/react/Plus";
import { X } from "@phosphor-icons/react/X";
import { ActionToast, ConfirmActionSheet, DismissibleLayer, Empty, MutationFeedback, PageHead, SearchField, SegmentedControl, Status } from "../components/UI.jsx";
import { cancelMealService, createMealService, hasCapability, setFoodAcknowledgement, setMealServiceStatus } from "../lib/field-operations.js";
import { loadFoodNeedsV2, loadMealProgressV2, loadMealRosterPageV2, loadMealServicesV2, setParticipantMealServedV2 } from "../lib/food-workspace.js";
import "./field-operations.css";
import "./food-v2.css";

const PAGE_SIZE = 80;
const REFRESH_INTERVAL = 20000;
const SEARCH_DELAY = 160;
const MEAL_TYPES = [["breakfast", "Breakfast"], ["lunch", "Lunch"], ["dinner", "Dinner"], ["snack", "Snack"], ["other", "Other"]];
const MEAL_FILTERS = [{ value: "remaining", label: "Not served" }, { value: "all", label: "All" }, { value: "served", label: "Served" }];
const DIETARY_FILTERS = [{ value: "open", label: "Needs review" }, { value: "all", label: "All" }, { value: "reviewed", label: "Reviewed" }];
const formatTime = (value) => value ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "";
const formatDate = (value) => value ? new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)) : "";
const personKey = (personType, personId) => `${personType}:${personId}`;

function demoServices(date, expectedCount) { return [{ id: "demo-lunch", date, mealType: "lunch", label: "Lunch", status: "open", openedAt: new Date().toISOString(), closedAt: null, servedCount: 0, expectedCount }]; }
function FoodSkeletonRows() { return <div className="food-roster-skeleton" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <div key={index}><i/><span><b/><small/></span></div>)}</div>; }
function uniqueAppend(current, incoming) { const seen = new Set(current.map((row) => row.personId)); return [...current, ...incoming.filter((row) => !seen.has(row.personId))]; }

export function Food({ sessionId, capabilities = [], sessionName, participants = [], live = false, initialTab = "", initialFilter = "" }) {
  const hasFoodView = hasCapability(capabilities, "food_view");
  const canViewMeals = hasFoodView || hasCapability(capabilities, "meal_attendance_view");
  const canRecordMeals = hasCapability(capabilities, "food_manage") || hasCapability(capabilities, "meal_attendance_record");
  const canManage = hasCapability(capabilities, "food_manage");
  const canViewDietary = hasFoodView;

  const [tab, setTab] = useState(initialTab === "dietary" || initialTab === "needs" ? "needs" : "meals");
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
  const [undo, setUndo] = useState(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [voidServiceOpen, setVoidServiceOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [serviceDate, setServiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newMeal, setNewMeal] = useState({ type: "lunch", label: "" });
  const [needs, setNeeds] = useState([]);
  const [needsLoaded, setNeedsLoaded] = useState(false);
  const [needsLoading, setNeedsLoading] = useState(false);
  const [dietaryQuery, setDietaryQuery] = useState("");
  const [dietaryFilter, setDietaryFilter] = useState(initialFilter === "all" ? "all" : initialFilter === "reviewed" ? "reviewed" : "open");
  const [dietaryLimit, setDietaryLimit] = useState(PAGE_SIZE);
  const rosterRequest = useRef(0);
  const searchRef = useRef(null);

  const selectedService = services.find((service) => service.id === selectedServiceId) || null;
  const selectedServed = Number(selectedService?.servedCount || 0);
  const selectedExpected = Number(selectedService?.expectedCount || 0);
  const selectedRemaining = Math.max(0, selectedExpected - selectedServed);
  const completion = selectedExpected ? Math.min(100, Math.round((selectedServed / selectedExpected) * 100)) : 0;
  const companyOptions = useMemo(() => progress.filter((row) => row.companyId), [progress]);

  const setRowBusy = (participantId, value) => setBusyRows((current) => value ? current.includes(participantId) ? current : [...current, participantId] : current.filter((id) => id !== participantId));
  const updateLocalCounts = (person, delta) => {
    setServices((current) => current.map((service) => service.id === selectedServiceId ? { ...service, servedCount: Math.max(0, Number(service.servedCount || 0) + delta) } : service));
    setProgress((current) => current.map((row) => row.companyId === person.companyId ? { ...row, servedCount: Math.max(0, Number(row.servedCount || 0) + delta) } : row));
  };

  const loadServices = useCallback(async ({ quiet = false } = {}) => {
    if (!canViewMeals) return;
    if (!quiet) setServicesLoading(true);
    try {
      const next = live ? await loadMealServicesV2(sessionId, serviceDate) : demoServices(serviceDate, participants.length);
      setServices(next);
      setSelectedServiceId((current) => next.some((service) => service.id === current) ? current : (next.find((service) => service.status === "open") || next[0])?.id || "");
    } catch (err) { setError(err.message || "Meal services could not load."); }
    finally { if (!quiet) setServicesLoading(false); }
  }, [canViewMeals, live, participants.length, serviceDate, sessionId]);

  const loadProgress = useCallback(async ({ quiet = false } = {}) => {
    if (!selectedServiceId) { setProgress([]); return; }
    try {
      if (!live) {
        const grouped = new Map();
        participants.forEach((person) => { const name = person.company || person.companyName || "Unassigned"; const id = person.companyId || name; const current = grouped.get(id) || { companyId: id, company: name, expectedCount: 0, servedCount: 0 }; current.expectedCount += 1; grouped.set(id, current); });
        setProgress([...grouped.values()]); return;
      }
      setProgress(await loadMealProgressV2(selectedServiceId));
    } catch (err) { if (!quiet) setError(err.message || "Company meal progress could not load."); }
  }, [live, participants, selectedServiceId]);

  const loadRoster = useCallback(async ({ offset = 0, append = false, quiet = false, limit = PAGE_SIZE } = {}) => {
    if (!selectedServiceId) { setRows([]); setRosterTotal(0); return; }
    const requestId = ++rosterRequest.current;
    if (!quiet) append ? setMoreLoading(true) : setRosterLoading(true);
    try {
      let result;
      if (live) result = await loadMealRosterPageV2({ serviceId: selectedServiceId, query: debouncedMealQuery, companyId: companyFilter, status: mealFilter, limit, offset, identities: participants });
      else {
        const text = debouncedMealQuery.toLowerCase();
        const source = participants.map((person) => ({ personId: person.id, name: person.fullName, fsyId: person.fsyId || "", companyId: person.companyId || "", company: person.company || person.companyName || "Unassigned", group: person.group || person.groupName || "", servedAt: null })).filter((person) => (!companyFilter || person.companyId === companyFilter) && (matchesPersonSearch(person,text)));
        result = { rows: source.slice(offset, offset + limit), total: source.length };
      }
      if (requestId !== rosterRequest.current) return;
      setRows((current) => append ? uniqueAppend(current, result.rows) : result.rows); setRosterTotal(result.total);
    } catch (err) { if (requestId === rosterRequest.current) setError(err.message || "Participant meal list could not load."); }
    finally { if (requestId === rosterRequest.current && !quiet) append ? setMoreLoading(false) : setRosterLoading(false); }
  }, [companyFilter, debouncedMealQuery, live, mealFilter, participants, selectedServiceId]);

  useEffect(() => { loadServices(); }, [loadServices]);
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedMealQuery(mealQuery.trim()), SEARCH_DELAY); return () => window.clearTimeout(timer); }, [mealQuery]);
  useEffect(() => { setRows([]); setRosterTotal(0); if (selectedServiceId) loadRoster(); }, [loadRoster, selectedServiceId]);
  useEffect(() => { loadProgress(); }, [loadProgress]);
  useEffect(() => {
    if (!live || !selectedServiceId) return undefined;
    const refresh = () => { if (document.visibilityState === "hidden" || busyRows.length) return; loadServices({ quiet: true }); loadProgress({ quiet: true }); if (rows.length <= 200) loadRoster({ quiet: true, limit: Math.max(PAGE_SIZE, rows.length || PAGE_SIZE) }); };
    const timer = window.setInterval(refresh, REFRESH_INTERVAL); const onVisibility = () => { if (document.visibilityState === "visible") refresh(); }; document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [busyRows.length, live, loadProgress, loadRoster, loadServices, rows.length, selectedServiceId]);

  const toggleServed = async (person, nextServed, offerUndo = true) => {
    if (!selectedService || selectedService.status !== "open" || !canRecordMeals || busyRows.includes(person.personId)) return false;
    const previousAt = person.servedAt; const optimisticAt = nextServed ? new Date().toISOString() : null; const delta = nextServed ? 1 : -1;
    setError(""); setNotice(""); setRowBusy(person.personId, true);
    setRows((current) => current.map((row) => row.personId === person.personId ? { ...row, servedAt: optimisticAt } : row)); updateLocalCounts(person, delta);
    try {
      if (live) { const saved = await setParticipantMealServedV2({ serviceId: selectedService.id, participantId: person.personId, served: nextServed }); setRows((current) => current.map((row) => row.personId === person.personId ? { ...row, servedAt: saved.servedAt || null } : row)); }
      if (offerUndo) setUndo({ person: { ...person, servedAt: nextServed ? optimisticAt : null }, previousServed: Boolean(previousAt), message: `${person.name} marked ${nextServed ? "served" : "not served"}.` });
      if (mealFilter === "remaining" && nextServed && !mealQuery.trim()) setRows((current) => current.filter((row) => row.personId !== person.personId));
      return true;
    } catch (err) { setRows((current) => current.map((row) => row.personId === person.personId ? { ...row, servedAt: previousAt } : row)); updateLocalCounts(person, -delta); setError(err.message || "This meal status could not be saved."); return false; }
    finally { setRowBusy(person.personId, false); }
  };

  const undoLast = async () => {
    if (!undo || !selectedService) return; setUndoBusy(true); setError("");
    try { if (live) await setParticipantMealServedV2({ serviceId: selectedService.id, participantId: undo.person.personId, served: undo.previousServed }); await Promise.all([loadServices({ quiet: true }), loadProgress({ quiet: true }), loadRoster({ quiet: true })]); setUndo(null); }
    catch (err) { setError(err.message || "This serving status changed again. Review the current value."); setUndo(null); }
    finally { setUndoBusy(false); }
  };

  const changeServiceStatus = async (service, nextStatus) => {
    setServiceBusy(`service:${service.id}`); setError(""); setNotice("");
    try { if (live) await setMealServiceStatus(service.id, nextStatus); await loadServices({ quiet: true }); await loadProgress({ quiet: true }); setNotice(nextStatus === "open" ? `${service.label} is ready for serving.` : `${service.label} is closed.`); }
    catch (err) { setError(err.message || "Meal status could not be updated."); }
    finally { setServiceBusy(""); }
  };

  const voidMeal = async (event) => {
    event.preventDefault();
    if (!selectedService || !canManage || voidReason.trim().length < 5) return;
    setServiceBusy(`void:${selectedService.id}`); setError(""); setNotice("");
    try {
      if (live) {
        await cancelMealService(selectedService.id, voidReason.trim());
        await loadServices({ quiet: true });
      } else {
        setServices((current) => current.map((service) => service.id === selectedService.id ? { ...service, status: "void", closedAt: new Date().toISOString() } : service));
      }
      await loadProgress({ quiet: true });
      setVoidServiceOpen(false);
      setVoidReason("");
      setNotice(`${selectedService.label} was voided. Attendance history remains available, but this service is excluded from active serving.`);
    } catch (err) { setError(err.message || "The meal service could not be voided. Review its current status and try again."); }
    finally { setServiceBusy(""); }
  };

  const shiftServiceDate = (days) => {
    const next = new Date(`${serviceDate}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + days);
    setServiceDate(next.toISOString().slice(0, 10));
    setMealQuery(""); setCompanyFilter("");
  };

  const createService = async (event) => {
    event.preventDefault(); setServiceBusy("create-service"); setError(""); setNotice("");
    try { const id = live ? await createMealService({ sessionId, serviceDate, mealType: newMeal.type, label: newMeal.label }) : `demo-${newMeal.type}-${Date.now()}`; await loadServices({ quiet: true }); setSelectedServiceId(id); setSetupOpen(false); setNewMeal({ type: "lunch", label: "" }); setNotice("Meal created. Open it when serving begins."); }
    catch (err) { setError(err.message || "Meal could not be created."); }
    finally { setServiceBusy(""); }
  };

  const loadNeeds = useCallback(async () => {
    if (!canViewDietary || needsLoaded || needsLoading) return; setNeedsLoading(true);
    try { setNeeds(live ? await loadFoodNeedsV2(sessionId) : []); setNeedsLoaded(true); }
    catch (err) { setError(err.message || "Dietary needs could not load."); }
    finally { setNeedsLoading(false); }
  }, [canViewDietary, live, needsLoaded, needsLoading, sessionId]);
  useEffect(() => { if (initialTab === "dietary" || initialTab === "needs") setTab("needs"); if (initialFilter) setDietaryFilter(initialFilter === "all" ? "all" : initialFilter === "reviewed" ? "reviewed" : "open"); }, [initialTab, initialFilter]);
  useEffect(() => { if (tab === "needs") loadNeeds(); }, [loadNeeds, tab]);
  useEffect(() => { if (!canViewDietary && tab === "needs") setTab("meals"); }, [canViewDietary, tab]);
  useEffect(() => { setDietaryLimit(PAGE_SIZE); }, [dietaryFilter, dietaryQuery]);

  const toggleNeed = async (item) => {
    const key = personKey(item.personType, item.personId); const next = !item.acknowledged; setServiceBusy(`need:${key}`); setError(""); setNeeds((current) => current.map((row) => personKey(row.personType, row.personId) === key ? { ...row, acknowledged: next, acknowledgedAt: next ? new Date().toISOString() : null } : row));
    try { if (live) await setFoodAcknowledgement({ sessionId, personType: item.personType, personId: item.personId, acknowledged: next }); setUndo({ dietary: item, message: `${item.name} marked ${next ? "reviewed" : "needs review"}.` }); }
    catch (err) { setNeeds((current) => current.map((row) => personKey(row.personType, row.personId) === key ? item : row)); setError(err.message || "This dietary item could not be saved."); }
    finally { setServiceBusy(""); }
  };

  const undoDietary = async () => {
    if (!undo?.dietary) return; const item = undo.dietary; setUndoBusy(true);
    try { if (live) await setFoodAcknowledgement({ sessionId, personType: item.personType, personId: item.personId, acknowledged: item.acknowledged }); setNeeds((current) => current.map((row) => personKey(row.personType,row.personId)===personKey(item.personType,item.personId)?item:row)); setUndo(null); }
    catch (err) { setError(err.message || "Dietary review could not be undone."); setUndo(null); }
    finally { setUndoBusy(false); }
  };

  if (!canViewMeals) return <section className="page"><PageHead title="Food" sessionName={sessionName} description="Meal attendance is limited to assigned FSY operations roles."/><article className="panel field-no-access"><ForkKnife size={30}/><h2>Food is not in your access</h2><p>Ask an administrator to confirm your operational assignment.</p></article></section>;
  const workflowTabs = [{ value: "meals", label: "Serve meals" }]; if (canViewDietary) workflowTabs.push({ value: "needs", label: "Dietary needs" });
  const openDietaryCount = needs.filter((item) => !item.acknowledged).length;
  const dietaryRows = needs.filter((item) => { const text=dietaryQuery.trim().toLowerCase(); if(dietaryFilter==='open'&&item.acknowledged)return false;if(dietaryFilter==='reviewed'&&!item.acknowledged)return false;return matchesPersonSearch(item,text,[item.dietaryInformation]); });

  return <section className="page field-page food-v3">
    <PageHead title="Food" sessionName={sessionName} description={tab === "meals" ? (selectedService?.status === "open" ? "Serve the current meal. Search, confirm, and move straight to the next person." : "Prepare or review meal service without crowding the live serving flow.") : "Review dietary accommodations separately from meal attendance."}/>
    {tab === "meals" ? <div className="food-date-nav" aria-label="Meal service date"><button type="button" className="secondary" onClick={() => shiftServiceDate(-1)} aria-label="Previous day">Previous day</button><label><span>Date</span><input type="date" value={serviceDate} onChange={(event) => { setServiceDate(event.target.value); setMealQuery(""); setCompanyFilter(""); }}/></label><button type="button" className="secondary" onClick={() => shiftServiceDate(1)} aria-label="Next day">Next day</button></div> : null}
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}{notice ? <MutationFeedback>{notice}</MutationFeedback> : null}
    <SegmentedControl label="Food workflows" value={tab} onChange={(value) => { setNotice(""); setTab(value); }} options={workflowTabs} className="food-workflow-tabs" />

    {tab === "meals" ? <>
      {servicesLoading && !services.length ? <article className="panel food-loading-card"><div className="food-loading-line wide"/><div className="food-loading-line"/><FoodSkeletonRows/></article> : null}
      {!servicesLoading && !services.length ? <article className="panel"><Empty icon={ForkKnife} title="No meals set up yet" text={canManage ? "Create the first meal. Open it only when the serving team is ready." : "The Food team has not opened a meal yet."} action={canManage ? <button type="button" className="primary" onClick={() => setSetupOpen(true)}><Plus/>New meal</button> : null}/></article> : null}
      {selectedService ? <article className={`panel food-v3-service ${selectedService.status === "open" ? "live" : ""}`}>
        <header className="food-v3-command-head"><div><span className="kicker">{selectedService.status === "open" ? "Serving now" : selectedService.status === "planned" ? "Not open yet" : selectedService.status === "void" ? "Voided service" : "Meal closed"}</span><h2>{selectedService.label}</h2><p>{formatDate(selectedService.date)}</p></div><div className="food-v3-count"><strong>{selectedService.status === "open" ? selectedRemaining : selectedServed}</strong><span>{selectedService.status === "open" ? "left to serve" : "served"}</span><Status tone={selectedService.status === "open" ? "good" : selectedService.status === "closed" ? "muted" : "warn"}>{selectedService.status === "open" ? "Open" : selectedService.status === "closed" ? "Closed" : selectedService.status === "void" ? "Voided" : "Planned"}</Status></div></header>
        {selectedService.status === "open" ? <section className="food-v3-serving" aria-labelledby="food-serving-title"><div className="food-v3-search-wrap"><div><span className="kicker">Serve someone</span><h3 id="food-serving-title">Find participant</h3></div><SearchField inputRef={searchRef} value={mealQuery} onChange={setMealQuery} label="Search participants" placeholder="Name or FSY ID" /></div><div className="food-v3-filter-row"><SegmentedControl label="Meal status" value={mealFilter} onChange={setMealFilter} options={MEAL_FILTERS} className="food-status-tabs" />{companyOptions.length > 1 ? <label className="food-company-filter"><span>Company</span><select value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)}><option value="">All in my view</option>{companyOptions.map((company) => <option key={company.companyId} value={company.companyId}>{company.company}</option>)}</select></label> : null}</div><div className="food-list-note"><Check size={16}/><span>Tap the row when food is handed over. You can undo the last change.</span></div><div className="food-meal-list">{rosterLoading && !rows.length ? <FoodSkeletonRows/> : rows.map((person) => { const served=Boolean(person.servedAt);const rowBusy=busyRows.includes(person.personId);return <label key={person.personId} className={`food-meal-row ${served?'served':''} ${rowBusy?'saving':''}`}><input type="checkbox" checked={served} disabled={!canRecordMeals||rowBusy} onChange={(event)=>toggleServed(person,event.target.checked,true)} aria-label={`${served?'Mark not served':'Mark served'}: ${person.name}`}/><span className="food-check" aria-hidden="true">{served?<Check size={18} weight="bold"/>:null}</span><span className="food-person"><PersonName person={person} context={{label:selectedService.label,value:served?"Served":"Not served"}}/><small>{[person.fsyId,person.company,person.group].filter(Boolean).join(' · ')}</small></span><span className="food-row-state">{rowBusy?'Saving…':served?formatTime(person.servedAt):''}</span></label>; })}{!rosterLoading&&!rows.length?<div className="empty-inline"><b>{mealFilter==='remaining'?'Everyone in this view is served':'No participants found'}</b><span>{mealQuery||companyFilter?'Clear a filter or try another search.':'There is nothing left to record here.'}</span></div>:null}</div>{rows.length<rosterTotal?<button type="button" className="secondary food-show-more" disabled={moreLoading} onClick={()=>loadRoster({offset:rows.length,append:true})}>{moreLoading?'Loading…':`Show ${Math.min(PAGE_SIZE,rosterTotal-rows.length)} more`}</button>:null}</section> : <section className="food-v3-not-live"><p>{selectedService.status === "planned" ? "Open this meal when serving starts. No attendance is recorded until then." : selectedService.status === "void" ? `This service is void. ${selectedServed ? `${selectedServed} recorded serving event${selectedServed === 1 ? "" : "s"} remain in history.` : "No serving events were recorded."}` : "This meal is read-only because serving has finished."}</p>{canManage&&selectedService.status==='planned'?<button type="button" className="primary" disabled={serviceBusy===`service:${selectedService.id}`} onClick={()=>changeServiceStatus(selectedService,'open')}>{serviceBusy?"Opening…":`Open ${selectedService.label}`}</button>:null}</section>}
        <details className="food-v3-secondary"><summary><span><DotsThree/>Meal details & controls</span><small>{selectedServed}/{selectedExpected} served · {completion}%</small></summary><div><label className="food-meal-picker"><span>Meal</span><select value={selectedServiceId} onChange={(event)=>{setCompanyFilter('');setSelectedServiceId(event.target.value);}}>{services.map(service=><option key={service.id} value={service.id}>{service.label} · {formatDate(service.date)} · {service.status}</option>)}</select></label>{progress.length>1?<div className="food-company-grid">{progress.map(row=>{const pct=row.expectedCount?Math.round(row.servedCount/row.expectedCount*100):0;return <div className="food-company-card" key={row.companyId||row.company}><span><b>{row.company}</b><small>{row.servedCount}/{row.expectedCount} served</small></span><strong>{pct}%</strong></div>;})}</div>:null}<div className="food-v3-management">{canManage?<button type="button" className="secondary" onClick={()=>setSetupOpen(true)}><Plus/>New meal</button>:null}{canManage&&selectedService.status==='open'?<button type="button" className="secondary danger-text" onClick={()=>setConfirmClose(true)}>Close {selectedService.label}</button>:null}{canManage&&selectedService.status!=='void'?<button type="button" className="secondary danger-text" onClick={()=>{setVoidReason("");setVoidServiceOpen(true);}}>Void service</button>:null}</div></div></details>
      </article> : null}
    </> : <section className="food-dietary-workspace"><div className="food-dietary-intro"><div><span className="kicker">Dietary accommodations</span><h2>{needsLoaded?`${openDietaryCount} need review`:'Dietary needs'}</h2><p>Keep this separate from the live serving list. Review only what the Food team needs to act on.</p></div></div>{needsLoading?<article className="panel food-loading-card"><FoodSkeletonRows/></article>:null}{needsLoaded?<article className="panel food-dietary-panel"><div className="food-dietary-tools"><SearchField value={dietaryQuery} onChange={setDietaryQuery} label="Search dietary needs" placeholder="Name, company or restriction"/><SegmentedControl label="Dietary review status" value={dietaryFilter} onChange={setDietaryFilter} options={DIETARY_FILTERS}/></div><div className="food-dietary-list">{dietaryRows.slice(0,dietaryLimit).map(item=>{const key=personKey(item.personType,item.personId);const rowBusy=serviceBusy===`need:${key}`;return <div key={key} className={`food-dietary-row ${item.acknowledged?'reviewed':''}`}><div className="food-dietary-person"><b>{item.name}</b><small>{item.personType==='staff'?'Staff':[item.company,item.group].filter(Boolean).join(' · ')||'Participant'}</small></div><p>{item.dietaryInformation}</p><div className="food-dietary-action"><span>{item.acknowledged?'Reviewed':'Needs review'}</span>{canManage?<button type="button" className="secondary" disabled={rowBusy} onClick={()=>toggleNeed(item)}>{rowBusy?'Saving…':item.acknowledged?'Reopen':'Mark reviewed'}</button>:null}</div></div>;})}</div>{!dietaryRows.length?<div className="empty-inline"><b>No dietary items in this view</b><span>Change the filter or search if needed.</span></div>:null}{dietaryLimit<dietaryRows.length?<button className="secondary" onClick={()=>setDietaryLimit(v=>v+PAGE_SIZE)}>Show more</button>:null}</article>:null}</section>}

    <DismissibleLayer open={setupOpen&&canManage} onClose={()=>serviceBusy!=="create-service"&&setSetupOpen(false)} title="Set up a meal" sheet className="food-setup-sheet-v2"><form className="food-setup-form-v2" onSubmit={createService}><button type="button" data-layer-close className="icon-button modal-close" onClick={()=>setSetupOpen(false)} disabled={serviceBusy==="create-service"} aria-label="Close"><X/></button><header><span className="kicker">Meal setup</span><h2>New meal</h2><p>Create it now. Opening it is a separate action so serving cannot begin by mistake.</p></header><label>Service date<input type="date" value={serviceDate} onChange={(event)=>setServiceDate(event.target.value)} required/></label><label>Meal type<select value={newMeal.type} onChange={(event)=>setNewMeal({...newMeal,type:event.target.value})}>{MEAL_TYPES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Label <span>optional</span><input maxLength="60" value={newMeal.label} onChange={(event)=>setNewMeal({...newMeal,label:event.target.value})} placeholder="e.g. Lunch"/></label><footer className="field-sheet-actions"><button type="button" className="secondary" onClick={()=>setSetupOpen(false)} disabled={serviceBusy==="create-service"}>Cancel</button><button className="primary" disabled={serviceBusy==="create-service"}>{serviceBusy==="create-service"?'Creating…':'Create meal'}</button></footer></form></DismissibleLayer>
    <DismissibleLayer open={voidServiceOpen&&canManage&&Boolean(selectedService)} onClose={()=>serviceBusy!==`void:${selectedService?.id}`&&setVoidServiceOpen(false)} title={`Void ${selectedService?.label || "meal service"}`} sheet className="food-setup-sheet-v2"><form className="food-setup-form-v2" onSubmit={voidMeal}><button type="button" data-layer-close className="icon-button modal-close" onClick={()=>setVoidServiceOpen(false)} disabled={serviceBusy===`void:${selectedService?.id}`} aria-label="Close"><X/></button><header><span className="kicker">Authorized correction</span><h2>Void this service?</h2><p>Voiding stops active serving and keeps the attendance history. It cannot be reopened, so use it only when this service should not count operationally.</p></header><p className="notice">{selectedServed ? `${selectedServed} serving record${selectedServed === 1 ? "" : "s"} will remain auditable but will be excluded from active meal reporting.` : "No serving records have been recorded yet."}</p><label>Reason for voiding<textarea required minLength={5} maxLength={240} value={voidReason} onChange={(event)=>setVoidReason(event.target.value)} placeholder="Explain the operational correction"/></label><footer className="field-sheet-actions"><button type="button" className="secondary" onClick={()=>setVoidServiceOpen(false)} disabled={serviceBusy===`void:${selectedService?.id}`}>Keep service</button><button className="primary danger-button" disabled={serviceBusy===`void:${selectedService?.id}`||voidReason.trim().length<5}>{serviceBusy===`void:${selectedService?.id}`?"Voiding…":"Void service"}</button></footer></form></DismissibleLayer>
    {confirmClose&&selectedService?<ConfirmActionSheet open title={`Close ${selectedService.label}?`} description="Serving becomes read-only after the meal closes." impact={selectedRemaining?`${selectedRemaining} participant${selectedRemaining===1?' is':'s are'} still not recorded.`:`All ${selectedExpected} participants in your visible scope are recorded.`} confirmLabel={`Close ${selectedService.label}`} cancelLabel="Keep serving" busy={serviceBusy===`service:${selectedService.id}`} onClose={()=>setConfirmClose(false)} onConfirm={async()=>{await changeServiceStatus(selectedService,'closed');setConfirmClose(false);}}/>:null}
    <ActionToast message={undo?.message} onAction={undo?.dietary?undoDietary:undo?undoLast:null} onDismiss={()=>setUndo(null)} busy={undoBusy}/>
  </section>;
}
