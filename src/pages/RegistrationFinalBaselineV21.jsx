import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { Check } from "@phosphor-icons/react/Check";
import { CloudArrowUp } from "@phosphor-icons/react/CloudArrowUp";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { MutationFeedback, Status } from "../components/UI.jsx";
import { loadParticipants, loadSession } from "../lib/backend.js";
import { parseFinalRosterFile, resolveFinalRosterRecords } from "../lib/final-roster-import.js";
import { applyFinalRegistrationBaseline, loadFinalRegistrationBaseline, previewFinalRegistrationBaseline } from "../lib/final-roster.js";
import "./registration-final-v21.css";

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function statusLabel(value) {
  return value === "approved" ? "Approved" : value === "awaiting" ? "Awaiting approval" : value === "cancelled" ? "Cancelled" : value;
}

function impactItem(label, value, note = "") {
  return <span><b>{Number(value || 0).toLocaleString()}</b><small>{label}</small>{note ? <em>{note}</em> : null}</span>;
}

export function RegistrationFinalBaselineV21({ sessionId, canManage = false, setImported, onChanged, onNavigate }) {
  const input = useRef(null);
  const [session, setSession] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [filename, setFilename] = useState("");
  const [result, setResult] = useState(null);
  const [resolutions, setResolutions] = useState({});
  const [preview, setPreview] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState(null);

  const refreshState = async () => {
    if (!sessionId) return;
    const [nextSession, nextBaseline] = await Promise.all([loadSession(sessionId), loadFinalRegistrationBaseline(sessionId)]);
    setSession(nextSession);
    setBaseline(nextBaseline);
  };

  useEffect(() => { refreshState().catch((error) => setMessage({ tone: "error", text: error.message })); }, [sessionId]);

  const conflicts = result?.identityConflicts || [];
  const unresolved = useMemo(() => conflicts.filter((group) => !resolutions[group.id]), [conflicts, resolutions]);
  const suggested = useMemo(() => conflicts.filter((group) => group.resolution === "merge").length, [conflicts]);

  const choose = async (file) => {
    if (!file) return;
    setBusy("read");
    setMessage(null);
    setPreview(null);
    setConfirmReset(false);
    setFilename(file.name);
    try {
      const next = await parseFinalRosterFile(file, {
        sessionStart: session?.starts_on || "2026-09-14",
        sessionEnd: session?.ends_on || "2026-09-19",
      });
      const defaults = Object.fromEntries(next.identityConflicts.filter((group) => group.resolution).map((group) => [group.id, group.resolution]));
      setResolutions(defaults);
      setResult(next);
    } catch (error) {
      setResult(null);
      setMessage({ tone: "error", text: error.message || "The final roster could not be read." });
    } finally {
      setBusy("");
    }
  };

  const decide = (id, value) => {
    setResolutions((current) => ({ ...current, [id]: value }));
    setPreview(null);
    setConfirmReset(false);
  };

  const previewImpact = async () => {
    if (!result || result.errors.length || unresolved.length || !canManage) return;
    setBusy("preview");
    setMessage(null);
    try {
      const resolved = await resolveFinalRosterRecords(result, resolutions);
      const impact = await previewFinalRegistrationBaseline({ sessionId, records: resolved.records });
      setPreview({ impact, resolved });
      setMessage({ tone: "success", text: "The file passed the final-roster checks. Review the impact below before applying it." });
    } catch (error) {
      setPreview(null);
      setMessage({ tone: "error", text: error.message || "The final roster could not be previewed safely." });
    } finally {
      setBusy("");
    }
  };

  const apply = async () => {
    if (!preview?.resolved?.records?.length || !confirmReset || !canManage) return;
    setBusy("apply");
    setMessage(null);
    try {
      const summary = await applyFinalRegistrationBaseline({
        sessionId,
        sourceFilename: filename,
        sourceSha256: result.sourceSha256,
        records: preview.resolved.records,
      });
      if (setImported) setImported(await loadParticipants(sessionId));
      await onChanged?.();
      await refreshState();
      setResult(null);
      setPreview(null);
      setConfirmReset(false);
      setMessage({
        tone: "success",
        text: `Final roster applied: ${Number(summary.participant_count || 0).toLocaleString()} youth and ${Number(summary.staff_count || 0).toLocaleString()} counselor records. Rehearsal groups, companies and staff assignments were cleared so the real structure can be built fresh.`,
      });
    } catch (error) {
      setMessage({ tone: "error", text: error.message || "The final roster was not applied. No partial baseline should be kept." });
    } finally {
      setBusy("");
    }
  };

  return <section className="final-roster-v21">
    {message ? <MutationFeedback tone={message.tone}>{message.text}</MutationFeedback> : null}

    <article className="panel final-roster-v21-intro">
      <div>
        <span className="kicker">Final FSY roster</span>
        <h2>{baseline ? "A final baseline is already active" : "Replace rehearsal data safely"}</h2>
        <p>This workflow is only for the complete final Participant + Counselor export. Accounts, passwords, Access permissions and manually created leadership are preserved. Rehearsal structure and roster-derived activity are reset only after the file passes every check.</p>
      </div>
      {baseline ? <Status tone="good">Final baseline active</Status> : <Status tone="warn">Not finalized</Status>}
    </article>

    {baseline ? <div className="final-roster-v21-current">
      <span><b>{Number(baseline.recordCount || 0).toLocaleString()}</b><small>records in active final baseline</small></span>
      <span><b>{Number(baseline.participantCount || 0).toLocaleString()}</b><small>participants</small></span>
      <span><b>{Number(baseline.staffCount || 0).toLocaleString()}</b><small>counselors</small></span>
      <p>Applied {formatDate(baseline.createdAt)} · {baseline.sourceFilename}</p>
    </div> : null}

    <article className="panel final-roster-v21-upload">
      <div className="panel-head"><div><span className="kicker">1 · Read the file</span><h2>{baseline ? "Replace the final baseline" : "Choose the complete final export"}</h2><p>Nothing changes in production while the file is being checked.</p></div></div>
      <button type="button" className="dropzone" disabled={!canManage || busy === "read"} onClick={() => input.current?.click()}>
        <CloudArrowUp size={30}/><b>{busy === "read" ? "Checking file…" : filename || "Choose final CSV or Excel file"}</b><span>Dates, statuses, session-age calculations and possible duplicate registrations are checked locally first.</span>
      </button>
      <input ref={input} hidden type="file" accept=".csv,.xlsx,.xls" onChange={(event) => choose(event.target.files?.[0])}/>
    </article>

    {result ? <>
      <article className="panel final-roster-v21-review">
        <div className="panel-head"><div><span className="kicker">2 · Validate</span><h2>{result.summary.total.toLocaleString()} source registrations</h2><p>Ages are calculated for {session?.starts_on || result.sessionStart}; the source Age column remains informational.</p></div><Status tone={result.errors.length ? "danger" : unresolved.length ? "warn" : "good"}>{result.errors.length ? `${result.errors.length} blocking` : unresolved.length ? `${unresolved.length} identity decisions` : "File checks passed"}</Status></div>
        <div className="final-roster-v21-metrics">
          {impactItem("participants", result.summary.participants)}
          {impactItem("counselors", result.summary.staff)}
          {impactItem("approved", result.summary.approved)}
          {impactItem("awaiting approval", result.summary.awaiting)}
          {impactItem("cancelled", result.summary.cancelled)}
          {impactItem("ages recalculated", result.summary.ageAdjusted)}
        </div>
        {result.errors.length || result.warnings.length ? <div className="error-list">{[...result.errors, ...result.warnings].slice(0, 16).map((issue, index) => <p key={`${issue.row}-${issue.field}-${index}`}><b>Row {issue.row}:</b> {issue.message}{issue.severity === "warning" ? " · review recommended" : ""}</p>)}</div> : null}
      </article>

      {conflicts.length ? <article className="panel final-roster-v21-identities">
        <div className="panel-head"><div><span className="kicker">3 · Possible re-registrations</span><h2>{conflicts.length} matching identity groups</h2><p>{suggested ? `${suggested} strong duplicate/re-registration matches were preselected. ` : ""}For the rest, decide whether the rows describe one person or genuinely different people. Email alone is never used as participant identity.</p></div><Status tone={unresolved.length ? "warn" : "good"}>{unresolved.length ? `${unresolved.length} unresolved` : "Reviewed"}</Status></div>
        <div className="final-roster-v21-conflict-list">
          {conflicts.map((group, index) => <div className={`final-roster-v21-conflict${resolutions[group.id] ? " resolved" : ""}`} key={group.id}>
            <div className="final-roster-v21-conflict-head"><span><b>{group.rows[0]?.fullName || `Possible duplicate ${index + 1}`}</b><small>{group.reason}</small></span><Status tone={resolutions[group.id] ? "good" : "warn"}>{resolutions[group.id] === "merge" ? "Use latest registration" : resolutions[group.id] === "keep" ? "Keep separate" : "Decision needed"}</Status></div>
            <div className="final-roster-v21-conflict-rows">{group.rows.map((row) => <span key={row.row}><b>{statusLabel(row.registrationStatus)}</b><small>{row.unit || "Unit missing"} · {row.registeredAtRaw || row.registeredAt}</small></span>)}</div>
            <div className="final-roster-v21-conflict-actions"><button type="button" className={resolutions[group.id] === "merge" ? "primary" : "secondary"} onClick={() => decide(group.id, "merge")}>Same person · use latest</button><button type="button" className={resolutions[group.id] === "keep" ? "primary" : "secondary"} onClick={() => decide(group.id, "keep")}>Different people · keep both</button></div>
          </div>)}
        </div>
      </article> : null}

      <article className="panel final-roster-v21-preview">
        <div className="panel-head"><div><span className="kicker">4 · Preview database impact</span><h2>Verify before anything changes</h2><p>The server independently validates the resolved roster and counts what will be preserved, reconciled and reset.</p></div></div>
        <div className="panel-actions"><span>{unresolved.length ? `${unresolved.length} identity decision${unresolved.length === 1 ? "" : "s"} remaining` : result.errors.length ? "Fix blocking file errors first" : "Ready for database preview"}</span><button type="button" className="primary" disabled={!canManage || Boolean(result.errors.length) || Boolean(unresolved.length) || busy === "preview"} onClick={previewImpact}>{busy === "preview" ? "Checking production…" : "Preview final baseline"}<ArrowRight/></button></div>
      </article>
    </> : null}

    {preview ? <article className="panel final-roster-v21-impact">
      <div className="panel-head"><div><span className="kicker">5 · Final confirmation</span><h2>Production impact is understood</h2><p>The apply step is one database transaction: if any safety assertion fails, the baseline is rolled back.</p></div><Status tone="good">Server preview passed</Status></div>
      <div className="final-roster-v21-metrics">
        {impactItem("final participants", preview.impact.participant_count)}
        {impactItem("final counselors", preview.impact.staff_count)}
        {impactItem("existing youth matched", preview.impact.matched_participants)}
        {impactItem("existing staff matched", preview.impact.matched_staff)}
        {impactItem("manual leaders preserved", preview.impact.manual_staff_preserved)}
        {impactItem("linked accounts preserved", preview.impact.account_links_preserved)}
      </div>
      <div className="final-roster-v21-reset-note"><WarningCircle/><span><b>What becomes fresh</b><small>{Number(preview.impact.companies_to_reset || 0)} rehearsal companies · {Number(preview.impact.groups_to_reset || 0)} counselor groups · {Number(preview.impact.badges_to_reset || 0)} test IDs · {Number(preview.impact.checkins_to_reset || 0)} check-ins. Staff-to-company and counselor-to-group assignments are cleared. Housing room inventory is not deleted, but rehearsal room assignments are cleared.</small></span></div>
      <label className="final-roster-v21-confirm"><input type="checkbox" checked={confirmReset} onChange={(event) => setConfirmReset(event.target.checked)}/><span><b>Make this file the final registration baseline</b><small>I understand that Access/accounts remain, while rehearsal roster-derived operations are reset so groups, companies and staff assignments can be built fresh.</small></span></label>
      <div className="panel-actions"><span>{preview.resolved.mergedRows ? `${preview.resolved.mergedRows} duplicate source row${preview.resolved.mergedRows === 1 ? "" : "s"} reconciled into latest registrations` : "No source rows merged"}</span><button type="button" className="primary" disabled={!confirmReset || busy === "apply"} onClick={apply}>{busy === "apply" ? "Applying final baseline…" : "Apply final roster"}<Check/></button></div>
    </article> : null}

    {baseline && !result ? <div className="final-roster-v21-next"><span><Check weight="bold"/><b>Final registration is ready.</b><small>Build the new counselor groups and companies next, then assign counselors and Assistant Coordinators from the refreshed Staff roster.</small></span><button type="button" className="primary" onClick={() => onNavigate?.({ view: "groups" })}>Build groups & companies<ArrowRight/></button></div> : null}
  </section>;
}
