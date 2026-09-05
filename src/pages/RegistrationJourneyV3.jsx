import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { Check } from "@phosphor-icons/react/Check";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { DismissibleLayer, Empty, MutationFeedback, SearchField, Status } from "../components/UI.jsx";
import { assignParticipantToGroup, loadGroupingPlan, loadParticipants, recordCheckin, verifyOnSiteParticipant } from "../lib/backend.js";
import { hasCapability, loadParticipantEligibility } from "../lib/field-operations.js";
import { loadRegistrationHousingStatus } from "../lib/housing-handoff.js";
import { loadArrivalRoster, loadArrivalVacancies, loadIdentityReadiness, replaceArrivalVacancy, setArrivalStatus } from "../lib/identity-arrival.js";
import { addOnSiteParticipantDetailed, loadOnSiteReferenceDate } from "../lib/onsite.js";
import { DeskFilters, OnSiteDetails, PersonJourney, arrivalLabel, arrivalTone, displaySource, initials, isReady, rowProblem } from "./RegistrationJourneyPartsV3.jsx";
import "./registration-journey-v2.css";
import "./registration-journey-v3.css";

import { buildUnitDirectory, matchesRegistrationSearch } from "../lib/registration-lookup.js";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const PAGE_SIZE = 60;
const FILTER_LABELS = {
  all: "Everyone",
  arrived: "Checked in",
  expected: "Yet to arrive",
  ready: "Ready",
  needs_help: "Needs attention",
  on_site: "On-site",
  not_attending: "Not attending",
};

export function RegistrationJourney({ view = "desk", sessionId, setImported, capabilities = [], onOperationalDataChanged }) {
  const canManageRegistration = hasCapability(capabilities, "registration_manage");
  const canCheckin = hasCapability(capabilities, "checkin_record") || canManageRegistration;
  const [rows, setRows] = useState([]);
  const [eligibilityMap, setEligibilityMap] = useState(new Map());
  const [identityReadiness, setIdentityReadiness] = useState(null);
  const [vacancies, setVacancies] = useState([]);
  const [groups, setGroups] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [housingAssignments, setHousingAssignments] = useState([]);
  const [sessionStart, setSessionStart] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilterState] = useState(view === "desk" ? "ready" : "all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState("");
  const [onsiteOpen, setOnsiteOpen] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState(null);
  const searchRef = useRef(null);

  const setFilter = (value) => { setFilterState(value); setShown(PAGE_SIZE); };

  const reload = async () => {
    if (!sessionId) return;
    const [nextRows, nextEligibility, nextReadiness, nextVacancies, grouping, nextHousing, startsOn] = await Promise.all([
      loadArrivalRoster(sessionId),
      loadParticipantEligibility(sessionId),
      loadIdentityReadiness(sessionId),
      canManageRegistration ? loadArrivalVacancies(sessionId) : Promise.resolve([]),
      loadGroupingPlan(sessionId),
      loadRegistrationHousingStatus(sessionId),
      loadOnSiteReferenceDate(sessionId),
    ]);
    setRows(nextRows);
    setEligibilityMap(nextEligibility);
    setIdentityReadiness(nextReadiness);
    setVacancies(nextVacancies);
    setGroups(grouping.groups || []);
    setCompanies(grouping.companies || []);
    setHousingAssignments(nextHousing.filter((item) => item.personType === "participant"));
    setSessionStart(startsOn || "");
  };

  useEffect(() => { reload().catch((err) => setMessage({ tone: "error", text: err.message || "Registration workspace could not load." })); }, [sessionId, canManageRegistration]);
  useEffect(() => { setFilterState(view === "desk" ? "ready" : "all"); setShown(PAGE_SIZE); }, [view]);

  const housingByPerson = useMemo(() => new Map(housingAssignments.map((item) => [item.personId, item])), [housingAssignments]);
  const currentRows = useMemo(() => rows.filter((row) => row.isCurrent), [rows]);
  const unitDirectory = useMemo(() => buildUnitDirectory(rows), [rows]);

  const counts = useMemo(() => ({
    all: currentRows.length,
    arrived: currentRows.filter((row) => row.checkinStatus === "arrived").length,
    expected: currentRows.filter((row) => row.checkinStatus !== "arrived" && row.attendanceStatus !== "confirmed_not_attending").length,
    ready: currentRows.filter((row) => isReady(row, eligibilityMap.get(row.participantId))).length,
    needs_help: currentRows.filter((row) => Boolean(rowProblem(row, eligibilityMap.get(row.participantId)))).length,
    on_site: currentRows.filter((row) => row.sourceKind === "on_site").length,
    not_attending: currentRows.filter((row) => row.attendanceStatus === "confirmed_not_attending").length,
  }), [currentRows, eligibilityMap]);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return currentRows.filter((row) => {
      const eligibility = eligibilityMap.get(row.participantId);
      if (sourceFilter === "official" && row.sourceKind === "on_site") return false;
      if (sourceFilter === "on_site" && row.sourceKind !== "on_site") return false;
      if (filter === "arrived" && row.checkinStatus !== "arrived") return false;
      if (filter === "expected" && (row.checkinStatus === "arrived" || row.attendanceStatus === "confirmed_not_attending")) return false;
      if (filter === "ready" && !isReady(row, eligibility)) return false;
      if (filter === "needs_help" && !rowProblem(row, eligibility)) return false;
      if (filter === "on_site" && row.sourceKind !== "on_site") return false;
      if (filter === "not_attending" && row.attendanceStatus !== "confirmed_not_attending") return false;
      if (!text) return true;
      const housing = housingByPerson.get(row.participantId);
      return matchesRegistrationSearch(row, text, housing);
    }).sort((a, b) => {
      if (["all", "expected"].includes(filter)) {
        const aReady = isReady(a, eligibilityMap.get(a.participantId));
        const bReady = isReady(b, eligibilityMap.get(b.participantId));
        if (aReady !== bReady) return aReady ? -1 : 1;
        const aProblem = Boolean(rowProblem(a, eligibilityMap.get(a.participantId)));
        const bProblem = Boolean(rowProblem(b, eligibilityMap.get(b.participantId)));
        if (aProblem !== bProblem) return aProblem ? 1 : -1;
      }
      return collator.compare(a.fullName, b.fullName);
    });
  }, [currentRows, eligibilityMap, housingByPerson, query, filter, sourceFilter]);

  const matchingInOtherViews = query.trim() ? currentRows.filter((row) => matchesRegistrationSearch(row, query, housingByPerson.get(row.participantId))).length : 0;
  const visible = filtered.slice(0, shown);
  const selectedRow = rows.find((row) => row.participantId === selectedId) || null;
  const selectedEligibility = selectedRow ? eligibilityMap.get(selectedRow.participantId) : null;
  const selectedHousing = selectedRow ? housingByPerson.get(selectedRow.participantId) : null;
  const activeFilterLabel = FILTER_LABELS[filter] || "Participants";

  const syncParent = async () => {
    if (setImported && sessionId) setImported(await loadParticipants(sessionId));
    await onOperationalDataChanged?.();
  };

  const runMutation = async (personId, action, success) => {
    setBusyId(personId || "workspace"); setError(""); setMessage(null);
    try {
      await action();
      await reload();
      await syncParent();
      if (success) setMessage({ tone: "success", text: success });
    } catch (err) {
      setError(err.message || "That change could not be saved.");
      throw err;
    } finally { setBusyId(""); }
  };

  const focusNext = () => {
    setSelectedId("");
    setQuery("");
    setFilter("ready");
    window.requestAnimationFrame(() => searchRef.current?.querySelector?.("input")?.focus?.());
  };

  const checkIn = async (row, keepOpen = false) => {
    if (!canCheckin) return;
    try {
      const housing = housingByPerson.get(row.participantId);
      const success = housing ? `${row.fullName} is checked in · Housing: ${housing.roomName}.` : `${row.fullName} is checked in. Housing can now see them in Arrivals waiting.`;
      await runMutation(row.participantId, () => recordCheckin({ sessionId, participantId: row.participantId, status: "arrived" }), success);
      if (!keepOpen) focusNext();
    } catch {}
  };

  const createOnsite = async (form) => {
    setBusyId("onsite-new"); setError("");
    try {
      const participantId = await addOnSiteParticipantDetailed({ sessionId, ...form });
      await reload();
      await syncParent();
      setOnsiteOpen(false);
      setSelectedId(participantId);
      setMessage({ tone: "success", text: `${form.firstName} ${form.lastName} was added. Continue verification, placement and check-in here.` });
    } catch (err) { setError(err.message || "Unable to add this participant."); }
    finally { setBusyId(""); }
  };

  const verifySelected = async (note) => {
    if (!selectedRow) return;
    try { await runMutation(selectedRow.participantId, () => verifyOnSiteParticipant(selectedRow.participantId, true, note), `${selectedRow.fullName} is verified. Continue with placement.`); } catch {}
  };

  const assignGroup = async (group) => {
    if (!selectedRow) return;
    try { await runMutation(selectedRow.participantId, () => assignParticipantToGroup(selectedRow.participantId, group.id), `${selectedRow.fullName} was assigned to ${group.displayName || group.name}.`); } catch {}
  };

  const useVacancy = async (vacancy) => {
    if (!selectedRow) return;
    try { await runMutation(selectedRow.participantId, () => replaceArrivalVacancy(vacancy.participantId, selectedRow.participantId), `${selectedRow.fullName} now has ${vacancy.fsyId} and ${vacancy.groupName}.`); } catch {}
  };

  const arrivalStatus = async (next, note = "") => {
    if (!selectedRow) return;
    try { await runMutation(selectedRow.participantId, () => setArrivalStatus(selectedRow.participantId, next, note || "Updated from Registration & Check-in desk"), `${selectedRow.fullName} is now ${next === "expected_later" ? "expected later" : next === "unknown" ? "marked for follow-up" : next === "confirmed_not_attending" ? "confirmed not attending" : "expected today"}.`); } catch {}
  };

  const closePerson = () => { if (!busyId) { setSelectedId(""); setError(""); } };
  const closeOnsite = () => { if (!busyId) { setOnsiteOpen(false); setError(""); } };
  const openPerson = (row) => { setSelectedId(row.participantId); setError(""); if (row.checkinStatus === "arrived") reload().catch(() => {}); };

  return <section className={`regjourney regjourney-${view} regjourney-v2 regjourney-v3`}>
    {view === "roster" ? <div className="regjourney-roster-head regjourney-roster-head-v2 regjourney-roster-head-v3"><div><span className="kicker">Session roster</span><h2>Everyone in one place</h2><p>Search current participants, arrivals and on-site additions.</p></div><div><b>{counts.all.toLocaleString()}</b><span>current participants</span></div></div> : null}

    {error && !selectedRow && !onsiteOpen ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
    {message ? <MutationFeedback tone={message.tone}>{message.text}</MutationFeedback> : null}

    <article className="panel regjourney-worklist regjourney-worklist-v2 regjourney-worklist-v3">
      <div className="regjourney-search-row" ref={searchRef}>
        <SearchField value={query} onChange={(value) => { setQuery(value); setShown(PAGE_SIZE); }} label={view === "desk" ? "Find a participant" : "Search roster"} placeholder="Search name, FSY ID, ward/branch, stake, company, group or room" />
        {canManageRegistration ? <button type="button" className="secondary regjourney-onsite-button" onClick={() => { setOnsiteOpen(true); setError(""); }}><UserPlus />Add on-site participant</button> : null}
      </div>

      {view === "desk" ? <DeskFilters filter={filter} setFilter={setFilter} counts={counts} /> : <div className="regjourney-roster-filters">
        <label><span>Status</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Everyone</option><option value="ready">Ready · {counts.ready}</option><option value="arrived">Checked in · {counts.arrived}</option><option value="needs_help">Needs attention · {counts.needs_help}</option><option value="expected">Yet to arrive · {counts.expected}</option><option value="on_site">On-site · {counts.on_site}</option><option value="not_attending">Not attending · {counts.not_attending}</option></select></label>
        <label><span>Source</span><select value={sourceFilter} onChange={(event) => { setSourceFilter(event.target.value); setShown(PAGE_SIZE); }}><option value="all">All sources</option><option value="official">Registration list</option><option value="on_site">On-site only</option></select></label>
      </div>}

      <div className="regjourney-result-line regjourney-result-line-v3" role="status"><span><b>{filtered.length.toLocaleString()}</b> {activeFilterLabel.toLowerCase()}</span>{filtered.length > shown ? <span>· showing first {shown.toLocaleString()}</span> : null}{query ? <span>· matching “{query}”</span> : null}{filter !== (view === "desk" ? "ready" : "all") || sourceFilter !== "all" || query ? <button type="button" className="text-action" onClick={() => { setQuery(""); setFilter(view === "desk" ? "ready" : "all"); setSourceFilter("all"); }}>Clear filters</button> : null}</div>

      <div className="regjourney-list regjourney-list-v2">
        {visible.map((row) => {
          const eligibility = eligibilityMap.get(row.participantId);
          const housing = housingByPerson.get(row.participantId);
          const problem = rowProblem(row, eligibility);
          const ready = isReady(row, eligibility);
          return <div className={`regjourney-row regjourney-row-v2${problem ? " needs-help" : ""}${ready ? " ready" : ""}${row.checkinStatus === "arrived" ? " arrived" : ""}`} key={row.participantId}>
            <button type="button" className="regjourney-person-button" onClick={() => openPerson(row)}>
              <span className="person-avatar">{initials(row.fullName)}</span>
              <span className="regjourney-person-copy"><b>{row.fullName}</b><small>{row.unit || "Unit not recorded"}{row.stake ? ` · ${row.stake}` : ""}</small><em>{displaySource(row)}{row.fsyId ? ` · ${row.fsyId}` : " · FSY ID pending"}</em></span>
            </button>
            <div className="regjourney-assignment"><span>{row.companyName || "No company"}</span><small>{row.groupName || "No counselor group"}</small>{row.checkinStatus === "arrived" ? <em className={housing ? "housing-ready" : "housing-waiting"}>{housing ? `Room ${housing.roomName}` : "Waiting for Housing"}</em> : null}</div>
            <div className="regjourney-status"><Status tone={problem ? "warn" : arrivalTone(row)}>{problem || arrivalLabel(row)}</Status></div>
            <div className="regjourney-row-action">{ready && canCheckin ? <button type="button" className="primary" disabled={busyId === row.participantId} onClick={() => checkIn(row)}>{busyId === row.participantId ? "Saving…" : "Check in"}<Check /></button> : problem && canManageRegistration ? <button type="button" className="secondary resolve" onClick={() => openPerson(row)}>Resolve<ArrowRight /></button> : <button type="button" className="secondary" onClick={() => openPerson(row)}>View</button>}</div>
          </div>;
        })}
        {!visible.length && query.trim().length >= 2 ? <div className="regjourney-no-match"><MagnifyingGlass size={30}/><div><b>{matchingInOtherViews ? "Participant matches are hidden by your filters" : `No participant found for “${query}”`}</b><p>{matchingInOtherViews ? `${matchingInOtherViews} matching record(s) exist in the roster. Check them before adding anyone.` : "Try a shorter spelling or another detail before adding a new participant."}</p></div>{matchingInOtherViews ? <button type="button" className="primary" onClick={() => { setFilter("all"); setSourceFilter("all"); }}>Search everyone<ArrowRight /></button> : canManageRegistration ? <button type="button" className="primary" onClick={() => { setOnsiteOpen(true); setError(""); }}>Add on-site participant<UserPlus /></button> : null}</div> : null}
        {!visible.length && query.trim().length < 2 ? <Empty icon={CheckCircle} title={filter === "ready" ? "No one is ready right now" : "Nothing in this view"} text={filter === "ready" ? "Open Needs attention for unresolved records or search for the participant directly." : "Choose another status or search for a participant."} /> : null}
      </div>
      {filtered.length > shown ? <button type="button" className="secondary regjourney-show-more" onClick={() => setShown((value) => value + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, filtered.length - shown)} more</button> : null}
    </article>

    <DismissibleLayer open={onsiteOpen} onClose={closeOnsite} title="On-site registration" sheet className="regjourney-onsite-layer regjourney-onsite-layer-v3">
      <OnSiteDetails initialSearch={query} sessionStart={sessionStart} unitDirectory={unitDirectory} busy={busyId === "onsite-new"} error={error} onCreate={createOnsite} onCancel={closeOnsite} onClose={closeOnsite} />
    </DismissibleLayer>

    <DismissibleLayer open={Boolean(selectedRow)} onClose={closePerson} title={selectedRow ? selectedRow.fullName : "Participant"} sheet className="regjourney-person-layer regjourney-person-layer-v3">
      {selectedRow ? <PersonJourney
        row={selectedRow}
        eligibility={selectedEligibility}
        identityReadiness={identityReadiness}
        vacancies={vacancies}
        groups={groups}
        companies={companies}
        housingAssignment={selectedHousing}
        canManageRegistration={canManageRegistration}
        busy={busyId === selectedRow.participantId}
        error={error}
        onVerify={verifySelected}
        onAssignGroup={assignGroup}
        onUseVacancy={useVacancy}
        onCheckin={() => checkIn(selectedRow, true)}
        onArrivalStatus={arrivalStatus}
        onDone={focusNext}
        onClose={closePerson}
      /> : null}
    </DismissibleLayer>
  </section>;
}