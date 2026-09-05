import { AccountSetup,AccountTeams } from "../components/AccountSetup.jsx";
import { useEffect, useMemo, useState } from "react";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { Key } from "@phosphor-icons/react/Key";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { demoAccessRequests, demoUsers } from "../data/demo.js";
import { canApproveAccess, roleLabel, roleVisibility } from "../lib/access.js";
import {
  accessStateLabel,
  loadSessionAccountActivity,
  loadStaffAccessDirectory,
  resolveCurrentAccessSessionId,
  setStaffWebsiteAccess,
  staffRoleLabel,
} from "../lib/staff-access.js";
import { subscribeSessionPresence } from "../lib/presence.js";
import { DismissibleLayer, Empty, MutationFeedback, PageHead, SearchField, Status } from "../components/UI.jsx";
import { AssistantCompanySheet } from "../components/AssistantCompanySheet.jsx";
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

function initials(name = "FSY") {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

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

function formatRelative(value) {
  if (!value) return "Never signed in";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return "Sign-in time unavailable";
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 1) return "Signed in just now";
  if (minutes < 60) return `Last signed in ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last signed in ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Last signed in ${days}d ago`;
  return `Last signed in ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value))}`;
}

function AccountActivity({ userId, accessState, onlineUserIds, activityByUser }) {
  if (!userId) return <span className="account-activity waiting">{accessState === "invited" ? "Waiting for setup" : "No account yet"}</span>;
  if (onlineUserIds.has(userId)) return <span className="account-activity online"><i/>Online now</span>;
  const lastSignInAt = activityByUser.get(userId)?.lastSignInAt;
  return <span className="account-activity" title={lastSignInAt ? new Date(lastSignInAt).toLocaleString() : undefined}>{formatRelative(lastSignInAt)}</span>;
}

function CompanyChips({ person }) {
  if (person.operationalRole !== "assistant_coordinator") return <span className="staff-access-whole-session">Whole session</span>;
  const names = person.companyNames || [];
  if (!names.length) return <span className="company-chip-empty"><WarningCircle/>No companies yet</span>;
  const visible = names.slice(0, 3);
  return <div className="staff-company-chips" aria-label={`${names.length} assigned companies`}>{visible.map((name) => <span key={name}>{name}</span>)}{names.length > visible.length ? <span className="more">+{names.length - visible.length}</span> : null}</div>;
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
    } catch (err) { setError(err.message || "This request could not be reviewed."); }
    finally { setBusy(""); }
  };
  return <DismissibleLayer open onClose={onClose} title="Review access request" sheet><div className="field-sheet">
    <button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} aria-label="Close"><X/></button>
    <span className="kicker">Legacy request</span><h2>{request.name}</h2><p>{request.email} · {roleLabel(request.role)}</p>
    {request.role === "assistant_coordinator" ? <div className="scope-editor"><b>Companies</b><small>Choose the companies this Assistant Coordinator is responsible for.</small><div className="company-picker">{companies.map((company) => <label key={company.id} className={companyIds.includes(company.id) ? "selected" : ""}><input type="checkbox" checked={companyIds.includes(company.id)} onChange={() => toggleCompany(company.id)}/><span>{company.name}</span></label>)}</div></div> : null}
    {request.role === "committee_viewer" ? <div className="scope-editor"><b>Team responsibility</b><div className="access-team-picker">{teams.map((team) => <label key={team.key} className={teamKeys.includes(team.key) ? "selected" : ""}><input type="checkbox" checked={teamKeys.includes(team.key)} onChange={() => toggleTeam(team.key)}/><span><b>{team.name}</b><small>{team.description}</small></span></label>)}</div></div> : null}
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
    <div className="field-sheet-actions"><button className="secondary" disabled={Boolean(busy)} onClick={() => decide("rejected")}>{busy === "rejected" ? "Rejecting…" : "Reject"}</button><button className="primary" disabled={Boolean(busy) || (request.role === "assistant_coordinator" && !companyIds.length) || (request.role === "committee_viewer" && !teamKeys.length)} onClick={() => decide("approved")}>{busy === "approved" ? "Approving…" : "Approve"}</button></div>
  </div></DismissibleLayer>;
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
  return <DismissibleLayer open onClose={onClose} title="Account settings" sheet><div className="field-sheet">
    <button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} aria-label="Close"><X/></button>
    <span className="kicker">Website account</span><h2>{user.name}</h2><p>{user.email}</p>
    <div className="notice compact-notice"><WarningCircle/><div><b>Independent website account</b><p>Website access and committee responsibilities do not require a Staff record.</p></div></div>
    <label>Access role<select value={role} onChange={(event) => { setRole(event.target.value); if (event.target.value !== "assistant_coordinator") setCompanyIds([]); }}><option value="assistant_coordinator">Assistant coordinator</option><option value="coordinator">Coordinator</option><option value="logistics_admin">Logistical administrator</option><option value="session_director">Session directing couple</option><option value="committee_viewer">Committee viewer</option></select></label>
    {role === "assistant_coordinator" ? <div className="company-picker">{companies.map((company) => <label key={company.id} className={companyIds.includes(company.id) ? "selected" : ""}><input type="checkbox" checked={companyIds.includes(company.id)} onChange={() => toggleCompany(company.id)}/><span>{company.name}</span></label>)}</div> : null}
    {<div className="access-team-picker">{teams.map((team) => <label key={team.key} className={teamKeys.includes(team.key) ? "selected" : ""}><input type="checkbox" checked={teamKeys.includes(team.key)} onChange={() => toggleTeam(team.key)}/><span><b>{team.name}</b><small>{team.description}</small></span></label>)}</div>}
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
    <div className="field-sheet-actions"><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy || (role === "assistant_coordinator" && !companyIds.length) || (role === "committee_viewer" && !teamKeys.length)} onClick={save}>{busy ? "Saving…" : "Save account"}</button></div>
  </div></DismissibleLayer>;
}

export function createInitialAccessRequests() { return demoAccessRequests; }

export function Access({
  requests = [], invites = [], currentRole = "logistics_admin", currentCapabilities = [], onDecision,
  onRefreshRoster, onCreateInvite, onRevokeInvite, onCreateRecovery, onManageLeaderAccess, roster = demoUsers, companies = [], teams = [],
  sessionId: requestedSessionId = "", live = false, sessionName, companyLimit = 4,
}) {
  const [newAccount,setNewAccount]=useState(false);
  const [teamTarget,setTeamTarget]=useState(null);
  const [recoveryResult,setRecoveryResult]=useState(null);
  const [sessionId, setSessionId] = useState(requestedSessionId);
  const [directory, setDirectory] = useState(live ? [] : demoDirectory());
  const [activityByUser, setActivityByUser] = useState(new Map());
  const [onlineUserIds, setOnlineUserIds] = useState(new Set());
  const [filter, setFilter] = useState("not_enabled");
  const [query, setQuery] = useState("");
  const [inviteTarget, setInviteTarget] = useState(null);
  const [companyTarget, setCompanyTarget] = useState(null);
  const [reviewRequest, setReviewRequest] = useState(null);
  const [legacyTarget, setLegacyTarget] = useState(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canManage = canApproveAccess(currentRole, currentCapabilities);

  const refresh = async (knownSessionId = sessionId) => {
    if (!live) return directory;
    const resolved = knownSessionId || await resolveCurrentAccessSessionId();
    if (!sessionId) setSessionId(resolved);
    const [nextDirectory, nextActivity] = await Promise.all([
      loadStaffAccessDirectory(resolved),
      loadSessionAccountActivity(resolved),
    ]);
    setDirectory(nextDirectory);
    setActivityByUser(nextActivity);
    return nextDirectory;
  };

  useEffect(() => {
    if (!live) return;
    (requestedSessionId ? Promise.resolve(requestedSessionId) : resolveCurrentAccessSessionId()).then((id) => { setSessionId(id); return refresh(id); }).catch((err) => setError(err.message || "Website access could not be loaded."));
  }, [live, requestedSessionId]);
  useEffect(() => live && sessionId ? subscribeSessionPresence(sessionId, setOnlineUserIds) : undefined, [live, sessionId]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([key]) => [key, directory.filter((item) => item.accessState === key).length])), [directory]);
  const missingCompanyCount = directory.filter((person) => person.operationalRole === "assistant_coordinator" && !person.companyIds?.length).length;
  const shown = useMemo(() => {
    const text = query.trim().toLowerCase();
    return directory.filter((item) => item.accessState === filter).filter((item) => {
      if (!text) return true;
      return `${item.name} ${item.email} ${item.accountEmail} ${staffRoleLabel(item.operationalRole)} ${(item.companyNames || []).join(" ")}`.toLowerCase().includes(text);
    });
  }, [directory, filter, query]);

  const linkedUsers = new Set(directory.map((item) => item.userId).filter(Boolean));
  const legacyRoster = (roster || []).filter((user) => user.active !== false && user.status !== "Pending" && !linkedUsers.has(user.userId || user.id));
  const legacyInvites = (invites || []).filter((invite) => !invite.staff_id && invite.status === "pending");
  const pendingLegacy = (requests || []).filter((request) => request.status === "pending");

  const openCompanies = (person, continueToAccess = false) => setCompanyTarget({ person, continueToAccess });
  const afterCompanySave = async (staffId) => {
    const rows = await refresh();
    return rows.find((item) => item.staffId === staffId) || null;
  };
  const continueAfterCompanies = (person) => { setCompanyTarget(null); setInviteTarget(person); };

  const toggleAccess = async (person, enabled) => {
    if (!live) { setDirectory((current) => current.map((item) => item.staffId === person.staffId ? { ...item, accessState: enabled ? "active" : "disabled", accessEnabled: enabled } : item)); return; }
    setBusyId(person.staffId); setError(""); setNotice("");
    try { await setStaffWebsiteAccess(person.staffId, enabled); await refresh(); setNotice(`${person.name}'s website access was ${enabled ? "enabled" : "disabled"}.`); }
    catch (err) { setError(err.message || "Website access could not be changed."); }
    finally { setBusyId(""); }
  };

  const recovery = async (person) => {
    if (!person.userId || !onCreateRecovery) return;
    setBusyId(person.staffId); setError(""); setNotice("");
    try {
      const created = await onCreateRecovery(person.userId);
      if (created?.code) { setRecoveryResult({...created,name:person.name}); }
      else setNotice(`Recovery access was prepared for ${person.name}.`);
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
    <PageHead title="Access" sessionName={sessionName} description="Manage website accounts and committee responsibilities. Linked staff assignments stay in sync." action={canManage ? <button className="primary" onClick={()=>setNewAccount(true)}><UserPlus/>Invite account</button> : null} />
    {!canManage ? <div className="notice"><WarningCircle/><div><b>View only</b><p>A Full Session Administrator is required to invite, enable or disable website access.</p></div></div> : null}
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
    {notice ? <MutationFeedback><b>Done</b> · {notice}</MutationFeedback> : null}

    {missingCompanyCount ? <div className="access-readiness-note"><Buildings/><div><b>{missingCompanyCount} Assistant Coordinator{missingCompanyCount === 1 ? " needs" : "s need"} companies</b><p>You can fix this here. Choose companies manually or let the system suggest a balanced set, then continue straight to website access.</p></div></div> : null}

    <div className="staff-access-summary" role="group" aria-label="Website access status">
      {FILTERS.map(([key, label]) => <button key={key} type="button" className={filter === key ? "active" : ""} onClick={() => setFilter(key)}><strong>{counts[key] || 0}</strong><span>{label}</span></button>)}
    </div>

    <article className="panel staff-access-main-panel">
      <div className="staff-access-intro"><div><span className="kicker">People & accounts</span><h2>{FILTERS.find(([key]) => key === filter)?.[1]}</h2><p>Start with the person. Their responsibility, companies, account state and recent sign-in activity stay together in one row.</p></div><Status tone={stateTone(filter)}>{shown.length} shown</Status></div>
      <div className="staff-access-toolbar"><SearchField value={query} onChange={setQuery} label="Search website access" placeholder="Search name, email, role or company"/></div>

      {shown.length ? <div className="staff-access-list">{shown.map((person) => {
        const needsCompanies = person.operationalRole === "assistant_coordinator" && !person.companyIds?.length;
        const rowBusy = busyId === person.staffId;
        return <div className={`staff-access-row ${needsCompanies ? "needs-scope" : ""}`} key={person.staffId}>
          <div className="staff-access-person">
            <span className="person-avatar" aria-hidden="true">{initials(person.name)}</span>
            <span><b>{person.name}</b><span className={`staff-access-state ${person.accessState}`}>{accessStateLabel(person.accessState)}</span><small>{person.accountEmail || person.email || "Email will be confirmed when access is given"}</small></span>
          </div>
          <div className="staff-access-responsibility"><small>{staffRoleLabel(person.operationalRole)}</small><CompanyChips person={person}/></div>
          <AccountActivity userId={person.userId} accessState={person.accessState} onlineUserIds={onlineUserIds} activityByUser={activityByUser}/>
          <div className="staff-access-actions">
            {needsCompanies ? <button className="primary" disabled={!canManage || rowBusy} onClick={() => openCompanies(person, person.accessState === "not_enabled")}><Buildings/>Set companies</button> : null}
            {!needsCompanies && person.operationalRole === "assistant_coordinator" ? <button className="secondary compact-button" disabled={!canManage || rowBusy} onClick={() => openCompanies(person, false)}><Buildings/>Companies</button> : null}
            {person.userId ? <button className="secondary compact-button" disabled={!canManage||rowBusy} onClick={()=>setTeamTarget(roster.find(u=>u.userId===person.userId)||{userId:person.userId,name:person.name,teamKeys:[]})}>Committees</button> : null}
            {person.accessState === "not_enabled" && !needsCompanies ? <button className="primary" disabled={!canManage || rowBusy} onClick={() => setInviteTarget(person)}><UserPlus/>Give access</button> : null}
            {person.accessState === "invited" ? <button className="primary" disabled={!canManage || rowBusy} onClick={() => setInviteTarget(person)}>Setup link</button> : null}
            {person.accessState === "disabled" ? <button className="primary" disabled={!canManage || rowBusy} onClick={() => toggleAccess(person, true)}>Enable access</button> : null}
            {(person.accessState === "active" || person.accessState === "invited") ? <details className="staff-access-more"><summary>More</summary><div>{person.accessState === "active" ? <><button disabled={!canManage || rowBusy} onClick={() => recovery(person)}><Key/>Recovery</button><button className="danger-text" disabled={!canManage || rowBusy} onClick={() => toggleAccess(person, false)}>Disable access</button></> : <button className="danger-text" disabled={!canManage || rowBusy} onClick={() => revokeStaffInvite(person)}>Revoke invite</button>}</div></details> : null}
          </div>
        </div>;
      })}</div> : <div className="staff-access-empty"><Empty title={`No ${FILTERS.find(([key]) => key === filter)?.[1]?.toLowerCase() || "matching"} accounts`} text={query ? "Try another search." : "There is nothing in this access state right now."}/></div>}
    </article>

    <details className="panel staff-access-help"><summary>How access works</summary><div className="staff-access-guide"><div><span>1 · Responsibility</span><b>Role and companies come first</b><p>Assistant Coordinators need at least one company so their account has a useful scope.</p></div><div><span>2 · Access</span><b>Create the setup link</b><p>Confirm the email, copy the link and send it to the leader.</p></div><div><span>3 · Sync</span><b>Future changes follow automatically</b><p>Changing an AC's companies updates their linked website permissions too.</p></div></div></details>

    {(pendingLegacy.length || legacyInvites.length || legacyRoster.length) ? <section className="panel legacy-access-details staff-access-account-list">
      <h2>Website accounts & committee members</h2><p>These accounts do not need a Staff record.</p>
      <div className="legacy-access-list">
        {pendingLegacy.map((request) => <div className="legacy-access-row" key={request.id}><span><b>{request.name}</b><small>Pending request · {roleLabel(request.role)} · {request.scope}</small></span><button className="secondary" disabled={!canManage} onClick={() => setReviewRequest(request)}>Review</button></div>)}
        {legacyInvites.map((invite) => <div className="legacy-access-row" key={invite.id}><span><b>{invite.display_name || invite.email}</b><small>Setup pending · {roleLabel(invite.role)}</small></span><button className="secondary" disabled={!canManage} onClick={() => onRevokeInvite?.(invite.id)}>Revoke</button></div>)}
        {legacyRoster.map((user) => { const userId = user.userId || user.user_id; return <div className="legacy-access-row" key={user.id || userId || user.email}><span><b>{user.name}</b><small>{roleLabel(user.role || user.roleKey)} · {user.email} · {user.role === "assistant_coordinator" ? `${user.companyIds?.length || 0} companies` : roleVisibility(user.role || user.roleKey)}</small><AccountActivity userId={userId} accessState="active" onlineUserIds={onlineUserIds} activityByUser={activityByUser}/></span><div className="staff-access-actions">{onCreateRecovery && userId ? <button className="secondary" onClick={() => recovery({userId,name:user.name,staffId:userId})}><Key/>Recovery</button> : null}{onManageLeaderAccess && user.id ? <button className="text-action" onClick={() => setLegacyTarget(user)}>Account settings</button> : null}</div></div>; })}
      </div>
    </section> : null}

    <div className="staff-access-lifecycle-note"><ShieldCheck weight="fill"/><div><b>Full Session Administrators</b><p>Coordinators, Logistical Administrators and the Session Directing Couple can manage website access for the whole session. Account activity is shown only here for administration and support.</p></div></div>

    {newAccount ? <AccountSetup teams={teams} companies={companies} onCreate={onCreateInvite} onClose={()=>setNewAccount(false)}/> : null}
    {teamTarget ? <AccountTeams user={teamTarget} sessionId={sessionId} teams={teams} onClose={()=>setTeamTarget(null)} onSaved={async()=>{await refresh();await onRefreshRoster?.();}}/> : null}
    {recoveryResult ? <DismissibleLayer open onClose={()=>setRecoveryResult(null)} title="Recovery code" sheet><div className="headcount-create"><h2>Recovery for {recoveryResult.name}</h2><label>One-time code<input readOnly value={recoveryResult.code}/></label><p>Expires {new Date(recoveryResult.expiresAt).toLocaleString()}. Share only with the account owner.</p><button className="secondary" onClick={()=>setRecoveryResult(null)}>Done</button></div></DismissibleLayer> : null}
    {inviteTarget ? <StaffAccessInvite staff={inviteTarget} onClose={() => setInviteTarget(null)} onInvited={() => refresh()} /> : null}
    {companyTarget ? <AssistantCompanySheet staff={companyTarget.person} companies={companies} directory={directory} companyLimit={companyLimit} continueToAccess={companyTarget.continueToAccess} onClose={() => setCompanyTarget(null)} onSaved={afterCompanySave} onContinue={continueAfterCompanies}/> : null}
    {reviewRequest ? <RequestReview request={reviewRequest} companies={companies} teams={teams} onClose={() => setReviewRequest(null)} onDecision={onDecision}/> : null}
    {legacyTarget ? <LegacyAccountEditor user={legacyTarget} companies={companies} teams={teams} onClose={() => setLegacyTarget(null)} onSave={onManageLeaderAccess}/> : null}
  </section>;
}
