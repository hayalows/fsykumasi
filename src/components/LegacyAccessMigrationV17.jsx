import { useMemo, useState } from "react";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { DismissibleLayer, Empty, MutationFeedback, SearchField } from "./UI.jsx";
import { staffRoleLabel } from "../lib/staff-access.js";

function normalized(value = "") { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function email(value = "") { return String(value).trim().toLowerCase(); }
function scopeText(person) {
  if (person.operationalRole !== "assistant_coordinator") return "Whole session";
  if (person.companyNames?.length) return person.companyNames.join(" · ");
  const count = person.companyIds?.length || 0;
  return count ? `${count} company${count === 1 ? "" : "ies"}` : "No companies assigned yet";
}
function rank(person, candidate, nameCounts) {
  const sameEmail = email(person.accountEmail || person.email) && email(person.accountEmail || person.email) === email(candidate.accountEmail || candidate.email);
  const sameName = normalized(person.name) && normalized(person.name) === normalized(candidate.name);
  const sameRole = person.operationalRole === candidate.operationalRole;
  const overlap = (person.companyIds || []).filter((id) => (candidate.companyIds || []).includes(id)).length;
  const uniqueName = sameName && nameCounts.get(normalized(candidate.name)) === 1;
  const score = (sameEmail ? 100 : 0) + (sameName ? 45 : 0) + (sameRole ? 20 : 0) + Math.min(overlap, 2) * 8;
  const confidence = sameEmail ? "email" : uniqueName && sameRole ? "name_role" : score >= 50 ? "possible" : "none";
  const reason = sameEmail ? "Same email" : uniqueName && sameRole ? "Same name and responsibility" : overlap && sameRole ? `${overlap} shared compan${overlap === 1 ? "y" : "ies"}` : sameName ? "Same name" : "";
  return { ...candidate, score, confidence, reason, overlap };
}

export function LegacyAccessMigrationV17({ person, candidates = [], onClose, onMigrate }) {
  const ranked = useMemo(() => {
    const eligible = candidates.filter((candidate) => candidate.staffId && !candidate.userId);
    const nameCounts = new Map();
    eligible.forEach((candidate) => nameCounts.set(normalized(candidate.name), (nameCounts.get(normalized(candidate.name)) || 0) + 1));
    return eligible.map((candidate) => rank(person, candidate, nameCounts)).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }, [candidates, person]);
  const suggested = ranked.find((candidate) => ["email", "name_role"].includes(candidate.confidence)) || null;
  const [selectedId, setSelectedId] = useState(suggested?.staffId || "");
  const [showChoices, setShowChoices] = useState(!suggested);
  const [createNew, setCreateNew] = useState(!ranked.length);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selected = ranked.find((candidate) => candidate.staffId === selectedId) || null;
  const shown = useMemo(() => {
    const text = query.trim().toLowerCase();
    return ranked.filter((candidate) => !text || `${candidate.name} ${candidate.email || ""} ${staffRoleLabel(candidate.operationalRole)} ${(candidate.companyNames || []).join(" ")}`.toLowerCase().includes(text));
  }, [ranked, query]);
  const canSubmit = !busy && (createNew || Boolean(selected));

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setError("");
    try {
      await onMigrate?.({ staffId: createNew ? null : selected.staffId });
      onClose?.();
    } catch (err) {
      setError(err.message || "This sign-in could not be connected to Staff.");
    } finally {
      setBusy(false);
    }
  };

  return <DismissibleLayer open onClose={() => !busy && onClose?.()} title="Connect existing sign-in" sheet className="legacy-migration-layer access-v17-migration-layer">
    <div className="legacy-migration-shell access-v17-migration-shell">
      <header className="legacy-migration-header">
        <div><span className="kicker">Account connection</span><h2>Connect {person.name} to Staff</h2><p>Keep the account they already use. We are only connecting it to the current FSY Staff record.</p></div>
        <button type="button" data-layer-close className="icon-button" onClick={onClose} disabled={busy} aria-label="Close"><X /></button>
      </header>

      <div className="legacy-migration-scroll">
        <section className="access-v17-existing-account">
          <div><span>Existing sign-in</span><b>{person.accountEmail || person.email || person.name}</b><small>{staffRoleLabel(person.legacyRole || person.operationalRole)} · {scopeText({ ...person, operationalRole: person.legacyRole || person.operationalRole, companyIds: person.legacyCompanyIds || person.companyIds })}</small></div>
          <CheckCircle weight="fill" />
        </section>

        {suggested && !showChoices && !createNew ? <section className="access-v17-recommended">
          <div className="access-v17-recommended-head"><span className="kicker">Recommended match</span><b>We found this person in Staff</b><p>Review the match, then connect the existing sign-in. No new password or invitation is needed.</p></div>
          <button type="button" className="access-v17-match-card selected" onClick={() => setSelectedId(suggested.staffId)}>
            <span><b>{suggested.name}</b><small>{staffRoleLabel(suggested.operationalRole)} · {scopeText(suggested)}</small><em>{suggested.reason}</em></span><i />
          </button>
          {suggested.operationalRole !== person.operationalRole ? <div className="legacy-migration-warning"><WarningCircle /><span><b>Staff responsibility will be used</b><small>The old website role says {staffRoleLabel(person.operationalRole)}, but Staff says {staffRoleLabel(suggested.operationalRole)}. After connection, Staff controls what this person can access.</small></span></div> : null}
          <button type="button" className="text-action access-v17-other-match" onClick={() => setShowChoices(true)}>Choose a different Staff record</button>
        </section> : null}

        {showChoices && !createNew ? <section className="legacy-migration-existing access-v17-match-picker">
          <div className="legacy-migration-section-head"><div><b>Choose the correct Staff record</b><small>Only Staff records without a connected website account are shown.</small></div></div>
          <SearchField value={query} onChange={setQuery} label="Search Staff" placeholder="Name, email, responsibility or company" />
          {shown.length ? <div className="legacy-migration-list">{shown.map((candidate) => {
            const checked = candidate.staffId === selectedId;
            return <label key={candidate.staffId} className={checked ? "selected" : ""}>
              <input type="radio" name="access-v17-staff-target" checked={checked} onChange={() => setSelectedId(candidate.staffId)} />
              <span><b>{candidate.name}</b><small>{staffRoleLabel(candidate.operationalRole)} · {scopeText(candidate)}</small>{candidate.reason ? <em>{candidate.reason}{candidate.confidence === "possible" ? " · check before connecting" : ""}</em> : null}</span>
            </label>;
          })}</div> : <Empty title="No Staff record found" text="Try another search. If this person truly is not in Staff, add their Staff record and keep the same sign-in." />}
          <button type="button" className="secondary access-v17-create-link" onClick={() => { setCreateNew(true); setSelectedId(""); }}>Person is not in Staff</button>
        </section> : null}

        {createNew ? <section className="access-v17-create-staff">
          <div className="access-v17-create-staff-icon"><WarningCircle /></div>
          <div><span className="kicker">No Staff record</span><h3>Add to Staff and connect</h3><p>A current Staff record will be created using this person's existing FSY account and responsibility. Their sign-in stays exactly the same.</p></div>
          {person.operationalRole === "assistant_coordinator" ? <div className="legacy-migration-warning"><WarningCircle /><span><b>Company assignments still need to be valid</b><small>The old company scope can be carried over only when those companies are not already assigned to another current Assistant Coordinator.</small></span></div> : null}
          {ranked.length ? <button type="button" className="text-action" onClick={() => { setCreateNew(false); setShowChoices(true); }}>Choose an existing Staff record instead</button> : null}
        </section> : null}

        {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      </div>

      <footer className="legacy-migration-footer"><button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="primary" disabled={!canSubmit} onClick={submit}>{busy ? "Connecting…" : createNew ? "Add to Staff & connect" : "Connect account"}</button></footer>
    </div>
  </DismissibleLayer>;
}
