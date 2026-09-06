import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "@phosphor-icons/react/ArrowLeft";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Copy } from "@phosphor-icons/react/Copy";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { X } from "@phosphor-icons/react/X";
import { DismissibleLayer, MutationFeedback } from "./UI.jsx";
import { loadOperationalStructure, loadStaff, loadStructureSettings } from "../lib/operations.js";
import {
  ACCOUNT_ROLES,
  createManualStaffLeader,
  createStaffLeaderInvite,
  setAssistantCoordinatorCompanies,
  staffRoleLabel,
} from "../lib/staff-access.js";

const ROLE_OPTIONS = [
  ["assistant_coordinator", "Assistant Coordinator"],
  ["coordinator", "Coordinator"],
  ["logistics_admin", "Logistical administrator"],
  ["session_director", "Session directing couple"],
];

function companyLabel(company) {
  return company?.displayName || company?.name || "Company";
}

function normalizeStaffId(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.staff_id || value.staffId || value.id || "";
}

function balancedCompanyIds(companies, staff, maxLoad, currentStaffId = "") {
  if (!companies.length) return [];
  const assistants = staff.filter((person) => person.operationalRole === "assistant_coordinator" && person.isCurrent !== false && person.registrationStatus === "approved");
  const assistantCount = Math.max(1, assistants.length + (currentStaffId ? 0 : 1));
  const target = Math.min(maxLoad, Math.max(1, Math.ceil(companies.length / assistantCount)));
  return [...companies]
    .map((company) => {
      const ownerId = company.assistantCoordinatorIds?.[0] || "";
      const owner = staff.find((person) => person.id === ownerId);
      return { company, ownerId, ownerLoad: owner?.companyIds?.length || 0 };
    })
    .filter(({ ownerId }) => !ownerId || ownerId === currentStaffId)
    .sort((a, b) => Number(Boolean(a.ownerId)) - Number(Boolean(b.ownerId)) || companyLabel(a.company).localeCompare(companyLabel(b.company), undefined, { numeric: true }))
    .slice(0, target)
    .map(({ company }) => company.id);
}

export function LeaderSetupFlow({ sessionId, person = null, onClose, onComplete }) {
  const existing = Boolean(person?.staffId);
  const firstStep = existing ? 2 : 1;
  const [step, setStep] = useState(firstStep);
  const [name, setName] = useState(person?.name || "");
  const [role, setRole] = useState(person?.operationalRole || "assistant_coordinator");
  const [email, setEmail] = useState(person?.accountEmail || person?.email || "");
  const [companies, setCompanies] = useState([]);
  const [staff, setStaff] = useState([]);
  const [companyIds, setCompanyIds] = useState(person?.companyIds || []);
  const [maxLoad, setMaxLoad] = useState(4);
  const [companyQuery, setCompanyQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([loadOperationalStructure(sessionId), loadStaff(sessionId), loadStructureSettings(sessionId)])
      .then(([structure, staffRows, settings]) => {
        if (!active) return;
        setCompanies(structure.companies || []);
        setStaff(staffRows || []);
        setMaxLoad(Number(settings.companiesPerAssistantCoordinator || 4));
        if (!existing && role === "assistant_coordinator" && !companyIds.length) {
          setCompanyIds(balancedCompanyIds(structure.companies || [], staffRows || [], Number(settings.companiesPerAssistantCoordinator || 4)));
        }
      })
      .catch((err) => active && setError(err.message || "Leader setup could not be prepared."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [sessionId]);

  useEffect(() => {
    if (role !== "assistant_coordinator") setCompanyIds([]);
    else if (!existing && companies.length && !companyIds.length) setCompanyIds(balancedCompanyIds(companies, staff, maxLoad));
  }, [role]);

  const owners = useMemo(() => new Map(companies.map((company) => {
    const ownerId = company.assistantCoordinatorIds?.[0] || "";
    return [company.id, staff.find((personRow) => personRow.id === ownerId) || null];
  })), [companies, staff]);

  const filteredCompanies = useMemo(() => {
    const text = companyQuery.trim().toLowerCase();
    return companies.filter((company) => !text || `${companyLabel(company)} ${owners.get(company.id)?.name || ""}`.toLowerCase().includes(text));
  }, [companies, owners, companyQuery]);

  const canAdvanceDetails = name.trim().length >= 2 && ACCOUNT_ROLES.has(role);
  const canFinish = !loading && !busy && canAdvanceDetails && (role !== "assistant_coordinator" || companyIds.length > 0) && companyIds.length <= maxLoad;
  const displayStep = existing ? step - 1 : step;
  const totalSteps = existing ? 2 : 3;
  const canGoBack = step > firstStep;

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

  const applyBalancedSuggestion = () => {
    setError("");
    setCompanyIds(balancedCompanyIds(companies, staff, maxLoad, existing ? person?.staffId : ""));
  };

  const copy = async (value, label) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1600);
    } catch {
      setError("Copy did not work on this device. Select the code manually instead.");
    }
  };

  const finish = async () => {
    if (!canFinish) return;
    setBusy(true);
    setError("");
    try {
      let staffId = person?.staffId || "";
      if (!staffId) {
        const result = await createManualStaffLeader({ sessionId, name: name.trim(), email: email.trim(), role });
        staffId = normalizeStaffId(result);
        if (!staffId) throw new Error("The leader was created but the setup could not continue. Refresh and try again.");
      }
      if (role === "assistant_coordinator") await setAssistantCoordinatorCompanies(staffId, companyIds);
      let invite = null;
      if (email.trim()) invite = await createStaffLeaderInvite(staffId, email.trim());
      const finalPerson = { staffId, name: name.trim(), operationalRole: role, email: email.trim(), companyIds };
      setCreated({ invite, person: finalPerson });
      await onComplete?.(finalPerson, invite);
    } catch (err) {
      setError(err.message || "Leader setup could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const setupLink = created?.invite && typeof window !== "undefined" ? `${window.location.origin}/?invite=${encodeURIComponent(created.invite.code)}` : "";
  const roleName = staffRoleLabel(role);

  return <DismissibleLayer open onClose={() => !busy && onClose()} title="Leader setup" sheet className="leader-setup-layer">
    <div className="leader-setup-flow">
      <header className="leader-setup-header">
        {canGoBack && !created ? <button type="button" className="icon-button leader-setup-back" onClick={() => setStep(step - 1)} aria-label="Back"><ArrowLeft /></button> : <span />}
        <div><span className="kicker">Leader setup</span><h2>{created ? "Setup complete" : existing ? `Finish ${name}'s setup` : "Add a leader"}</h2></div>
        <button type="button" data-layer-close className="icon-button" onClick={onClose} disabled={busy} aria-label="Close"><X /></button>
      </header>

      {!created ? <div className="leader-setup-progress" aria-label={`Step ${displayStep} of ${totalSteps}`}>{Array.from({ length: totalSteps }, (_, index) => <i key={index} className={displayStep >= index + 1 ? "done" : ""} />)}</div> : null}

      <div className="leader-setup-scroll">
        {!existing && step === 1 && !created ? <section className="leader-setup-section">
          <div className="leader-setup-section-title"><UserPlus /><div><b>Who is this leader?</b><small>Add the responsibility first. Access can be prepared before you finish.</small></div></div>
          <label>Full name<input autoFocus required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>
          <label>FSY responsibility<select value={role} onChange={(event) => setRole(event.target.value)}>{ROLE_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <div className="leader-setup-note"><ShieldCheck /><span><b>One connected setup</b><small>The role remains the assignment source of truth, but you do not need to leave this flow to finish company scope or website access.</small></span></div>
        </section> : null}

        {step === 2 && !created ? <section className="leader-setup-section">
          <div className="leader-setup-section-title"><Buildings /><div><b>{role === "assistant_coordinator" ? "Company scope and sign-in" : "Website sign-in"}</b><small>{role === "assistant_coordinator" ? "Choose where this leader serves, then confirm the email they will use." : "Confirm the email this leader will use to sign in."}</small></div></div>
          {role === "assistant_coordinator" ? <>
            <div className="leader-setup-selection-head"><span><b>Companies</b><small>{companyIds.length}/{maxLoad} selected</small></span>{(!existing || !companyIds.length) ? <button type="button" className="text-action" onClick={applyBalancedSuggestion}>Use balanced suggestion</button> : null}</div>
            <input className="leader-setup-company-search" type="search" value={companyQuery} onChange={(event) => setCompanyQuery(event.target.value)} placeholder="Search companies" aria-label="Search companies" />
            <div className="leader-setup-company-list">{filteredCompanies.map((company) => {
              const selected = companyIds.includes(company.id);
              const owner = owners.get(company.id);
              const moves = owner && owner.id !== person?.staffId;
              return <label key={company.id} className={selected ? "selected" : ""}><input type="checkbox" checked={selected} disabled={!selected && companyIds.length >= maxLoad} onChange={() => toggleCompany(company.id)} /><span><b>{companyLabel(company)}</b><small>{moves ? `Currently ${owner.name}. Selecting it will move this company.` : owner ? "Already assigned to this leader" : "Available"}</small></span></label>;
            })}</div>
            {!companyIds.length ? <MutationFeedback tone="error">Choose at least one company before finishing an Assistant Coordinator setup.</MutationFeedback> : null}
          </> : null}
          <label>Email address <span className="optional">Optional</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="leader@example.com" /><small>{email.trim() ? "A setup link will be created when you finish." : "Leave blank to save the FSY assignment without website access for now."}</small></label>
        </section> : null}

        {step === 3 && !created ? <section className="leader-setup-section">
          <div className="leader-setup-section-title"><CheckCircle /><div><b>Review setup</b><small>Check the result once. Nothing else is needed on another page.</small></div></div>
          <div className="leader-setup-review">
            <div><span>Leader</span><b>{name}</b></div>
            <div><span>Responsibility</span><b>{roleName}</b></div>
            {role === "assistant_coordinator" ? <div><span>Company scope</span><b>{companyIds.map((id) => companyLabel(companies.find((company) => company.id === id))).join(" · ") || "None"}</b></div> : null}
            <div><span>Website access</span><b>{email.trim() ? email.trim() : "Not prepared now"}</b></div>
          </div>
          <div className="leader-setup-note"><ShieldCheck /><span><b>Assignments and Access stay synchronized</b><small>Future role or company changes continue to update the linked website account automatically.</small></span></div>
        </section> : null}

        {created ? <section className="leader-setup-section leader-setup-success">
          <CheckCircle weight="fill" className="leader-setup-success-icon" />
          <div><span className="kicker">Done</span><h3>{created.person.name} is set up</h3><p>{staffRoleLabel(created.person.operationalRole)}{created.person.companyIds?.length ? ` · ${created.person.companyIds.length} companies` : ""}</p></div>
          {created.invite ? <><div className="leader-setup-code"><span>One-time code</span><strong>{created.invite.code}</strong><small>{created.invite.expiresAt ? `Expires ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(created.invite.expiresAt))}` : "Use once to finish account setup"}</small></div><div className="leader-setup-copy-actions"><button className="primary" onClick={() => copy(setupLink, "link")}><Copy />{copied === "link" ? "Link copied" : "Copy setup link"}</button><button className="secondary" onClick={() => copy(created.invite.code, "code")}><Copy />{copied === "code" ? "Code copied" : "Copy code"}</button></div></> : <div className="leader-setup-note"><ShieldCheck /><span><b>Assignment saved</b><small>No website invite was created because no email was entered. You can prepare access from this leader's row later without rebuilding the assignment.</small></span></div>}
        </section> : null}

        {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      </div>

      {!created ? <footer className="leader-setup-footer">
        {canGoBack ? <button type="button" className="secondary" disabled={busy} onClick={() => setStep(step - 1)}>Back</button> : <button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button>}
        {step < 3 ? <button type="button" className="primary" disabled={loading || (step === 1 && !canAdvanceDetails) || (step === 2 && role === "assistant_coordinator" && !companyIds.length)} onClick={() => setStep(step + 1)}>Continue</button> : <button type="button" className="primary" disabled={!canFinish} onClick={finish}>{busy ? "Finishing…" : "Finish setup"}</button>}
      </footer> : <footer className="leader-setup-footer"><span /><button type="button" className="primary" onClick={onClose}>Done</button></footer>}
    </div>
  </DismissibleLayer>;
}
