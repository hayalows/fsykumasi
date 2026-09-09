import { useCallback, useEffect, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Users } from "@phosphor-icons/react/Users";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { MutationFeedback, Status } from "../components/UI.jsx";
import { finalizeSessionRoster, loadSessionFinalizationPreview } from "../lib/session-finalization.js";
import "./session-finalization.css";

function n(value) { return Number(value || 0).toLocaleString(); }

function Fact({ value, label, detail, tone = "" }) {
  return <div className={`session-finalization-fact ${tone ? `tone-${tone}` : ""}`}>
    <strong>{value}</strong>
    <span>{label}</span>
    {detail ? <small>{detail}</small> : null}
  </div>;
}

export function SessionFinalization({ sessionId, sessionName, onChanged, onNavigate }) {
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError("");
    try {
      const next = await loadSessionFinalizationPreview(sessionId);
      setPreview(next);
      if (next?.alreadyApplied && next?.appliedSummary) setResult(next.appliedSummary);
    } catch (err) {
      setError(err.message || "Final roster preparation could not load.");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { reload(); }, [reload]);

  const apply = async () => {
    if (!sessionId || applying || preview?.participant20PlusWithActivity) return;
    setApplying(true);
    setError("");
    try {
      const next = await finalizeSessionRoster(sessionId);
      setResult(next);
      await onChanged?.();
      await reload();
    } catch (err) {
      setError(err.message || "The final roster could not be applied.");
    } finally {
      setApplying(false);
    }
  };

  const applied = Boolean(result || preview?.alreadyApplied);
  const summary = result || preview?.appliedSummary || {};
  const blocked = Number(preview?.participant20PlusWithActivity || 0) > 0;

  if (loading && !preview) return <section className="session-finalization" aria-busy="true">
    <div className="session-finalization-loading" role="status"><span className="workspace-state state-loading"><i />Preparing the final roster</span><p>Checking participant decisions, Staff readiness and current group coverage.</p></div>
  </section>;

  return <section className="session-finalization" aria-busy={applying}>
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}

    <header className="session-finalization-head">
      <div>
        <span className="kicker">Pre-session closeout</span>
        <h2>{applied ? "The working rosters are finalized" : "Finalize the working rosters"}</h2>
        <p>{applied
          ? "The source registration records are still intact. The app is now using the Kumasi session decisions for participant and Staff operations."
          : "Apply the local session decisions once, keep the existing 44-company structure untouched, and add only the people who still need placement."}</p>
      </div>
      <Status tone={applied ? "good" : blocked ? "danger" : "warn"}>{applied ? "Finalized" : blocked ? "Needs review" : "Ready to apply"}</Status>
    </header>

    {applied ? <>
      <div className="session-finalization-result" role="status">
        <CheckCircle size={26} weight="fill" />
        <div><b>{n(summary.activeParticipants)} active participants</b><span>{n(summary.activeStaff)} active Staff · {summary.newCompany || "No new company needed"}</span></div>
      </div>
      <div className="session-finalization-facts" aria-label="Finalization result">
        <Fact value={n(summary.includedParticipants)} label="Participants added" detail="Local session exceptions" />
        <Fact value={n(summary.excluded20Plus)} label="20+ removed from youth roster" detail="Source records preserved" />
        <Fact value={n(summary.staffCleared)} label="Staff cleared for planning" detail="Source approval remains unchanged" />
        <Fact value={n(summary.newGroups)} label="New counselor groups" detail="Existing groups were not rebalanced" />
        <Fact value={n(summary.counselorsAssigned)} label="Counselor assignments added" />
        <Fact value={n(summary.assistantAssignmentsAdded)} label="Company coverage added" />
      </div>
      {Number(summary.supplementalIdsMissingOrigin || 0) ? <MutationFeedback tone="warning">{n(summary.supplementalIdsMissingOrigin)} participant is on the final roster but still needs origin details before an FSY ID can be issued.</MutationFeedback> : null}
      <div className="session-finalization-actions">
        <button type="button" className="primary" onClick={() => onNavigate?.({ view: "reports" })}>Open reports<ArrowRight /></button>
        <button type="button" className="secondary" onClick={() => onNavigate?.({ view: "assignments", tab: "groups" })}>Review Staff coverage</button>
        <button type="button" className="text-action" onClick={reload}><ArrowClockwise />Refresh</button>
      </div>
    </> : <>
      <div className="session-finalization-strip" aria-label="Planned roster changes">
        <Fact value={n(preview?.projectedActiveParticipants)} label="Final active participants" detail={`${n(preview?.participantEligibleNow)} already ready + ${n(preview?.participantToInclude)} local inclusions`} />
        <Fact value={n(preview?.participant20Plus)} label="Age 20+ leaving youth roster" detail="They can be registered on site as Staff if needed" />
        <Fact value={n(preview?.staffAwaiting)} label="Awaiting Staff to clear" detail="Their source approval value stays unchanged" />
        <Fact value={n(preview?.suggestedNewGroups)} label="New groups" detail="Only the supplemental cohort is placed" />
      </div>

      <div className="session-finalization-sections">
        <section>
          <div className="session-finalization-icon"><Users size={22} /></div>
          <div><h3>Participants</h3><p><b>{n(preview?.participantToInclude)}</b> current participants will be included by the Kumasi session decision. That includes the awaiting-approval and age-exception cases under 20. <b>{n(preview?.participant20Plus)}</b> people aged 20+ leave the active youth roster.</p><small>{n(preview?.femaleToInclude)} Young Women · {n(preview?.maleToInclude)} Young Men</small></div>
        </section>
        <section>
          <div className="session-finalization-icon"><ShieldCheck size={22} /></div>
          <div><h3>Staff</h3><p><b>{n(preview?.staffAwaiting)}</b> current Staff with source approval still awaiting will be cleared for local planning. Existing source values are retained for reference.</p><small>Cancelled, no-show and left Staff remain unavailable.</small></div>
        </section>
        <section>
          <div className="session-finalization-icon"><CheckCircle size={22} /></div>
          <div><h3>Groups & companies</h3><p>The existing participant placements stay where they are. The supplemental cohort gets new counselor groups and a new company only where needed. Existing uncovered groups are filled from available same-sex counselors.</p><small>{n(preview?.groupsWithoutCounselor)} existing group gaps · {n(preview?.companiesWithoutAssistantCoordinator)} companies currently need Assistant Coordinator coverage</small></div>
        </section>
      </div>

      {Number(preview?.missingOriginForNewIds || 0) ? <MutationFeedback tone="warning">{n(preview?.missingOriginForNewIds)} incoming participant is missing origin information. They can still be placed, but their FSY ID will remain for follow-up.</MutationFeedback> : null}
      {blocked ? <MutationFeedback tone="error"><WarningCircle /> {n(preview?.participant20PlusWithActivity)} participant aged 20+ already has a live group, check-in, Housing or badge record. The batch is blocked so those records are not changed automatically.</MutationFeedback> : null}

      <div className="session-finalization-guard">
        <b>What this does not change</b>
        <p>It does not rewrite source approval, date of birth, existing participant groups, existing company membership or valid Staff assignments.</p>
      </div>

      <div className="session-finalization-actions">
        <button type="button" className="primary" disabled={applying || blocked || !preview || preview?.status !== "planning"} onClick={apply}>{applying ? "Finalizing…" : "Finalize roster & Staff"}</button>
        <button type="button" className="secondary" disabled={applying} onClick={reload}><ArrowClockwise />Refresh preview</button>
      </div>
    </>}
  </section>;
}
