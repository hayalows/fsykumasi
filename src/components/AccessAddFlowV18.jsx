import { useMemo, useState } from "react";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { Users } from "@phosphor-icons/react/Users";
import { X } from "@phosphor-icons/react/X";
import { DismissibleLayer, Empty, SearchField } from "./UI.jsx";
import { staffRoleLabel } from "../lib/staff-access.js";

function initials(name = "FSY") {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function scopeText(person) {
  if (person.operationalRole !== "assistant_coordinator") return "Whole session";
  if (person.companyNames?.length) return person.companyNames.join(" · ");
  if (person.companyIds?.length) return `${person.companyIds.length} compan${person.companyIds.length === 1 ? "y" : "ies"}`;
  return "Companies still need to be chosen";
}

export function AccessAddFlowV18({
  staff = [],
  canAddLeader = false,
  canInviteCommittee = false,
  onChooseStaff,
  onAddStaff,
  onAddCommittee,
  onClose,
}) {
  const [query, setQuery] = useState("");
  const available = useMemo(() => {
    const text = query.trim().toLowerCase();
    return staff
      .filter((person) => person.staffId && !person.userId && person.accessState === "not_enabled")
      .filter((person) => !text || `${person.name} ${person.email || ""} ${staffRoleLabel(person.operationalRole)} ${(person.companyNames || []).join(" ")}`.toLowerCase().includes(text))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [staff, query]);

  return <DismissibleLayer open onClose={onClose} title="Add access" sheet className="access-v18-add-layer">
    <div className="access-v18-add-shell">
      <header className="access-v18-sheet-head">
        <div><span className="kicker">Add access</span><h2>Choose a person</h2><p>Start with Staff. Add someone new only if they are not already listed.</p></div>
        <button type="button" data-layer-close className="icon-button" onClick={onClose} aria-label="Close"><X /></button>
      </header>

      <div className="access-v18-sheet-scroll">
        <section className="access-v18-add-existing">
          <div className="access-v18-section-head"><div><b>Choose from Staff</b><small>People already in Staff should get access from their existing record.</small></div></div>
          <SearchField value={query} onChange={setQuery} label="Search Staff" placeholder="Search by name or email" />
          {available.length ? <div className="access-v18-staff-choices">{available.map((person) => <button type="button" key={person.staffId} className="access-v18-staff-choice" onClick={() => onChooseStaff?.(person)}>
            <span className="person-avatar">{initials(person.name)}</span>
            <span><b>{person.name}</b><small>{staffRoleLabel(person.operationalRole)} · {scopeText(person)}</small>{person.email ? <em>{person.email}</em> : null}</span>
            <strong>Choose</strong>
          </button>)}</div> : <Empty title={query ? "No matching Staff person" : "No Staff person is waiting for access"} text={query ? "Try another name or email. If they are not in Staff, open Can't find them? below." : "No current Staff person is waiting for website access."} />}
        </section>

        {(canAddLeader || canInviteCommittee) ? <details className="access-v20-new-person">
          <summary><span><b>Can't find them?</b><small>Add a genuinely new Staff person or committee-only account.</small></span><span aria-hidden="true">+</span></summary>
          <div className="access-v18-new-options">
            {canAddLeader ? <button type="button" onClick={onAddStaff}><span className="access-v18-option-icon"><Buildings /></span><span><b>Add new Staff person</b><small>Create their Staff responsibility, then prepare sign-in.</small></span></button> : null}
            {canInviteCommittee ? <button type="button" onClick={onAddCommittee}><span className="access-v18-option-icon"><Users /></span><span><b>Committee-only access</b><small>Give selected committee tools without a staff-level role.</small></span></button> : null}
          </div>
        </details> : null}
      </div>

      <footer className="access-v18-sheet-footer access-v20-add-footer"><button type="button" className="secondary" onClick={onClose}><X />Cancel</button></footer>
    </div>
  </DismissibleLayer>;
}
