import { Buildings } from "@phosphor-icons/react/Buildings";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { Empty, Metric, PageHead, Status } from "../components/UI.jsx";
import { buildBalancedAssignments } from "../lib/grouping.js";

export function Groups({ participants, assignment, setAssignment }) {
  const generate = () => setAssignment(buildBalancedAssignments(participants));
  return (
    <section className="page">
      <PageHead title="Groups & companies" description="Create a balanced draft, review exceptions, then publish only after a human check." action={<button className="primary" onClick={generate}><Sparkle />{assignment ? "Regenerate proposal" : "Generate proposal"}</button>} />
      <div className="rules">
        <div><CheckCircle weight="fill"/><span><b>8–10 per group</b><small>Small enough for counselors to know the youth</small></span></div>
        <div><CheckCircle weight="fill"/><span><b>No same unit</b><small>Ward or branch diversity inside each counselor group</small></span></div>
        <div><CheckCircle weight="fill"/><span><b>YM / YW groups</b><small>Separate counselor groups, paired into companies</small></span></div>
      </div>

      {!assignment ? (
        <article className="panel"><Empty icon={Buildings} title="Ready for a full-scale draft" text={`The builder will arrange ${participants.length.toLocaleString()} participants. The result stays a draft until leadership reviews it.`} action={<button className="primary" onClick={generate}>Build draft groups</button>}/></article>
      ) : (
        <>
          <div className="metrics-grid">
            <Metric label="Proposed groups" value={assignment.groups.length} note="target size 8–10" />
            <Metric label="Companies" value={assignment.companies.length} note="YM and YW groups paired" tone="light-blue" />
            <Metric label="Rule conflicts" value={assignment.issues.length} note={assignment.issues.length ? "manual review required" : "all checks passed"} tone={assignment.issues.length ? "yellow" : "green"} />
            <Metric label="Participants" value={participants.length.toLocaleString()} note="included in this draft" tone="green" />
          </div>
          <article className="panel">
            <div className="panel-head"><div><span className="kicker">Draft proposal</span><h2>First groups to review</h2></div><Status tone={assignment.issues.length ? "warn" : "good"}>{assignment.issues.length ? "Review needed" : "Rules passed"}</Status></div>
            <div className="group-grid">
              {assignment.groups.slice(0, 12).map((group) => (
                <div className="group-card" key={group.id}>
                  <div><span>{group.sex === "Female" ? "YW" : "YM"}</span><Status tone={group.conflicts.length ? "warn" : "good"}>{group.members.length}/{group.capacity}</Status></div>
                  <h3>{group.name}</h3>
                  <p>{group.members.slice(0, 4).map((x) => x.unit.replace(" Ward", "").replace(" Branch", "")).join(" · ")}{group.members.length > 4 ? " · …" : ""}</p>
                </div>
              ))}
            </div>
            <div className="panel-actions"><span>Showing 12 of {assignment.groups.length}. Human review remains required before publishing.</span><button className="secondary">Review all groups</button></div>
          </article>
        </>
      )}
    </section>
  );
}
