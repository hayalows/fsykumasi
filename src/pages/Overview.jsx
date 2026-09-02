import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { Cake } from "@phosphor-icons/react/Cake";
import { Check } from "@phosphor-icons/react/Check";
import { CloudArrowUp } from "@phosphor-icons/react/CloudArrowUp";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { Users } from "@phosphor-icons/react/Users";
import { setupSteps } from "../data/demo.js";
import { Metric, PageHead, Status } from "../components/UI.jsx";
import { formatCount } from "../lib/cohort.js";

export function Overview({ setActive, imported = [], allParticipants = [], cohort, assignment, pendingAccess, birthdays = [], live = false, companies = [], checkedCount = 0, sessionName }) {
  const hasParticipants = allParticipants.length > 0 || imported.length > 0;
  const hasGroups = Boolean(assignment?.groups?.length);
  const hasCompanies = companies.length > 0 || Boolean(assignment?.companies?.length);
  const complete = 1 + (hasParticipants ? 2 : 0) + (hasGroups ? 1 : 0) + (hasCompanies ? 1 : 0);
  const participantCount = live ? (cohort?.eligible ?? imported.length) : (cohort?.eligible || imported.length || 1640);
  const registrationRecords = cohort?.records ?? allParticipants.length ?? imported.length;
  const reviewCount = cohort?.reviewExceptions || 0;
  const unassignedCount = cohort?.unassigned || 0;
  const groupCount = assignment?.groups?.length || 0;
  const companyCount = companies.length || assignment?.companies?.length || 0;
  const attentionCount = (hasParticipants ? 0 : 1) + (hasGroups ? unassignedCount : 1) + reviewCount + pendingAccess;
  const primaryLabel = !hasParticipants ? "Continue setup" : hasGroups ? "Review structure" : "Build groups";

  return <section className="page">
    <PageHead title="Conference operations, without the noise." sessionName={sessionName} description="Prepare the session, spot what needs attention, then get leaders back to the youth." action={<button className="primary" onClick={() => setActive(hasParticipants ? "groups" : "registration")}>{primaryLabel}<ArrowRight/></button>}/>
    <div className="brand-banner theme-banner"><div className="theme-copy"><span className="kicker">2026 theme</span><h2>Walk With Me</h2><p>Moses 6:34 · Believe, Belong, Become</p><p className="theme-verse">“…thou shalt <mark>abide in me</mark>, and <mark>I in you</mark>; therefore <mark>walk with me</mark>.”</p></div><img className="theme-identifier" src="/brand/2026-theme-identifier-full-color.png" alt="2026 Walk with Me theme identifier"/></div>
    <div className="journey-card"><div className="section-title"><div><span className="kicker">Conference readiness</span><h2>{complete} of 7 setup steps complete</h2></div><strong>{Math.round((complete / 7) * 100)}%</strong></div><div className="journey-track">{setupSteps.map((step,index) => <button key={step.id} className={index < complete ? "done" : index === complete ? "current" : ""} onClick={() => index === 1 ? setActive("registration") : index >= 3 ? setActive("groups") : undefined}><span>{index < complete ? <Check weight="bold"/> : index+1}</span><small>{step.short}</small></button>)}</div></div>
    <div className="metrics-grid"><Metric label="Eligible youth" value={formatCount(participantCount)} note={hasParticipants ? `${formatCount(registrationRecords)} registration records` : live ? "not imported" : "synthetic rehearsal"}/><Metric label="Checked in" value={checkedCount.toLocaleString()} note={hasParticipants ? `${Math.max(0,participantCount-checkedCount).toLocaleString()} still expected` : "waiting for participant import"} tone="green"/><Metric label="Counselor groups" value={live ? groupCount : (groupCount || "~164")} note={hasGroups ? "published structure" : "not built"} tone="light-blue"/><Metric label="Companies" value={live ? companyCount : (companyCount || "~82")} note={hasCompanies ? "current structure" : "not formed"} tone="yellow"/></div>
    <div className="overview-grid">
      <article className="panel attention"><div className="panel-head"><div><span className="kicker">Attention first</span><h2>What needs action</h2></div><span className="count">{attentionCount}</span></div><button onClick={() => setActive("registration")}><span className="alert-icon"><CloudArrowUp/></span><span><b>{!hasParticipants ? "Import registration data" : reviewCount ? `${formatCount(reviewCount)} people need review` : "Registration list is ready"}</b><small>{!hasParticipants ? "Use the approved CSV or Excel export" : reviewCount ? `${formatCount(reviewCount)} data exceptions · source records stay preserved` : `${formatCount(registrationRecords)} records · ${formatCount(participantCount)} eligible youth`}</small></span><ArrowRight/></button><button onClick={() => setActive("groups")}><span className="alert-icon green"><Buildings/></span><span><b>{hasGroups ? (unassignedCount ? `${formatCount(unassignedCount)} youth ready for placement` : "Review groups, companies & staffing") : "Build groups & companies"}</b><small>{hasGroups ? (unassignedCount ? "Place eligible youth before check-in" : "Names, staff assignments and grouping rules remain manageable") : "Admins choose the rules, preview, then publish"}</small></span><ArrowRight/></button><button onClick={() => setActive("access")}><span className="alert-icon yellow"><Users/></span><span><b>{pendingAccess ? `${pendingAccess} access items waiting` : "Access is clear"}</b><small>Administrative access controls who can manage the session</small></span><ArrowRight/></button></article>
      <article className="panel"><div className="panel-head"><div><span className="kicker">Readiness summary</span><h2>Operational foundation</h2></div><ShieldCheck size={22} className="panel-symbol"/></div><div className="readiness"><div><span>Registration data</span><Status tone={hasParticipants ? "good" : "warn"}>{hasParticipants ? `${formatCount(participantCount)} eligible` : "Not imported"}</Status></div><div><span>Group assignments</span><Status tone={hasGroups ? "good" : "muted"}>{hasGroups ? "Published" : "Waiting"}</Status></div><div><span>Role hierarchy</span><Status>Defined</Status></div><div><span>Access approvals</span><Status tone={pendingAccess ? "warn" : "good"}>{pendingAccess ? `${pendingAccess} pending` : "Clear"}</Status></div></div></article>
      <article className="panel birthday-overview"><div className="panel-head"><div><span className="kicker">People care</span><h2>Birthdays this FSY</h2></div><Cake size={22} className="panel-symbol"/></div><strong>{birthdays.length}</strong><p>{birthdays.length ? `${birthdays.filter((person) => !person.acknowledged).length} still to acknowledge` : "Birthday details appear after the registration snapshot is applied."}</p><button className="secondary" onClick={() => setActive("birthdays")}>View birthday list<ArrowRight/></button></article>
    </div>
    <article className="panel principle"><Sparkle size={22} weight="fill"/><div><b>Fast by design.</b><p>A leader should finish the task in a few taps, understand the result immediately, and put the phone away.</p></div></article>
  </section>;
}

