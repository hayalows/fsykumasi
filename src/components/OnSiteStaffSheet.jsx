import { useEffect, useMemo, useState } from "react";
import { DismissibleLayer, SearchField } from "./UI.jsx";
import { searchPeople } from "../lib/person-search.js";
import { addOnSiteStaff, loadOnSiteReferenceDate } from "../lib/onsite.js";
import { loadOperationalStructure, loadStructureSettings } from "../lib/operations.js";
import { ageOnDate, validateManualStaff } from "../lib/registration.js";
import "./operational-state.css";

function namePrefill(value = "") {
  const parts = String(value).trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
}

function companyLabel(company) {
  return company?.displayName || company?.name || "Company";
}

export function OnSiteStaffSheet({
  staff,
  sessionId,
  onClose,
  onSaved,
  initialQuery = "",
  createStaff = addOnSiteStaff,
  title = "Add on-site staff",
  submitLabel = "Add staff",
  helperText = "This creates a current, approved staff record. Website access is prepared separately for leaders who need it.",
  allowAssistantCoordinator = false,
}) {
  const prefill = namePrefill(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [reviewed, setReviewed] = useState(false);
  const [form, setForm] = useState({
    firstName: prefill.firstName,
    lastName: prefill.lastName,
    preferredName: "",
    sex: "",
    birthday: "",
    unit: "",
    stake: "",
    phone: "",
    email: "",
    operationalRole: "counselor",
  });
  const [companies, setCompanies] = useState([]);
  const [companyIds, setCompanyIds] = useState([]);
  const [maxLoad, setMaxLoad] = useState(4);
  const [structureLoading, setStructureLoading] = useState(false);
  const [structureError, setStructureError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const matches = useMemo(() => query.trim() ? searchPeople(staff, query).slice(0, 12) : [], [staff, query]);
  const isAssistant = form.operationalRole === "assistant_coordinator";
  const currentAssistants = useMemo(() => (staff || []).filter((person) => person.operationalRole === "assistant_coordinator" && person.isCurrent !== false && person.registrationStatus === "approved"), [staff]);
  const ownerByCompany = useMemo(() => {
    const map = new Map();
    (companies || []).forEach((company) => {
      const ownerId = company.assistantCoordinatorIds?.[0] || "";
      if (ownerId) map.set(company.id, (staff || []).find((person) => person.id === ownerId) || { id: ownerId, name: "Another Assistant Coordinator" });
    });
    return map;
  }, [companies, staff]);

  useEffect(() => {
    if (!reviewed || !isAssistant || !allowAssistantCoordinator || !sessionId || companies.length) return undefined;
    let active = true;
    setStructureLoading(true);
    setStructureError("");
    Promise.all([loadOperationalStructure(sessionId), loadStructureSettings(sessionId)])
      .then(([structure, settings]) => {
        if (!active) return;
        const nextCompanies = [...(structure.companies || [])].sort((a, b) => companyLabel(a).localeCompare(companyLabel(b), undefined, { numeric: true }));
        const limit = Number(settings.companiesPerAssistantCoordinator || 4);
        setCompanies(nextCompanies);
        setMaxLoad(limit);
        setCompanyIds((current) => {
          if (current.length) return current;
          const target = Math.min(limit, Math.max(1, Math.ceil(nextCompanies.length / Math.max(1, currentAssistants.length + 1))));
          return nextCompanies.filter((company) => !(company.assistantCoordinatorIds || []).length).slice(0, target).map((company) => company.id);
        });
      })
      .catch((err) => {
        if (active) setStructureError(err.message || "Company assignments could not be loaded.");
      })
      .finally(() => { if (active) setStructureLoading(false); });
    return () => { active = false; };
  }, [reviewed, isAssistant, allowAssistantCoordinator, sessionId, companies.length, currentAssistants.length]);

  useEffect(() => {
    if (!isAssistant) {
      setCompanyIds([]);
      setStructureError("");
    }
  }, [isAssistant]);

  const toggleCompany = (companyId) => {
    setError("");
    setCompanyIds((current) => {
      if (current.includes(companyId)) return current.filter((id) => id !== companyId);
      if (current.length >= maxLoad) {
        setError(`Choose up to ${maxLoad} companies for one Assistant Coordinator.`);
        return current;
      }
      return [...current, companyId];
    });
  };

  const useAvailableSuggestion = () => {
    const target = Math.min(maxLoad, Math.max(1, Math.ceil(companies.length / Math.max(1, currentAssistants.length + 1))));
    const available = companies.filter((company) => !ownerByCompany.has(company.id)).slice(0, target).map((company) => company.id);
    setCompanyIds(available);
    if (!available.length) setError("No unassigned company is available. Choose the company or companies this Assistant Coordinator is taking over.");
    else setError("");
  };

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (isAssistant && !allowAssistantCoordinator) throw new Error("A Full Session Administrator is required to add an Assistant Coordinator.");
      if (isAssistant && !companyIds.length) throw new Error("Choose at least one company for this Assistant Coordinator.");
      if (isAssistant && !form.email.trim()) throw new Error("Add the Assistant Coordinator's email so website access can be prepared.");
      const date = await loadOnSiteReferenceDate(sessionId);
      const errors = validateManualStaff({ ...form, age: ageOnDate(form.birthday, date) }, reviewed);
      if (errors.length) throw Error(errors.join(" "));
      const id = await createStaff({ sessionId, ...form, companyIds });
      await onSaved?.(id);
      onClose();
    } catch (err) {
      setError(err.message || "Could not add staff");
    } finally {
      setBusy(false);
    }
  };

  const roleOptions = [
    ["counselor", "Counselor"],
    ...(allowAssistantCoordinator ? [["assistant_coordinator", "Assistant Coordinator"]] : []),
    ["committee_member", "Committee member"],
    ["other", "Other staff"],
  ];
  const canSubmit = !busy && !structureLoading && (!isAssistant || (companyIds.length > 0 && Boolean(form.email.trim()) && !structureError));

  return <DismissibleLayer open onClose={() => !busy && onClose()} title={title} sheet className="operations-state-layer">
    <form className="operations-state-form operations-state-form-v2" onSubmit={save}>
      <header>
        <div><span className="kicker">Staff arrival</span><h2>{title}</h2></div>
        <button type="button" className="icon-button" disabled={busy} onClick={onClose} aria-label="Close">×</button>
      </header>

      <div className="operations-state-step">
        <b>1. Check the roster first</b>
        <span>Search before adding anyone so the same person does not get two records.</span>
      </div>
      <SearchField
        value={query}
        onChange={(value) => { setQuery(value); setReviewed(false); }}
        label="Search existing staff"
        placeholder="Full or preferred name"
      />

      {matches.length ? <div className="operations-state-matches" aria-label="Existing staff matches">
        {matches.map((person) => <div key={person.id} className="operations-state-match">
          <b>{person.name}</b>
          <small>{[person.unit, person.registrationStatus].filter(Boolean).join(" · ")}</small>
        </div>)}
      </div> : null}

      {query.trim().length >= 3 ? <label className="check-row operations-state-confirm-search">
        <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
        <span><b>I checked the results</b><small>This person is not already listed.</small></span>
      </label> : null}

      {reviewed ? <>
        <div className="operations-state-step">
          <b>2. Add the person</b>
          <span>People added here are approved to serve for this session.</span>
        </div>

        <div className="operations-state-field-grid">
          {[
            ["firstName", "First name", "text"],
            ["lastName", "Last name", "text"],
            ["birthday", "Date of birth", "date"],
            ["unit", "Ward / branch", "text"],
            ["stake", "Stake / district", "text"],
            ["phone", "Phone", "tel"],
            ["email", isAssistant ? "Email for website access" : "Email", "email"],
          ].map(([key, label, type]) => <label key={key}>{label}
            <input
              type={type}
              required={["firstName", "lastName", "birthday", "unit"].includes(key) || (key === "email" && isAssistant)}
              maxLength={150}
              value={form[key]}
              onChange={(event) => setForm({ ...form, [key]: event.target.value })}
              autoComplete={key === "email" ? "email" : key === "phone" ? "tel" : "off"}
            />
            {key === "email" && isAssistant ? <small>They will not need to type this again during first-time setup.</small> : null}
          </label>)}

          <label>Sex
            <select required value={form.sex} onChange={(event) => setForm({ ...form, sex: event.target.value })}>
              <option value="">Choose</option>
              <option>Female</option>
              <option>Male</option>
            </select>
          </label>

          <label>Operational role
            <select value={form.operationalRole} onChange={(event) => setForm({ ...form, operationalRole: event.target.value })}>
              {roleOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>

        {isAssistant ? <section className="operations-state-companies" aria-label="Assistant Coordinator companies">
          <div className="operations-state-company-head">
            <span><b>3. Assign companies</b><small>{companyIds.length}/{maxLoad} selected</small></span>
            <button type="button" className="text-action" disabled={structureLoading} onClick={useAvailableSuggestion}>Use available suggestion</button>
          </div>
          <p>The companies selected here become this person's website scope too. Selecting an assigned company transfers it from the current Assistant Coordinator.</p>
          {structureLoading ? <div className="operations-state-loading"><span />Loading companies…</div> : null}
          {structureError ? <p role="alert" className="operations-state-inline-error">{structureError}</p> : null}
          {!structureLoading && !structureError ? <div className="operations-state-company-list">
            {companies.map((company) => {
              const selected = companyIds.includes(company.id);
              const owner = ownerByCompany.get(company.id);
              return <label key={company.id} className={selected ? "selected" : ""}>
                <input type="checkbox" checked={selected} disabled={!selected && companyIds.length >= maxLoad} onChange={() => toggleCompany(company.id)} />
                <span><b>{companyLabel(company)}</b><small>{owner ? `Currently ${owner.name}. Selecting will move it.` : "Available"}</small></span>
              </label>;
            })}
          </div> : null}
          {!structureLoading && !companies.length && !structureError ? <p className="operations-state-inline-error">No companies are available yet. Create the session structure before adding an Assistant Coordinator here.</p> : null}
        </section> : null}

        <div className="operations-state-ready-note">
          <b>{isAssistant ? "Ready in one action" : "Ready to add"}</b>
          <span>{isAssistant ? "This will add the staff record, approve the person, mark them present and save the selected companies. Website access can then be prepared from Access." : helperText}</span>
        </div>
        {error ? <p role="alert" className="operations-state-inline-error">{error}</p> : null}
        <div className="operations-state-actions"><button className="primary" disabled={!canSubmit}>{busy ? "Adding…" : submitLabel}</button></div>
      </> : null}
    </form>
  </DismissibleLayer>;
}
