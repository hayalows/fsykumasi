import { useMemo, useState } from "react";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
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
        <div><span className="kicker">Add access</span><h2>Who needs to sign in?</h2><p>Choose someone already in Staff first. This keeps one person, one assignment and one website identity.</p></div>
        <button type="button" data-layer-close className="icon-button" onClick={onClose} aria-label="Close"><X /></button>
      </header>

      <div className="access-v18-sheet-scroll">
        <section className="access-v18-add-existing">
          <div className="access-v18-section-head"><div><b>Current Staff without website access</b><small>If the person is here, use their existing Staff record instead of creating another one.</small></div></div>
          <SearchField value={query} onChange={setQuery} label="Search Staff" placeholder="Name, email, responsibility or company" />
          {available.length ? <div className="access-v18-staff-choices">{available.map((person) => <button type="button" key={person.staffId} className="access-v18-staff-choice" onClick={() => onChooseStaff?.(person)}>
            <span className="person-avatar">{initials(person.name)}</span>
            <span><b>{person.name}</b><small>{staffRoleLabel(person.operationalRole)} · {scopeText(person)}</small>{person.email ? <em>{person.email}</em> : null}</span>
            <strong>Choose</strong>
          </button>)}</div> : <Empty title={query ? "No matching Staff person" : "No Staff person is waiting for access"} text={query ? "Try another name or email. If this person is genuinely new to Staff, add them below." : "Everyone in Staff who needs a website identity is already active, invited or being reviewed."} />}
        </section>

        {(canAddLeader || canInviteCommittee) ? <section className="access-v18-new-person">
          <div className="access-v18-section-head"><div><b>Person is not in the list</b><small>Use these only when the person is genuinely new to the current Staff directory or needs committee-only access.</small></div></div>
          <div className="access-v18-new-options">
            {canAddLeader ? <button type="button" onClick={onAddStaff}><span className="access-v18-option-icon"><Buildings /></span><span><b>Add new Staff person</b><small>Create the Staff responsibility first, then prepare their sign-in.</small></span></button> : null}
            {canInviteCommittee ? <button type="button" onClick={onAddCommittee}><span className="access-v18-option-icon"><Users /></span><span><b>Committee-only access</b><small>For someone who needs selected committee tools without a staff-level responsibility.</small></span></button> : null}
          </div>
        </section> : null}
      </div>

      <footer className="access-v18-sheet-footer"><button type="button" className="secondary" onClick={onClose}><X />Cancel</button><span><UserPlus />Choose a person above to continue</span></footer>
    </div>
  </DismissibleLayer>;
}
