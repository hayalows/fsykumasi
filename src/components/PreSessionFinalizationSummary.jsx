import { useEffect, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { MutationFeedback, Status } from "./UI.jsx";
import { loadPreSessionFinalizationSummary } from "../lib/pre-session-finalization.js";

const number = (value) => Number(value || 0).toLocaleString();

export function PreSessionFinalizationSummary({ sessionId, onNavigate }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [error, setError] = useState("");

  const load = async () => {
    if (!sessionId) return;
    setLoading(true);
    setError("");
    try {
      setSummary(await loadPreSessionFinalizationSummary(sessionId));
    } catch (err) {
      setError(err.message || "Final roster progress could not load.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [sessionId]);
  if (!sessionId) return null;

  const participantLeft = Number(summary?.participantRemaining || 0);
  const staffLeft = Number(summary?.staffRemaining || 0);
  const groupLeft = Number(summary?.groupsNeedCounselor || 0);
  const companyLeft = Number(summary?.companiesNeedAssistant || 0);
  const open = participantLeft + staffLeft + groupLeft + companyLeft;

  return <section className="pre-session-finalization-v38" aria-busy={loading}>
    {error ? <MutationFeedback tone="error">{error} <button type="button" className="text-action" onClick={load}>Retry</button></MutationFeedback> : null}
    <article className="panel pre-session-finalization-v38-card">
      <div className="pre-session-finalization-v38-head">
        <div className="pre-session-finalization-v38-icon">{open ? <WarningCircle size={24} /> : <CheckCircle size={24} weight="fill" />}</div>
        <div><span className="kicker">Before Monday</span><h2>{loading ? "Checking final rosters…" : open ? "Finish the final rosters" : "Final rosters are clear"}</h2><p>One place to see the youth list, Staff readiness and missing coverage before the rehearsal and Day One.</p></div>
        <Status tone={loading ? "muted" : open ? "warn" : "good"}>{loading ? "Checking" : open ? `${number(open)} items left` : "Ready"}</Status>
      </div>
      <div className="pre-session-finalization-v38-stats" aria-label="Final roster progress">
        <span><small>Final youth</small><b>{loading ? "—" : `${number(summary?.participantFinal)} / ${number(summary?.participantCurrent)}`}</b><em>{loading ? "Loading" : participantLeft ? `${number(participantLeft)} decisions left` : "Participant list clear"}</em></span>
        <span><small>Final Staff</small><b>{loading ? "—" : `${number(summary?.staffFinal)} / ${number(summary?.staffCurrent)}`}</b><em>{loading ? "Loading" : staffLeft ? `${number(staffLeft)} need confirmation` : "Staff list clear"}</em></span>
        <span><small>Counselor groups</small><b>{loading ? "—" : `${number((summary?.groupsTotal || 0) - groupLeft)} / ${number(summary?.groupsTotal)}`}</b><em>{loading ? "Loading" : groupLeft ? `${number(groupLeft)} need a Counselor` : "Every group covered"}</em></span>
        <span><small>Companies</small><b>{loading ? "—" : `${number((summary?.companiesTotal || 0) - companyLeft)} / ${number(summary?.companiesTotal)}`}</b><em>{loading ? "Loading" : companyLeft ? `${number(companyLeft)} need an Assistant Coordinator` : "Every company covered"}</em></span>
      </div>
      {!loading ? <div className="pre-session-finalization-v38-actions">
        <button type="button" className="secondary" onClick={() => onNavigate?.({ view: "registration", mode: "readiness" })}>Staff readiness<ArrowRight /></button>
        <button type="button" className="secondary" onClick={() => onNavigate?.({ view: "assignments", tab: groupLeft ? "groups" : "companies", filter: "needs" })}>Finish Staff coverage<ArrowRight /></button>
        <button type="button" className="secondary" onClick={() => onNavigate?.({ view: "reports" })}>Open final participant report<ArrowRight /></button>
        {summary?.assistantCompanyLimit === 1 && companyLeft ? <small className="pre-session-finalization-v38-note">Assistant Coordinator coverage is currently limited to 1 company each. The Staff coverage screen can change that planning limit before applying suggestions.</small> : null}
      </div> : null}
    </article>
  </section>;
}
