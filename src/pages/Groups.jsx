import { useState } from "react";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { CloudArrowUp } from "@phosphor-icons/react/CloudArrowUp";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { Empty, Metric, PageHead, Status } from "../components/UI.jsx";
import { buildBalancedAssignments } from "../lib/grouping.js";

export function Groups({ participants, assignment, setAssignment, onPublish, live = false, canPublish = true }) {
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const [published, setPublished] = useState(Boolean(assignment?.published));
  const generate = () => {
    setError("");
    setPublished(false);
    setAssignment(buildBalancedAssignments(participants));
  };
  const publish = async () => {
    if (!assignment || assignment.issues?.length || !onPublish) return;
    setPublishing(true);
    setError("");
    try {
      await onPublish(assignment);
      setPublished(true);
    } catch (err) {
      setError(err.message || "Unable to publish this grouping plan.");
    } finally {
      setPublishing(false);
    }
  };
  const isPublished = published || assignment?.published;
  const groupCount = assignment?.groups?.length || 0;
  const companyCount = assignment?.companies?.length || 0;
  const assignedCount = isPublished
    ? assignment.groups.reduce((sum, group) => sum + Number(group.memberCount || 0), 0)
    : participants.length;

  return (
    <section className="page">
      <PageHead
        title="Groups & companies"
        description="Create a balanced draft, review every exception, then publish the complete plan in one safe step."
        action={!isPublished ? <button className="primary" onClick={generate} disabled={!participants.length}><Sparkle />{assignment ? "Regenerate draft" : "Generate draft"}</button> : <Status>Published</Status>}
      />
      <div className="rules">
        <div><CheckCircle weight="fill"/><span><b>8–10 per group</b><small>Small enough for counselors to know the youth</small></span></div>
        <div><CheckCircle weight="fill"/><span><b>No same unit</b><small>Ward or branch diversity inside each counselor group</small></span></div>
        <div><CheckCircle weight="fill"/><span><b>YM / YW groups</b><small>Separate counselor groups, paired into companies</small></span></div>
      </div>

      {!assignment ? (
        <article className="panel"><Empty icon={Buildings} title={participants.length ? "Ready to build a reviewed draft" : "Import participants first"} text={participants.length ? `The builder will arrange ${participants.length.toLocaleString()} participants. Nothing changes in the database until you publish.` : "A grouping plan needs the approved participant list."} action={participants.length ? <button className="primary" onClick={generate}>Build draft groups</button> : null}/></article>
      ) : (
        <>
          <div className="metrics-grid">
            <Metric label={isPublished ? "Published groups" : "Proposed groups"} value={groupCount} note="target size 8–10" />
            <Metric label="Companies" value={companyCount} note="YM and YW groups paired" tone="light-blue" />
            <Metric label="Rule conflicts" value={assignment.issues?.length || 0} note={assignment.issues?.length ? "must be resolved" : "all automated checks passed"} tone={assignment.issues?.length ? "yellow" : "green"} />
            <Metric label="Assigned youth" value={assignedCount.toLocaleString()} note={isPublished ? "saved in Supabase" : "included in this draft"} tone="green" />
          </div>
          <article className="panel">
            <div className="panel-head"><div><span className="kicker">{isPublished ? "Live plan" : "Draft proposal"}</span><h2>{isPublished ? "Published counselor groups" : "First groups to review"}</h2></div><Status tone={assignment.issues?.length ? "warn" : "good"}>{assignment.issues?.length ? "Review needed" : isPublished ? "Live" : "Rules passed"}</Status></div>
            <div className="group-grid">
              {assignment.groups.slice(0, 12).map((group) => {
                const count = group.members?.length ?? group.memberCount ?? 0;
                return (
                  <div className="group-card" key={group.id}>
                    <div><span>{group.sex === "Female" ? "YW" : "YM"}</span><Status tone={group.conflicts?.length ? "warn" : "good"}>{count}</Status></div>
                    <h3>{group.name}</h3>
                    <p>{group.members?.length ? `${group.members.slice(0, 4).map((x) => x.unit.replace(" Ward", "").replace(" Branch", "")).join(" · ")}${group.members.length > 4 ? " · …" : ""}` : `${count} assigned participants`}</p>
                  </div>
                );
              })}
            </div>
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <div className="panel-actions">
              <span>Showing {Math.min(12, groupCount)} of {groupCount}. {isPublished ? "This is the current operational plan." : "Publishing is atomic and cannot leave partial assignments."}</span>
              {!isPublished && live ? <button className="primary" disabled={!canPublish || publishing || Boolean(assignment.issues?.length)} onClick={publish}><CloudArrowUp />{publishing ? "Publishing…" : "Publish reviewed plan"}</button> : null}
            </div>
          </article>
        </>
      )}
    </section>
  );
}
