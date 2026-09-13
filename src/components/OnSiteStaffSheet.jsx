import { useMemo, useState } from "react";
import { DismissibleLayer, SearchField } from "./UI.jsx";
import { searchPeople } from "../lib/person-search.js";
import { addOnSiteStaff, loadOnSiteReferenceDate } from "../lib/onsite.js";
import { ageOnDate, validateManualStaff } from "../lib/registration.js";
import "./operational-state.css";

function namePrefill(value = "") {
  const parts = String(value).trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
}

export function OnSiteStaffSheet({
  staff,
  sessionId,
  onClose,
  onSaved,
  initialQuery = "",
  createStaff = addOnSiteStaff,
  title = "Add on-site Staff",
  submitLabel = "Add Staff for confirmation",
  helperText = "Saved as provisional and needing confirmation. Add committee duties and arrival next. Website Access is optional and separate.",
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const matches = useMemo(() => query.trim() ? searchPeople(staff, query).slice(0, 12) : [], [staff, query]);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const date = await loadOnSiteReferenceDate(sessionId);
      const errors = validateManualStaff({ ...form, age: ageOnDate(form.birthday, date) }, reviewed);
      if (errors.length) throw Error(errors.join(" "));
      const id = await createStaff({ sessionId, ...form });
      await onSaved?.(id);
      onClose();
    } catch (err) {
      setError(err.message || "Could not add staff");
    } finally {
      setBusy(false);
    }
  };

  return <DismissibleLayer open onClose={() => !busy && onClose()} title={title} sheet className="operations-state-layer">
    <form className="operations-state-form" onSubmit={save}>
      <header>
        <h2>{title}</h2>
        <button type="button" className="icon-button" disabled={busy} onClick={onClose} aria-label="Close">×</button>
      </header>

      <SearchField
        value={query}
        onChange={(value) => { setQuery(value); setReviewed(false); }}
        label="Search existing Staff first"
        placeholder="Full or preferred name"
      />

      {matches.map((person) => <div key={person.id} className="operations-state-match">
        <b>{person.name}</b>
        <small> · {person.unit} · {person.registrationStatus}</small>
      </div>)}

      {query.trim().length >= 3 ? <label className="check-row">
        <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
        I checked the results. This person is not already listed.
      </label> : null}

      {reviewed ? <>
        {[
          ["firstName", "First name", "text"],
          ["lastName", "Last name", "text"],
          ["birthday", "Date of birth", "date"],
          ["unit", "Ward / branch", "text"],
          ["stake", "Stake / district", "text"],
          ["phone", "Phone", "tel"],
          ["email", "Email", "email"],
        ].map(([key, label, type]) => <label key={key}>{label}
          <input
            type={type}
            required={["firstName", "lastName", "birthday", "unit"].includes(key)}
            maxLength={150}
            value={form[key]}
            onChange={(event) => setForm({ ...form, [key]: event.target.value })}
          />
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
            {[
              ["counselor", "Counselor"],
              ["assistant_coordinator", "Assistant Coordinator"],
              ["committee_member", "Committee member"],
              ["other", "Other Staff"],
            ].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>

        <p>{helperText}</p>
        {error ? <p role="alert">{error}</p> : null}
        <button className="primary" disabled={busy}>{busy ? "Adding…" : submitLabel}</button>
      </> : null}
    </form>
  </DismissibleLayer>;
}
