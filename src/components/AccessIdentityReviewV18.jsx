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
  if (person.companyIds?.length) return `${person.companyIds.length} compan${person.companyIds.length === 1 ? "y" : "ies"}`;
  return "No companies assigned yet";
}
function rank(person, candidate) {
  const sameEmail = email(person.accountEmail || person.email) && email(person.accountEmail || person.email) === email(candidate.accountEmail || candidate.email);
  const sameName = normalized(person.name) && normalized(person.name) === normalized(candidate.name);
  const sameRole = person.operationalRole === candidate.operationalRole;
  const overlap = (person.companyIds || []).filter((id) => (candidate.companyIds || []).includes(id)).length;
  return {
    ...candidate,
    score: (sameEmail ? 100 : 0) + (sameName ? 45 : 0) + (sameRole ? 20 : 0) + Math.min(overlap, 2) * 8,
    sameEmail,
    sameName,
    sameRole,
    reason: sameEmail ? "Same email" : sameName && sameRole ? "Same name and responsibility" : sameName ? "Same name" : overlap && sameRole ? `${overlap} shared compan${overlap === 1 ? "y" : "ies"}` : "",
  };
}

export function AccessIdentityReviewV18({ person, candidates = [], onClose, onResolve, onCreateAndResolve }) {
  const ranked = useMemo(() => candidates
    .filter((candidate) => candidate.staffId)
    .map((candidate) => rank(person, candidate))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)), [candidates, person]);
  const likely = ranked.filter((candidate) => candidate.score >= 45);
  const initial = likely.find((candidate) => !candidate.userId)?.staffId || "";
  const [selectedId, setSelectedId] = useState(initial);
  const [showAll, setShowAll] = useState(likely.length === 0);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const pool = showAll ? ranked : likely;
  const shown = useMemo(() => {
    const text = query.trim().toLowerCase();
    return pool.filter((candidate) => !text || `${candidate.name} ${candidate.email || ""} ${staffRoleLabel(candidate.operationalRole)} ${(candidate.companyNames || []).join(" ")}`.toLowerCase().includes(text));
  }, [pool, query]);
  const selected = ranked.find((candidate) => candidate.staffId === selectedId) || null;

  const resolve = async () => {
    if (!selected || selected.userId || busy) return;
    setBusy("resolve"); setError("");
    try { await onResolve?.({ staffId: selected.staffId }); onClose?.(); }
    catch (err) { setError(err.message || "This identity could not be matched safely."); }
    finally { setBusy(""); }
  };
  const create = async () => {
    if (busy) return;
    setBusy("create"); setError("");
    try { await onCreateAndResolve?.(); onClose?.(); }
    catch (err) { setError(err.message || "A Staff identity could not be created safely."); }
    finally { setBusy(""); }
  };

  return <DismissibleLayer open onClose={() => !busy && onClose?.()} title="Identity review" sheet className="access-v18-identity-layer">
    <div className="access-v18-identity-shell">
      <header className="access-v18-sheet-head">
        <div><span className="kicker">Identity review</span><h2>Which Staff person is {person.name}?</h2><p>This person already has an FSY sign-in. We only need your help because the system found a real identity conflict.</p></div>
        <button type="button" data-layer-close className="icon-button" onClick={onClose} disabled={Boolean(busy)} aria-label="Close"><X /></button>
      </header>

      <div className="access-v18-sheet-scroll">
        <section className="access-v18-known-account">
          <CheckCircle weight="fill" />
          <div><span>Existing sign-in</span><b>{person.accountEmail || person.email || person.name}</b><small>{staffRoleLabel(person.legacyRole || person.operationalRole)} · This password and account will be kept.</small></div>
        </section>

        <section className="access-v18-review-help">
          <WarningCircle />
          <div><b>Choose the person, not a similar name</b><p>Staff controls the responsibility and company scope after the match. A Staff record already connected to another sign-in cannot be selected.</p></div>
        </section>

        <section className="access-v18-candidates">
          <div className="access-v18-section-head"><div><b>{likely.length ? "Possible Staff matches" : "Find the correct Staff record"}</b><small>{likely.length ? "The strongest matches are shown first." : "No confident match was found automatically."}</small></div></div>
          {showAll ? <SearchField value={query} onChange={setQuery} label="Search Staff" placeholder="Name, email, responsibility or company" /> : null}
          {shown.length ? <div className="access-v18-candidate-list">{shown.map((candidate) => {
            const checked = candidate.staffId === selectedId;
            const blocked = Boolean(candidate.userId);
            return <button type="button" key={candidate.staffId} disabled={blocked || Boolean(busy)} className={`access-v18-candidate ${checked ? "selected" : ""} ${blocked ? "blocked" : ""}`} onClick={() => setSelectedId(candidate.staffId)}>
              <span><b>{candidate.name}</b><small>{staffRoleLabel(candidate.operationalRole)} · {scopeText(candidate)}</small>{candidate.email ? <small>{candidate.email}</small> : null}{candidate.reason ? <em>{candidate.reason}</em> : null}{blocked ? <strong>Already connected to another sign-in</strong> : null}</span><i aria-hidden="true" />
            </button>;
          })}</div> : <Empty title="No Staff match found" text="If this really is a missing Staff person, create their Staff identity below while keeping the sign-in they already use." />}
          {!showAll && ranked.length > likely.length ? <button type="button" className="text-action" onClick={() => setShowAll(true)}>Find another Staff record</button> : null}
        </section>

        {selected && selected.operationalRole !== person.operationalRole ? <div className="access-v18-review-help"><WarningCircle /><div><b>Staff responsibility will be used</b><p>The existing website role says {staffRoleLabel(person.operationalRole)}, while Staff says {staffRoleLabel(selected.operationalRole)}. After the match, Staff becomes authoritative.</p></div></div> : null}

        <section className="access-v18-create-identity">
          <div><b>None of these is the person</b><small>Use this only when the person is genuinely missing from Staff. Their existing sign-in stays unchanged.</small></div>
          <button type="button" className="secondary" disabled={Boolean(busy)} onClick={create}>{busy === "create" ? "Creating…" : "Create Staff identity & keep sign-in"}</button>
        </section>

        {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      </div>

      <footer className="access-v18-sheet-footer access-v18-review-footer"><button type="button" className="secondary" disabled={Boolean(busy)} onClick={onClose}>Cancel</button><button type="button" className="primary" disabled={!selected || Boolean(selected?.userId) || Boolean(busy)} onClick={resolve}>{busy === "resolve" ? "Matching…" : "Use selected Staff record"}</button></footer>
    </div>
  </DismissibleLayer>;
}
