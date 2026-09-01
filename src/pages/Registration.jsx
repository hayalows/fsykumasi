import { useRef, useState } from "react";
import { Check } from "@phosphor-icons/react/Check";
import { CloudArrowUp } from "@phosphor-icons/react/CloudArrowUp";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { PageHead, Status } from "../components/UI.jsx";
import { downloadCsvTemplate, parseParticipantFile } from "../lib/import.js";

export function Registration({ imported, setImported, onApply, live = false, canManage = true }) {
  const input = useRef();
  const [result, setResult] = useState(imported.length ? { participants: imported, errors: [] } : null);
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");

  const choose = async (file) => {
    if (!file) return;
    setBusy(true);
    setApplyError("");
    setFilename(file.name);
    try {
      setResult(await parseParticipantFile(file));
    } catch (error) {
      setResult({ participants: [], errors: [{ row: "File", message: error.message, severity: "blocking" }] });
    } finally {
      setBusy(false);
    }
  };

  const hasBlockingErrors = result?.errors?.some((error) => error.severity === "blocking") ?? false;
  const apply = async () => {
    if (!result?.participants?.length || hasBlockingErrors || !canManage) return;
    setApplying(true);
    setApplyError("");
    try {
      if (onApply) await onApply({ participants: result.participants, sourceFilename: filename || "participant-import" });
      setImported(result.participants);
    } catch (error) {
      setApplyError(error.message || "Unable to apply participant records.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <section className="page">
      <PageHead title="Registration data" description="Bring the approved participant export into the operations workspace with a review step before anything changes." action={<button className="secondary" onClick={downloadCsvTemplate}>Download template</button>} />
      <div className="notice"><WarningCircle size={21}/><div><b>{live ? "Connected import" : "Real data comes later"}</b><p>{live ? "This deployment writes validated participant records to Supabase only after you review the file. Use the approved registration export and keep it out of chat and source control." : "Keep using synthetic data until Supabase, login, role permissions and row-level security have been tested. The real export should enter through this screen, not chat or source control."}</p></div></div>

      {!canManage ? <div className="notice"><WarningCircle size={21}/><div><b>View-only access</b><p>Your role can see registration progress, but only logistical administrators and the session directing couple can apply participant imports.</p></div></div> : null}

      <article className="panel import-card">
        <div className="step-badge">Step 1</div>
        <h2>Upload participant list</h2>
        <p>Designed for the full 1,600+ youth list. CSV and Excel files are supported, and the preview is read-only until you apply it.</p>
        <button className="dropzone" disabled={!canManage} onClick={() => input.current?.click()}>
          <CloudArrowUp size={32}/><b>{busy ? "Reading file…" : "Choose CSV or Excel file"}</b><span>Required: name, sex, age, ward or branch</span>
        </button>
        <input ref={input} hidden type="file" accept=".csv,.xlsx,.xls" onChange={(e) => choose(e.target.files?.[0])}/>
      </article>

      {result && (
        <article className="panel">
          <div className="panel-head"><div><span className="kicker">Step 2</span><h2>Review before applying</h2></div><Status tone={result.errors.length ? "danger" : "good"}>{result.errors.length ? `${result.errors.length} issues` : `${result.participants.length.toLocaleString()} valid rows`}</Status></div>
          {result.errors.length ? (
            <div className="error-list">{result.errors.slice(0, 8).map((error, i) => <p key={i}><b>Row {error.row}:</b> {error.message}</p>)}</div>
          ) : (
            <div className="table-wrap"><table><thead><tr><th>Name</th><th>Sex</th><th>Age</th><th>Unit</th></tr></thead><tbody>{result.participants.slice(0, 8).map((p) => <tr key={p.id}><td><b>{p.fullName}</b></td><td>{p.sex}</td><td>{p.age}</td><td>{p.unit}</td></tr>)}</tbody></table></div>
          )}
          {applyError ? <div className="form-error">{applyError}</div> : null}
          <div className="panel-actions"><span>{result.participants.length > 8 ? `Showing 8 of ${result.participants.length.toLocaleString()}` : "Review every issue before continuing"}</span><button className="primary" disabled={hasBlockingErrors || applying || !canManage} onClick={apply}>{applying ? "Applying…" : imported.length ? "Applied" : "Apply validated records"}<Check /></button></div>
        </article>
      )}
    </section>
  );
}
