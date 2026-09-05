import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { Bed } from "@phosphor-icons/react/Bed";
import { Check } from "@phosphor-icons/react/Check";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { IdentificationCard } from "@phosphor-icons/react/IdentificationCard";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { Plus } from "@phosphor-icons/react/Plus";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { UsersThree } from "@phosphor-icons/react/UsersThree";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { DismissibleLayer, Empty, MutationFeedback, SearchField, Status } from "../components/UI.jsx";
import { assignParticipantToGroup, loadGroupingPlan, loadParticipants, recordCheckin, verifyOnSiteParticipant } from "../lib/backend.js";
import { hasCapability, loadHousingAssignments, loadHousingRooms, loadParticipantEligibility } from "../lib/field-operations.js";
import { createHousingRoomAndAssignV2, saveHousingAssignment } from "../lib/housing-actions.js";
import { loadArrivalRoster, loadArrivalVacancies, loadIdentityReadiness, replaceArrivalVacancy, setArrivalStatus, NO_SHOW_CONFIRMATION_SOURCES } from "../lib/identity-arrival.js";
import { addOnSiteParticipantDetailed, loadOnSiteReferenceDate } from "../lib/onsite.js";
import "./registration-journey.css";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const PAGE_SIZE = 60;
const EMPTY_FORM = {
  firstName: "", lastName: "", preferredName: "", sex: "Female", birthday: "",
  unit: "", stake: "", phone: "", guardianName: "", guardianPhone: "",
  tshirtSize: "", medicalInformation: "", dietaryInformation: "",
};

function initials(name = "FSY") {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function sexValue(value) {
  return String(value || "").toLowerCase() === "female" ? "female" : "male";
}

function arrivalLabel(row) {
  if (row.checkinStatus === "arrived") return "Checked in";
  if (row.attendanceStatus === "confirmed_not_attending") return "Not attending";
  if (row.attendanceStatus === "expected_later") return "Expected later";
  if (row.attendanceStatus === "unknown") return "Follow up";
  return "Yet to arrive";
}

function arrivalTone(row) {
  if (row.checkinStatus === "arrived") return "good";
  if (row.attendanceStatus === "confirmed_not_attending") return "danger";
  if (row.attendanceStatus === "expected_later" || row.attendanceStatus === "unknown") return "warn";
  return "muted";
}

function rowProblem(row, eligibility, housingAssignment = null, requireHousing = false) {
  if (!row.isCurrent || row.attendanceStatus === "confirmed_not_attending") return "";
  if (row.sourceKind === "on_site" && row.verificationStatus !== "verified") return "Needs verification";
  if (eligibility && !eligibility.eligible) return eligibility.reason || "Needs review";
  if (!row.groupName) return "Needs counselor group";
  if (requireHousing && row.sourceKind === "on_site" && !housingAssignment) return "Needs housing";
  if (row.attendanceStatus === "unknown") return "Needs follow-up";
  return "";
}

function isReady(row, eligibility, housingAssignment = null, requireHousing = false) {
  return row.isCurrent && row.attendanceStatus !== "confirmed_not_attending" && row.checkinStatus !== "arrived" && !rowProblem(row, eligibility, housingAssignment, requireHousing);
}

function displaySource(row) {
  return row.sourceKind === "on_site" ? "On-site" : "Registration list";
}

function GroupPicker({ groups, companies, row, busy, onChoose }) {
  const companyById = useMemo(() => new Map(companies.map((item) => [item.id, item])), [companies]);
  const choices = useMemo(() => groups
    .filter((group) => sexValue(group.sex) === sexValue(row.sex))
    .sort((a, b) => Number(a.memberCount || 0) - Number(b.memberCount || 0) || collator.compare(a.name, b.name)), [groups, row.sex]);

  return <div className="regjourney-choice-list">
    {choices.slice(0, 20).map((group, index) => {
      const company = companyById.get(group.companyId);
      return <button type="button" key={group.id} className="regjourney-choice" disabled={busy} onClick={() => onChoose(group)}>
        <span><b>{group.displayName || group.name}</b><small>{company?.name || "Company"} · {Number(group.memberCount || 0)} currently assigned</small></span>
        <span className="regjourney-choice-end">{index === 0 ? <em>Suggested</em> : null}<ArrowRight /></span>
      </button>;
    })}
    {!choices.length ? <Empty icon={UsersThree} title="No compatible counselor groups" text="Create or publish a compatible counselor group before continuing." /> : null}
  </div>;
}

function HousingPicker({ rooms, row, busy, onChoose, onCreate }) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newRoom, setNewRoom] = useState({ name: "", capacity: 4, building: "", floor: "" });
  const compatible = useMemo(() => {
    const text = query.trim().toLowerCase();
    return rooms
      .filter((room) => (!room.sex || room.sex === sexValue(row.sex)) && room.occupancy < room.capacity)
      .filter((room) => !text || `${room.name} ${room.building} ${room.floor}`.toLowerCase().includes(text))
      .sort((a, b) => (b.capacity - b.occupancy) - (a.capacity - a.occupancy) || collator.compare(a.name, b.name));
  }, [rooms, row.sex, query]);

  if (creating) return <div className="regjourney-create-room">
    <div className="regjourney-section-head"><div><span className="kicker">No suitable room?</span><h3>Create a room and assign {row.fullName}</h3><p>Room use follows this participant automatically, so you only enter the room details.</p></div></div>
    <div className="regjourney-form-grid two"><label>Room name<input autoFocus required value={newRoom.name} onChange={(event) => setNewRoom({ ...newRoom, name: event.target.value })} placeholder="e.g. Block C · 12" /></label><label>Spaces<input type="number" min="1" max="50" value={newRoom.capacity} onChange={(event) => setNewRoom({ ...newRoom, capacity: event.target.value })} /></label><label>Building <span>Optional</span><input value={newRoom.building} onChange={(event) => setNewRoom({ ...newRoom, building: event.target.value })} placeholder="e.g. Republic Hall" /></label><label>Floor <span>Optional</span><input value={newRoom.floor} onChange={(event) => setNewRoom({ ...newRoom, floor: event.target.value })} placeholder="e.g. Ground floor" /></label></div>
    <div className="regjourney-inline-actions"><button type="button" className="secondary" onClick={() => setCreating(false)}>Back to rooms</button><button type="button" className="primary" disabled={busy || !newRoom.name.trim()} onClick={() => onCreate(newRoom)}>{busy ? "Creating…" : "Create room & assign"}</button></div>
  </div>;

  return <div>
    <div className="regjourney-inline-toolbar"><SearchField value={query} onChange={setQuery} label="Find a room" placeholder="Search room, building or floor" /><button type="button" className="secondary" onClick={() => setCreating(true)}><Plus />Create room</button></div>
    <div className="regjourney-choice-list compact">
      {compatible.slice(0, 24).map((room) => <button type="button" className="regjourney-choice" key={room.id} disabled={busy} onClick={() => onChoose(room)}>
        <span><b>{room.name}</b><small>{[room.building, room.floor].filter(Boolean).join(" · ") || "Location not labelled"}</small></span>
        <span className="regjourney-room-space"><b>{room.capacity - room.occupancy} open</b><small>{room.occupancy}/{room.capacity}</small></span>
      </button>)}
      {!compatible.length ? <Empty icon={Bed} title="No compatible rooms with space" text="Create a new room here without leaving this participant's journey." action={<button type="button" className="secondary" onClick={() => setCreating(true)}>Create room</button>} /> : null}
    </div>
  </div>;
}

function OnSiteDetails({ initialSearch = "", sessionStart, busy, error, onCreate, onCancel }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, firstName: initialSearch.trim().split(/\s+/)[0] || "", lastName: initialSearch.trim().split(/\s+/).slice(1).join(" ") }));
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event) => { event.preventDefault(); onCreate(form); };
  return <form className="regjourney-onsite-form" onSubmit={submit}>
    <header className="regjourney-sheet-intro"><span className="kicker">On-site registration · Step 1 of 4</span><h2>Add the participant once</h2><p>Capture the minimum details needed to identify and support this youth. The next steps stay in this same journey.</p></header>
    <div className="regjourney-form-grid two">
      <label>First name<input autoFocus required value={form.firstName} onChange={(e) => set("firstName", e.target.value)} /></label>
      <label>Last name<input required value={form.lastName} onChange={(e) => set("lastName", e.target.value)} /></label>
      <label>Preferred name <span>Optional</span><input value={form.preferredName} onChange={(e) => set("preferredName", e.target.value)} /></label>
      <label>Sex<select value={form.sex} onChange={(e) => set("sex", e.target.value)}><option>Female</option><option>Male</option></select></label>
      <label>Date of birth<input type="date" required max={sessionStart || undefined} value={form.birthday} onChange={(e) => set("birthday", e.target.value)} /></label>
      <label>Ward / branch<input required value={form.unit} onChange={(e) => set("unit", e.target.value)} placeholder="e.g. Bantama Ward" /></label>
      <label>Stake / district <span>Recommended</span><input value={form.stake} onChange={(e) => set("stake", e.target.value)} /></label>
      <label>Participant phone <span>Optional if guardian phone is added</span><input inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></label>
      <label>Parent / guardian name <span>Recommended</span><input value={form.guardianName} onChange={(e) => set("guardianName", e.target.value)} /></label>
      <label>Parent / guardian phone<input inputMode="tel" value={form.guardianPhone} onChange={(e) => set("guardianPhone", e.target.value)} /></label>
    </div>
    <details className="regjourney-optional-details">
      <summary><span><b>Participant needs</b><small>T-shirt, medical and dietary information</small></span><span aria-hidden="true">+</span></summary>
      <div className="regjourney-form-grid"><label>T-shirt size<input value={form.tshirtSize} onChange={(e) => set("tshirtSize", e.target.value)} placeholder="Optional" /></label><label>Medical information<textarea rows="2" value={form.medicalInformation} onChange={(e) => set("medicalInformation", e.target.value)} placeholder="Optional" /></label><label>Dietary information<textarea rows="2" value={form.dietaryInformation} onChange={(e) => set("dietaryInformation", e.target.value)} placeholder="Optional" /></label></div>
    </details>
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
    <footer className="regjourney-sheet-actions"><button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button><button className="primary" disabled={busy || !form.firstName.trim() || !form.lastName.trim() || !form.birthday || !form.unit.trim() || (!form.phone.trim() && !form.guardianPhone.trim())}>{busy ? "Adding…" : "Add & continue"}<ArrowRight /></button></footer>
  </form>;
}

function ApprovalStep({ busy, error, onVerify }) {
  const [checks, setChecks] = useState({ terms: false, leader: false, payment: false });
  const complete = checks.terms && checks.leader && checks.payment;
  return <div className="regjourney-resolution-section">
    <div className="regjourney-section-head"><div><span className="kicker">On-site registration · Step 2 of 4</span><h3>Confirm the registration requirements</h3><p>Keep the participant with you until these checks are complete. The confirmations are recorded in the audit note.</p></div></div>
    <div className="regjourney-checklist">
      <label><input type="checkbox" checked={checks.terms} onChange={(e) => setChecks({ ...checks, terms: e.target.checked })} /><span><b>Parent / guardian registration and terms are complete</b><small>Including the required consent or terms used for this session.</small></span></label>
      <label><input type="checkbox" checked={checks.leader} onChange={(e) => setChecks({ ...checks, leader: e.target.checked })} /><span><b>Bishop or branch president approval is confirmed</b><small>The youth has approval to attend this FSY session.</small></span></label>
      <label><input type="checkbox" checked={checks.payment} onChange={(e) => setChecks({ ...checks, payment: e.target.checked })} /><span><b>Payment information has been checked</b><small>Confirm the applicable session payment requirement has been resolved.</small></span></label>
    </div>
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
    <button type="button" className="primary regjourney-step-primary" disabled={busy || !complete} onClick={() => onVerify("On-site registration verified by Registration Committee: parent/guardian terms confirmed; bishop/branch president approval confirmed; payment information checked.")}>{busy ? "Verifying…" : "Verify & continue"}<ArrowRight /></button>
  </div>;
}

function VacancyPicker({ vacancies, row, busy, onChoose }) {
  const compatible = vacancies.filter((item) => sexValue(item.sex) === sexValue(row.sex));
  return <div className="regjourney-resolution-section">
    <div className="regjourney-section-head"><div><span className="kicker">On-site registration · Step 3 of 4</span><h3>Use an available roster place</h3><p>FSY IDs are finalized, so this participant needs a confirmed vacancy. The original participant stays in the audit history.</p></div></div>
    <div className="regjourney-choice-list">
      {compatible.map((vacancy) => <button type="button" className="regjourney-choice" key={vacancy.participantId} disabled={busy} onClick={() => onChoose(vacancy)}>
        <span><b>{vacancy.companyName} · {vacancy.groupName}</b><small>Available from {vacancy.fullName} · {vacancy.fsyId}</small></span><span className="regjourney-choice-end"><b>Slot {String(vacancy.slotNumber || "").padStart(2, "0")}</b><ArrowRight /></span>
      </button>)}
      {!compatible.length ? <Empty icon={IdentificationCard} title="No compatible confirmed vacancy" text="Keep this participant in Needs help until a confirmed no-show creates a compatible roster place." /> : null}
    </div>
  </div>;
}

function PersonJourney({ row, eligibility, identityReadiness, vacancies, groups, companies, rooms, housingAssignment, canManageRegistration, canHousing, busy, error, onVerify, onAssignGroup, onUseVacancy, onAssignRoom, onCreateRoom, onCheckin, onArrivalStatus }) {
  const [noShowOpen, setNoShowOpen] = useState(false);
  const [confirmationSource, setConfirmationSource] = useState("");
  const [confirmationNote, setConfirmationNote] = useState("");
  const problem = rowProblem(row, eligibility, housingAssignment, canHousing);
  const finalized = Number(identityReadiness?.finalizedIds || 0) > 0;
  const onsitePending = row.sourceKind === "on_site" && row.verificationStatus !== "verified";
  const needsPlacement = row.isCurrent && row.verificationStatus === "verified" && !row.groupName;
  const housingNeeded = row.sourceKind === "on_site" && row.verificationStatus === "verified" && Boolean(row.groupName) && !housingAssignment;
  const ready = isReady(row, eligibility, housingAssignment, canHousing);

  return <div className="regjourney-person-flow">
    <header className="regjourney-person-header">
      <span className="person-avatar large">{initials(row.fullName)}</span>
      <div><span className="kicker">{row.sourceKind === "on_site" ? "On-site participant" : "Participant"}</span><h2>{row.fullName}</h2><p>{row.unit || "Unit not recorded"}{row.stake ? ` · ${row.stake}` : ""}</p></div>
      <Status tone={problem ? "warn" : row.checkinStatus === "arrived" ? "good" : "muted"}>{problem || arrivalLabel(row)}</Status>
    </header>

    <div className="regjourney-person-facts">
      <div><span>FSY ID</span><b>{row.fsyId || "Pending"}</b></div>
      <div><span>Company</span><b>{row.companyName || "Not assigned"}</b></div>
      <div><span>Counselor group</span><b>{row.groupName || "Not assigned"}</b></div>
      <div><span>Housing</span><b>{housingAssignment?.roomName || "Not assigned"}</b></div>
    </div>

    <div className="regjourney-progress" aria-label="Participant readiness">
      <span className="done"><i><Check /></i><b>Registration</b></span>
      <span className={row.verificationStatus === "verified" ? "done" : "current"}><i>{row.verificationStatus === "verified" ? <Check /> : "2"}</i><b>Verify</b></span>
      <span className={row.groupName ? "done" : row.verificationStatus === "verified" ? "current" : ""}><i>{row.groupName ? <Check /> : "3"}</i><b>Placement</b></span>
      <span className={row.checkinStatus === "arrived" ? "done" : ready ? "current" : ""}><i>{row.checkinStatus === "arrived" ? <Check /> : "4"}</i><b>Check in</b></span>
    </div>

    {row.checkinStatus === "arrived" ? <div className="regjourney-complete"><CheckCircle weight="fill"/><div><b>Check-in complete</b><p>{row.fullName} is recorded as arrived. Their assignment details remain available above.</p></div></div> : null}

    {onsitePending && canManageRegistration ? <ApprovalStep busy={busy} error={error} onVerify={onVerify} /> : null}

    {!onsitePending && needsPlacement && canManageRegistration ? (finalized
      ? <VacancyPicker vacancies={vacancies} row={row} busy={busy} onChoose={onUseVacancy} />
      : <div className="regjourney-resolution-section"><div className="regjourney-section-head"><div><span className="kicker">Placement</span><h3>Choose the counselor group</h3><p>The company follows the counselor group automatically. Suggested groups with fewer people appear first.</p></div></div><GroupPicker groups={groups} companies={companies} row={row} busy={busy} onChoose={onAssignGroup} /></div>) : null}

    {!onsitePending && !needsPlacement && housingNeeded && canHousing ? <div className="regjourney-resolution-section"><div className="regjourney-section-head"><div><span className="kicker">On-site registration · Housing</span><h3>Assign housing before the participant leaves</h3><p>Only compatible rooms with space are shown. If none fit, create one without leaving this journey.</p></div></div><HousingPicker rooms={rooms} row={row} busy={busy} onChoose={onAssignRoom} onCreate={onCreateRoom} /></div> : null}

    {!onsitePending && !needsPlacement && ready ? <div className="regjourney-ready-panel"><div><CheckCircle weight="fill"/><span><b>Ready to check in</b><small>{row.companyName} · {row.groupName}{housingAssignment?.roomName ? ` · ${housingAssignment.roomName}` : ""}</small></span></div><button type="button" className="primary" disabled={busy} onClick={onCheckin}>{busy ? "Saving…" : "Complete check-in"}<Check /></button></div> : null}

    {!onsitePending && !needsPlacement && !ready && row.checkinStatus !== "arrived" && problem ? <div className="regjourney-blocked"><WarningCircle/><div><b>{problem}</b><p>This record still has an eligibility issue that cannot safely be bypassed from check-in.</p></div></div> : null}

    <details className="regjourney-secondary-actions">
      <summary><span><b>Arrival & other actions</b><small>Use only when the participant is not ready to check in now</small></span><span aria-hidden="true">+</span></summary>
      <div className="regjourney-secondary-grid">
        {row.checkinStatus !== "arrived" && row.attendanceStatus !== "expected" ? <button type="button" className="secondary" disabled={busy} onClick={() => onArrivalStatus("expected")}>Expected today</button> : null}
        {row.checkinStatus !== "arrived" && row.attendanceStatus !== "expected_later" ? <button type="button" className="secondary" disabled={busy} onClick={() => onArrivalStatus("expected_later")}>Expected later</button> : null}
        {row.checkinStatus !== "arrived" && row.attendanceStatus !== "unknown" ? <button type="button" className="secondary" disabled={busy} onClick={() => onArrivalStatus("unknown")}>Needs follow-up</button> : null}
        {canManageRegistration && row.checkinStatus !== "arrived" && row.attendanceStatus !== "confirmed_not_attending" ? <button type="button" className="secondary danger-subtle" disabled={busy} onClick={() => setNoShowOpen((open) => !open)}>Confirm not attending</button> : null}
      </div>
      {noShowOpen && row.attendanceStatus !== "confirmed_not_attending" ? <div className="regjourney-noshow-inline">
        <div><b>Confirm only from an authorized source</b><p>This keeps the original participant in history and, after FSY IDs are finalized, can make their roster place available to a verified on-site participant.</p></div>
        <label>Who confirmed this?<select value={confirmationSource} onChange={(event) => setConfirmationSource(event.target.value)}><option value="">Choose source</option>{NO_SHOW_CONFIRMATION_SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}</select></label>
        <label>Short note <span>{confirmationSource === "Other authorized confirmation" ? "Required" : "Optional"}</span><textarea rows="2" value={confirmationNote} onChange={(event) => setConfirmationNote(event.target.value)} placeholder="e.g. Parent confirmed by phone at 8:15 AM" /></label>
        <button type="button" className="danger-button" disabled={busy || !confirmationSource || (confirmationSource === "Other authorized confirmation" && !confirmationNote.trim())} onClick={() => onArrivalStatus("confirmed_not_attending", confirmationNote.trim() ? `${confirmationSource}: ${confirmationNote.trim()}` : confirmationSource)}>Confirm not attending</button>
      </div> : null}
    </details>
    {error && !onsitePending ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
  </div>;
}

export function RegistrationJourney({ view = "desk", sessionId, setImported, capabilities = [], onOperationalDataChanged }) {
  const canManageRegistration = hasCapability(capabilities, "registration_manage");
  const canCheckin = hasCapability(capabilities, "checkin_record") || canManageRegistration;
  const canHousing = hasCapability(capabilities, "housing_manage");
  const canHousingView = hasCapability(capabilities, "housing_view") || canHousing;
  const [rows, setRows] = useState([]);
  const [eligibilityMap, setEligibilityMap] = useState(new Map());
  const [identityReadiness, setIdentityReadiness] = useState(null);
  const [vacancies, setVacancies] = useState([]);
  const [groups, setGroups] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [housingAssignments, setHousingAssignments] = useState([]);
  const [sessionStart, setSessionStart] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(view === "desk" ? "expected" : "all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState("");
  const [onsiteOpen, setOnsiteOpen] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState(null);
  const searchRef = useRef(null);

  const reload = async () => {
    if (!sessionId) return;
    const [nextRows, nextEligibility, nextReadiness, nextVacancies, grouping, nextRooms, nextHousing, startsOn] = await Promise.all([
      loadArrivalRoster(sessionId),
      loadParticipantEligibility(sessionId),
      loadIdentityReadiness(sessionId),
      canManageRegistration ? loadArrivalVacancies(sessionId) : Promise.resolve([]),
      loadGroupingPlan(sessionId),
      canHousingView ? loadHousingRooms(sessionId) : Promise.resolve([]),
      canHousingView ? loadHousingAssignments(sessionId) : Promise.resolve([]),
      loadOnSiteReferenceDate(sessionId),
    ]);
    setRows(nextRows);
    setEligibilityMap(nextEligibility);
    setIdentityReadiness(nextReadiness);
    setVacancies(nextVacancies);
    setGroups(grouping.groups || []);
    setCompanies(grouping.companies || []);
    setRooms(nextRooms);
    setHousingAssignments(nextHousing.filter((item) => item.personType === "participant"));
    setSessionStart(startsOn || "");
  };

  useEffect(() => { reload().catch((err) => setMessage({ tone: "error", text: err.message || "Registration workspace could not load." })); }, [sessionId, canManageRegistration, canHousingView]);
  useEffect(() => { setFilter(view === "desk" ? "expected" : "all"); setShown(PAGE_SIZE); }, [view]);

  const housingByPerson = useMemo(() => new Map(housingAssignments.map((item) => [item.personId, item])), [housingAssignments]);
  const currentRows = useMemo(() => rows.filter((row) => row.isCurrent), [rows]);
  const counts = useMemo(() => {
    const base = currentRows;
    return {
      all: base.length,
      arrived: base.filter((row) => row.checkinStatus === "arrived").length,
      expected: base.filter((row) => row.checkinStatus !== "arrived" && row.attendanceStatus !== "confirmed_not_attending").length,
      ready: base.filter((row) => isReady(row, eligibilityMap.get(row.participantId), housingByPerson.get(row.participantId), canHousing)).length,
      needs_help: base.filter((row) => Boolean(rowProblem(row, eligibilityMap.get(row.participantId), housingByPerson.get(row.participantId), canHousing))).length,
      on_site: base.filter((row) => row.sourceKind === "on_site").length,
      not_attending: base.filter((row) => row.attendanceStatus === "confirmed_not_attending").length,
    };
  }, [currentRows, eligibilityMap, housingByPerson, canHousing]);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return currentRows.filter((row) => {
      const eligibility = eligibilityMap.get(row.participantId);
      if (sourceFilter === "official" && row.sourceKind === "on_site") return false;
      if (sourceFilter === "on_site" && row.sourceKind !== "on_site") return false;
      if (filter === "arrived" && row.checkinStatus !== "arrived") return false;
      if (filter === "expected" && (row.checkinStatus === "arrived" || row.attendanceStatus === "confirmed_not_attending")) return false;
      const housing = housingByPerson.get(row.participantId);
      if (filter === "ready" && !isReady(row, eligibility, housing, canHousing)) return false;
      if (filter === "needs_help" && !rowProblem(row, eligibility, housing, canHousing)) return false;
      if (filter === "on_site" && row.sourceKind !== "on_site") return false;
      if (filter === "not_attending" && row.attendanceStatus !== "confirmed_not_attending") return false;
      if (!text) return true;
      return `${row.fullName} ${row.preferredName || ""} ${row.fsyId || ""} ${row.unit || ""} ${row.stake || ""} ${row.companyName || ""} ${row.groupName || ""}`.toLowerCase().includes(text);
    }).sort((a, b) => {
      if (view === "desk") {
        const aProblem = Boolean(rowProblem(a, eligibilityMap.get(a.participantId), housingByPerson.get(a.participantId), canHousing));
        const bProblem = Boolean(rowProblem(b, eligibilityMap.get(b.participantId), housingByPerson.get(b.participantId), canHousing));
        if (aProblem !== bProblem) return aProblem ? -1 : 1;
      }
      return collator.compare(a.fullName, b.fullName);
    });
  }, [currentRows, eligibilityMap, housingByPerson, canHousing, query, filter, sourceFilter, view]);

  const visible = filtered.slice(0, shown);
  const selectedRow = rows.find((row) => row.participantId === selectedId) || null;
  const selectedEligibility = selectedRow ? eligibilityMap.get(selectedRow.participantId) : null;
  const selectedHousing = selectedRow ? housingByPerson.get(selectedRow.participantId) : null;

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

  const checkIn = async (row) => {
    if (!canCheckin) return;
    try {
      await runMutation(row.participantId, () => recordCheckin({ sessionId, participantId: row.participantId, status: "arrived" }), `${row.fullName} is checked in.`);
      setSelectedId("");
      setQuery("");
      window.requestAnimationFrame(() => searchRef.current?.querySelector?.("input")?.focus?.());
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
      setMessage({ tone: "success", text: `${form.firstName} ${form.lastName} was added. Continue the verification and placement steps here.` });
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

  const assignRoom = async (room) => {
    if (!selectedRow) return;
    try { await runMutation(selectedRow.participantId, () => saveHousingAssignment({ sessionId, personType: "participant", personId: selectedRow.participantId, roomId: room.id }), `${selectedRow.fullName} was assigned to ${room.name}.`); } catch {}
  };

  const createRoom = async (room) => {
    if (!selectedRow) return;
    try { await runMutation(selectedRow.participantId, () => createHousingRoomAndAssignV2({ sessionId, personType: "participant", personId: selectedRow.participantId, roomName: room.name, building: room.building, floor: room.floor, capacity: room.capacity }), `New room created and ${selectedRow.fullName} was assigned.`); } catch {}
  };

  const arrivalStatus = async (next, note = "") => {
    if (!selectedRow) return;
    try { await runMutation(selectedRow.participantId, () => setArrivalStatus(selectedRow.participantId, next, note || "Updated from Registration & Check-in desk"), `${selectedRow.fullName} is now ${next === "expected_later" ? "expected later" : next === "unknown" ? "marked for follow-up" : next === "confirmed_not_attending" ? "confirmed not attending" : "expected today"}.`); } catch {}
  };

  const openPerson = (row) => { setSelectedId(row.participantId); setError(""); };

  const filters = [
    ["all", "All", counts.all],
    ["expected", "Yet to arrive", counts.expected],
    ["ready", "Ready", counts.ready],
    ["arrived", "Checked in", counts.arrived],
    ["needs_help", "Needs help", counts.needs_help],
    ["on_site", "On-site", counts.on_site],
    ["not_attending", "Not attending", counts.not_attending],
  ];

  return <section className={`regjourney regjourney-${view}`}>
    {view === "desk" ? <article className="regjourney-hero">
      <div className="regjourney-hero-copy"><span className="kicker">Day-one registration</span><h2>Find the person. Resolve what matters. Check them in.</h2><p>One desk for the normal line and the exceptions. Registration Committee members can verify on-site additions, place participants, resolve housing, and finish check-in without sending the youth around the app.</p></div>
      <div className="regjourney-glance"><button type="button" onClick={() => setFilter("arrived")}><strong>{counts.arrived.toLocaleString()}</strong><span>checked in</span></button><button type="button" onClick={() => setFilter("expected")}><strong>{counts.expected.toLocaleString()}</strong><span>yet to arrive</span></button><button type="button" className={counts.needs_help ? "attention" : ""} onClick={() => setFilter("needs_help")}><strong>{counts.needs_help.toLocaleString()}</strong><span>need help</span></button></div>
    </article> : <div className="regjourney-roster-head"><div><span className="kicker">Session roster</span><h2>Everyone in one operational view</h2><p>Search the current registration list, arrivals and on-site additions without switching pages.</p></div><div><b>{counts.all.toLocaleString()}</b><span>current participants</span></div></div>}

    {message ? <MutationFeedback tone={message.tone}>{message.text}</MutationFeedback> : null}

    <article className="panel regjourney-worklist">
      <div className="regjourney-search-row" ref={searchRef}>
        <SearchField value={query} onChange={(value) => { setQuery(value); setShown(PAGE_SIZE); }} label={view === "desk" ? "Find participant" : "Search roster"} placeholder="Search name, FSY ID, ward/branch, stake, company or group" />
        {canManageRegistration ? <button type="button" className="secondary regjourney-onsite-button" onClick={() => { setOnsiteOpen(true); setError(""); }}><UserPlus />On-site registration</button> : null}
      </div>
      <div className="regjourney-filter-row" aria-label="Registration filters">
        <div className="regjourney-filter-scroll">{filters.map(([value, label, count]) => <button type="button" key={value} className={filter === value ? "active" : ""} aria-pressed={filter === value} onClick={() => { setFilter(value); setShown(PAGE_SIZE); }}><span>{label}</span><b>{count.toLocaleString()}</b></button>)}</div>
        {view === "roster" ? <select aria-label="Registration source" value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setShown(PAGE_SIZE); }}><option value="all">All sources</option><option value="official">Registration list</option><option value="on_site">On-site only</option></select> : null}
      </div>
      <div className="regjourney-result-line" role="status"><span><b>{Math.min(shown, filtered.length).toLocaleString()}</b> of {filtered.length.toLocaleString()} shown</span>{query ? <span>for “{query}”</span> : null}{filter !== (view === "desk" ? "expected" : "all") || sourceFilter !== "all" || query ? <button type="button" className="text-action" onClick={() => { setQuery(""); setFilter(view === "desk" ? "expected" : "all"); setSourceFilter("all"); }}>Clear filters</button> : null}</div>

      <div className="regjourney-list">
        {visible.map((row) => {
          const eligibility = eligibilityMap.get(row.participantId);
          const housing = housingByPerson.get(row.participantId);
          const problem = rowProblem(row, eligibility, housing, canHousing);
          const ready = isReady(row, eligibility, housing, canHousing);
          return <div className={`regjourney-row${problem ? " needs-help" : ""}${row.checkinStatus === "arrived" ? " arrived" : ""}`} key={row.participantId}>
            <button type="button" className="regjourney-person-button" onClick={() => openPerson(row)}>
              <span className="person-avatar">{initials(row.fullName)}</span>
              <span className="regjourney-person-copy"><b>{row.fullName}</b><small>{row.unit || "Unit not recorded"}{row.stake ? ` · ${row.stake}` : ""}</small><em>{displaySource(row)}{row.fsyId ? ` · ${row.fsyId}` : " · FSY ID pending"}</em></span>
            </button>
            <div className="regjourney-assignment"><span>{row.companyName || "No company"}</span><small>{row.groupName || "No counselor group"}</small></div>
            <div className="regjourney-status"><Status tone={problem ? "warn" : arrivalTone(row)}>{problem || arrivalLabel(row)}</Status></div>
            <div className="regjourney-row-action">{ready && canCheckin ? <button type="button" className="primary" disabled={busyId === row.participantId} onClick={() => checkIn(row)}>{busyId === row.participantId ? "Saving…" : "Check in"}<Check /></button> : problem && canManageRegistration ? <button type="button" className="secondary resolve" onClick={() => openPerson(row)}>Resolve & check in<ArrowRight /></button> : <button type="button" className="secondary" onClick={() => openPerson(row)}>View</button>}</div>
          </div>;
        })}
        {!visible.length && query.trim().length >= 2 ? <div className="regjourney-no-match"><MagnifyingGlass size={30}/><div><b>No match found for “{query}”</b><p>Try a shorter spelling or another detail. If the youth is genuinely missing, start the on-site journey here.</p></div>{canManageRegistration ? <button type="button" className="primary" onClick={() => { setOnsiteOpen(true); setError(""); }}>Start on-site registration<UserPlus /></button> : null}</div> : null}
        {!visible.length && query.trim().length < 2 ? <Empty icon={CheckCircle} title="Nothing needs attention in this view" text="Choose another filter or search for a participant." /> : null}
      </div>
      {filtered.length > shown ? <button type="button" className="secondary regjourney-show-more" onClick={() => setShown((value) => value + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, filtered.length - shown)} more</button> : null}
    </article>

    <DismissibleLayer open={onsiteOpen} onClose={() => { if (!busyId) { setOnsiteOpen(false); setError(""); } }} title="On-site registration" sheet className="regjourney-onsite-layer">
      <OnSiteDetails initialSearch={query} sessionStart={sessionStart} busy={busyId === "onsite-new"} error={error} onCreate={createOnsite} onCancel={() => setOnsiteOpen(false)} />
    </DismissibleLayer>

    <DismissibleLayer open={Boolean(selectedRow)} onClose={() => { if (!busyId) { setSelectedId(""); setError(""); } }} title={selectedRow ? selectedRow.fullName : "Participant"} sheet className="regjourney-person-layer">
      {selectedRow ? <PersonJourney
        row={selectedRow}
        eligibility={selectedEligibility}
        identityReadiness={identityReadiness}
        vacancies={vacancies}
        groups={groups}
        companies={companies}
        rooms={rooms}
        housingAssignment={selectedHousing}
        canManageRegistration={canManageRegistration}
        canHousing={canHousing}
        busy={busyId === selectedRow.participantId}
        error={error}
        onVerify={verifySelected}
        onAssignGroup={assignGroup}
        onUseVacancy={useVacancy}
        onAssignRoom={assignRoom}
        onCreateRoom={createRoom}
        onCheckin={() => checkIn(selectedRow)}
        onArrivalStatus={arrivalStatus}
      /> : null}
    </DismissibleLayer>
  </section>;
}
