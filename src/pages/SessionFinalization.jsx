import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowCounterClockwise } from "@phosphor-icons/react/ArrowCounterClockwise";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { FloppyDisk } from "@phosphor-icons/react/FloppyDisk";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Users } from "@phosphor-icons/react/Users";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { ConfirmActionSheet, MutationFeedback, Status } from "../components/UI.jsx";
import {
  describeSessionFinalizationError,
  finalizeSessionRoster,
  loadSessionFinalizationPreview,
  loadSessionRosterVersions,
  restoreSessionRosterVersion,
  saveSessionRosterVersion,
} from "../lib/session-finalization.js";
import "./session-finalization.css";

function n(value) { return Number(value || 0).toLocaleString(); }

function shortDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

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
        <span className="kicker">Final roster</span>
        <h2>{issue?.title || "Final roster plan could not load"}</h2>
        <p>{issue?.message || "The final roster plan could not load. Try again."}</p>
        {issue?.supportReference ? <small>Support reference {issue.supportReference}</small> : null}
      </div>
      <button type="button" className="secondary" disabled={loading} onClick={onRetry}>
        <ArrowClockwise />{loading ? "Retrying…" : "Retry plan"}
      </button>
    </div>
  </section>;
}

function VersionRow({ version, busy, onRestore }) {
  const summary = version?.summary || {};
  return <div className="session-roster-version-row">
    <div>
      <b>{version.label || "Saved roster"}</b>
      <span>{shortDate(version.created_at)}</span>
      <small>{n(summary.participants_with_group)} placed · {n(summary.published_groups)} groups · {n(summary.companies)} companies · {n(summary.active_badges)} active IDs</small>
    </div>
    <button type="button" className="text-action" disabled={busy} onClick={() => onRestore(version)}>
      <ArrowCounterClockwise />Restore
    </button>
  </div>;
}

export function SessionFinalization({ sessionId, onChanged, onNavigate }) {
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [applying, setApplying] = useState(false);
  const [savingVersion, setSavingVersion] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [issue, setIssue] = useState(null);
  const [versionIssue, setVersionIssue] = useState(null);
  const [versionNotice, setVersionNotice] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);

  const reloadVersions = useCallback(async () => {
    if (!sessionId) return;
    try {
      const next = await loadSessionRosterVersions(sessionId);
      setVersions(next);
    } catch (err) {
      const nextIssue = describeSessionFinalizationError(err, "preview");
      if (!nextIssue.accessDenied) setVersionIssue(nextIssue);
    }
  }, [sessionId]);

  const reload = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setIssue(null);
    setAccessDenied(false);
    try {
      const next = await loadSessionFinalizationPreview(sessionId);
      setPreview(next);
      if (next?.already_finalized && next?.final_summary) setResult(next.final_summary);
      await reloadVersions();
    } catch (err) {
      const nextIssue = describeSessionFinalizationError(err, "preview");
      if (nextIssue.accessDenied) setAccessDenied(true);
      else setIssue(nextIssue);
    } finally {
      setLoading(false);
    }
  }, [sessionId, reloadVersions]);

  useEffect(() => { reload(); }, [reload]);

  const apply = async () => {
    if (!sessionId || applying || !preview?.safe_to_apply) return;
    setApplying(true);
    setIssue(null);
    setVersionNotice("");
    try {
      const next = await finalizeSessionRoster(sessionId);
      setResult(next);
      setConfirming(false);
      if (next?.rollback_version_id) setVersionNotice("The pre-rebalance roster was saved automatically and can be restored while the session remains safe to roll back.");
      await onChanged?.();
      await reload();
    } catch (err) {
      setIssue(describeSessionFinalizationError(err, "apply"));
      setConfirming(false);
    } finally {
      setApplying(false);
    }
  };

  const saveCurrent = async () => {
    if (!sessionId || savingVersion) return;
    setSavingVersion(true);
    setVersionIssue(null);
    setVersionNotice("");
    try {
      await saveSessionRosterVersion(sessionId, "Current roster before rebalance", "Manual safety version saved from Final roster");
      setVersionNotice("Current roster saved. Groups, companies, Staff assignments and FSY ID state are now available as a rollback point.");
      await reloadVersions();
    } catch (err) {
      setVersionIssue(describeSessionFinalizationError(err, "save"));
    } finally {
      setSavingVersion(false);
    }
  };

  const restoreVersion = async () => {
    if (!sessionId || !restoreTarget?.id || restoring) return;
    setRestoring(true);
    setVersionIssue(null);
    setVersionNotice("");
    try {
      await restoreSessionRosterVersion(sessionId, restoreTarget.id);
      setRestoreTarget(null);
      setResult(null);
      setVersionNotice("Saved roster restored. A second safety version was created immediately before the restore, so the restore itself can also be reversed.");
      await onChanged?.();
      await reload();
    } catch (err) {
      setVersionIssue(describeSessionFinalizationError(err, "restore"));
      setRestoreTarget(null);
    } finally {
      setRestoring(false);
    }
  };

  if (accessDenied) return null;
  if (loading && !preview) return <section className="session-finalization" aria-busy="true">
    <div className="session-finalization-loading" role="status"><span className="workspace-state state-loading"><i />Planning the final roster</span><p>Checking group capacity, wards and branches, Staff coverage and FSY ID impact.</p></div>
  </section>;
  if (!preview && issue) return <PreviewRecovery issue={issue} loading={loading} onRetry={reload} />;

  const applied = Boolean(result || preview?.already_finalized);
  const summary = result || preview?.final_summary || {};
  const liveCheckins = Number(preview?.live_checkins || 0);
  const activeHousing = Number(preview?.active_housing_assignments || 0);
  const participantBlockers = Number(preview?.participant_blockers || 0);
  const unitConflicts = Number(preview?.baseline_unit_conflicts || 0);
  const overCapacity = Number(preview?.over_capacity_groups || 0);
  const unassigned = Number(preview?.unassigned_after_plan || 0);
  const underMin = Number(preview?.under_min_groups_after_plan || 0);
  const moved = Number(preview?.existing_placements_moved || 0);
  const newGroups = Number(preview?.new_groups || 0);
  const newCompanies = Number(preview?.new_companies || 0);
  const femaleCounselorsNeeded = Number(preview?.existing_female_groups_needing_counselor || 0) + Number(preview?.new_female_groups || 0);
  const maleCounselorsNeeded = Number(preview?.existing_male_groups_needing_counselor || 0) + Number(preview?.new_male_groups || 0);
  const femaleCounselorShortfall = Math.max(0, femaleCounselorsNeeded - Number(preview?.available_female_counselors || 0));
  const maleCounselorShortfall = Math.max(0, maleCounselorsNeeded - Number(preview?.available_male_counselors || 0));
  const assistantShortfall = Math.max(0, newCompanies - Number(preview?.available_assistant_coordinators || 0));
  const blocked = Boolean(preview) && !preview?.safe_to_apply;
  const latestVersion = versions[0];

  const mainBlocker = useMemo(() => {
    if (liveCheckins) return `${n(liveCheckins)} current check-in${liveCheckins === 1 ? "" : "s"} must be reset first.`;
    if (activeHousing) return `${n(activeHousing)} active Housing assignment${activeHousing === 1 ? "" : "s"} must be reviewed first.`;
    if (participantBlockers) return `${n(participantBlockers)} participant record${participantBlockers === 1 ? "" : "s"} still need a final eligibility decision.`;
    if (unitConflicts) return `${n(unitConflicts)} existing group${unitConflicts === 1 ? "" : "s"} already contain a repeated ward or branch.`;
    if (overCapacity) return `${n(overCapacity)} existing group${overCapacity === 1 ? "" : "s"} are above the configured maximum.`;
    if (unassigned || underMin) return "The current plan cannot place everybody inside the 8–10 person and ward/branch rules.";
    if (femaleCounselorShortfall || maleCounselorShortfall || assistantShortfall) return "Staff coverage is short for the proposed final structure.";
    return blocked ? "The plan still has an unresolved safety condition." : "";
  }, [liveCheckins, activeHousing, participantBlockers, unitConflicts, overCapacity, unassigned, underMin, femaleCounselorShortfall, maleCounselorShortfall, assistantShortfall, blocked]);

  return <section className="session-finalization" aria-busy={applying || loading || restoring}>
    {issue ? <div className="session-finalization-inline-issue" role="status">
      <WarningCircle size={20} weight="fill" aria-hidden="true" />
      <div><b>{issue.title}</b><span>{issue.message}</span>{issue.supportReference ? <small>Support reference {issue.supportReference}</small> : null}</div>
      <button type="button" className="text-action" disabled={loading || applying} onClick={reload}><ArrowClockwise />Refresh plan</button>
    </div> : null}

    <header className="session-finalization-head">
      <div>
        <span className="kicker">Controlled final roster</span>
        <h2>{applied ? "Final roster is settled" : "Rebalance only what needs to move"}</h2>
        <p>{applied
          ? "The final structure is saved with its rollback point. Source registrations remain in history and the operational youth roster follows the session age policy."
          : "Use the current groups as the starting point, fit the final participants into safe open spaces, and add structure only when the numbers require it. The planner avoids moving an existing participant unless the group-size or ward/branch rule makes that necessary."}</p>
      </div>
      <Status tone={applied || !blocked ? "good" : "warn"}>{applied ? "Finalized" : blocked ? "Action needed" : "Plan ready"}</Status>
    </header>

    {applied ? <>
      <div className="session-finalization-result" role="status">
        <CheckCircle size={26} weight="fill" />
        <div><b>Controlled final roster applied</b><span>{n(summary.existing_placements_preserved)} existing placements kept · {n(summary.existing_placements_moved)} moved</span></div>
      </div>
      <div className="session-finalization-facts" aria-label="Final roster result">
        <Fact value={n(summary.final_participants)} label="Final participants" detail="Age 12–18 policy" />
        <Fact value={n(summary.excluded_age_19_plus)} label="Age 19+ outside youth roster" detail="Source records retained" />
        <Fact value={n(summary.new_groups)} label="Groups added" detail={`${n(summary.new_companies)} new companies`} />
        <Fact value={n(summary.badge_ids_preserved)} label="Existing FSY IDs preserved" />
        <Fact value={n(summary.badge_ids_changed)} label="Existing IDs changed" detail="Only when company changed" />
        <Fact value={n(summary.new_ids_issued)} label="New participant IDs" />
      </div>
      <div className="session-finalization-actions">
        <button type="button" className="primary" onClick={() => onNavigate?.({ view: "reports" })}>Open final roster report<ArrowRight /></button>
        <button type="button" className="secondary" onClick={() => onNavigate?.({ view: "assignments", tab: "groups", filter: "all" })}>Review groups & Staff</button>
        <button type="button" className="text-action" onClick={reload}><ArrowClockwise />Refresh</button>
      </div>
    </> : <>
      <div className="session-finalization-strip session-finalization-strip-controlled" aria-label="Controlled final roster plan">
        <Fact value={n(preview?.final_participants)} label="Final participants" detail={`${n(preview?.final_female)} female · ${n(preview?.final_male)} male`} />
        <Fact value={n(preview?.new_participants_to_place)} label="New people to place" detail={`${n(preview?.existing_placements_preserved)} existing placements stay`} />
        <Fact value={n(moved)} label="Existing placements moved" detail={moved ? "Only where the rules require it" : "No existing move needed"} />
        <Fact value={n(newGroups)} label="Groups to add" detail={`${n(preview?.new_female_groups)} YW · ${n(preview?.new_male_groups)} YM`} />
        <Fact value={n(newCompanies)} label="Companies to add" detail="Uses existing spare group capacity first" />
      </div>

      <div className="session-finalization-sections">
        <section>
          <div className="session-finalization-icon"><Users size={22} /></div>
          <div><h3>Participants</h3><p>The final youth roster is age 12–18. Age 19+ source registrations stay in history but leave the active youth roster. Existing placements are treated as valuable state, not something to reshuffle for neatness.</p></div>
        </section>
        <section>
          <div className="session-finalization-icon"><ShieldCheck size={22} /></div>
          <div><h3>Group rules</h3><p>Groups stay within {n(preview?.group_min_size || 8)}–{n(preview?.group_max_size || 10)} people. A ward or branch cannot repeat inside one counselor group. The planner fills compatible spaces first, then creates only the groups the final numbers need.</p></div>
        </section>
        <section>
          <div className="session-finalization-icon"><CheckCircle size={22} /></div>
          <div><h3>FSY IDs & badges</h3><p>{n(preview?.badge_ids_preserved)} existing FSY IDs remain attached to the same company. {n(preview?.badge_ids_changed)} existing ID{Number(preview?.badge_ids_changed || 0) === 1 ? "" : "s"} would change company and need replacement. {n(preview?.new_ids_issued)} new participant IDs will be issued.</p></div>
        </section>
      </div>

      {mainBlocker ? <MutationFeedback tone="error"><WarningCircle /> {mainBlocker}</MutationFeedback> : null}
      {!mainBlocker && moved ? <MutationFeedback tone="info">The plan moves {n(moved)} existing participant{moved === 1 ? "" : "s"}. Same-company moves keep the FSY ID; a company change receives a replacement ID and is recorded in ID history.</MutationFeedback> : null}

      <div className="session-finalization-guard session-finalization-backup-card">
        <div>
          <b>Keep a way back</b>
          <p>Before the rebalance writes anything, the system automatically saves the current group, company, Staff assignment and FSY ID state. You can also save this version manually now. Restoring is allowed only while the session is still in planning and no live check-in or active Housing work would be overwritten.</p>
        </div>
        <button type="button" className="secondary" disabled={savingVersion || applying || restoring} onClick={saveCurrent}>
          <FloppyDisk />{savingVersion ? "Saving…" : "Save current roster"}
        </button>
      </div>

      {versionNotice ? <MutationFeedback tone="success"><CheckCircle /> {versionNotice}</MutationFeedback> : null}
      {versionIssue ? <MutationFeedback tone="error"><WarningCircle /> {versionIssue.message}</MutationFeedback> : null}

      {versions.length ? <div className="session-roster-versions">
        <div className="session-roster-versions-head">
          <div><b>Saved roster versions</b><span>{latestVersion ? `Latest saved ${shortDate(latestVersion.created_at)}` : "Rollback points"}</span></div>
          <button type="button" className="text-action" disabled={loading || restoring} onClick={reloadVersions}><ArrowClockwise />Refresh</button>
        </div>
        {versions.slice(0, 4).map((version) => <VersionRow key={version.id} version={version} busy={restoring || applying} onRestore={setRestoreTarget} />)}
      </div> : null}

      <div className="session-finalization-guard">
        <b>Nothing is applied by this preview</b>
        <p>The plan remains read-only until you confirm finalization. It also refuses to run while anyone is checked in, which lets you reset the current check-ins and start the final roster from a clean arrival state.</p>
      </div>

      <div className="session-finalization-actions">
        <button type="button" className="primary" disabled={applying || blocked || !preview} onClick={() => setConfirming(true)}>{applying ? "Applying final roster…" : "Apply controlled final roster"}</button>
        <button type="button" className="secondary" disabled={applying || loading} onClick={reload}><ArrowClockwise />{loading ? "Refreshing…" : "Refresh plan"}</button>
      </div>
    </>}

    <ConfirmActionSheet
      open={confirming}
      onClose={() => setConfirming(false)}
      title="Apply this controlled final roster?"
      description="A rollback version is saved first. The system then applies the age 12–18 policy, preserves existing placements where possible, places the new participants, and creates only the additional structure in this plan."
      impact={<div><b>{n(preview?.final_participants)} final participants</b><br />{n(preview?.excluded_age_19_plus)} age 19+ outside the active youth roster<br />{n(moved)} existing placements moved · {n(newGroups)} groups added · {n(newCompanies)} companies added<br />{n(preview?.badge_ids_changed)} existing FSY IDs replaced · {n(preview?.new_ids_issued)} new IDs issued</div>}
      confirmLabel="Apply final roster"
      tone="warn"
      busy={applying}
      onConfirm={apply}
    />

    <ConfirmActionSheet
      open={Boolean(restoreTarget)}
      onClose={() => setRestoreTarget(null)}
      title="Restore this saved roster?"
      description="This returns the operational roster, groups, companies, Staff company assignments and FSY ID state to the selected version. A new safety version is saved immediately before the restore."
      impact={restoreTarget ? <div><b>{restoreTarget.label}</b><br />Saved {shortDate(restoreTarget.created_at)}<br />Restore is blocked if live check-in, active Housing or later head-count dependencies make the rollback unsafe.</div> : null}
      confirmLabel="Restore saved roster"
      tone="warn"
      busy={restoring}
      onConfirm={restoreVersion}
    />
  </section>;
}
