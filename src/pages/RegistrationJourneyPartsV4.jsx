import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { Check } from "@phosphor-icons/react/Check";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Funnel } from "@phosphor-icons/react/Funnel";
import { IdentificationCard } from "@phosphor-icons/react/IdentificationCard";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { UsersThree } from "@phosphor-icons/react/UsersThree";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { Empty, MutationFeedback, Status } from "../components/UI.jsx";
import { NO_SHOW_CONFIRMATION_SOURCES } from "../lib/identity-arrival.js";
import { uniqueUnitMatch } from "../lib/registration-lookup.js";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const EMPTY_FORM = {
  firstName: "", lastName: "", preferredName: "", sex: "Female", birthday: "",
  unit: "", stake: "", phone: "", guardianName: "", guardianPhone: "",
  tshirtSize: "", medicalInformation: "", dietaryInformation: "",
};

export function initials(name = "FSY") {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function sexValue(value) {
  return String(value || "").toLowerCase() === "female" ? "female" : "male";
}

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
  if (row.sourceKind === "on_site" && row.verificationStatus === "verified" && !row.fsyId) return "Needs FSY ID";
  if (row.attendanceStatus === "unknown") return "Needs follow-up";
  return "";
}

export function isReady(row, eligibility) {
  return row.isCurrent
    && row.attendanceStatus !== "confirmed_not_attending"
    && row.checkinStatus !== "arrived"
    && !rowProblem(row, eligibility);
}

export function displaySource(row) {
  return row.sourceKind === "on_site" ? "On-site" : "Registration list";
}

function LayerCloseButton({ onClose }) {
  if (!onClose) return null;
  return <button type="button" className="regjourney-layer-close" onClick={onClose} aria-label="Close"><X size={19} /></button>;
}

function GroupPicker({ groups, companies, row, busy, onChoose }) {
  const [query, setQuery] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(6);
  const companyById = useMemo(() => new Map(companies.map((item) => [item.id, item])), [companies]);
  const choices = useMemo(() => groups
    .filter((group) => sexValue(group.sex) === sexValue(row.sex))
    .sort((a, b) => Number(a.memberCount || 0) - Number(b.memberCount || 0) || collator.compare(a.name, b.name)), [groups, row.sex]);
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return choices;
    return choices.filter((group) => {
      const company = companyById.get(group.companyId);
      return `${group.displayName || group.name} ${company?.displayName || company?.name || ""}`.toLowerCase().includes(text);
    });
  }, [choices, companyById, query]);
  const visible = filtered.slice(0, visibleLimit);

  return <div className="regjourney-group-picker">
    {choices.length > 6 ? <label className="regjourney-inline-search"><span className="sr-only">Find counselor group</span><MagnifyingGlass aria-hidden="true" /><input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleLimit(6); }} placeholder="Find a counselor group or company" /></label> : null}
    <div className="regjourney-choice-list">
      {visible.map((group, index) => {
        const company = companyById.get(group.companyId);
        return <button type="button" key={group.id} className="regjourney-choice" disabled={busy} onClick={() => onChoose(group)}>
          <span><b>{group.displayName || group.name}</b><small>{company?.displayName || company?.name || "Company"} · {Number(group.memberCount || 0)} currently assigned</small></span>
          <span className="regjourney-choice-end">{!query.trim() && index === 0 ? <em>Best fit</em> : null}<ArrowRight /></span>
        </button>;
      })}
      {!visible.length ? <Empty icon={UsersThree} title="No matching counselor groups" text="Try another group or company name." /> : null}
    </div>
    {filtered.length > visible.length ? <button type="button" className="text-action regjourney-show-groups" onClick={() => setVisibleLimit((value) => value + 14)}>Show {Math.min(14, filtered.length - visible.length)} more groups</button> : null}
  </div>;
}

function UnitCombobox({ value, stake, options = [], onChange, onStakeChange }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const blurTimer = useRef(null);
  const listId = useId();
  useEffect(() => () => window.clearTimeout(blurTimer.current), []);
  const normalized = value.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!normalized) return [];
    const ranked = options.map((option) => {
      const unit = option.unit.toLowerCase();
      const starts = unit.startsWith(normalized);
      const contains = unit.includes(normalized);
      return { option, score: starts ? 0 : contains ? 1 : 2 };
    }).filter((item) => item.score < 2).sort((a, b) => a.score - b.score || collator.compare(a.option.unit, b.option.unit));
    return ranked.slice(0, 8).map((item) => item.option);
  }, [normalized, options]);
  const exact = useMemo(() => uniqueUnitMatch(options, value), [normalized, options]);

  const choose = (option) => {
    onChange(option.unit);
    onStakeChange(option.stake || "");
    setOpen(false);
    setActiveIndex(0);
  };
  const handleChange = (nextValue) => {
    onChange(nextValue);
    const nextExact = uniqueUnitMatch(options, nextValue);
    if (nextExact?.stake) onStakeChange(nextExact.stake);
    else if (value.trim().toLowerCase() !== nextValue.trim().toLowerCase()) onStakeChange("");
    setOpen(Boolean(nextValue.trim()));
    setActiveIndex(0);
  };
  const handleKeyDown = (event) => {
    if (!open || !matches.length) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => (index + 1) % matches.length); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => (index - 1 + matches.length) % matches.length); }
    if (event.key === "Enter") { event.preventDefault(); if (matches[activeIndex]) choose(matches[activeIndex]); }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); }
  };

  return <div className="regjourney-unit-field">
    <div className="regjourney-combobox">
      <MagnifyingGlass aria-hidden="true" />
      <input
        required
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        onFocus={() => { if (value.trim()) setOpen(true); }}
        onBlur={() => { blurTimer.current = window.setTimeout(() => setOpen(false), 120); }}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-label="Ward / branch"
        aria-expanded={open && Boolean(matches.length)}
        aria-haspopup="listbox"
        aria-activedescendant={open && matches[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        aria-autocomplete="list"
        aria-controls={open && matches.length ? listId : undefined}
        placeholder="Start typing a ward or branch"
        autoComplete="off"
      />
      {open && matches.length ? <div id={listId} className="regjourney-unit-options" role="listbox">
        {matches.map((option, index) => <button type="button" role="option" tabIndex={-1} id={`${listId}-${index}`} aria-selected={index === activeIndex} className={index === activeIndex ? "active" : ""} key={`${option.unit}-${option.stake}`} onMouseDown={(event) => event.preventDefault()} onClick={() => { if (blurTimer.current) window.clearTimeout(blurTimer.current); choose(option); }}><span><b>{option.unit}</b>{option.stake ? <small>{option.stake}</small> : null}</span><ArrowRight /></button>)}
      </div> : null}
    </div>
    <small className={`regjourney-field-note${exact?.stake && exact.stake === stake ? " matched" : ""}`}>{exact?.stake && exact.stake === stake ? `Stake / district filled automatically · ${stake}` : "Search the session directory. You can still type a new unit if it is not listed."}</small>
  </div>;
}

export function OnSiteDetails({ initialSearch = "", sessionStart, unitDirectory = [], busy, error, onCreate, onCancel, onClose }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, firstName: initialSearch.trim().split(/\s+/)[0] || "", lastName: initialSearch.trim().split(/\s+/).slice(1).join(" ") }));
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event) => { event.preventDefault(); onCreate(form); };

  return <form className="regjourney-onsite-form regjourney-onsite-form-v3" onSubmit={submit}>
    <header className="regjourney-sheet-intro regjourney-sheet-intro-v3"><div><span className="kicker">On-site registration · Step 1 of 4</span><h2>Add participant</h2><p>Start with the essentials. Verification, placement and identity come next.</p></div><LayerCloseButton onClose={onClose} /></header>

    <section className="regjourney-form-section"><div className="regjourney-form-section-head"><h3>Identity</h3><span>Required details</span></div><div className="regjourney-form-grid two">
      <label>First name<input data-layer-autofocus required autoComplete="given-name" spellCheck="false" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} /></label>
      <label>Last name<input required autoComplete="family-name" spellCheck="false" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} /></label>
      <label>Preferred name <span>Optional</span><input autoComplete="off" spellCheck="false" value={form.preferredName} onChange={(e) => set("preferredName", e.target.value)} /></label>
      <label>Sex<select value={form.sex} onChange={(e) => set("sex", e.target.value)}><option>Female</option><option>Male</option></select></label>
      <label className="regjourney-span-2">Date of birth<input type="date" required autoComplete="bday" max={sessionStart || undefined} value={form.birthday} onChange={(e) => set("birthday", e.target.value)} /></label>
    </div></section>

    <section className="regjourney-form-section"><div className="regjourney-form-section-head"><h3>Church unit</h3><span>Stake / district can fill itself</span></div><div className="regjourney-form-grid two">
      <label className="regjourney-span-2">Ward / branch<UnitCombobox value={form.unit} stake={form.stake} options={unitDirectory} onChange={(value) => set("unit", value)} onStakeChange={(value) => set("stake", value)} /></label>
      <label className="regjourney-span-2">Stake / district <span>Used to create the FSY ID</span><input value={form.stake} onChange={(e) => set("stake", e.target.value)} placeholder="Will fill from the ward / branch when available" /></label>
    </div></section>

    <section className="regjourney-form-section"><div className="regjourney-form-section-head"><h3>Contact</h3><span>One phone number is enough to continue</span></div><div className="regjourney-form-grid two">
      <label>Participant phone <span>Optional if guardian phone is added</span><input type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></label>
      <label>Parent / guardian phone<input type="tel" inputMode="tel" value={form.guardianPhone} onChange={(e) => set("guardianPhone", e.target.value)} /></label>
      <label className="regjourney-span-2">Parent / guardian name <span>Recommended</span><input autoComplete="name" spellCheck="false" value={form.guardianName} onChange={(e) => set("guardianName", e.target.value)} /></label>
    </div></section>

    <details className="regjourney-optional-details"><summary><span><b>Participant needs</b><small>T-shirt, medical and dietary information</small></span><span aria-hidden="true">+</span></summary><div className="regjourney-form-grid"><label>T-shirt size<input value={form.tshirtSize} onChange={(e) => set("tshirtSize", e.target.value)} placeholder="Optional" /></label><label>Medical information<textarea rows="2" value={form.medicalInformation} onChange={(e) => set("medicalInformation", e.target.value)} placeholder="Optional" /></label><label>Dietary information<textarea rows="2" value={form.dietaryInformation} onChange={(e) => set("dietaryInformation", e.target.value)} placeholder="Optional" /></label></div></details>
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
    <footer className="regjourney-sheet-actions"><button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button><button className="primary" disabled={busy || !form.firstName.trim() || !form.lastName.trim() || !form.birthday || !form.unit.trim() || (!form.phone.trim() && !form.guardianPhone.trim())}>{busy ? "Adding…" : "Add & continue"}<ArrowRight /></button></footer>
  </form>;
}

function ApprovalStep({ busy, error, onVerify }) {
  const [checks, setChecks] = useState({ terms: false, leader: false, payment: false });
  const complete = checks.terms && checks.leader && checks.payment;
  return <div className="regjourney-resolution-section"><div className="regjourney-section-head"><div><span className="kicker">On-site registration · Step 2 of 4</span><h3>Verify registration</h3><p>Confirm the three checks below, then continue.</p></div></div><div className="regjourney-checklist"><label><input type="checkbox" checked={checks.terms} onChange={(e) => setChecks({ ...checks, terms: e.target.checked })} /><span><b>Parent / guardian terms confirmed</b><small>Required consent or registration terms are complete.</small></span></label><label><input type="checkbox" checked={checks.leader} onChange={(e) => setChecks({ ...checks, leader: e.target.checked })} /><span><b>Bishop or branch president approval confirmed</b><small>The youth has approval to attend this session.</small></span></label><label><input type="checkbox" checked={checks.payment} onChange={(e) => setChecks({ ...checks, payment: e.target.checked })} /><span><b>Payment checked</b><small>The applicable session payment requirement is resolved.</small></span></label></div>{error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}<button type="button" className="primary regjourney-step-primary" disabled={busy || !complete} onClick={() => onVerify("On-site registration verified by Registration Committee: parent/guardian terms confirmed; bishop/branch president approval confirmed; payment information checked.")}>{busy ? "Verifying…" : "Verify & continue"}<ArrowRight /></button></div>;
}

function VacancyOptions({ vacancies, row, busy, onChoose }) {
  const compatible = vacancies.filter((item) => sexValue(item.sex) === sexValue(row.sex));
  if (!compatible.length) return null;
  return <details className="regjourney-vacancy-option"><summary><span><b>Use a confirmed vacancy instead</b><small>Optional. Use this when a confirmed non-attendee is being replaced.</small></span><span aria-hidden="true">+</span></summary><div className="regjourney-choice-list">{compatible.map((vacancy) => <button type="button" className="regjourney-choice" key={vacancy.participantId} disabled={busy} onClick={() => onChoose(vacancy)}><span><b>{vacancy.companyName} · {vacancy.groupName}</b><small>Vacancy confirmed from {vacancy.fullName}. Their old badge stays in the audit history.</small></span><span className="regjourney-choice-end"><ArrowRight /></span></button>)}</div></details>;
}

function CompletionState({ row, assignment, onDone }) {
  return <div className="regjourney-completion-state"><div className="regjourney-completion-card"><CheckCircle weight="fill"/><div><span className="kicker">Check-in complete</span><h3>{row.fullName} has arrived</h3><p>{assignment ? `Housing · ${assignment.roomName}${assignment.bedLabel ? ` · Bed / key ${assignment.bedLabel}` : ""}` : "Sent automatically to Housing · Waiting for room assignment"}</p></div></div><button type="button" className="primary regjourney-next-person" onClick={onDone}>Done · next participant<ArrowRight /></button></div>;
}

export function PersonJourney({ row, eligibility, identityReadiness, vacancies, groups, companies, housingAssignment, canManageRegistration, busy, error, onVerify, onAssignGroup, onUseVacancy, onCheckin, onArrivalStatus, onDone, onClose }) {
  const [noShowOpen, setNoShowOpen] = useState(false);
  const [confirmationSource, setConfirmationSource] = useState("");
  const [confirmationNote, setConfirmationNote] = useState("");
  const problem = rowProblem(row, eligibility);
  const finalized = Number(identityReadiness?.finalizedIds || 0) > 0;
  const onsitePending = row.sourceKind === "on_site" && row.verificationStatus !== "verified";
  const placementAllowed = !eligibility || eligibility.eligible;
  const needsPlacement = row.isCurrent && row.verificationStatus === "verified" && !row.groupName && placementAllowed;
  const ready = isReady(row, eligibility);
  const housingText = housingAssignment?.roomName || (row.checkinStatus === "arrived" ? "Waiting for Housing" : "After check-in");

  return <div className="regjourney-person-flow regjourney-person-flow-v3 regjourney-person-flow-v4">
    <header className="regjourney-person-header"><span className="person-avatar large">{initials(row.fullName)}</span><div><span className="kicker">{row.sourceKind === "on_site" ? "On-site participant" : "Participant"}</span><h2>{row.fullName}</h2><p>{row.unit || "Unit not recorded"}{row.stake ? ` · ${row.stake}` : ""}</p></div><Status tone={problem ? "warn" : arrivalTone(row)}>{problem || arrivalLabel(row)}</Status><LayerCloseButton onClose={onClose} /></header>

    <div className="regjourney-person-facts"><div><span>FSY ID</span><b>{row.fsyId || "Pending"}</b></div><div><span>Company</span><b>{row.companyName || "Not assigned"}</b></div><div><span>Counselor group</span><b>{row.groupName || "Not assigned"}</b></div><div><span>Housing</span><b>{housingText}</b></div></div>

    {row.checkinStatus !== "arrived" ? <div className="regjourney-progress" aria-label="Participant readiness"><span className="done"><i><Check /></i><b>Registration</b></span><span className={row.verificationStatus === "verified" ? "done" : "current"}><i>{row.verificationStatus === "verified" ? <Check /> : "2"}</i><b>Verify</b></span><span className={row.groupName && (row.sourceKind !== "on_site" || row.fsyId) ? "done" : row.verificationStatus === "verified" && placementAllowed ? "current" : ""}><i>{row.groupName && (row.sourceKind !== "on_site" || row.fsyId) ? <Check /> : "3"}</i><b>Placement + ID</b></span><span className={ready ? "current" : ""}><i>4</i><b>Check in</b></span></div> : null}

    {row.checkinStatus === "arrived" ? <CompletionState row={row} assignment={housingAssignment} onDone={onDone} /> : null}
    {onsitePending && canManageRegistration ? <ApprovalStep busy={busy} error={error} onVerify={onVerify} /> : null}

    {!onsitePending && needsPlacement && canManageRegistration ? <div className="regjourney-resolution-section regjourney-placement-id"><div className="regjourney-section-head"><div><span className="kicker">{row.sourceKind === "on_site" ? "On-site registration · Step 3 of 4" : "Placement"}</span><h3>{row.sourceKind === "on_site" ? "Choose placement" : "Choose a counselor group"}</h3><p>{row.sourceKind === "on_site" ? "Choose the counselor group. The company follows it, and the FSY ID is created automatically from the company and Stake or District." : "Best-fit groups appear first. The company follows the group automatically."}</p></div></div><GroupPicker groups={groups} companies={companies} row={row} busy={busy} onChoose={onAssignGroup} />{finalized && row.sourceKind === "on_site" ? <VacancyOptions vacancies={vacancies} row={row} busy={busy} onChoose={onUseVacancy} /> : null}</div> : null}

    {!onsitePending && !needsPlacement && ready ? <div className="regjourney-ready-panel"><div><CheckCircle weight="fill"/><span><b>{row.sourceKind === "on_site" ? "Step 4 of 4 · Ready to check in" : "Ready to check in"}</b><small>{[row.fsyId, row.companyName, row.groupName].filter(Boolean).join(" · ")}</small></span></div><button type="button" className="primary" disabled={busy} onClick={onCheckin}>{busy ? "Saving…" : "Complete check-in"}<Check /></button></div> : null}

    {!onsitePending && !needsPlacement && !ready && row.checkinStatus !== "arrived" && problem ? <div className="regjourney-blocked"><WarningCircle/><div><b>{problem}</b><p>{problem === "Needs FSY ID" ? "The participant cannot check in until identity is complete. Review their Stake or District and placement." : "Resolve this eligibility issue before placement or check-in."}</p></div></div> : null}

    {row.checkinStatus !== "arrived" ? <details className="regjourney-secondary-actions"><summary><span><b>Not checking in now?</b><small>Update the arrival status only when needed</small></span><span aria-hidden="true">+</span></summary><div className="regjourney-secondary-grid">{row.attendanceStatus !== "expected" ? <button type="button" className="secondary" disabled={busy} onClick={() => onArrivalStatus("expected")}>Expected today</button> : null}{row.attendanceStatus !== "expected_later" ? <button type="button" className="secondary" disabled={busy} onClick={() => onArrivalStatus("expected_later")}>Expected later</button> : null}{row.attendanceStatus !== "unknown" ? <button type="button" className="secondary" disabled={busy} onClick={() => onArrivalStatus("unknown")}>Needs follow-up</button> : null}{canManageRegistration && row.attendanceStatus !== "confirmed_not_attending" ? <button type="button" className="secondary danger-subtle" disabled={busy} onClick={() => setNoShowOpen((open) => !open)}>Confirm not attending</button> : null}</div>{noShowOpen && row.attendanceStatus !== "confirmed_not_attending" ? <div className="regjourney-noshow-inline"><div><b>Confirm only from an authorized source</b><p>This can make a finalized roster place available to a verified on-site participant.</p></div><label>Who confirmed this?<select value={confirmationSource} onChange={(event) => setConfirmationSource(event.target.value)}><option value="">Choose source</option>{NO_SHOW_CONFIRMATION_SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}</select></label><label>Short note <span>{confirmationSource === "Other authorized confirmation" ? "Required" : "Optional"}</span><textarea rows="2" value={confirmationNote} onChange={(event) => setConfirmationNote(event.target.value)} placeholder="e.g. Parent confirmed by phone at 8:15 AM" /></label><button type="button" className="danger-button" disabled={busy || !confirmationSource || (confirmationSource === "Other authorized confirmation" && !confirmationNote.trim())} onClick={() => onArrivalStatus("confirmed_not_attending", confirmationNote.trim() ? `${confirmationSource}: ${confirmationNote.trim()}` : confirmationSource)}>Confirm not attending</button></div> : null}</details> : null}
    {error && !onsitePending ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
  </div>;
}

export function DeskFilters({ filter, setFilter, counts }) {
  const primary = [["ready", "Ready", counts.ready], ["needs_help", "Needs attention", counts.needs_help], ["arrived", "Checked in", counts.arrived]];
  const secondary = [["expected", "Yet to arrive", counts.expected], ["on_site", "On-site", counts.on_site], ["not_attending", "Not attending", counts.not_attending], ["all", "Everyone", counts.all]];
  const secondaryActive = secondary.some(([value]) => value === filter);
  return <div className="regjourney-filter-system"><div className="regjourney-primary-filter" role="group" aria-label="Check-in status">{primary.map(([value, label, count]) => <button type="button" key={value} className={filter === value ? "active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}><span>{label}</span><b>{count.toLocaleString()}</b></button>)}</div><details className={`regjourney-more-filters${secondaryActive ? " active" : ""}`}><summary><Funnel /><span>{secondaryActive ? secondary.find(([value]) => value === filter)?.[1] : "More"}</span></summary><div>{secondary.map(([value, label, count]) => <button type="button" key={value} className={filter === value ? "active" : ""} onClick={(event) => { setFilter(value); event.currentTarget.closest("details")?.removeAttribute("open"); }}><span>{label}</span><b>{count.toLocaleString()}</b></button>)}</div></details></div>;
}
