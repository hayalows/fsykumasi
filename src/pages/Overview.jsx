import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { Bed } from "@phosphor-icons/react/Bed";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { Cake } from "@phosphor-icons/react/Cake";
import { Check } from "@phosphor-icons/react/Check";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { CloudArrowUp } from "@phosphor-icons/react/CloudArrowUp";
import { FirstAidKit } from "@phosphor-icons/react/FirstAidKit";
import { ForkKnife } from "@phosphor-icons/react/ForkKnife";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { Users } from "@phosphor-icons/react/Users";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { setupSteps } from "../data/demo.js";
import { formatCount } from "../lib/cohort.js";
import "./overview-v2.css";

const BASE_OPERATIONAL = new Set(["assistant_coordinator", "coordinator", "logistics_admin", "session_director"]);
function has(capabilities, key) { return Array.isArray(capabilities) && capabilities.includes(key); }
function pct(value, total) { return total > 0 ? Math.max(0, Math.min(100, Math.round((value / total) * 100))) : 0; }

export function Overview({ setActive, imported = [], allParticipants = [], cohort, assignment, pendingAccess, birthdays = [], live = false, companies = [], checkedCount = 0, sessionName, capabilities = [], fieldSummary = {} }) {
  const hasParticipants = allParticipants.length > 0 || imported.length > 0;
  const hasGroups = Boolean(assignment?.groups?.length);
  const hasCompanies = companies.length > 0 || Boolean(assignment?.companies?.length);
  const participantCount = live ? (cohort?.eligible ?? imported.length) : (cohort?.eligible || imported.length || 1640);
  const registrationRecords = cohort?.records ?? allParticipants.length ?? imported.length;
  const reviewCount = cohort?.reviewExceptions || 0;
  const unassignedCount = cohort?.unassigned || 0;
  const stillExpected = Math.max(0, participantCount - checkedCount);
  const checkinProgress = pct(checkedCount, participantCount);
  const birthdayPending = birthdays.filter((person) => !person.acknowledged).length;

  const canRegistration = has(capabilities, "registration_view") || has(capabilities, "registration_manage");
  const canCheckin = has(capabilities, "checkin_record") || canRegistration;
  const canGroups = has(capabilities, "groups_view");
  const canHousing = has(capabilities, "housing_view");
  const canWellness = has(capabilities, "wellness_private") || has(capabilities, "wellness_status");
  const canFood = has(capabilities, "food_view") || has(capabilities, "meal_attendance_view");
  const canAccess = has(capabilities, "access_admin");
  const broadOps = [canRegistration, canHousing, canWellness, canFood, canAccess].filter(Boolean).length >= 3;

  const actions = [];
  if (canRegistration) actions.push({ id: "registration", Icon: CloudArrowUp, label: "Registration & check-in", title: !hasParticipants ? "Import the registration list" : reviewCount ? `${formatCount(reviewCount)} records need review` : stillExpected ? `${formatCount(stillExpected)} participants still expected` : "Registration is up to date", detail: !hasParticipants ? "Start with the approved session export." : reviewCount ? "Resolve registration exceptions before they slow down arrival." : stillExpected ? `${formatCount(checkedCount)} checked in so far.` : "Everyone in the current roster has been processed.", urgent: !hasParticipants || reviewCount > 0, cta: !hasParticipants ? "Open registration" : "Open check-in desk" });
  else if (canCheckin) actions.push({ id: "checkin", Icon: CheckCircle, label: "Check-in", title: stillExpected ? `${formatCount(stillExpected)} participants still expected` : "Check-in is clear", detail: `${formatCount(checkedCount)} of ${formatCount(participantCount)} checked in.`, urgent: stillExpected > 0, cta: "Open check-in" });

  if (canGroups) actions.push({ id: "groups", Icon: Buildings, label: "Groups & companies", title: !hasGroups ? "Build groups and companies" : unassignedCount ? `${formatCount(unassignedCount)} youth need placement` : "Grouping is ready", detail: !hasGroups ? "Create the structure before arrival work begins." : unassignedCount ? "Place the remaining eligible youth." : `${assignment?.groups?.length || 0} counselor groups are published.`, urgent: !hasGroups || unassignedCount > 0, cta: "Open groups" });
  if (canHousing) actions.push({ id: "housing", Icon: Bed, label: "Housing", title: fieldSummary.housingUnassigned ? `${formatCount(fieldSummary.housingUnassigned)} people need rooms` : "Housing is clear", detail: fieldSummary.housingUnassigned ? "Work from the Housing queue and assign rooms as arrivals come in." : "Room assignments are currently covered.", urgent: fieldSummary.housingUnassigned > 0, cta: "Open Housing" });
  if (canWellness) actions.push({ id: "wellness", Icon: FirstAidKit, label: "Wellness", title: fieldSummary.wellnessOpen ? `${formatCount(fieldSummary.wellnessOpen)} open Wellness item${fieldSummary.wellnessOpen === 1 ? "" : "s"}` : "Wellness is clear", detail: "Confidential details stay inside the Wellness workspace.", urgent: fieldSummary.wellnessOpen > 0, cta: "Open Wellness" });
  if (canFood) actions.push({ id: "food", Icon: ForkKnife, label: "Food", title: fieldSummary.foodOpen ? `${formatCount(fieldSummary.foodOpen)} dietary item${fieldSummary.foodOpen === 1 ? "" : "s"} need review` : "Food needs are reviewed", detail: "Keep meal operations aligned with participant needs.", urgent: fieldSummary.foodOpen > 0, cta: "Open Food" });
  if (canAccess) actions.push({ id: "access", Icon: Users, label: "Access", title: pendingAccess ? `${formatCount(pendingAccess)} access item${pendingAccess === 1 ? "" : "s"} waiting` : "Access is clear", detail: "Review only the access changes that need attention.", urgent: pendingAccess > 0, cta: "Open Access" });

  const priority = actions.find((item) => item.urgent) || actions[0] || { id: "birthdays", Icon: Cake, label: "People care", title: birthdayPending ? `${birthdayPending} birthday acknowledgement${birthdayPending === 1 ? "" : "s"} waiting` : "Your FSY work is up to date", detail: "Open a workspace when you are ready for the next task.", cta: "View birthdays" };
  const attention = actions.filter((item) => item.urgent && item.id !== priority.id);
  const quickTools = actions.filter((item) => item.id !== priority.id).slice(0, 6);
  const setupComplete = 1 + (hasParticipants ? 2 : 0) + (hasGroups ? 1 : 0) + (hasCompanies ? 1 : 0);
  const setupIncomplete = setupComplete < 7;

  const pulse = [];
  if (canRegistration || canCheckin || broadOps) {
    pulse.push({ label: "Checked in", value: formatCount(checkedCount), note: `${checkinProgress}% of current participants`, progress: checkinProgress });
    pulse.push({ label: "Still expected", value: formatCount(stillExpected), note: stillExpected ? "Not checked in yet" : "Arrival complete" });
  }
  if (canHousing) pulse.push({ label: "Need a room", value: formatCount(fieldSummary.housingUnassigned || 0), note: "Current Housing workload" });
  else if (canRegistration) pulse.push({ label: "Need review", value: formatCount(reviewCount), note: "Registration exceptions" });
  if (canAccess) pulse.push({ label: "Access waiting", value: formatCount(pendingAccess || 0), note: "Requests and invites" });
  else if (canFood) pulse.push({ label: "Food review", value: formatCount(fieldSummary.foodOpen || 0), note: "Dietary items" });
  else if (canWellness) pulse.push({ label: "Wellness open", value: formatCount(fieldSummary.wellnessOpen || 0), note: "Current private items" });

  const focusLabel = broadOps ? "Session operations" : canRegistration ? "Registration & check-in" : canHousing ? "Housing" : canWellness ? "Wellness" : canFood ? "Food" : canCheckin ? "Check-in" : "Your FSY work";

  return <section className="page overview-v2">
    <header className="overview-v2-head">
      <div>
        <span className="kicker">{sessionName}</span>
        <h1>{focusLabel}</h1>
        <p>Start with what matters now. Everything else stays out of the way until you need it.</p>
      </div>
      <div className="overview-v2-head-meta"><span><ShieldCheck weight="fill" /> Personalized to your access</span></div>
    </header>

    <section className="overview-v2-primary" aria-labelledby="overview-next-title">
      <div className="overview-v2-primary-icon"><priority.Icon /></div>
      <div className="overview-v2-primary-copy">
        <span className="kicker">Next best action · {priority.label}</span>
        <h2 id="overview-next-title">{priority.title}</h2>
        <p>{priority.detail}</p>
      </div>
      <button type="button" className="primary" onClick={() => setActive(priority.id)}>{priority.cta}<ArrowRight /></button>
    </section>

    {pulse.length ? <section className="overview-v2-pulse" aria-label="Session pulse">{pulse.slice(0, 4).map((item) => <div key={item.label} className="overview-v2-pulse-item"><span>{item.label}</span><strong>{item.value}</strong><small>{item.note}</small>{typeof item.progress === "number" ? <div className="overview-v2-progress" aria-label={`${item.progress}%`}><i style={{ width: `${item.progress}%` }} /></div> : null}</div>)}</section> : null}

    <div className="overview-v2-grid">
      <article className="panel overview-v2-attention">
        <div className="overview-v2-section-head"><div><span className="kicker">Attention</span><h2>{attention.length ? "A few things need you" : "Nothing urgent right now"}</h2></div>{attention.length ? <span className="overview-v2-count">{attention.length}</span> : <CheckCircle className="overview-v2-clear" weight="fill" />}</div>
        {attention.length ? <div className="overview-v2-list">{attention.map((item) => <button key={item.id} type="button" onClick={() => setActive(item.id)}><span className="overview-v2-list-icon"><item.Icon /></span><span><b>{item.title}</b><small>{item.detail}</small></span><ArrowRight /></button>)}</div> : <p className="overview-v2-empty">Your highest-priority work is already surfaced above. You can move straight into the task.</p>}
      </article>

      <article className="panel overview-v2-tools">
        <div className="overview-v2-section-head"><div><span className="kicker">Your tools</span><h2>Only what you can use</h2></div><ShieldCheck className="overview-v2-symbol" /></div>
        <div className="overview-v2-tool-grid">{quickTools.map((item) => <button key={item.id} type="button" onClick={() => setActive(item.id)}><item.Icon /><span><b>{item.label}</b><small>{item.urgent ? "Needs attention" : "Open workspace"}</small></span><ArrowRight /></button>)}<button type="button" onClick={() => setActive("birthdays")}><Cake /><span><b>Birthdays</b><small>{birthdayPending ? `${birthdayPending} to acknowledge` : "People care"}</small></span><ArrowRight /></button></div>
      </article>
    </div>

    {broadOps && setupIncomplete ? <details className="panel overview-v2-setup"><summary><span><span className="kicker">Session setup</span><b>{setupComplete} of 7 steps complete</b><small>Open only when you need the setup sequence.</small></span><span>{Math.round((setupComplete / 7) * 100)}%</span></summary><div className="overview-v2-setup-track">{setupSteps.map((step, index) => <button key={step.id} type="button" className={index < setupComplete ? "done" : index === setupComplete ? "current" : ""} onClick={() => index === 1 ? setActive("registration") : index >= 3 ? setActive("groups") : undefined}><i>{index < setupComplete ? <Check weight="bold" /> : index + 1}</i><span>{step.short}</span></button>)}</div></details> : null}

    <aside className="overview-v2-theme"><div><Sparkle weight="fill" /><span><b>Walk With Me</b><small>Moses 6:34 · Believe, Belong, Become</small></span></div><img src="/brand/2026-theme-identifier-full-color.png" alt="2026 Walk with Me theme identifier" /></aside>
  </section>;
}
