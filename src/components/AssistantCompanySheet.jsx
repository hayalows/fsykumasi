import { useMemo, useState } from "react";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { DismissibleLayer, MutationFeedback, SearchField } from "./UI.jsx";
import {
  loadAssistantCoordinatorCompanySuggestions,
  setAssistantCoordinatorCompanies,
} from "../lib/staff-access.js";

function companyLabel(company) {
  return company.displayName || company.customName || company.name || "Company";
}

export function AssistantCompanySheet({
  staff,
  companies = [],
  directory = [],
  companyLimit = 4,
  continueToAccess = false,
  onClose,
  onSaved,
  onContinue,
}) {
  const [selected, setSelected] = useState(() => [...(staff?.companyIds || [])]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState(null);
  if (!staff) return null;

  const ownerByCompany = useMemo(() => {
    const map = new Map();
    directory.forEach((person) => {
      if (person.operationalRole !== "assistant_coordinator") return;
      (person.companyIds || []).forEach((companyId) => map.set(companyId, person));
    });
    return map;
  }, [directory]);

  const companyById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return companies.filter((company) => !text || companyLabel(company).toLowerCase().includes(text));
  }, [companies, query]);

  const selectedCompanies = selected.map((id) => companyById.get(id)).filter(Boolean);
  const movedCompanies = selected.filter((id) => {
    const owner = ownerByCompany.get(id);
    return owner && owner.staffId !== staff.staffId;
  });
  const removedCount = (staff.companyIds || []).filter((id) => !selected.includes(id)).length;

  const toggle = (companyId) => {
    setError("");
    setSelected((current) => {
      if (current.includes(companyId)) return current.filter((id) => id !== companyId);
      if (current.length >= companyLimit) {
        setError(`${staff.name} can supervise up to ${companyLimit} companies.`);
        return current;
      }
      return [...current, companyId];
    });
  };

  const suggest = async () => {
    setBusy("suggest"); setError("");
    try {
      const next = await loadAssistantCoordinatorCompanySuggestions(staff.staffId);
      setSuggestions(next);
      if (next.length) {
        setSelected((current) => {
          const merged = [...current];
          next.forEach((item) => { if (!merged.includes(item.companyId) && merged.length < companyLimit) merged.push(item.companyId); });
          return merged;
        });
      }
    } catch (err) {
      setError(err.message || "A balanced company suggestion could not be prepared.");
    } finally { setBusy(""); }
  };

  const save = async () => {
    if (continueToAccess && !selected.length) {
      setError("Choose at least one company before continuing to website access.");
      return;
    }
    setBusy("save"); setError("");
    try {
      await setAssistantCoordinatorCompanies(staff.staffId, selected);
      const updated = await onSaved?.(staff.staffId, selected);
      if (continueToAccess) onContinue?.(updated || { ...staff, companyIds: selected, companyNames: selectedCompanies.map(companyLabel) });
      else onClose?.();
    } catch (err) {
      setError(err.message || "Company assignments could not be saved.");
    } finally { setBusy(""); }
  };

  return <DismissibleLayer open onClose={onClose} title={`Companies for ${staff.name}`} sheet className="assistant-company-sheet">
    <div className="assistant-company-sheet-body">
      <button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} aria-label="Close"><X/></button>
      <span className="kicker">Assistant Coordinator scope</span>
      <h2>{staff.name}</h2>
      <p className="assistant-company-lead">Choose the companies this leader is responsible for. Their website permissions will follow these assignments automatically.</p>

      <section className="assistant-company-current" aria-label="Selected companies">
        <div><span>Selected</span><strong>{selected.length}/{companyLimit}</strong></div>
        {selectedCompanies.length ? <div className="assistant-company-chips">{selectedCompanies.map((company) => <span key={company.id}>{companyLabel(company)}</span>)}</div> : <p>No companies selected yet.</p>}
      </section>

      <section className="assistant-company-auto">
        <div><Sparkle weight="fill"/><span><b>Let the system suggest a balanced set</b><small>It prefers unassigned companies first. If everything is already assigned, it suggests safe moves from leaders with several companies.</small></span></div>
        <button type="button" className="secondary" disabled={Boolean(busy)} onClick={suggest}><Sparkle/>{busy === "suggest" ? "Checking…" : "Suggest companies"}</button>
        {suggestions ? <div className="assistant-company-suggestion" role="status">{suggestions.length ? <><CheckCircle weight="fill"/><span><b>{suggestions.length} suggestion{suggestions.length === 1 ? "" : "s"} added for review</b><small>Nothing moves until you save.</small></span></> : <><WarningCircle/><span><b>No safe automatic move found</b><small>Choose companies manually below.</small></span></>}</div> : null}
      </section>

      <details className="assistant-company-manual" open={!selected.length}>
        <summary><span><Buildings/><b>Choose manually</b></span><small>{companies.length} companies</small></summary>
        <div className="assistant-company-manual-body">
          <SearchField value={query} onChange={setQuery} label="Search companies" placeholder="Search company" />
          <div className="assistant-company-list">{filtered.map((company) => {
            const owner = ownerByCompany.get(company.id);
            const checked = selected.includes(company.id);
            const moving = owner && owner.staffId !== staff.staffId;
            return <label key={company.id} className={`${checked ? "selected" : ""} ${moving ? "moves-company" : ""}`.trim()}>
              <input type="checkbox" checked={checked} onChange={() => toggle(company.id)} />
              <span><b>{companyLabel(company)}</b><small>{moving ? `Currently ${owner.name} · selecting moves it here` : owner?.staffId === staff.staffId ? "Already assigned here" : "Available"}</small></span>
            </label>;
          })}</div>
        </div>
      </details>

      {(movedCompanies.length || removedCount) ? <div className="assistant-company-change-note"><WarningCircle/><span>{movedCompanies.length ? `${movedCompanies.length} selected compan${movedCompanies.length === 1 ? "y is" : "ies are"} currently assigned to another Assistant Coordinator. ` : ""}{removedCount ? `${removedCount} current assignment${removedCount === 1 ? "" : "s"} will be removed. ` : ""}These changes are shown before saving so nothing moves unexpectedly.</span></div> : null}
      {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}

      <div className="field-sheet-actions assistant-company-actions">
        <button type="button" className="secondary" disabled={Boolean(busy)} onClick={onClose}>Cancel</button>
        <button type="button" className="primary" disabled={Boolean(busy) || (continueToAccess && !selected.length)} onClick={save}>{busy === "save" ? "Saving…" : continueToAccess ? "Save & continue to access" : "Save companies"}</button>
      </div>
    </div>
  </DismissibleLayer>;
}
