import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { Check } from "@phosphor-icons/react/Check";
import { CloudArrowUp } from "@phosphor-icons/react/CloudArrowUp";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { Users } from "@phosphor-icons/react/Users";
import { demoStaffSummary, setupSteps } from "../data/demo.js";
import { Metric, PageHead, Status } from "../components/UI.jsx";

export function Overview({ setActive, imported, assignment, pendingAccess }) {
  const complete = imported.length ? 3 : 1;
  const participantCount = imported.length || 1640;

  return (
    <section className="page">
      <PageHead
        title="Conference operations, without the noise."
        description="Prepare the session, spot what needs attention, then get leaders back to the youth."
        action={<button className="primary" onClick={() => setActive(imported.length ? "groups" : "registration")}>{imported.length ? "Build groups" : "Continue setup"}<ArrowRight /></button>}
      />

      <div className="brand-banner">
        <div><span className="kicker">2026 theme</span><h2>Walk With Me</h2><p>Moses 6:34 · Believe, Belong, Become</p></div>
        <div className="brand-banner-shapes" aria-hidden="true"><i/><i/><i/></div>
      </div>

      <div className="journey-card">
        <div className="section-title">
          <div><span className="kicker">Conference readiness</span><h2>{complete} of 7 setup steps complete</h2></div>
          <strong>{Math.round((complete / 7) * 100)}%</strong>
        </div>
        <div className="journey-track">
          {setupSteps.map((step, index) => (
            <button key={step.id} className={index < complete ? "done" : index === complete ? "current" : ""} onClick={() => index === 1 ? setActive("registration") : index >= 3 ? setActive("groups") : undefined}>
              <span>{index < complete ? <Check weight="bold" /> : index + 1}</span>
              <small>{step.short}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="metrics-grid">
        <Metric label="Youth participants" value={participantCount.toLocaleString()} note={imported.length ? "validated import" : "full-scale synthetic test data"} />
        <Metric label="YSA staff" value={demoStaffSummary.ysaStaff} note="planning estimate" tone="green" />
        <Metric label="Counselor groups" value={assignment?.groups?.length || "~164"} note={assignment ? "draft proposal" : "at 8–10 youth each"} tone="light-blue" />
        <Metric label="Companies" value={assignment?.companies?.length || "~82"} note={assignment ? "YM + YW groups paired" : "planning estimate"} tone="yellow" />
      </div>

      <div className="overview-grid">
        <article className="panel attention">
          <div className="panel-head"><div><span className="kicker">Attention first</span><h2>What needs action</h2></div><span className="count">{2 + pendingAccess}</span></div>
          <button onClick={() => setActive("registration")}><span className="alert-icon"><CloudArrowUp /></span><span><b>{imported.length ? "Participant data is ready" : "Import participant data"}</b><small>{imported.length ? `${imported.length.toLocaleString()} records passed the first review` : "Use the approved CSV or Excel export when production is ready"}</small></span><ArrowRight /></button>
          <button onClick={() => setActive("groups")}><span className="alert-icon green"><Buildings /></span><span><b>Review grouping rules</b><small>8–10 youth per group, no same unit inside a counselor group</small></span><ArrowRight /></button>
          <button onClick={() => setActive("access")}><span className="alert-icon yellow"><Users /></span><span><b>{pendingAccess} access requests waiting</b><small>Logistics or session directors can approve or reject them</small></span><ArrowRight /></button>
        </article>

        <article className="panel">
          <div className="panel-head"><div><span className="kicker">Readiness summary</span><h2>Operational foundation</h2></div><ShieldCheck size={22} className="panel-symbol" /></div>
          <div className="readiness">
            <div><span>Registration data</span><Status tone={imported.length ? "good" : "warn"}>{imported.length ? "Imported" : "Synthetic"}</Status></div>
            <div><span>Group assignments</span><Status tone={assignment ? "good" : "muted"}>{assignment ? "Draft ready" : "Waiting"}</Status></div>
            <div><span>Role hierarchy</span><Status>Defined</Status></div>
            <div><span>Access approvals</span><Status tone={pendingAccess ? "warn" : "good"}>{pendingAccess ? `${pendingAccess} pending` : "Clear"}</Status></div>
          </div>
        </article>
      </div>

      <article className="panel principle"><Sparkle size={22} weight="fill"/><div><b>Fast by design.</b><p>A leader should finish the task in a few taps, understand the result immediately, and put the phone away.</p></div></article>
    </section>
  );
}
