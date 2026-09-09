import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowLeft } from "@phosphor-icons/react/ArrowLeft";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { FileText } from "@phosphor-icons/react/FileText";
import { IdentificationCard } from "@phosphor-icons/react/IdentificationCard";
import { Users } from "@phosphor-icons/react/Users";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { MutationFeedback, Status } from "../components/UI.jsx";
import { loadIdentityReadiness } from "../lib/identity-arrival.js";
import { loadFinalRegistrationBaseline } from "../lib/final-roster.js";
import { loadStaff } from "../lib/operations.js";
import { registrationBlockerCount } from "../lib/registration-workflow-v30.js";
import { isFinalStaff, staffException, staffState } from "../lib/staff-state.js";
import { IdentityFoundationV31 as IdentityFoundationV28 } from "./RegistrationIdentityV31.jsx";
import { RegistrationFinalBaselineV22 as RegistrationFinalBaselineV21 } from "./RegistrationFinalBaselineV22.jsx";
import { StaffReadinessV31 as StaffReadiness } from "./StaffReadinessV31.jsx";
import "./registration-phase2-v30.css";
import "./registration-readiness-demo.css";

const TOOL_META = {
  identity: { label: "FSY IDs", kicker: "Participant identity" },
  staff: { label: "Final Staff roster", kicker: "Staff" },
  final: { label: "Final source", kicker: "Official source" },
};

function currentStaff(rows = []) {
  return rows.filter((person) => person.isCurrent !== false && person.registrationStatus !== "cancelled");
}

function ReadinessCard({ icon: Icon, title, status, tone = "good", value, detail, action, actionLabel, disabled = false }) {
  return <article className={`registration-readiness-card-v30 tone-${tone}`}>
    <div className="registration-readiness-card-icon-v30"><Icon size={22} weight={tone === "good" ? "fill" : "regular"} /></div>
    <div className="registration-readiness-card-copy-v30">
      <div><h3>{title}</h3><Status tone={tone}>{status}</Status></div>
      {value !== undefined && value !== null ? <strong>{value}</strong> : null}
      <p>{detail}</p>
      <button type="button" className="secondary" disabled={disabled} onClick={action}>{actionLabel}<ArrowRight /></button>
    </div>
  </article>;
}

function DemoReadinessTool({ tool, participantCount = 0, onBack }) {
  const meta = {
    identity: {
      icon: IdentificationCard,
      kicker: "Participant identity",
      title: "FSY IDs are not issued in demo mode",
      detail: "The rehearsal uses synthetic participant records so you can exercise the arrival flow. ID preparation, origin review and finalization are live-session operations and are deliberately not simulated here.",
      stat: `${participantCount.toLocaleString()} synthetic participant records`,
    },
    staff: {
      icon: Users,
      kicker: "Staff",
      title: "Staff readiness is not simulated in demo mode",
      detail: "No Staff records are seeded in the rehearsal. Sign in to a session with the appropriate scope to review source approval, service confirmation, arrival and assignment readiness.",
      stat: "Live Staff data required",
    },
    final: {
      icon: FileText,
      kicker: "Official source",
      title: "The final source is not applied in demo mode",
      detail: "The rehearsal cannot upload, preview or apply a source roster. This keeps synthetic data separate from real participant, counselor and access records.",
      stat: "No live roster write available",
    },
  }[tool] || {};
  const Icon = meta.icon || FileText;
  return <section className="registration-readiness-demo-tool" aria-label={`${meta.title || "Demo readiness"}`}>
    <div className="registration-readiness-tool-head-v30">
      <button type="button" className="secondary registration-readiness-back-v30" onClick={onBack}><ArrowLeft />Readiness</button>
      <div><span className="kicker">{meta.kicker}</span><h2>{meta.title}</h2></div>
    </div>
    <article className="panel registration-readiness-demo-card">
      <div className="registration-readiness-demo-icon"><Icon size={26} /></div>
      <div><Status tone="muted">Demo only</Status><p>{meta.detail}</p><strong>{meta.stat}</strong></div>
    </article>
  </section>;
}

export function RegistrationReadinessV30({
  imported = [], cohort, live = false, sessionId, capabilities = [], canManage = false,
  setImported, onChanged, onFinalBaselineChanged, onNavigate,
}) {
  const demoMode = !live || !sessionId;
  const [tool, setTool] = useState("overview");
  const [visited, setVisited] = useState(() => new Set());
  const [identity, setIdentity] = useState(null);
  const [staff, setStaff] = useState([]);
  const [baseline, setBaseline] = useState(null);
  const [loading, setLoading] = useState(Boolean(live && sessionId));
  const [error, setError] = useState("");
  const [checkErrors, setCheckErrors] = useState({});
  const blockerCount = useMemo(() => registrationBlockerCount(imported), [imported]);
  const staffCurrent = useMemo(() => currentStaff(staff), [staff]);
  const staffFinal = useMemo(() => staffCurrent.filter(isFinalStaff).length, [staffCurrent]);
  const staffConfirmation = useMemo(() => staffCurrent.filter((person) => staffState(person).clearance === "confirmation_required").length, [staffCurrent]);
  const staffAttention = useMemo(() => staffCurrent.filter((person) => Boolean(staffException(person))).length, [staffCurrent]);

  const reload = async () => {
    if (!live || !sessionId) {
      const activeIds = imported.filter((person) => Boolean(person.fsyId)).length;
      setIdentity({ draftIds: 0, finalizedIds: activeIds ? activeIds : 0, unresolvedOrigin: 0 });
      setStaff([]);
      setBaseline(null);
      setLoading(false);
      setError("");
      setCheckErrors({});
      return;
    }
    setLoading(true);
    setError("");
    setCheckErrors({});
    const results = await Promise.allSettled([
      loadIdentityReadiness(sessionId),
      loadStaff(sessionId),
      loadFinalRegistrationBaseline(sessionId),
    ]);
    const labels = ["identity", "staff", "baseline"];
    const failures = {};
    results.forEach((result, index) => {
      if (result.status === "rejected") failures[labels[index]] = result.reason?.message || "Could not refresh";
    });
    if (results[0].status === "fulfilled") setIdentity(results[0].value);
    if (results[1].status === "fulfilled") setStaff(results[1].value || []);
    if (results[2].status === "fulfilled") setBaseline(results[2].value || null);
    setCheckErrors(failures);
    const failedCount = Object.keys(failures).length;
    if (failedCount) setError(`${failedCount} readiness check${failedCount === 1 ? "" : "s"} could not refresh. No failed check is being shown as ready.`);
    setLoading(false);
  };

  useEffect(() => { reload().catch((err) => { setError(err.message || "Readiness could not load."); setCheckErrors({ identity: "Could not load", staff: "Could not load", baseline: "Could not load" }); setLoading(false); }); }, [sessionId, live]);

  const openTool = (next) => {
    setVisited((current) => {
      if (current.has(next)) return current;
      const updated = new Set(current);
      updated.add(next);
      return updated;
    });
    setTool(next);
  };

  const identityPending = !identity || (!Number(identity.finalizedIds || 0) && !Number(identity.draftIds || 0));
  const identityReview = Number(identity?.unresolvedOrigin || 0);
  const identityStatus = demoMode ? "Demo only" : checkErrors.identity ? "Could not load" : loading && !identity ? "Checking" : identityReview ? `${identityReview} origin issue${identityReview === 1 ? "" : "s"}` : Number(identity?.finalizedIds || 0) ? "Finalized" : Number(identity?.draftIds || 0) ? "Draft ready" : "Not prepared";
  const identityTone = demoMode ? "muted" : checkErrors.identity ? "danger" : loading && !identity ? "muted" : identityReview || identityPending ? "warn" : "good";
  const staffStatus = demoMode ? "Demo only" : checkErrors.staff ? "Could not load" : loading && !staff.length ? "Checking" : staffConfirmation ? `${staffConfirmation} need confirmation` : staffAttention ? `${staffAttention} need review` : staffCurrent.length ? "Ready" : "No Staff loaded";
  const staffTone = demoMode ? "muted" : checkErrors.staff ? "danger" : loading && !staff.length ? "muted" : staffConfirmation || staffAttention || !staffCurrent.length ? "warn" : "good";
  const baselineStatus = demoMode ? "Demo only" : checkErrors.baseline ? "Could not load" : loading && baseline === null ? "Checking" : baseline ? "Final source active" : "Not finalized";
  const baselineTone = demoMode ? "muted" : checkErrors.baseline ? "danger" : loading && baseline === null ? "muted" : baseline ? "good" : "warn";
  const hasCheckErrors = Object.keys(checkErrors).length > 0;

  const nextStep = demoMode
    ? { title: "Explore the rehearsal workspace", text: "Synthetic data demonstrates the day-one participant flow. Live roster, FSY ID and Staff readiness checks appear after sign-in.", action: () => onNavigate?.({ view: "registration", mode: "desk" }), label: "Open Live check-in" }
    : hasCheckErrors
    ? { title: "Retry the readiness checks", text: "At least one supporting check did not load, so Readiness will not guess or mark it complete.", action: reload, label: "Retry checks" }
    : !baseline
      ? { title: "Confirm the final source", text: "Use the complete official Participant + Counselor export before treating the working structure as final.", action: () => openTool("final"), label: "Open Final source" }
      : blockerCount
        ? { title: `Finish ${blockerCount.toLocaleString()} participant decision${blockerCount === 1 ? "" : "s"}`, text: "Work the remaining participant records in Final roster. Each decision keeps the source record and changes only the active session list.", action: () => onNavigate?.({ view: "registration", mode: "roster", filter: "needs_help" }), label: "Open Final roster" }
        : identityPending || identityReview
          ? { title: "Finish participant identities", text: "Prepare and review FSY IDs after the active participant cohort and counselor groups are stable.", action: () => openTool("identity"), label: "Open FSY IDs" }
          : staffConfirmation || staffAttention
            ? { title: "Finish the final Staff roster", text: "Confirm who is serving, then finish Counselor and Assistant Coordinator coverage in Assignments.", action: () => openTool("staff"), label: "Open Final Staff roster" }
            : { title: "Registration readiness is clear", text: "The final source, participant decisions, participant identities and Staff readiness do not currently show an open task.", action: () => onNavigate?.({ view: "registration", mode: "desk" }), label: "Go to Live check-in" };

  const toolMeta = TOOL_META[tool];
  if (tool !== "overview") {
    if (demoMode) return <DemoReadinessTool tool={tool} participantCount={imported.length || Number(cohort?.eligible || 0)} onBack={() => setTool("overview")} />;
    return <section className="registration-readiness-v30 registration-readiness-tool-v30">
      <div className="registration-readiness-tool-head-v30">
        <button type="button" className="secondary registration-readiness-back-v30" onClick={() => setTool("overview")}><ArrowLeft />Readiness</button>
        <div><span className="kicker">{toolMeta?.kicker}</span><h2>{toolMeta?.label}</h2></div>
      </div>
      {visited.has("identity") ? <div hidden={tool !== "identity"}><IdentityFoundationV28 sessionId={sessionId} capabilities={capabilities} onChanged={async () => { await onChanged?.(); await reload(); }} /></div> : null}
      {visited.has("staff") ? <div hidden={tool !== "staff"}><StaffReadiness sessionId={sessionId} onNavigate={onNavigate} /></div> : null}
      {visited.has("final") ? <div hidden={tool !== "final"}><RegistrationFinalBaselineV21 sessionId={sessionId} canManage={canManage} setImported={setImported} onChanged={onFinalBaselineChanged || onChanged} onNavigate={onNavigate} /></div> : null}
    </section>;
  }

  return <section className="registration-readiness-v30" aria-busy={loading}>
    {error ? <MutationFeedback tone="error">{error} <button type="button" className="text-action" onClick={reload}>Retry</button></MutationFeedback> : null}
    <article className="panel registration-readiness-next-v30">
      <div className="registration-readiness-next-icon-v30">{hasCheckErrors || blockerCount || identityPending || identityReview || staffConfirmation || staffAttention || !baseline ? <WarningCircle size={24} /> : <CheckCircle size={24} weight="fill" />}</div>
      <div><span className="kicker">Recommended next action</span><h2>{loading ? "Checking readiness…" : nextStep.title}</h2><p>{loading ? "Reading the final roster, participant decisions, identities and Staff state without hiding the current screen." : nextStep.text}</p></div>
      <button type="button" className="primary" disabled={loading} onClick={nextStep.action}>{loading ? "Checking…" : nextStep.label}<ArrowRight /></button>
    </article>

    <div className="registration-readiness-summary-v30">
      <span><b>{Number(cohort?.eligible || 0).toLocaleString()}</b><small>final youth now</small></span>
      <span><b>{blockerCount.toLocaleString()}</b><small>participant decisions left</small></span>
      <span><b>{demoMode || checkErrors.staff ? "—" : staffFinal.toLocaleString()}</b><small>{demoMode ? "live Staff check" : "final Staff now"}</small></span>
      <button type="button" className="text-action" disabled={loading} onClick={reload}><ArrowClockwise />{loading ? "Checking" : "Refresh readiness"}</button>
    </div>

    <div className="registration-readiness-grid-v30">
      <ReadinessCard icon={WarningCircle} title="Final participant roster" status={blockerCount ? "Decisions left" : demoMode ? "Demo clear" : "Clear"} tone={blockerCount ? "warn" : "good"} value={blockerCount.toLocaleString()} detail={blockerCount ? "These records still need a final session decision, verification, placement, identity or attendance follow-up." : demoMode ? "No participant decisions are simulated in this rehearsal. Live records appear after sign-in." : "No current participant is waiting on a final roster decision."} action={() => onNavigate?.({ view: "registration", mode: "roster", filter: blockerCount ? "needs_help" : "all" })} actionLabel="Open Final roster" />
      <ReadinessCard icon={FileText} title="Final source" status={baselineStatus} tone={baselineTone} value={!demoMode && !checkErrors.baseline && baseline ? Number(baseline.recordCount || 0).toLocaleString() : undefined} detail={demoMode ? "The rehearsal does not represent an applied official source roster." : checkErrors.baseline ? "The final-source check did not load. Retry before treating this state as complete." : baseline ? `Active final source · ${baseline.sourceFilename}` : "The final Participant + Counselor export has not been confirmed as the active source."} action={() => openTool("final")} actionLabel="Open Final source" disabled={!demoMode && loading && baseline === null} />
      <ReadinessCard icon={IdentificationCard} title="FSY IDs" status={identityStatus} tone={identityTone} value={!demoMode && !checkErrors.identity && identity ? Number(identity.finalizedIds || identity.draftIds || 0).toLocaleString() : undefined} detail={demoMode ? "Synthetic records support navigation only; live ID preparation and origin review require sign-in." : checkErrors.identity ? "The participant-identity check did not load. Retry before treating this state as complete." : identityReview ? `${identityReview} origin issue${identityReview === 1 ? "" : "s"} must be resolved before finalization.` : Number(identity?.finalizedIds || 0) ? "The active participant identity set is finalized." : "Prepare IDs only after the active participant cohort and counselor groups are stable."} action={() => openTool("identity")} actionLabel="Open FSY IDs" disabled={!demoMode && loading && !identity} />
      <ReadinessCard icon={Users} title="Final Staff roster" status={staffStatus} tone={staffTone} value={!demoMode && !checkErrors.staff && staffCurrent.length ? `${staffFinal.toLocaleString()} / ${staffCurrent.length.toLocaleString()}` : undefined} detail={demoMode ? "Staff records are not seeded in this rehearsal; live permission-scoped Staff checks require sign-in." : checkErrors.staff ? "The Staff readiness check did not load. Retry before treating this state as complete." : staffConfirmation ? `${staffConfirmation} Staff member${staffConfirmation === 1 ? "" : "s"} still need local service confirmation.` : staffAttention ? `${staffAttention} Staff member${staffAttention === 1 ? "" : "s"} have a clearance, arrival or replacement issue.` : "Current Staff who are confirmed and active in the plan form the final Staff roster."} action={() => openTool("staff")} actionLabel="Open Final Staff roster" disabled={!demoMode && loading && !staff.length} />
    </div>

    <p className="registration-readiness-principle-v30"><CheckCircle size={18} weight="fill" /><span><b>One final participant queue.</b> Final roster holds the remaining youth decisions. Readiness checks the supporting setup and points to the next place to work.</span></p>
  </section>;
}
