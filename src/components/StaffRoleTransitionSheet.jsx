import { useMemo, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { UsersThree } from "@phosphor-icons/react/UsersThree";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { DismissibleLayer, MutationFeedback } from "./UI.jsx";

const ROLE_LABELS = {
  counselor: "Counselor",
  assistant_coordinator: "Assistant Coordinator",
  coordinator: "Coordinator",
  committee_member: "Committee member",
  logistics_admin: "Logistical administrator",
  session_director: "Session directing couple",
  other: "Other staff",
};

const WEBSITE_ROLES = new Set(["assistant_coordinator", "coordinator", "logistics_admin", "session_director"]);

function companyLabel(company) {
  return company?.displayName || company?.name || "Company";
}

function groupLabel(group) {
  return group?.displayName || group?.name || "Counselor group";
}

function sameSex(person, group) {
  if (!person?.sex || !group?.sex) return true;
  return person.sex === group.sex;
}

function buildCompanySuggestion(person, staff, companies, maxCompanyLoad) {
  const assistants = staff.filter((item) => item.id !== person.id
    && item.operationalRole === "assistant_coordinator"
    && item.registrationStatus === "approved"
    && item.isCurrent !== false);
  const futureAssistantCount = assistants.length + (person.operationalRole === "assistant_coordinator" ? 0 : 1);
  const targetCount = Math.min(maxCompanyLoad, Math.max(1, Math.ceil(companies.length / Math.max(1, futureAssistantCount))));
  const loads = new Map(assistants.map((item) => [item.id, item.companyIds?.length || 0]));
  const candidates = [...companies]
    .filter((company) => !company.assistantCoordinatorIds?.includes(person.id))
    .map((company) => {
      const ownerId = company.assistantCoordinatorIds?.[0] || "";
      return { company, ownerId, ownerLoad: ownerId ? (loads.get(ownerId) || 0) : 0 };
    })
    .filter((item) => !item.ownerId || item.ownerLoad > 1)
    .sort((left, right) => {
      if (!left.ownerId && right.ownerId) return -1;
      if (left.ownerId && !right.ownerId) return 1;
      if (right.ownerLoad !== left.ownerLoad) return right.ownerLoad - left.ownerLoad;
      return companyLabel(left.company).localeCompare(companyLabel(right.company), undefined, { numeric: true });
    });
  return candidates.slice(0, targetCount).map((item) => item.company.id);
}

export function StaffRoleTransitionSheet({
  person,
  targetRole,
  staff = [],
  groups = [],
  companies = [],
  maxCompanyLoad = 4,
  access,
  onClose,
  onConfirm,
}) {
  const currentGroup = groups.find((group) => group.id === person.counselorGroupId) || null;
  const currentCompany = currentGroup ? companies.find((company) => company.id === currentGroup.companyId) : null;
  const currentCompanies = companies.filter((company) => person.companyIds?.includes(company.id));
  const replacementCounselors = useMemo(() => staff
    .filter((item) => item.id !== person.id
      && item.operationalRole === "counselor"
      && item.registrationStatus === "approved"
      && item.isCurrent !== false
      && !item.counselorGroupId
      && sameSex(item, currentGroup))
    .sort((a, b) => a.name.localeCompare(b.name)), [staff, person.id, currentGroup]);
  const openGroups = useMemo(() => groups
    .filter((group) => !group.counselorId && sameSex(person, group))
    .sort((a, b) => groupLabel(a).localeCompare(groupLabel(b), undefined, { numeric: true })), [groups, person]);
  const suggestedCompanyIds = useMemo(
    () => targetRole === "assistant_coordinator" ? buildCompanySuggestion(person, staff, companies, maxCompanyLoad) : [],
    [targetRole, person, staff, companies, maxCompanyLoad],
  );
  const [replacementMode, setReplacementMode] = useState(currentGroup && targetRole !== "counselor" && replacementCounselors.length ? "replace" : "open");
  const [replacementCounselorId, setReplacementCounselorId] = useState("");
  const [targetGroupId, setTargetGroupId] = useState("");
  const [companyIds, setCompanyIds] = useState(suggestedCompanyIds);
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyVisible, setCompanyVisible] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const companyOwners = useMemo(() => new Map(companies.map((company) => {
    const ownerId = company.assistantCoordinatorIds?.[0] || "";
    return [company.id, ownerId ? staff.find((item) => item.id === ownerId) : null];
  })), [companies, staff]);

  const filteredCompanies = useMemo(() => {
    const text = companyQuery.trim().toLowerCase();
    return companies.filter((company) => {
      const owner = companyOwners.get(company.id);
      return !text || `${companyLabel(company)} ${owner?.name || ""}`.toLowerCase().includes(text);
    }).sort((a, b) => companyLabel(a).localeCompare(companyLabel(b), undefined, { numeric: true }));
  }, [companies, companyOwners, companyQuery]);

  const selectedCompanies = companyIds.map((id) => companies.find((company) => company.id === id)).filter(Boolean);
  const leavingCounselorGroup = Boolean(currentGroup && person.operationalRole === "counselor" && targetRole !== "counselor");
  const leavingCompanies = person.operationalRole === "assistant_coordinator" && targetRole !== "assistant_coordinator" ? currentCompanies : [];
  const linkedAccess = access?.accessState === "active" || access?.accessState === "invited";
  const needsReplacement = leavingCounselorGroup && replacementMode === "replace";
  const needsCompanyScope = targetRole === "assistant_coordinator" && linkedAccess;
  const canConfirm = !busy
    && (!needsReplacement || Boolean(replacementCounselorId))
    && (!needsCompanyScope || companyIds.length > 0)
    && companyIds.length <= maxCompanyLoad;

  const toggleCompany = (companyId) => {
    setError("");
    setCompanyIds((current) => {
      if (current.includes(companyId)) return current.filter((id) => id !== companyId);
      if (current.length >= maxCompanyLoad) {
        setError(`Choose up to ${maxCompanyLoad} companies for one Assistant Coordinator.`);
        return current;
      }
      return [...current, companyId];
    });
  };

  const submit = async () => {
    if (!canConfirm) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm({
        replacementCounselorId: needsReplacement ? replacementCounselorId : null,
        counselorGroupId: targetRole === "counselor" ? (targetGroupId || null) : null,
        companyIds: targetRole === "assistant_coordinator" ? companyIds : [],
        leaveGroupOpen: leavingCounselorGroup && replacementMode === "open",
      });
    } catch (err) {
      setError(err.message || "This responsibility change could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  return <DismissibleLayer open onClose={() => !busy && onClose()} title="Change staff responsibility" sheet>
    <div className="field-sheet staff-role-transition-sheet">
      <button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} disabled={busy} aria-label="Close"><X/></button>
      <span className="kicker">Change responsibility</span>
      <h2>{person.name}</h2>
      <div className="role-transition-route" aria-label={`${ROLE_LABELS[person.operationalRole]} to ${ROLE_LABELS[targetRole]}`}>
        <span>{ROLE_LABELS[person.operationalRole] || person.operationalRole}</span><ArrowRight/><strong>{ROLE_LABELS[targetRole] || targetRole}</strong>
      </div>
      <p className="role-transition-intro">The system will resolve connected assignments in the same change, so you do not have to hunt through other sections first.</p>

      {leavingCounselorGroup ? <section className="role-transition-section">
        <div className="role-transition-section-head"><UsersThree/><div><b>Keep {groupLabel(currentGroup)} covered</b><small>{currentCompany ? `${companyLabel(currentCompany)} · ` : ""}{currentGroup.sex === "Female" ? "YW" : "YM"} · {currentGroup.memberCount} youth</small></div></div>
        {replacementCounselors.length ? <div className="role-transition-choice-grid">
          <label className={replacementMode === "replace" ? "selected" : ""}><input type="radio" name="replacement-mode" checked={replacementMode === "replace"} onChange={() => setReplacementMode("replace")}/><span><b>Replace the Counselor now</b><small>Recommended. The group stays covered when this change saves.</small></span></label>
          <label className={replacementMode === "open" ? "selected" : ""}><input type="radio" name="replacement-mode" checked={replacementMode === "open"} onChange={() => setReplacementMode("open")}/><span><b>Leave the group open</b><small>The group will appear under Needs Counselor after this change.</small></span></label>
        </div> : <div className="role-transition-note warn"><WarningCircle/><span><b>No eligible replacement Counselor is currently free.</b><small>{groupLabel(currentGroup)} will be left open and surfaced immediately in Assignments.</small></span></div>}
        {replacementMode === "replace" && replacementCounselors.length ? <label className="role-transition-field">Replacement Counselor<select value={replacementCounselorId} onChange={(event) => setReplacementCounselorId(event.target.value)}><option value="">Choose an available {currentGroup.sex === "Female" ? "YW" : "YM"} Counselor…</option>{replacementCounselors.map((item) => <option value={item.id} key={item.id}>{item.name}{item.unit ? ` · ${item.unit}` : ""}</option>)}</select><small>{replacementCounselors.length} current approved Counselors are available for this group.</small></label> : null}
      </section> : null}

      {leavingCompanies.length ? <section className="role-transition-section">
        <div className="role-transition-section-head"><Buildings/><div><b>Company scope will be released</b><small>{leavingCompanies.length} compan{leavingCompanies.length === 1 ? "y" : "ies"} will need another Assistant Coordinator.</small></div></div>
        <div className="role-transition-inline-list">{leavingCompanies.map((company) => <span key={company.id}>{companyLabel(company)}</span>)}</div>
        <p className="form-hint">After saving, Assignments will bring these open companies to the top so they can be reassigned.</p>
      </section> : null}

      {targetRole === "assistant_coordinator" ? <section className="role-transition-section">
        <div className="role-transition-section-head"><Buildings/><div><b>Assistant Coordinator scope</b><small>Choose the companies this person will support. Their linked website account follows this scope automatically.</small></div></div>
        {selectedCompanies.length ? <div className="role-transition-selected-companies">{selectedCompanies.map((company) => {
          const owner = companyOwners.get(company.id);
          return <div key={company.id}><span><b>{companyLabel(company)}</b>{owner && owner.id !== person.id ? <small>Moves from {owner.name}</small> : <small>{owner?.id === person.id ? "Already assigned" : "Currently unassigned"}</small>}</span><button type="button" onClick={() => toggleCompany(company.id)} aria-label={`Remove ${companyLabel(company)}`}>Remove</button></div>;
        })}</div> : <div className="role-transition-note"><Buildings/><span><b>No companies selected yet</b><small>{linkedAccess ? "Choose at least one company because this person already has linked website access." : "You can save without a company and assign scope later."}</small></span></div>}
        {suggestedCompanyIds.length ? <button type="button" className="secondary role-transition-suggestion" onClick={() => { setCompanyIds(suggestedCompanyIds); setError(""); }}><CheckCircle/>Use balanced suggestion ({suggestedCompanyIds.length})</button> : null}
        <details className="role-transition-company-picker">
          <summary>Choose different companies <span>{companyIds.length}/{maxCompanyLoad}</span></summary>
          <div className="role-transition-company-picker-body">
            <label className="role-transition-field">Search companies<input type="search" value={companyQuery} onChange={(event) => { setCompanyQuery(event.target.value); setCompanyVisible(10); }} placeholder="Company or current Assistant Coordinator"/></label>
            <div className="role-transition-company-options">{filteredCompanies.slice(0, companyVisible).map((company) => {
              const selected = companyIds.includes(company.id);
              const owner = companyOwners.get(company.id);
              return <label key={company.id} className={selected ? "selected" : ""}><input type="checkbox" checked={selected} disabled={!selected && companyIds.length >= maxCompanyLoad} onChange={() => toggleCompany(company.id)}/><span><b>{companyLabel(company)}</b><small>{owner && owner.id !== person.id ? `Currently ${owner.name} · ${owner.companyIds?.length || 0} companies` : owner?.id === person.id ? "Already assigned to this person" : "Unassigned"}</small></span></label>;
            })}</div>
            {companyVisible < filteredCompanies.length ? <button type="button" className="text-action" onClick={() => setCompanyVisible((value) => value + 10)}>Show 10 more</button> : null}
          </div>
        </details>
      </section> : null}

      {targetRole === "counselor" && person.operationalRole !== "counselor" ? <section className="role-transition-section">
        <div className="role-transition-section-head"><UsersThree/><div><b>Counselor group</b><small>Assign an open same-sex group now, or leave this Counselor available for later.</small></div></div>
        <label className="role-transition-field">Counselor group<select value={targetGroupId} onChange={(event) => setTargetGroupId(event.target.value)}><option value="">Keep available · assign later</option>{openGroups.map((group) => <option value={group.id} key={group.id}>{groupLabel(group)} · {group.sex === "Female" ? "YW" : "YM"} · {group.memberCount} youth</option>)}</select><small>{openGroups.length ? `${openGroups.length} matching open groups are available.` : "There are no matching open counselor groups right now."}</small></label>
      </section> : null}

      {access ? <div className="role-transition-note"><CheckCircle/><span><b>Website access follows the assignment</b><small>{WEBSITE_ROLES.has(targetRole) ? "If this is a linked staff account, its role and company scope will synchronize when you save." : "This staff-linked website role will be removed when you save. Website-only committee access can still be managed separately in Access."}</small></span></div> : null}

      <section className="role-transition-review">
        <span className="kicker">Review</span>
        <div><span><small>Current</small><b>{ROLE_LABELS[person.operationalRole] || person.operationalRole}</b></span><ArrowRight/><span><small>After saving</small><b>{ROLE_LABELS[targetRole] || targetRole}</b></span></div>
        {leavingCounselorGroup && replacementMode === "open" ? <p><WarningCircle/> {groupLabel(currentGroup)} will become unassigned.</p> : null}
        {targetRole === "assistant_coordinator" ? <p><Buildings/> {companyIds.length ? `${companyIds.length} companies will define this Assistant Coordinator's scope.` : "Company scope will be assigned later."}</p> : null}
      </section>

      {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      <div className="field-sheet-actions role-transition-actions"><button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="primary" disabled={!canConfirm} onClick={submit}>{busy ? "Saving change…" : "Confirm responsibility change"}</button></div>
    </div>
  </DismissibleLayer>;
}
