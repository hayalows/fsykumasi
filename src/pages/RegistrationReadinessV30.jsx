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
import { staffException, staffState } from "../lib/staff-state.js";
import { IdentityFoundationV28 } from "./RegistrationIdentityV28.jsx";
import { RegistrationFinalBaselineV21 } from "./RegistrationFinalBaselineV21.jsx";
import { StaffReadiness } from "./StaffReadiness.jsx";
import "./registration-phase2-v30.css";

const TOOL_META = {
  identity: { label: "FSY IDs", kicker: "Participant identity" },
  staff: { label: "Staff readiness", kicker: "Staff" },
  final: { label: "Final roster", kicker: "Official source" },
};

function currentStaff(rows = []) {
  return rows.filter((person) => person.isCurrent !== false && person.registrationStatus !== "cancelled");
}

function readinessTone(kind, value) {
  if (kind === "loading") return "muted";
  if (kind === "error") return "danger";
  return value ? "warn" : "good";
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

export function RegistrationReadinessV30({
  imported = [], cohort, live = false, sessionId, capabilities = [], canManage = false,
  setImported, onChanged, onNavigate,
}) {
  const [tool, setTool] = useState("overview");
  const [visited, setVisited] = useState(() => new Set());
  const [identity, setIdentity] = useState(null);
  const [staff, setStaff] = useState([]);
  const [baseline, setBaseline] = useState(null);
  const [loading, setLoading] = useState(Boolean(live && sessionId));
  const [error, setError] = useState("");
  const blockerCount = useMemo(() => registrationBlockerCount(imported), [imported]);
  const staffCurrent = useMemo(() => currentStaff(staff), [staff]);
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
      return;
    }
    setLoading(true);
    setError("");
    const results = await Promise.allSettled([
      loadIdentityReadiness(sessionId),
      loadStaff(sessionId),
      loadFinalRegistrationBaseline(sessionId),
    ]);
    if (results[0].status === "fulfilled") setIdentity(results[0].value);
    if (results[1].status === "fulfilled") setStaff(results[1].value || []);
    if (results[2].status === "fulfilled") setBaseline(results[2].value || null);
    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length) setError(`${failed.length} readiness check${failed.length === 1 ? "" : "s"} could not refresh.`);
    setLoading(false);
  };

  useEffect(() => { reload().catch((err) => { setError(err.message || "Readiness could not load."); setLoading(false); }); }, [sessionId, live]);

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
  const identityStatus = loading && !identity ? "Checking" : identityReview ? `${identityReview} origin issue${identityReview === 1 ? "" : "s"}` : Number(identity?.finalizedIds || 0) ? "Finalized" : Number(identity?.draftIds || 0) ? "Draft ready" : "Not prepared";
  const identityTone = loading && !identity ? "muted" : identityReview || identityPending ? "warn" : "good";
  const staffStatus = loading && !staff.length ? "Checking" : staffConfirmation ? `${staffConfirmation} need confirmation` : staffAttention ? `${staffAttention} need attention` : staffCurrent.length ? "Ready" : "No Staff loaded";
  const staffTone = loading && !staff.length ? "muted" : staffConfirmation || staffAttention || !staffCurrent.length ? "warn" : "good";
  const baselineStatus = loading && baseline === null ? "Checking" : baseline ? "Final baseline active" : "Not finalized";
  const baselineTone = loading && baseline === null ? "muted" : baseline ? "good" : "warn";

  const nextStep = !baseline
    ? { title: "Confirm the final roster", text: "Use the complete official Participant + Counselor export before treating rehearsal structure as final.", action: () => openTool("final"), label: "Open Final roster" }
    : blockerCount
      ? { title: `Resolve ${blockerCount.toLocaleString()} participant blocker${blockerCount === 1 ? "" : "s"}`, text: "Participant exceptions live in one place now. Work them in Solutions instead of repeating a separate preflight queue.", action: () => onNavigate?.({ view: "registration", mode: "roster", filter: "needs_help" }), label: "Open Solutions" }
      : identityPending || identityReview
        ? { title: "Finish participant identities", text: "Prepare and review FSY IDs after the active participant cohort and counselor groups are stable.", action: () => openTool("identity"), label: "Open FSY IDs" }
        : staffConfirmation || staffAttention
          ? { title: "Finish Staff readiness", text: "Source approval stays separate from service confirmation and operational assignment readiness.", action: () => openTool("staff"), label: "Open Staff readiness" }
          : { title: "Registration readiness is clear", text: "The final roster, participant blockers, participant identities and Staff readiness do not currently show an open readiness task.", action: () => onNavigate?.({ view: "registration", mode: "desk" }), label: "Go to Live check-in" };

  const toolMeta = TOOL_META[tool];
  if (tool !== "overview") {
    return <section className="registration-readiness-v30 registration-readiness-tool-v30">
      <div className="registration-readiness-tool-head-v30">
        <button type="button" className="secondary registration-readiness-back-v30" onClick={() => setTool("overview")}><ArrowLeft />Readiness</button>
        <div><span className="kicker">{toolMeta?.kicker}</span><h2>{toolMeta?.label}</h2></div>
      </div>
      {visited.has("identity") ? <div hidden={tool !== "identity"}><IdentityFoundationV28 sessionId={sessionId} capabilities={capabilities} onChanged={async () => { await onChanged?.(); await reload(); }} /></div> : null}
      {visited.has("staff") ? <div hidden={tool !== "staff"}><StaffReadiness sessionId={sessionId} onNavigate={onNavigate} /></div> : null}
      {visited.has("final") ? <div hidden={tool !== "final"}><RegistrationFinalBaselineV21 sessionId={sessionId} canManage={canManage} setImported={setImported} onChanged={async () => { await onChanged?.(); await reload(); }} onNavigate={onNavigate} /></div> : null}
    </section>;
  }

  return <section className="registration-readiness-v30" aria-busy={loading}>
    {error ? <MutationFeedback tone="error">{error} <button type="button" className="text-action" onClick={reload}>Retry</button></MutationFeedback> : null}
    <article className="panel registration-readiness-next-v30">
      <div className="registration-readiness-next-icon-v30">{blockerCount || identityPending || identityReview || staffConfirmation || staffAttention || !baseline ? <WarningCircle size={24} /> : <CheckCircle size={24} weight="fill" />}</div>
      <div><span className="kicker">Recommended next action</span><h2>{loading ? "Checking readiness…" : nextStep.title}</h2><p>{loading ? "Reading the final roster, participant blockers, identities and Staff state without hiding the current screen." : nextStep.text}</p></div>
      <button type="button" className="primary" disabled={loading} onClick={nextStep.action}>{loading ? "Checking…" : nextStep.label}<ArrowRight /></button>
    </article>

    <div className="registration-readiness-summary-v30">
      <span><b>{Number(cohort?.eligible || 0).toLocaleString()}</b><small>eligible youth</small></span>
      <span><b>{blockerCount.toLocaleString()}</b><small>participant blockers</small></span>
      <span><b>{staffCurrent.length.toLocaleString()}</b><small>current Staff</small></span>
      <button type="button" className="text-action" disabled={loading} onClick={reload}><ArrowClockwise />{loading ? "Checking" : "Refresh readiness"}</button>
    </div>

    <div className="registration-readiness-grid-v30">
      <ReadinessCard
        icon={WarningCircle}
        title="Participant blockers"
        status={blockerCount ? "Needs action" : "Clear"}
        tone={blockerCount ? "warn" : "good"}
        value={blockerCount.toLocaleString()}
        detail={blockerCount ? "Approval, eligibility, verification, placement, identity or follow-up is blocking normal check-in." : "No current participant is blocked from the normal Registration path."}
        action={() => onNavigate?.({ view: "registration", mode: "roster", filter: blockerCount ? "needs_help" : "all" })}
        actionLabel="Open Solutions"
      />
      <ReadinessCard
        icon={FileText}
        title="Final roster"
        status={baselineStatus}
        tone={baselineTone}
        value={baseline ? Number(baseline.recordCount || 0).toLocaleString() : undefined}
        detail={baseline ? `Active final source · ${baseline.sourceFilename}` : "The final Participant + Counselor export has not been confirmed as the active baseline."}
        action={() => openTool("final")}
        actionLabel="Open Final roster"
        disabled={loading && baseline === null}
      />
      <ReadinessCard
        icon={IdentificationCard}
        title="FSY IDs"
        status={identityStatus}
        tone={identityTone}
        value={identity ? Number(identity.finalizedIds || identity.draftIds || 0).toLocaleString() : undefined}
        detail={identityReview ? `${identityReview} origin issue${identityReview === 1 ? "" : "s"} must be resolved before finalization.` : Number(identity?.finalizedIds || 0) ? "The active participant identity set is finalized." : "Prepare IDs only after the active participant cohort and counselor groups are stable."}
        action={() => openTool("identity")}
        actionLabel="Open FSY IDs"
        disabled={loading && !identity}
      />
      <ReadinessCard
        icon={Users}
        title="Staff readiness"
        status={staffStatus}
        tone={staffTone}
        value={staffCurrent.length ? staffCurrent.length.toLocaleString() : undefined}
        detail={staffConfirmation ? `${staffConfirmation} Staff member${staffConfirmation === 1 ? "" : "s"} still need service confirmation.` : staffAttention ? `${staffAttention} Staff member${staffAttention === 1 ? "" : "s"} have a clearance, arrival or replacement issue.` : "Source approval, service confirmation and operational readiness stay separate."}
        action={() => openTool("staff")}
        actionLabel="Open Staff readiness"
        disabled={loading && !staff.length}
      />
    </div>

    <p className="registration-readiness-principle-v30"><CheckCircle size={18} weight="fill" /><span><b>One exception queue.</b> Participant problems are resolved in Solutions. Readiness only tells you whether the supporting setup is ready and sends you to the correct tool.</span></p>
  </section>;
}
