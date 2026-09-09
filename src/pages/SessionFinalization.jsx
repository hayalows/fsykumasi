import { useCallback, useEffect, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Users } from "@phosphor-icons/react/Users";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { ConfirmActionSheet, MutationFeedback, Status } from "../components/UI.jsx";
import { describeSessionFinalizationError, finalizeSessionRoster, loadSessionFinalizationPreview } from "../lib/session-finalization.js";
import "./session-finalization.css";

function n(value) { return Number(value || 0).toLocaleString(); }

function Fact({ value, label, detail }) {
  return <div className="session-finalization-fact">
    <strong>{value}</strong>
    <span>{label}</span>
    {detail ? <small>{detail}</small> : null}
  </div>;
}

function PreviewRecovery({ issue, loading, onRetry }) {
  return <section className="session-finalization session-finalization-recovery" aria-busy={loading}>
    <div className="session-finalization-recovery-card" role="alert">
      <div className="session-finalization-recovery-icon"><WarningCircle size={24} weight="fill" /></div>
      <div className="session-finalization-recovery-copy">
        <span className="kicker">Pre-session closeout</span>
        <h2>{issue?.title || "Final roster preview could not load"}</h2>
        <p>{issue?.message || "The final roster preview could not load. Try again."}</p>
        {issue?.supportReference ? <small>Support reference {issue.supportReference}</small> : null}
      </div>
      <button type="button" className="secondary" disabled={loading} onClick={onRetry}>
        <ArrowClockwise />{loading ? "Retrying…" : "Retry preview"}
      </button>
    </div>
  </section>;
}

export function SessionFinalization({ sessionId, onChanged, onNavigate }) {
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [applying, setApplying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [issue, setIssue] = useState(null);
  const [accessDenied, setAccessDenied] = useState(false);

  const reload = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setIssue(null);
    setAccessDenied(false);
    try {
      const next = await loadSessionFinalizationPreview(sessionId);
      setPreview(next);
      if (next?.already_finalized && next?.final_summary) setResult(next.final_summary);
    } catch (err) {
      const nextIssue = describeSessionFinalizationError(err, "preview");
      if (nextIssue.accessDenied) setAccessDenied(true);
      else setIssue(nextIssue);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { reload(); }, [reload]);

  const apply = async () => {
    if (!sessionId || applying || !preview?.safe_to_apply) return;
    setApplying(true);
    setIssue(null);
    try {
      const next = await finalizeSessionRoster(sessionId);
      setResult(next);
      setConfirming(false);
      await onChanged?.();
      await reload();
    } catch (err) {
      setIssue(describeSessionFinalizationError(err, "apply"));
      setConfirming(false);
    } finally {
      setApplying(false);
    }
  };

  if (accessDenied) return null;
  if (loading && !preview) return <section className="session-finalization" aria-busy="true">
    <div className="session-finalization-loading" role="status"><span className="workspace-state state-loading"><i />Checking the final roster</span><p>Reading participant decisions, Staff readiness and current coverage.</p></div>
  </section>;
  if (!preview && issue) return <PreviewRecovery issue={issue} loading={loading} onRetry={reload} />;

  const applied = Boolean(result || preview?.already_finalized);
  const summary = result || preview?.final_summary || {};
  const blocked = Boolean(preview) && !preview?.safe_to_apply;
  const newGroups = Number(preview?.new_female_groups || 0) + Number(preview?.new_male_groups || 0);
  const participantBlockers = Number(preview?.remaining_participant_blockers || 0);
  const femaleCounselorsNeeded = Number(preview?.existing_female_groups_needing_counselor || 0) + Number(preview?.new_female_groups || 0);
  const maleCounselorsNeeded = Number(preview?.existing_male_groups_needing_counselor || 0) + Number(preview?.new_male_groups || 0);
  const femaleCounselorShortfall = Math.max(0, femaleCounselorsNeeded - Number(preview?.available_female_counselors || 0));
  const maleCounselorShortfall = Math.max(0, maleCounselorsNeeded - Number(preview?.available_male_counselors || 0));
  const assistantShortfall = Math.max(0, Number(preview?.new_companies || 0) - Number(preview?.available_assistant_coordinators || 0));

  return <section className="session-finalization" aria-busy={applying || loading}>
    {issue ? <div className="session-finalization-inline-issue" role="status">
      <WarningCircle size={20} weight="fill" aria-hidden="true" />
      <div><b>{issue.title}</b><span>{issue.message}</span>{issue.supportReference ? <small>Support reference {issue.supportReference}</small> : null}</div>
      <button type="button" className="text-action" disabled={loading || applying} onClick={reload}><ArrowClockwise />Refresh preview</button>
    </div> : null}

    <header className="session-finalization-head">
      <div>
        <span className="kicker">Pre-session closeout</span>
        <h2>{applied ? "Final roster is ready" : "Finish the final roster"}</h2>
        <p>{applied
          ? "The working participant and Staff rosters are settled. Source registration history is still preserved, and new arrivals now use the on-site flow."
          : "Review what will change, resolve anything blocking the batch, then finalize. Existing participant placements stay where they are."}</p>
      </div>
      <Status tone={applied || !blocked ? "good" : "warn"}>{applied ? "Finalized" : blocked ? "Review needed" : "Ready to finalize"}</Status>
    </header>

    {applied ? <>
      <div className="session-finalization-result" role="status">
        <CheckCircle size={26} weight="fill" />
        <div><b>No participant eligibility decisions remain open</b><span>Existing placements moved: {n(summary.existing_placements_moved)}</span></div>
      </div>
      <div className="session-finalization-facts" aria-label="Final roster result">
        <Fact value={n(summary.participants_included)} label="Participants included" detail="Local session decisions" />
        <Fact value={n(summary.participants_20_plus_removed)} label="20+ removed from youth roster" detail="Source records retained" />
        <Fact value={n(summary.staff_cleared)} label="Staff cleared for planning" detail="Source approval retained" />
        <Fact value={n(summary.new_groups)} label="New counselor groups" detail={`${n(summary.new_companies)} new companies`} />
        <Fact value={n(summary.counselors_assigned)} label="Counselor gaps filled" />
        <Fact value={n(summary.fsy_ids_issued)} label="Supplemental FSY IDs" detail={Number(summary.unknown_origin_ids || 0) ? `${n(summary.unknown_origin_ids)} use UNK origin` : "All origin codes available"} />
      </div>
      <div className="session-finalization-actions">
        <button type="button" className="primary" onClick={() => onNavigate?.({ view: "reports" })}>Open final roster report<ArrowRight /></button>
        <button type="button" className="secondary" onClick={() => onNavigate?.({ view: "assignments", tab: "groups", filter: "all" })}>Review Staff coverage</button>
        <button type="button" className="text-action" onClick={reload}><ArrowClockwise />Refresh</button>
      </div>
    </> : <>
      <div className="session-finalization-strip" aria-label="Final roster changes">
        <Fact value={n(preview?.participants_to_include)} label="Participants to include" detail={`${n(preview?.participants_awaiting_to_allow)} awaiting · ${n(preview?.participants_12_13_to_allow)} age 12–13 · ${n(preview?.participants_19_to_allow)} age 19`} />
        <Fact value={n(preview?.participants_20_plus_to_remove)} label="Age 20+ leaving youth roster" detail="Source records stay in history" />
        <Fact value={n(preview?.staff_awaiting_to_clear)} label="Staff to clear" detail="Available for local planning" />
        <Fact value={n(newGroups)} label="New counselor groups" detail={`${n(preview?.new_companies)} new companies · existing placements stay put`} />
      </div>

      <div className="session-finalization-sections">
        <section>
          <div className="session-finalization-icon"><Users size={22} /></div>
          <div><h3>Participants</h3><p>Verified participants aged 12–19 and verified registrations awaiting approval become active under the approved session policy. People aged 20+ leave the active youth roster without deleting their source registration.</p></div>
        </section>
        <section>
          <div className="session-finalization-icon"><ShieldCheck size={22} /></div>
          <div><h3>Staff</h3><p>Current Staff still awaiting source approval become available for local planning. Cancelled, no-show, left and explicitly excluded Staff remain unavailable.</p></div>
        </section>
        <section>
          <div className="session-finalization-icon"><CheckCircle size={22} /></div>
          <div><h3>Groups & companies</h3><p>Existing placements stay fixed. The system fills {n(preview?.existing_groups_needing_counselor)} counselor gaps first, then adds only the supplemental groups and companies needed for the new policy cohorts.</p></div>
        </section>
      </div>

      {Number(preview?.exclusion_conflicts || 0) ? <MutationFeedback tone="error"><WarningCircle /> {n(preview?.exclusion_conflicts)} person aged 20+ already has live placement, check-in, Housing or badge work. Review them individually before finalizing.</MutationFeedback> : null}
      {!Number(preview?.exclusion_conflicts || 0) && participantBlockers ? <MutationFeedback tone="error"><WarningCircle /> {n(participantBlockers)} participant eligibility blocker{participantBlockers === 1 ? "" : "s"} remain. Review those participant records before finalizing.</MutationFeedback> : null}
      {!Number(preview?.exclusion_conflicts || 0) && !participantBlockers && (femaleCounselorShortfall || maleCounselorShortfall || assistantShortfall) ? <MutationFeedback tone="error"><WarningCircle /> Staff coverage is short for this batch{femaleCounselorShortfall ? ` by ${n(femaleCounselorShortfall)} female counselor${femaleCounselorShortfall === 1 ? "" : "s"}` : ""}{maleCounselorShortfall ? `${femaleCounselorShortfall ? " and" : " by"} ${n(maleCounselorShortfall)} male counselor${maleCounselorShortfall === 1 ? "" : "s"}` : ""}{assistantShortfall ? `${femaleCounselorShortfall || maleCounselorShortfall ? " and" : " by"} ${n(assistantShortfall)} Assistant Coordinator${assistantShortfall === 1 ? "" : "s"}` : ""}. Review Staff coverage first.</MutationFeedback> : null}
      {!Number(preview?.exclusion_conflicts || 0) && !participantBlockers && !femaleCounselorShortfall && !maleCounselorShortfall && !assistantShortfall && blocked ? <MutationFeedback tone="error">The final roster is blocked by an unresolved session condition. Refresh the preview and review the result before applying it.</MutationFeedback> : null}

      <div className="session-finalization-guard">
        <b>What finalizing changes</b>
        <p>The final source import is frozen. New participants or Staff then use the on-site registration flows. Existing participant groups, companies and finalized IDs are preserved.</p>
      </div>

      <div className="session-finalization-actions">
        <button type="button" className="primary" disabled={applying || blocked || !preview} onClick={() => setConfirming(true)}>{applying ? "Finalizing…" : "Finalize participant & Staff rosters"}</button>
        <button type="button" className="secondary" disabled={applying || loading} onClick={reload}><ArrowClockwise />{loading ? "Refreshing…" : "Refresh preview"}</button>
      </div>
    </>}

    <ConfirmActionSheet
      open={confirming}
      onClose={() => setConfirming(false)}
      title="Finalize the pre-session rosters?"
      description="This applies the local participant and Staff decisions, appends the supplemental structure and freezes further source imports. Existing participant placements are not moved."
      impact={<div><b>{n(preview?.participants_to_include)} participants included</b><br />{n(preview?.participants_20_plus_to_remove)} age 20+ removed from the active youth roster<br />{n(newGroups)} new groups · {n(preview?.new_companies)} new companies</div>}
      confirmLabel="Finalize rosters"
      tone="warn"
      busy={applying}
      onConfirm={apply}
    />
  </section>;
}