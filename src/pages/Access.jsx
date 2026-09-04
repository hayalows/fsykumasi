import { useEffect, useMemo, useState } from "react";
import { Key } from "@phosphor-icons/react/Key";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { demoAccessRequests, demoUsers } from "../data/demo.js";
import { canApproveAccess, roleLabel, roleVisibility } from "../lib/access.js";
import {
  accessStateLabel,
  loadStaffAccessDirectory,
  resolveCurrentAccessSessionId,
  setStaffWebsiteAccess,
  staffRoleLabel,
  staffScopeLabel,
} from "../lib/staff-access.js";
import { DismissibleLayer, Empty, MutationFeedback, PageHead, SearchField, Status } from "../components/UI.jsx";
import { StaffAccessInvite } from "../components/StaffAccessInvite.jsx";
import "./access-review.css";
import "./access-invites.css";
import "./field-operations.css";
import "./staff-access.css";

const FILTERS = [
  ["not_enabled", "Needs access"],
  ["invited", "Invited"],
  ["active", "Active"],
  ["disabled", "Disabled"],
];

function demoDirectory() {
  return demoUsers.filter((user) => user.roleKey !== "committee_viewer").map((user, index) => ({
    staffId: `demo-staff-${index + 1}`,
    name: user.name,
    operationalRole: user.roleKey,
    email: user.email,
    companyIds: user.roleKey === "assistant_coordinator" ? ["demo-1", "demo-2"] : [],
    companyNames: user.roleKey === "assistant_coordinator" ? ["Company 01", "Company 02"] : [],
    userId: `demo-user-${index + 1}`,
    accountEmail: user.email,
    accessEnabled: user.status === "Active",
    accessState: user.status === "Active" ? "active" : "not_enabled",
  }));
}

function stateTone(state) {
  if (state === "active") return "good";
  if (state === "invited") return "warn";
  return "neutral";
}

function RequestReview({ request, companies, teams, onClose, onDecision }) {
  const [companyIds, setCompanyIds] = useState(request.companyIds || []);
  const [teamKeys, setTeamKeys] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const toggleCompany = (id) => setCompanyIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const toggleTeam = (key) => setTeamKeys((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key]);
  const decide = async (status) => {
    setBusy(status); setError("");
    try {
      await onDecision?.(request.id, status, {
        companyIds: request.role === "assistant_coordinator" ? companyIds : [],
        committeeScope: request.role === "committee_viewer" ? teamKeys : [],
      });
      onClose();
    } catch (err) {
      setError(err.message || "This request could not be reviewed.");
    } finally { setBusy(""); }
  };
  return <DismissibleLayer open onClose={onClose} title="Review access request" sheet>
    <div className="field-sheet">
      <button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} aria-label="Close"><X/></button>
      <span className="kicker">Legacy request</span><h2>{request.name}</h2>
      <p>{request.email} · {roleLabel(request.role)}</p>
      {request.role === "assistant_coordinator" ? <div className="scope-editor"><b>Companies</b><small>Choose the companies this Assistant Coordinator is responsible for.</small><div className="company-picker">{companies.map((company) => <label key={company.id} className={companyIds.includes(company.id) ? "selected" : ""}><input type="checkbox" checked={companyIds.includes(company.id)} onChange={() => toggleCompany(company.id)}/><span>{company.name}</span></label>)}</div></div> : null}
      {request.role === "committee_viewer" ? <div className="scope-editor"><b>Team responsibility</b><div className="access-team-picker">{teams.map((team) => <label key={team.key} className={teamKeys.includes(team.key) ? "selected" : ""}><input type="checkbox" checked={teamKeys.includes(team.key)} onChange={() => toggleTeam(team.key)}/><span><b>{team.name}</b><small>{team.description}</small></span></label>)}</div></div> : null}
      {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      <div className="field-sheet-actions"><button className="secondary" disabled={Boolean(busy)} onClick={() => decide("rejected")}>{busy === "rejected" ? "Rejecting…" : "Reject"}</button><button className="primary" disabled={Boolean(busy) || (request.role === "assistant_coordinator" && !companyIds.length) || (request.role === "committee_viewer" && !teamKeys.length)} onClick={() => decide("approved")}>{busy === "approved" ? "Approving…" : "Approve"}</button></div>
    </div>
  </DismissibleLayer>;
}

function LegacyAccountEditor({ user, companies, teams, onClose, onSave }) {
  const [role, setRole] = useState(user.role);
  const [companyIds, setCompanyIds] = useState(user.companyIds || []);
  const [teamKeys, setTeamKeys] = useState(user.teamKeys || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toggleCompany = (id) => setCompanyIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const toggleTeam = (key) => setTeamKeys((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key]);
  const save = async () => {
    setBusy(true); setError("");
    try { await onSave?.({ assignmentId: user.id, role, companyIds, teamKeys, accessAdmin: false }); onClose(); }
    catch (err) { setError(err.message || "This exception account could not be updated."); }
    finally { setBusy(false); }
  };
  return <DismissibleLayer open onClose={onClose} title="Legacy account settings" sheet><div className="field-sheet">
    <button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} aria-label="Close"><X/></button>
    <span className="kicker">Exception account</span><h2>{user.name}</h2><p>{user.email}</p>
    <div className="notice compact-notice"><WarningCircle/><div><b>Not linked to a Staff identity yet</b><p>Use this editor only for older or committee accounts. New staff access should be created from Assignments.</p></div></div>
    <label>Access role<select value={role} onChange={(event) => { setRole(event.target.value); if (event.target.value !== "assistant_coordinator") setCompanyIds([]); }}><option value="assistant_coordinator">Assistant coordinator</option><option value="coordinator">Coordinator</option><option value="logistics_admin">Logistical administrator</option><option value="session_director">Session directing couple</option><option value="committee_viewer">Committee viewer</option></select></label>
    {role === "assistant_coordinator" ? <div className="company-picker">{companies.map((company) => <label key={company.id} className={companyIds.includes(company.id) ? "selected" : ""}><input type="checkbox" checked={companyIds.includes(company.id)} onChange={() => toggleCompany(company.id)}/><span>{company.name}</span></label>)}</div> : null}
    {role === "committee_viewer" ? <div className="access-team-picker">{teams.map((team) => <label key={team.key} className={teamKeys.includes(team.key) ? "selected" : ""}><input type="checkbox" checked={teamKeys.includes(team.key)} onChange={() => toggleTeam(team.key)}/><span><b>{team.name}</b><small>{team.description}</small></span></label>)}</div> : null}
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
    <div className="field-sheet-actions"><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy || (role === "assistant_coordinator" && !companyIds.length) || (role === "committee_viewer" && !teamKeys.length)} onClick={save}>{busy ? "Saving…" : "Save exception account"}</button></div>
  </div></DismissibleLayer>;
}

export function createInitialAccessRequests() { return demoAccessRequests; }

export function Access({
  requests = [],
  invites = [],
  currentRole = "logistics_admin",
  currentCapabilities = [],
  onDecision,
  onRevokeInvite,
  onCreateRecovery,
  onManageLeaderAccess,
  roster = demoUsers,
  companies = [],
  teams = [],
  live = false,
  sessionName,
}) {
  const [sessionId, setSessionId] = useState("");
  const [directory, setDirectory] = useState(live ? [] : demoDirectory());
  const [filter, setFilter] = useState("not_enabled");
  const [query, setQuery] = useState("");
  const [inviteTarget, setInviteTarget] = useState(null);
  const [reviewRequest, setReviewRequest] = useState(null);
  const [legacyTarget, setLegacyTarget] = useState(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canManage = canApproveAccess(currentRole, currentCapabilities);

  const refresh = async (knownSessionId = sessionId) => {
    if (!live) return;
    const resolved = knownSessionId || await resolveCurrentAccessSessionId();
    if (!sessionId) setSessionId(resolved);
    setDirectory(await loadStaffAccessDirectory(resolved));
  };

  useEffect(() => {
    if (!live) return;
    resolveCurrentAccessSessionId().then((id) => { setSessionId(id); return loadStaffAccessDirectory(id); }).then(setDirectory).catch((err) => setError(err.message || "Website access could not be loaded."));
  }, [live]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([key]) => [key, directory.filter((item) => item.accessState === key).length])), [directory]);
  const shown = useMemo(() => {
    const text = query.trim().toLowerCase();
    return directory.filter((item) => item.accessState === filter).filter((item) => {
      if (!text) return true;
      return `${item.name} ${item.email} ${item.accountEmail} ${staffRoleLabel(item.operationalRole)} ${staffScopeLabel(item)}`.toLowerCase().includes(text);
    });
  }, [directory, filter, query]);

  const linkedUsers = new Set(directory.map((item) => item.userId).filter(Boolean));
  const legacyRoster = (roster || []).filter((user) => user.active !== false && user.status !== "Pending" && !linkedUsers.has(user.userId || user.id));
  const legacyInvites = (invites || []).filter((invite) => !invite.staff_id && invite.status === "pending");
  const pendingLegacy = (requests || []).filter((request) => request.status === "pending");

  const toggleAccess = async (person, enabled) => {
    if (!live) {
      setDirectory((current) => current.map((item) => item.staffId === person.staffId ? { ...item, accessState: enabled ? "active" : "disabled", accessEnabled: enabled } : item));
      return;
    }
    setBusyId(person.staffId); setError(""); setNotice("");
    try {
      await setStaffWebsiteAccess(person.staffId, enabled);
      await refresh();
      setNotice(`${person.name}'s website access was ${enabled ? "enabled" : "disabled"}.`);
    } catch (err) { setError(err.message || "Website access could not be changed."); }
    finally { setBusyId(""); }
  };

  const recovery = async (person) => {
    if (!person.userId || !onCreateRecovery) return;
    setBusyId(person.staffId); setError(""); setNotice("");
    try {
      const created = await onCreateRecovery(person.userId);
      if (created?.code) {
        await navigator.clipboard.writeText(created.code).catch(() => {});
        setNotice(`Recovery code created for ${person.name}${navigator.clipboard ? " and copied." : "."}`);
      } else setNotice(`Recovery access was prepared for ${person.name}.`);
    } catch (err) { setError(err.message || "Recovery access could not be prepared."); }
    finally { setBusyId(""); }
  };

  const revokeStaffInvite = async (person) => {
    if (!person.inviteId || !onRevokeInvite) return;
    setBusyId(person.staffId); setError("");
    try { await onRevokeInvite(person.inviteId); await refresh(); setNotice(`${person.name}'s pending invite was revoked.`); }
    catch (err) { setError(err.message || "Invite could not be revoked."); }
    finally { setBusyId(""); }
  };

  return <section className="page staff-access-page">
    <PageHead title="Website access" sessionName={sessionName} description="Assignments decides each person's FSY role and company scope. This screen only controls who can sign in." />

    {!canManage ? <div className="notice"><WarningCircle/><div><b>View only</b><p>A Full Session Administrator is required to invite, enable or disable website access.</p></div></div> : null}
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
    {notice ? <MutationFeedback><b>Done</b> · {notice}</MutationFeedback> : null}

    <div className="staff-access-guide" aria-label="How website access works">
      <div><span>1 · Assign</span><b>Set the FSY responsibility</b><p>Role and companies live in Assignments, even if the person never receives a login.</p></div>
      <div><span>2 · Give access</span><b>Invite only who needs the app</b><p>The setup link attaches an account to the existing staff identity. Nothing is re-entered.</p></div>
      <div><span>3 · Stay in sync</span><b>Permissions follow Assignments</b><p>Moving an AC to different companies automatically changes what their linked account can access.</p></div>
    </div>

    <div className="staff-access-summary" role="group" aria-label="Website access status">
      {FILTERS.map(([key, label]) => <button key={key} type="button" className={filter === key ? "active" : ""} onClick={() => setFilter(key)}><strong>{counts[key] || 0}</strong><span>{label}</span></button>)}
    </div>

    <article className="panel">
      <div className="staff-access-intro"><div><span className="kicker">Account lifecycle</span><h2>{FILTERS.find(([key]) => key === filter)?.[1]}</h2><p>No access is a valid state. An Assistant Coordinator can be fully assigned to FSY without ever receiving a website account.</p></div><Status tone={stateTone(filter)}>{shown.length} shown</Status></div>
      <div className="staff-access-toolbar"><SearchField value={query} onChange={setQuery} label="Search website access" placeholder="Search name, email, role or company"/></div>

      {shown.length ? <div className="staff-access-list">{shown.map((person) => <div className="staff-access-row" key={person.staffId}>
        <div className="staff-access-person"><b>{person.name}</b><span className={`staff-access-state ${person.accessState}`}>{accessStateLabel(person.accessState)}</span><small>{person.accountEmail || person.email || "Email will be confirmed when access is given"}</small></div>
        <div className="staff-access-scope"><small>{staffRoleLabel(person.operationalRole)}</small><b>{staffScopeLabel(person)}</b></div>
        <div className="staff-access-actions">
          {person.accessState === "not_enabled" ? <button className="primary" disabled={!canManage || (person.operationalRole === "assistant_coordinator" && !person.companyIds.length)} onClick={() => setInviteTarget(person)}><UserPlus/>Give access</button> : null}
          {person.accessState === "invited" ? <><button className="secondary" disabled={!canManage || busyId === person.staffId} onClick={() => setInviteTarget(person)}>New setup link</button><button className="text-action" disabled={!canManage || busyId === person.staffId} onClick={() => revokeStaffInvite(person)}>Revoke</button></> : null}
          {person.accessState === "active" ? <><button className="secondary" disabled={!canManage || busyId === person.staffId} onClick={() => recovery(person)}><Key/>Recovery</button><button className="text-action" disabled={!canManage || busyId === person.staffId} onClick={() => toggleAccess(person, false)}>Disable</button></> : null}
          {person.accessState === "disabled" ? <button className="primary" disabled={!canManage || busyId === person.staffId} onClick={() => toggleAccess(person, true)}>Enable access</button> : null}
        </div>
      </div>)}</div> : <div className="staff-access-empty"><Empty title={`No ${FILTERS.find(([key]) => key === filter)?.[1]?.toLowerCase() || "matching"} accounts`} text={query ? "Try another search." : "There is nothing in this access state right now."}/></div>}
    </article>

    {(pendingLegacy.length || legacyInvites.length || legacyRoster.length) ? <details className="panel legacy-access-details">
      <summary>Older / exception access ({pendingLegacy.length + legacyInvites.length + legacyRoster.length})</summary>
      <div className="legacy-access-list">
        {pendingLegacy.map((request) => <div className="legacy-access-row" key={request.id}><span><b>{request.name}</b><small>Pending request · {roleLabel(request.role)} · {request.scope}</small></span><button className="secondary" disabled={!canManage} onClick={() => setReviewRequest(request)}>Review</button></div>)}
        {legacyInvites.map((invite) => <div className="legacy-access-row" key={invite.id}><span><b>{invite.display_name || invite.email}</b><small>Older invite · {roleLabel(invite.role)}</small></span><button className="secondary" disabled={!canManage} onClick={() => onRevokeInvite?.(invite.id)}>Revoke</button></div>)}
        {legacyRoster.map((user) => <div className="legacy-access-row" key={user.id || user.userId || user.email}><span><b>{user.name}</b><small>{roleLabel(user.role || user.roleKey)} · {user.email} · {user.role === "assistant_coordinator" ? `${user.companyIds?.length || 0} companies` : roleVisibility(user.role || user.roleKey)}</small></span><div className="staff-access-actions">{onCreateRecovery && (user.userId || user.id) ? <button className="secondary" onClick={() => onCreateRecovery(user.userId || user.id)}><Key/>Recovery</button> : null}{onManageLeaderAccess && user.id ? <button className="text-action" onClick={() => setLegacyTarget(user)}>Legacy settings</button> : null}</div></div>)}
      </div>
    </details> : null}

    <div className="staff-access-lifecycle-note"><ShieldCheck weight="fill"/><div><b>Full Session Administrators</b><p>Coordinators, Logistical Administrators and the Session Directing Couple can manage website access for the whole session. FSY organizational responsibility and software administration are shown separately, while all access changes remain auditable.</p></div></div>

    {inviteTarget ? <StaffAccessInvite staff={inviteTarget} onClose={() => setInviteTarget(null)} onInvited={() => refresh()} /> : null}
    {reviewRequest ? <RequestReview request={reviewRequest} companies={companies} teams={teams} onClose={() => setReviewRequest(null)} onDecision={onDecision}/> : null}
    {legacyTarget ? <LegacyAccountEditor user={legacyTarget} companies={companies} teams={teams} onClose={() => setLegacyTarget(null)} onSave={onManageLeaderAccess}/> : null}
  </section>;
}
