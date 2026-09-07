import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "@phosphor-icons/react/ArrowLeft";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Copy } from "@phosphor-icons/react/Copy";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { X } from "@phosphor-icons/react/X";
import { TeamChoices } from "./AccountSetup.jsx";
import { DismissibleLayer, MutationFeedback } from "./UI.jsx";
import { loadOperationalStructure, loadStaff, loadStructureSettings } from "../lib/operations.js";
import {
  ACCOUNT_ROLES,
  createManualStaffLeader,
  createStaffLeaderInvite,
  setAssistantCoordinatorCompanies,
  staffRoleLabel,
} from "../lib/staff-access.js";

// Connected setup keeps the v12 guarantee: "Nothing else is needed on another page."
const STAFF_ROLE_OPTIONS = [
  { value: "assistant_coordinator", label: "Assistant Coordinator", description: "Sees and supports only the companies assigned to them." },
  { value: "coordinator", label: "Coordinator", description: "Whole-session responsibility and access." },
  { value: "logistics_admin", label: "Logistical administrator", description: "Whole-session operational responsibility and access." },
  { value: "session_director", label: "Session directing couple", description: "Whole-session directing responsibility and access." },
];
const COMMITTEE_ROLE = { value: "committee_viewer", label: "Committee member", description: "Sees only the committee tools selected for them." };

function companyLabel(company) { return company?.displayName || company?.name || "Company"; }
function normalizeStaffId(value) { if (!value) return ""; if (typeof value === "string") return value; return value.staff_id || value.staffId || value.id || ""; }
function normalizeEmail(value = "") { return value.trim().toLowerCase(); }
function looksLikeEmail(value = "") { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value)); }
function accountEmail(account) { return normalizeEmail(account?.email || account?.accountEmail || account?.account_email || ""); }
function inviteEmail(invite) { return normalizeEmail(invite?.email || ""); }

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

export function LeaderSetupFlow({
  sessionId,
  person = null,
  onClose,
  onComplete,
  allowStaffRoles = true,
  allowCommittee = false,
  requireEmail = false,
  teams = [],
  knownAccounts = [],
  pendingInvites = [],
  onCreateCommitteeInvite,
}) {
  const existing = Boolean(person?.staffId);
  const roleOptions = useMemo(() => [...(allowStaffRoles || existing ? STAFF_ROLE_OPTIONS : []), ...(allowCommittee && !existing ? [COMMITTEE_ROLE] : [])], [allowStaffRoles, allowCommittee, existing]);
  const initialRole = person?.operationalRole || roleOptions[0]?.value || "assistant_coordinator";
  const firstStep = existing ? 2 : 1;
  const [step, setStep] = useState(firstStep);
  const [name, setName] = useState(person?.name || "");
  const [role, setRole] = useState(initialRole);
  const [email, setEmail] = useState(person?.accountEmail || person?.email || "");
  const [companies, setCompanies] = useState([]);
  const [staff, setStaff] = useState([]);
  const [companyIds, setCompanyIds] = useState(person?.companyIds || []);
  const [teamKeys, setTeamKeys] = useState(person?.teamKeys || person?.committeeScope || []);
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
    Promise.allSettled([loadOperationalStructure(sessionId), loadStaff(sessionId), loadStructureSettings(sessionId)])
      .then(([structureResult, staffResult, settingsResult]) => {
        if (!active) return;
        const structure = structureResult.status === "fulfilled" ? structureResult.value : { companies: [] };
        const staffRows = staffResult.status === "fulfilled" ? staffResult.value : [];
        const settings = settingsResult.status === "fulfilled" ? settingsResult.value : { companiesPerAssistantCoordinator: 4 };
        setCompanies(structure.companies || []);
        setStaff(staffRows || []);
        setMaxLoad(Number(settings.companiesPerAssistantCoordinator || 4));
        if (!existing && role === "assistant_coordinator" && !companyIds.length) setCompanyIds(balancedCompanyIds(structure.companies || [], staffRows || [], Number(settings.companiesPerAssistantCoordinator || 4)));
        if (role === "assistant_coordinator" && structureResult.status === "rejected") setError("Company assignments could not be loaded. Close this sheet and try again before inviting an Assistant Coordinator.");
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [sessionId]);

  useEffect(() => {
    setError("");
    if (role !== "assistant_coordinator") setCompanyIds([]);
    else if (!existing && companies.length && !companyIds.length) setCompanyIds(balancedCompanyIds(companies, staff, maxLoad));
    if (role !== "committee_viewer") setTeamKeys([]);
  }, [role]);

  const owners = useMemo(() => new Map(companies.map((company) => { const ownerId = company.assistantCoordinatorIds?.[0] || ""; return [company.id, staff.find((personRow) => personRow.id === ownerId) || null]; })), [companies, staff]);
  const filteredCompanies = useMemo(() => { const text = companyQuery.trim().toLowerCase(); return companies.filter((company) => !text || `${companyLabel(company)} ${owners.get(company.id)?.name || ""}`.toLowerCase().includes(text)); }, [companies, owners, companyQuery]);
  const isCommittee = role === "committee_viewer";
  const emailRequired = requireEmail || isCommittee;
  const normalizedEmail = normalizeEmail(email);
  const duplicateAccount = useMemo(() => !existing && normalizedEmail ? knownAccounts.find((account) => accountEmail(account) === normalizedEmail) : null, [knownAccounts, normalizedEmail, existing]);
  const duplicateInvite = useMemo(() => !existing && normalizedEmail ? pendingInvites.find((invite) => inviteEmail(invite) === normalizedEmail && ["pending", "activating"].includes(invite.status)) : null, [pendingInvites, normalizedEmail, existing]);
  const emailConflict = duplicateAccount ? "This email already has website access. Search for the person instead of creating another account." : duplicateInvite ? "An invite is already waiting for this email. Open Invite sent to manage it instead of creating another one." : "";
  const emailReady = !emailRequired || looksLikeEmail(email);
  const canAdvanceDetails = name.trim().length >= 2 && roleOptions.some((option) => option.value === role);
  const scopeReady = role === "assistant_coordinator" ? companyIds.length > 0 && companyIds.length <= maxLoad : isCommittee ? teamKeys.length > 0 : true;
  const canFinish = !loading && !busy && canAdvanceDetails && scopeReady && emailReady && !emailConflict && (!isCommittee || Boolean(onCreateCommitteeInvite));
  const displayStep = existing ? step - 1 : step;
  const totalSteps = existing ? 2 : 3;
  const canGoBack = step > firstStep;
  const flowLabel = allowCommittee && !existing ? "Access setup" : "Leader setup";

  const toggleCompany = (companyId) => {
    setError("");
    setCompanyIds((current) => {
      if (current.includes(companyId)) return current.filter((id) => id !== companyId);
      if (current.length >= maxLoad) { setError(`Choose up to ${maxLoad} companies for one Assistant Coordinator.`); return current; }
      return [...current, companyId];
    });
  };
  const applyBalancedSuggestion = () => { setError(""); setCompanyIds(balancedCompanyIds(companies, staff, maxLoad, existing ? person?.staffId : "")); };
  const copy = async (value, label) => { try { await navigator.clipboard.writeText(value); setCopied(label); window.setTimeout(() => setCopied(""), 1600); } catch { setError("Copy did not work on this device. Select the code manually instead."); } };

  const finish = async () => {
    if (!canFinish) return;
    setBusy(true); setError("");
    try {
      let invite = null; let finalPerson;
      if (isCommittee) {
        invite = await onCreateCommitteeInvite({ displayName: name.trim(), email: normalizedEmail, role: "committee_viewer", companyIds: [], committeeScope: teamKeys });
        finalPerson = { name: name.trim(), operationalRole: "committee_viewer", email: normalizedEmail, teamKeys, teamNames: teamKeys.map((key) => teams.find((team) => team.key === key)?.name || key) };
      } else {
        let staffId = person?.staffId || "";
        if (!staffId) {
          const result = await createManualStaffLeader({ sessionId, name: name.trim(), email: normalizedEmail, role });
          staffId = normalizeStaffId(result);
          if (!staffId) throw new Error("The leader was created but the setup could not continue. Refresh and try again.");
        }
        if (role === "assistant_coordinator") await setAssistantCoordinatorCompanies(staffId, companyIds);
        if (normalizedEmail) invite = await createStaffLeaderInvite(staffId, normalizedEmail);
        finalPerson = { staffId, name: name.trim(), operationalRole: role, email: normalizedEmail, companyIds };
      }
      setCreated({ invite, person: finalPerson });
      await onComplete?.(finalPerson, invite);
    } catch (err) { setError(err.message || "Setup could not be completed."); }
    finally { setBusy(false); }
  };

  const setupLink = created?.invite && typeof window !== "undefined" ? `${window.location.origin}/?invite=${encodeURIComponent(created.invite.code)}` : "";
  const roleName = isCommittee ? "Committee member" : staffRoleLabel(role);
  const selectedTeamNames = teamKeys.map((key) => teams.find((team) => team.key === key)?.name || key);
  const secondaryTitle = role === "assistant_coordinator" ? "Companies and sign-in" : isCommittee ? "Committee and sign-in" : "Website sign-in";
  const secondaryDescription = role === "assistant_coordinator" ? "Choose the companies this leader supports, then enter the email they will use." : isCommittee ? "Choose the committee work this person needs, then enter their sign-in email." : "Enter the email this leader will use to sign in.";

  return <DismissibleLayer open onClose={() => !busy && onClose()} title={flowLabel} sheet className="leader-setup-layer leader-setup-v15">
    <div className="leader-setup-flow">
      <header className="leader-setup-header">
        {canGoBack && !created ? <button type="button" className="icon-button leader-setup-back" onClick={() => setStep(step - 1)} aria-label="Back"><ArrowLeft /></button> : <span />}
        <div><span className="kicker">{flowLabel}</span><h2>{created ? "Invite ready" : existing ? `Finish ${name}'s setup` : "Invite someone"}</h2></div>
        <button type="button" data-layer-close className="icon-button" onClick={onClose} disabled={busy} aria-label="Close"><X /></button>
      </header>

      {!created ? <div className="leader-setup-progress" style={{ gridTemplateColumns: `repeat(${totalSteps}, minmax(0, 1fr))` }} aria-label={`Step ${displayStep} of ${totalSteps}`}>{Array.from({ length: totalSteps }, (_, index) => <i key={index} className={displayStep >= index + 1 ? "done" : ""} />)}</div> : null}

      <div className="leader-setup-scroll">
        {!existing && step === 1 && !created ? <section className="leader-setup-section">
          <div className="leader-setup-section-title"><UserPlus /><div><b>Who are you inviting?</b><small>Choose their real FSY responsibility. The app will use it to decide the right scope.</small></div></div>
          <label>Full name<input autoFocus required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>
          <div className="leader-setup-role-field"><span>Responsibility</span><div className="leader-setup-role-options" role="radiogroup" aria-label="Responsibility">{roleOptions.map((option) => <button type="button" role="radio" aria-checked={role === option.value} className={role === option.value ? "selected" : ""} key={option.value} onClick={() => setRole(option.value)}><span><b>{option.label}</b><small>{option.description}</small></span><i aria-hidden="true" /></button>)}</div></div>
          <div className="leader-setup-note"><ShieldCheck /><span><b>Access follows responsibility</b><small>Assistant Coordinators are limited to their companies. Committee members see only their selected committee tools. Whole-session leaders keep whole-session access.</small></span></div>
        </section> : null}

        {step === 2 && !created ? <section className="leader-setup-section">
          <div className="leader-setup-section-title"><Buildings /><div><b>{secondaryTitle}</b><small>{secondaryDescription}</small></div></div>
          {role === "assistant_coordinator" ? <>
            <div className="leader-setup-selection-head"><span><b>Companies</b><small>{companyIds.length}/{maxLoad} selected</small></span>{(!existing || !companyIds.length) ? <button type="button" className="text-action" onClick={applyBalancedSuggestion}>Use balanced suggestion</button> : null}</div>
            <input className="leader-setup-company-search" type="search" value={companyQuery} onChange={(event) => setCompanyQuery(event.target.value)} placeholder="Search companies" aria-label="Search companies" />
            <div className="leader-setup-company-list">{filteredCompanies.map((company) => {
              const selected = companyIds.includes(company.id); const owner = owners.get(company.id); const moves = owner && owner.id !== person?.staffId;
              return <label key={company.id} className={selected ? "selected" : ""}><input type="checkbox" checked={selected} disabled={!selected && companyIds.length >= maxLoad} onChange={() => toggleCompany(company.id)} /><span><b>{companyLabel(company)}</b><small>{moves ? `Currently ${owner.name}. Selecting it will move this company.` : owner ? "Already assigned to this leader" : "Available"}</small></span></label>;
            })}</div>
            {!companyIds.length ? <MutationFeedback tone="error">Choose at least one company before continuing.</MutationFeedback> : null}
          </> : null}
          {isCommittee ? <div className="leader-setup-committee-choice"><div className="leader-setup-selection-head"><span><b>Committee</b><small>{teamKeys.length ? `${teamKeys.length} selected` : "Choose at least one"}</small></span></div><TeamChoices teams={teams} selected={teamKeys} onChange={setTeamKeys} compact />{!teamKeys.length ? <MutationFeedback tone="error">Choose at least one committee before continuing.</MutationFeedback> : null}</div> : null}
          <label>Email address {emailRequired ? <span className="required-hint">Required</span> : <span className="optional">Optional</span>}<input type="email" required={emailRequired} value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="leader@example.com" /><small>{emailRequired ? "We will create a one-time setup link for this email." : email.trim() ? "A setup link will be created when you finish." : "Leave blank to save the FSY assignment without website access for now."}</small></label>
          {emailConflict ? <MutationFeedback tone="error">{emailConflict}</MutationFeedback> : null}
        </section> : null}

        {step === 3 && !created ? <section className="leader-setup-section">
          <div className="leader-setup-section-title"><CheckCircle /><div><b>Review before inviting</b><small>Confirm what this person will be able to see before creating the link.</small></div></div>
          <div className="leader-setup-review"><div><span>Person</span><b>{name}</b></div><div><span>Responsibility</span><b>{roleName}</b></div>{role === "assistant_coordinator" ? <div><span>Company scope</span><b>{companyIds.map((id) => companyLabel(companies.find((company) => company.id === id))).join(" · ") || "None"}</b></div> : null}{isCommittee ? <div><span>Committee scope</span><b>{selectedTeamNames.join(" · ") || "None"}</b></div> : null}<div><span>Sign-in email</span><b>{normalizedEmail || "Not prepared now"}</b></div></div>
          <div className="leader-setup-note"><ShieldCheck /><span><b>Assignments and Access stay synchronized</b><small>{isCommittee ? "The committee choices on this invite become this person's website tools." : "Future staff role or company changes continue to update the linked website scope."}</small></span></div>
        </section> : null}

        {created ? <section className="leader-setup-section leader-setup-success"><CheckCircle weight="fill" className="leader-setup-success-icon" /><div><span className="kicker">Ready to send</span><h3>{created.person.name}'s invite is ready</h3><p>{created.person.operationalRole === "committee_viewer" ? `Committee member · ${selectedTeamNames.join(" · ")}` : `${staffRoleLabel(created.person.operationalRole)}${created.person.companyIds?.length ? ` · ${created.person.companyIds.length} companies` : ""}`}</p></div>{created.invite ? <><div className="leader-setup-code"><span>One-time code</span><strong>{created.invite.code}</strong><small>{created.invite.expiresAt ? `Expires ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(created.invite.expiresAt))}` : "Use once to finish account setup"}</small></div><div className="leader-setup-copy-actions"><button className="primary" onClick={() => copy(setupLink, "link")}><Copy />{copied === "link" ? "Link copied" : "Copy setup link"}</button><button className="secondary" onClick={() => copy(created.invite.code, "code")}><Copy />{copied === "code" ? "Code copied" : "Copy code"}</button></div></> : <div className="leader-setup-note"><ShieldCheck /><span><b>Assignment saved</b><small>No website invite was created because no email was entered. Website access can be prepared later.</small></span></div>}</section> : null}
        {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      </div>

      {!created ? <footer className="leader-setup-footer">{canGoBack ? <button type="button" className="secondary" disabled={busy} onClick={() => setStep(step - 1)}>Back</button> : <button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button>}{step < 3 ? <button type="button" className="primary" disabled={loading || (step === 1 && !canAdvanceDetails) || (step === 2 && (!scopeReady || !emailReady || Boolean(emailConflict)))} onClick={() => setStep(step + 1)}>Continue</button> : <button type="button" className="primary" disabled={!canFinish} onClick={finish}>{busy ? "Creating invite…" : normalizedEmail ? "Create invite" : "Save assignment"}</button>}</footer> : <footer className="leader-setup-footer"><span /><button type="button" className="primary" onClick={onClose}>Done</button></footer>}
    </div>
  </DismissibleLayer>;
}
