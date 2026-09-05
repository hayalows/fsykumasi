import { useMemo, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { Check } from "@phosphor-icons/react/Check";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Funnel } from "@phosphor-icons/react/Funnel";
import { IdentificationCard } from "@phosphor-icons/react/IdentificationCard";
import { UsersThree } from "@phosphor-icons/react/UsersThree";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { Empty, MutationFeedback, Status } from "../components/UI.jsx";
import { NO_SHOW_CONFIRMATION_SOURCES } from "../lib/identity-arrival.js";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const EMPTY_FORM = {
  firstName: "", lastName: "", preferredName: "", sex: "Female", birthday: "",
  unit: "", stake: "", phone: "", guardianName: "", guardianPhone: "",
  tshirtSize: "", medicalInformation: "", dietaryInformation: "",
};

export function initials(name = "FSY") {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}
function sexValue(value) { return String(value || "").toLowerCase() === "female" ? "female" : "male"; }
export function arrivalLabel(row) {
  if (row.checkinStatus === "arrived") return "Checked in";
  if (row.attendanceStatus === "confirmed_not_attending") return "Not attending";
  if (row.attendanceStatus === "expected_later") return "Expected later";
  if (row.attendanceStatus === "unknown") return "Follow up";
  return "Yet to arrive";
}
export function arrivalTone(row) {
  if (row.checkinStatus === "arrived") return "good";
  if (row.attendanceStatus === "confirmed_not_attending") return "danger";
  if (row.attendanceStatus === "expected_later" || row.attendanceStatus === "unknown") return "warn";
  return "muted";
}
export function rowProblem(row, eligibility) {
  if (!row.isCurrent || row.attendanceStatus === "confirmed_not_attending" || row.checkinStatus === "arrived") return "";
  if (row.sourceKind === "on_site" && row.verificationStatus !== "verified") return "Needs verification";
  if (eligibility && !eligibility.eligible) return eligibility.reason || "Needs review";
  if (!row.groupName) return "Needs counselor group";
  if (row.attendanceStatus === "unknown") return "Needs follow-up";
  return "";
}
export function isReady(row, eligibility) { return row.isCurrent && row.attendanceStatus !== "confirmed_not_attending" && row.checkinStatus !== "arrived" && !rowProblem(row, eligibility); }
export function displaySource(row) { return row.sourceKind === "on_site" ? "On-site" : "Registration list"; }

function GroupPicker({ groups, companies, row, busy, onChoose }) {
  const companyById = useMemo(() => new Map(companies.map((item) => [item.id, item])), [companies]);
  const choices = useMemo(() => groups.filter((group) => sexValue(group.sex) === sexValue(row.sex)).sort((a, b) => Number(a.memberCount || 0) - Number(b.memberCount || 0) || collator.compare(a.name, b.name)), [groups, row.sex]);
  return <div className="regjourney-choice-list">
    {choices.slice(0, 20).map((group, index) => { const company = companyById.get(group.companyId); return <button type="button" key={group.id} className="regjourney-choice" disabled={busy} onClick={() => onChoose(group)}><span><b>{group.displayName || group.name}</b><small>{company?.name || "Company"} · {Number(group.memberCount || 0)} currently assigned</small></span><span className="regjourney-choice-end">{index === 0 ? <em>Suggested</em> : null}<ArrowRight /></span></button>; })}
    {!choices.length ? <Empty icon={UsersThree} title="No compatible counselor groups" text="Create or publish a compatible counselor group before continuing." /> : null}
  </div>;
}

export function OnSiteDetails({ initialSearch = "", sessionStart, busy, error, onCreate, onCancel }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, firstName: initialSearch.trim().split(/\s+/)[0] || "", lastName: initialSearch.trim().split(/\s+/).slice(1).join(" ") }));
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event) => { event.preventDefault(); onCreate(form); };
  return <form className="regjourney-onsite-form" onSubmit={submit}>
    <header className="regjourney-sheet-intro"><span className="kicker">On-site registration · Step 1 of 4</span><h2>Add the participant once</h2><p>Capture the details needed to identify and support this youth. Verification, placement and check-in stay in this same journey.</p></header>
    <div className="regjourney-form-grid two">
      <label>First name<input autoFocus required value={form.firstName} onChange={(e) => set("firstName", e.target.value)} /></label><label>Last name<input required value={form.lastName} onChange={(e) => set("lastName", e.target.value)} /></label><label>Preferred name <span>Optional</span><input value={form.preferredName} onChange={(e) => set("preferredName", e.target.value)} /></label><label>Sex<select value={form.sex} onChange={(e) => set("sex", e.target.value)}><option>Female</option><option>Male</option></select></label><label>Date of birth<input type="date" required max={sessionStart || undefined} value={form.birthday} onChange={(e) => set("birthday", e.target.value)} /></label><label>Ward / branch<input required value={form.unit} onChange={(e) => set("unit", e.target.value)} placeholder="e.g. Bantama Ward" /></label><label>Stake / district <span>Recommended</span><input value={form.stake} onChange={(e) => set("stake", e.target.value)} /></label><label>Participant phone <span>Optional if guardian phone is added</span><input inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></label><label>Parent / guardian name <span>Recommended</span><input value={form.guardianName} onChange={(e) => set("guardianName", e.target.value)} /></label><label>Parent / guardian phone<input inputMode="tel" value={form.guardianPhone} onChange={(e) => set("guardianPhone", e.target.value)} /></label>
    </div>
    <details className="regjourney-optional-details"><summary><span><b>Participant needs</b><small>T-shirt, medical and dietary information</small></span><span aria-hidden="true">+</span></summary><div className="regjourney-form-grid"><label>T-shirt size<input value={form.tshirtSize} onChange={(e) => set("tshirtSize", e.target.value)} placeholder="Optional" /></label><label>Medical information<textarea rows="2" value={form.medicalInformation} onChange={(e) => set("medicalInformation", e.target.value)} placeholder="Optional" /></label><label>Dietary information<textarea rows="2" value={form.dietaryInformation} onChange={(e) => set("dietaryInformation", e.target.value)} placeholder="Optional" /></label></div></details>
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
    <footer className="regjourney-sheet-actions"><button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button><button className="primary" disabled={busy || !form.firstName.trim() || !form.lastName.trim() || !form.birthday || !form.unit.trim() || (!form.phone.trim() && !form.guardianPhone.trim())}>{busy ? "Adding…" : "Add & continue"}<ArrowRight /></button></footer>
  </form>;
}

function ApprovalStep({ busy, error, onVerify }) {
  const [checks, setChecks] = useState({ terms: false, leader: false, payment: false });
  const complete = checks.terms && checks.leader && checks.payment;
  return <div className="regjourney-resolution-section"><div className="regjourney-section-head"><div><span className="kicker">On-site registration · Step 2 of 4</span><h3>Confirm the registration requirements</h3><p>Keep the participant with you until these checks are complete. The confirmations are recorded in the audit note.</p></div></div><div className="regjourney-checklist"><label><input type="checkbox" checked={checks.terms} onChange={(e) => setChecks({ ...checks, terms: e.target.checked })} /><span><b>Parent / guardian registration and terms are complete</b><small>Including the required consent or terms used for this session.</small></span></label><label><input type="checkbox" checked={checks.leader} onChange={(e) => setChecks({ ...checks, leader: e.target.checked })} /><span><b>Bishop or branch president approval is confirmed</b><small>The youth has approval to attend this FSY session.</small></span></label><label><input type="checkbox" checked={checks.payment} onChange={(e) => setChecks({ ...checks, payment: e.target.checked })} /><span><b>Payment information has been checked</b><small>Confirm the applicable session payment requirement has been resolved.</small></span></label></div>{error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}<button type="button" className="primary regjourney-step-primary" disabled={busy || !complete} onClick={() => onVerify("On-site registration verified by Registration Committee: parent/guardian terms confirmed; bishop/branch president approval confirmed; payment information checked.")}>{busy ? "Verifying…" : "Verify & continue"}<ArrowRight /></button></div>;
}

function VacancyPicker({ vacancies, row, busy, onChoose }) {
  const compatible = vacancies.filter((item) => sexValue(item.sex) === sexValue(row.sex));
  return <div className="regjourney-resolution-section"><div className="regjourney-section-head"><div><span className="kicker">On-site registration · Step 3 of 4</span><h3>Use an available roster place</h3><p>FSY IDs are finalized, so this participant needs a confirmed vacancy. The original participant stays in the audit history.</p></div></div><div className="regjourney-choice-list">{compatible.map((vacancy) => <button type="button" className="regjourney-choice" key={vacancy.participantId} disabled={busy} onClick={() => onChoose(vacancy)}><span><b>{vacancy.companyName} · {vacancy.groupName}</b><small>Available from {vacancy.fullName} · {vacancy.fsyId}</small></span><span className="regjourney-choice-end"><b>Slot {String(vacancy.slotNumber || "").padStart(2, "0")}</b><ArrowRight /></span></button>)}{!compatible.length ? <Empty icon={IdentificationCard} title="No compatible confirmed vacancy" text="Keep this participant in Needs attention until a confirmed no-show creates a compatible roster place." /> : null}</div></div>;
}

function HousingHandoff({ row, assignment }) {
  if (row.checkinStatus !== "arrived") return null;
  if (assignment) return <div className="regjourney-handoff complete"><CheckCircle weight="fill"/><div><span className="kicker">Housing</span><b>{assignment.roomName}</b><p>Housing has assigned this participant{assignment.bedLabel ? ` · Bed / key ${assignment.bedLabel}` : ""}.</p></div></div>;
  return <div className="regjourney-handoff waiting"><ArrowRight/><div><span className="kicker">Automatic handoff</span><b>Waiting for Housing</b><p>Check-in is complete. This participant now appears automatically in Housing's <strong>Arrivals waiting</strong> queue. Registration does not need to assign the room.</p></div></div>;
}

export function PersonJourney({ row, eligibility, identityReadiness, vacancies, groups, companies, housingAssignment, canManageRegistration, busy, error, onVerify, onAssignGroup, onUseVacancy, onCheckin, onArrivalStatus, onDone }) {
  const [noShowOpen, setNoShowOpen] = useState(false);
  const [confirmationSource, setConfirmationSource] = useState("");
  const [confirmationNote, setConfirmationNote] = useState("");
  const problem = rowProblem(row, eligibility);
  const finalized = Number(identityReadiness?.finalizedIds || 0) > 0;
  const onsitePending = row.sourceKind === "on_site" && row.verificationStatus !== "verified";
  const needsPlacement = row.isCurrent && row.verificationStatus === "verified" && !row.groupName;
  const ready = isReady(row, eligibility);
  const housingText = housingAssignment?.roomName || (row.checkinStatus === "arrived" ? "Waiting for Housing" : "After check-in");
  return <div className="regjourney-person-flow">
    <header className="regjourney-person-header"><span className="person-avatar large">{initials(row.fullName)}</span><div><span className="kicker">{row.sourceKind === "on_site" ? "On-site participant" : "Participant"}</span><h2>{row.fullName}</h2><p>{row.unit || "Unit not recorded"}{row.stake ? ` · ${row.stake}` : ""}</p></div><Status tone={problem ? "warn" : arrivalTone(row)}>{problem || arrivalLabel(row)}</Status></header>
    <div className="regjourney-person-facts"><div><span>FSY ID</span><b>{row.fsyId || "Pending"}</b></div><div><span>Company</span><b>{row.companyName || "Not assigned"}</b></div><div><span>Counselor group</span><b>{row.groupName || "Not assigned"}</b></div><div><span>Housing</span><b>{housingText}</b></div></div>
    <div className="regjourney-progress" aria-label="Participant readiness"><span className="done"><i><Check /></i><b>Registration</b></span><span className={row.verificationStatus === "verified" ? "done" : "current"}><i>{row.verificationStatus === "verified" ? <Check /> : "2"}</i><b>Verify</b></span><span className={row.groupName ? "done" : row.verificationStatus === "verified" ? "current" : ""}><i>{row.groupName ? <Check /> : "3"}</i><b>Placement</b></span><span className={row.checkinStatus === "arrived" ? "done" : ready ? "current" : ""}><i>{row.checkinStatus === "arrived" ? <Check /> : "4"}</i><b>Check in</b></span></div>
    {row.checkinStatus === "arrived" ? <><div className="regjourney-complete"><CheckCircle weight="fill"/><div><b>Check-in complete</b><p>{row.fullName} is recorded as arrived.</p></div></div><HousingHandoff row={row} assignment={housingAssignment} /><div className="regjourney-done-actions"><button type="button" className="primary" onClick={onDone}>Done · next participant</button></div></> : null}
    {onsitePending && canManageRegistration ? <ApprovalStep busy={busy} error={error} onVerify={onVerify} /> : null}
    {!onsitePending && needsPlacement && canManageRegistration ? (finalized && row.sourceKind === "on_site" ? <VacancyPicker vacancies={vacancies} row={row} busy={busy} onChoose={onUseVacancy} /> : <div className="regjourney-resolution-section"><div className="regjourney-section-head"><div><span className="kicker">{row.sourceKind === "on_site" ? "On-site registration · Step 3 of 4" : "Placement"}</span><h3>Choose the counselor group</h3><p>The company follows the counselor group automatically. Suggested groups with fewer people appear first.</p></div></div><GroupPicker groups={groups} companies={companies} row={row} busy={busy} onChoose={onAssignGroup} /></div>) : null}
    {!onsitePending && !needsPlacement && ready ? <div className="regjourney-ready-panel"><div><CheckCircle weight="fill"/><span><b>{row.sourceKind === "on_site" ? "Step 4 of 4 · Ready to check in" : "Ready to check in"}</b><small>{row.companyName} · {row.groupName}</small></span></div><button type="button" className="primary" disabled={busy} onClick={onCheckin}>{busy ? "Saving…" : "Complete check-in"}<Check /></button></div> : null}
    {!onsitePending && !needsPlacement && !ready && row.checkinStatus !== "arrived" && problem ? <div className="regjourney-blocked"><WarningCircle/><div><b>{problem}</b><p>This record still has an eligibility issue that cannot safely be bypassed from check-in.</p></div></div> : null}
    {row.checkinStatus !== "arrived" ? <details className="regjourney-secondary-actions"><summary><span><b>Arrival & other actions</b><small>Use only when this participant is not checking in now</small></span><span aria-hidden="true">+</span></summary><div className="regjourney-secondary-grid">{row.attendanceStatus !== "expected" ? <button type="button" className="secondary" disabled={busy} onClick={() => onArrivalStatus("expected")}>Expected today</button> : null}{row.attendanceStatus !== "expected_later" ? <button type="button" className="secondary" disabled={busy} onClick={() => onArrivalStatus("expected_later")}>Expected later</button> : null}{row.attendanceStatus !== "unknown" ? <button type="button" className="secondary" disabled={busy} onClick={() => onArrivalStatus("unknown")}>Needs follow-up</button> : null}{canManageRegistration && row.attendanceStatus !== "confirmed_not_attending" ? <button type="button" className="secondary danger-subtle" disabled={busy} onClick={() => setNoShowOpen((open) => !open)}>Confirm not attending</button> : null}</div>{noShowOpen && row.attendanceStatus !== "confirmed_not_attending" ? <div className="regjourney-noshow-inline"><div><b>Confirm only from an authorized source</b><p>This keeps the original participant in history and can make a finalized roster place available to a verified on-site participant.</p></div><label>Who confirmed this?<select value={confirmationSource} onChange={(event) => setConfirmationSource(event.target.value)}><option value="">Choose source</option>{NO_SHOW_CONFIRMATION_SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}</select></label><label>Short note <span>{confirmationSource === "Other authorized confirmation" ? "Required" : "Optional"}</span><textarea rows="2" value={confirmationNote} onChange={(event) => setConfirmationNote(event.target.value)} placeholder="e.g. Parent confirmed by phone at 8:15 AM" /></label><button type="button" className="danger-button" disabled={busy || !confirmationSource || (confirmationSource === "Other authorized confirmation" && !confirmationNote.trim())} onClick={() => onArrivalStatus("confirmed_not_attending", confirmationNote.trim() ? `${confirmationSource}: ${confirmationNote.trim()}` : confirmationSource)}>Confirm not attending</button></div> : null}</details> : null}
    {error && !onsitePending ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
  </div>;
}

export function DeskFilters({ filter, setFilter, counts }) {
  const primary = [["ready", "Ready to check in", counts.ready], ["arrived", "Checked in", counts.arrived], ["needs_help", "Needs attention", counts.needs_help]];
  const secondary = [["expected", "Yet to arrive", counts.expected], ["on_site", "On-site", counts.on_site], ["not_attending", "Not attending", counts.not_attending], ["all", "Everyone", counts.all]];
  const secondaryActive = secondary.some(([value]) => value === filter);
  return <div className="regjourney-filter-system"><div className="regjourney-primary-filter" role="group" aria-label="Check-in status">{primary.map(([value, label, count]) => <button type="button" key={value} className={filter === value ? "active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}><span>{label}</span><b>{count.toLocaleString()}</b></button>)}</div><details className={`regjourney-more-filters${secondaryActive ? " active" : ""}`}><summary><Funnel /><span>{secondaryActive ? secondary.find(([value]) => value === filter)?.[1] : "More"}</span></summary><div>{secondary.map(([value, label, count]) => <button type="button" key={value} className={filter === value ? "active" : ""} onClick={(event) => { setFilter(value); event.currentTarget.closest("details")?.removeAttribute("open"); }}><span>{label}</span><b>{count.toLocaleString()}</b></button>)}</div></details></div>;
}
