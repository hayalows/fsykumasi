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

function naturalCompanySort(a, b) {
  return companyLabel(a).localeCompare(companyLabel(b), undefined, { numeric: true, sensitivity: "base" });
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
    return companies
      .filter((company) => !text || companyLabel(company).toLowerCase().includes(text))
      .slice()
      .sort(naturalCompanySort);
  }, [companies, query]);

  if (!staff) return null;

  const selectedCompanies = selected.map((id) => companyById.get(id)).filter(Boolean).sort(naturalCompanySort);
  const movedCompanies = selected.filter((id) => {
    const owner = ownerByCompany.get(id);
    return owner && owner.staffId !== staff.staffId;
  });
  const removedCount = (staff.companyIds || []).filter((id) => !selected.includes(id)).length;
  const hasChanges = movedCompanies.length > 0 || removedCount > 0 || selected.join("|") !== (staff.companyIds || []).join("|");

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
    setBusy("suggest");
    setError("");
    try {
      const next = await loadAssistantCoordinatorCompanySuggestions(staff.staffId);
      setSuggestions(next);
      if (next.length) {
        setSelected((current) => {
          const merged = [...current];
          next.forEach((item) => {
            if (!merged.includes(item.companyId) && merged.length < companyLimit) merged.push(item.companyId);
          });
          return merged;
        });
      }
    } catch (err) {
      setError(err.message || "A balanced company suggestion could not be prepared.");
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    if (continueToAccess && !selected.length) {
      setError("Choose at least one company before continuing to website access.");
      return;
    }
    setBusy("save");
    setError("");
    try {
      await setAssistantCoordinatorCompanies(staff.staffId, selected);
      const updated = await onSaved?.(staff.staffId, selected);
      if (continueToAccess) {
        onContinue?.(updated || { ...staff, companyIds: selected, companyNames: selectedCompanies.map(companyLabel) });
      } else {
        onClose?.();
      }
    } catch (err) {
      setError(err.message || "Company assignments could not be saved.");
    } finally {
      setBusy("");
    }
  };

  return <DismissibleLayer open onClose={onClose} title={`Companies for ${staff.name}`} sheet className="assistant-company-sheet app-modal-wide">
    <div className="assistant-company-shell">
      <header className="assistant-company-header">
        <div>
          <span className="kicker">Assistant Coordinator companies</span>
          <h2>{staff.name}</h2>
          <p>Choose up to {companyLimit} companies. Saving updates this leader&apos;s responsibility and linked website access.</p>
        </div>
        <button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} aria-label="Close"><X/></button>
      </header>

      <div className="assistant-company-content">
        <aside className="assistant-company-sidebar" aria-label="Selection summary and suggestions">
          <section className="assistant-company-current" aria-label="Selected companies">
            <div className="assistant-company-current-head">
              <div><span>Selected</span><b>{selected.length} of {companyLimit}</b></div>
              <strong>{selected.length}/{companyLimit}</strong>
            </div>
            {selectedCompanies.length ? <div className="assistant-company-selected-list">
              {selectedCompanies.map((company) => <button type="button" key={company.id} className="assistant-company-selected-chip" onClick={() => toggle(company.id)} aria-label={`Remove ${companyLabel(company)}`}>
                <span>{companyLabel(company)}</span><X size={14}/>
              </button>)}
            </div> : <p>No companies selected yet.</p>}
          </section>

          <section className="assistant-company-auto">
            <div className="assistant-company-auto-copy"><span className="assistant-company-auto-icon"><Sparkle weight="fill"/></span><span><b>Balanced suggestion</b><small>Fills open companies first and only suggests safe moves when needed.</small></span></div>
            <button type="button" className="secondary" disabled={Boolean(busy)} onClick={suggest}><Sparkle/>{busy === "suggest" ? "Checking…" : "Suggest companies"}</button>
            {suggestions ? <div className="assistant-company-suggestion" role="status">{suggestions.length ? <><CheckCircle weight="fill"/><span><b>{suggestions.length} suggestion{suggestions.length === 1 ? "" : "s"} added</b><small>Review them before saving.</small></span></> : <><WarningCircle/><span><b>No safe automatic move found</b><small>Choose companies from the list.</small></span></>}</div> : null}
          </section>

          {(movedCompanies.length || removedCount) ? <div className="assistant-company-change-note"><WarningCircle/><span>{movedCompanies.length ? `${movedCompanies.length} selected compan${movedCompanies.length === 1 ? "y is" : "ies are"} currently assigned to another Assistant Coordinator. ` : ""}{removedCount ? `${removedCount} current assignment${removedCount === 1 ? "" : "s"} will be removed. ` : ""}Nothing changes until you save.</span></div> : null}
          {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
        </aside>

        <section className="assistant-company-picker" aria-label="Choose companies">
          <div className="assistant-company-picker-head">
            <div><span className="assistant-company-picker-label"><Buildings/>All companies</span><small>{filtered.length === companies.length ? `${companies.length} total` : `${filtered.length} of ${companies.length}`}</small></div>
            <SearchField value={query} onChange={setQuery} label="Search companies" placeholder="Search companies" />
          </div>

          <div className="assistant-company-list">{filtered.map((company) => {
            const owner = ownerByCompany.get(company.id);
            const checked = selected.includes(company.id);
            const moving = owner && owner.staffId !== staff.staffId;
            const current = owner?.staffId === staff.staffId;
            const status = moving ? `Assigned to ${owner.name}` : current ? "Already assigned here" : "Available";
            return <label key={company.id} className={`${checked ? "selected" : ""} ${moving ? "moves-company" : ""} ${current ? "current-company" : ""}`.trim()}>
              <input type="checkbox" checked={checked} onChange={() => toggle(company.id)} />
              <span className="assistant-company-option-copy"><b>{companyLabel(company)}</b><small>{status}</small></span>
              {moving ? <span className="assistant-company-option-state moving">Will move</span> : checked ? <span className="assistant-company-option-state selected">Selected</span> : null}
            </label>;
          })}</div>
          {!filtered.length ? <div className="assistant-company-no-results"><Buildings/><b>No companies found</b><span>Try a different search.</span></div> : null}
        </section>
      </div>

      <footer className="assistant-company-actions">
        <div className="assistant-company-footer-status">
          <b>{selected.length} of {companyLimit} selected</b>
          <span>{continueToAccess && !selected.length ? "Choose at least one company to continue." : hasChanges ? "Review your selection, then save." : "No unsaved changes."}</span>
        </div>
        <div className="assistant-company-footer-buttons">
          <button type="button" className="secondary" disabled={Boolean(busy)} onClick={onClose}>Cancel</button>
          <button type="button" className="primary" disabled={Boolean(busy) || (continueToAccess && !selected.length)} onClick={save}>{busy === "save" ? "Saving…" : continueToAccess ? "Save & continue" : "Save companies"}</button>
        </div>
      </footer>
    </div>
  </DismissibleLayer>;
}
