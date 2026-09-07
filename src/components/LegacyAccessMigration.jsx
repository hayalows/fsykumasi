import { useMemo, useState } from "react";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { DismissibleLayer, Empty, MutationFeedback, SearchField, Status } from "./UI.jsx";
import { staffRoleLabel } from "../lib/staff-access.js";

function normalized(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function candidateScore(person, candidate) {
  let score = 0;
  if (normalized(person.name) && normalized(person.name) === normalized(candidate.name)) score += 6;
  if (person.email && candidate.email && person.email.trim().toLowerCase() === candidate.email.trim().toLowerCase()) score += 8;
  if (person.operationalRole === candidate.operationalRole) score += 2;
  if ((person.companyIds || []).some((id) => (candidate.companyIds || []).includes(id))) score += 3;
  return score;
}

function scopeText(person) {
  if (person.operationalRole !== "assistant_coordinator") return "Whole session";
  if (person.companyNames?.length) return person.companyNames.join(" · ");
  const count = person.companyIds?.length || 0;
  return count ? `${count} company${count === 1 ? "" : "ies"}` : "No company scope recorded";
}

export function LegacyAccessMigration({ person, candidates = [], onClose, onMigrate }) {
  const ranked = useMemo(() => candidates
    .filter((candidate) => candidate.staffId && !candidate.userId)
    .map((candidate) => ({ ...candidate, score: candidateScore(person, candidate) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)), [candidates, person]);
  const suggested = ranked.find((candidate) => candidate.score >= 5) || null;
  const [mode, setMode] = useState(ranked.length ? "existing" : "create");
  const [selectedId, setSelectedId] = useState(suggested?.staffId || "");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const shown = useMemo(() => {
    const text = query.trim().toLowerCase();
    return ranked.filter((candidate) => !text || `${candidate.name} ${candidate.email || ""} ${staffRoleLabel(candidate.operationalRole)} ${(candidate.companyNames || []).join(" ")}`.toLowerCase().includes(text));
  }, [ranked, query]);
  const selected = ranked.find((candidate) => candidate.staffId === selectedId) || null;
  const canSubmit = !busy && (mode === "create" || Boolean(selected));

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      await onMigrate?.({ staffId: mode === "existing" ? selected.staffId : null });
      onClose?.();
    } catch (err) {
      setError(err.message || "This account could not be moved to staff-linked access.");
    } finally {
      setBusy(false);
    }
  };

  return <DismissibleLayer open onClose={() => !busy && onClose?.()} title="Move older access" sheet className="legacy-migration-layer">
    <div className="legacy-migration-shell">
      <header className="legacy-migration-header">
        <div><span className="kicker">Access repair</span><h2>Move this account to Staff</h2><p>Keep the existing sign-in, but make the current FSY assignment the source of truth.</p></div>
        <button type="button" data-layer-close className="icon-button" onClick={onClose} disabled={busy} aria-label="Close"><X /></button>
      </header>

      <div className="legacy-migration-scroll">
        <section className="legacy-migration-account">
          <div><b>{person.name}</b><small>{person.email || "Email not recorded"}</small></div>
          <div><span>Older website role</span><b>{staffRoleLabel(person.operationalRole)}</b><small>{scopeText(person)}</small></div>
          <Status tone="warn">Needs Staff link</Status>
        </section>

        <section className="legacy-migration-choice">
          <div><span className="kicker">Choose the correct identity</span><h3>Is this person already in Staff?</h3><p>Connecting to the existing Staff record is safest when one already exists. Create a new Staff record only if this is genuinely a different person.</p></div>
          <div className="legacy-migration-mode" role="radiogroup" aria-label="Migration method">
            <button type="button" role="radio" aria-checked={mode === "existing"} className={mode === "existing" ? "selected" : ""} onClick={() => setMode("existing")} disabled={!ranked.length}><span><b>Connect to existing Staff</b><small>Use the current responsibility and company assignment already recorded in Staff.</small></span><i /></button>
            <button type="button" role="radio" aria-checked={mode === "create"} className={mode === "create" ? "selected" : ""} onClick={() => setMode("create")}><span><b>Create a Staff record</b><small>Use this older account's current role as the starting FSY assignment.</small></span><i /></button>
          </div>
        </section>

        {mode === "existing" ? <section className="legacy-migration-existing">
          <div className="legacy-migration-section-head"><div><b>Current Staff records without a linked account</b><small>{suggested ? `Best match: ${suggested.name}` : "Choose the real person, not just a similar name."}</small></div></div>
          <SearchField value={query} onChange={setQuery} label="Search Staff" placeholder="Name, email, responsibility or company" />
          {shown.length ? <div className="legacy-migration-list">{shown.map((candidate) => {
            const checked = candidate.staffId === selectedId;
            const overlap = (person.companyIds || []).filter((id) => (candidate.companyIds || []).includes(id)).length;
            return <label key={candidate.staffId} className={checked ? "selected" : ""}>
              <input type="radio" name="legacy-staff-target" checked={checked} onChange={() => setSelectedId(candidate.staffId)} />
              <span><b>{candidate.name}</b><small>{staffRoleLabel(candidate.operationalRole)} · {scopeText(candidate)}</small>{candidate.score >= 5 ? <em>Likely match{overlap ? ` · ${overlap} shared company${overlap === 1 ? "" : "ies"}` : ""}</em> : null}</span>
            </label>;
          })}</div> : <Empty title="No Staff record found" text="Try another search, or create a new Staff record if this person is genuinely missing." />}
          {selected && selected.operationalRole !== person.operationalRole ? <div className="legacy-migration-warning"><WarningCircle /><span><b>The Staff assignment will win</b><small>This account currently says {staffRoleLabel(person.operationalRole)}, but {selected.name} is {staffRoleLabel(selected.operationalRole)} in Staff. After linking, website access will follow Staff.</small></span></div> : null}
        </section> : <section className="legacy-migration-create">
          <div className="legacy-migration-warning"><WarningCircle /><span><b>Create only when this person is not already in Staff</b><small>A new current {staffRoleLabel(person.operationalRole)} Staff record will be created and linked to this existing sign-in. No new password or invite is needed.</small></span></div>
          {person.operationalRole === "assistant_coordinator" ? <p>For an Assistant Coordinator, the older company scope can be carried over only when those companies are not already assigned to someone in Staff. If they are already assigned, connect to the correct existing Staff record instead.</p> : null}
        </section>}

        {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      </div>

      <footer className="legacy-migration-footer"><button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="primary" disabled={!canSubmit} onClick={submit}>{busy ? "Moving account…" : "Move account"}</button></footer>
    </div>
  </DismissibleLayer>;
}
