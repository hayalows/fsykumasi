import { useEffect, useMemo, useState } from "react";
import { Key } from "@phosphor-icons/react/Key";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { AccountTeams } from "../components/AccountSetup.jsx";
import { LeaderSetupFlow } from "../components/LeaderSetupFlow.jsx";
import { LegacyAccessMigration } from "../components/LegacyAccessMigration.jsx";
import { ActionToast, ConfirmActionSheet, DismissibleLayer, Empty, MutationFeedback, PageHead, SearchField, Status } from "../components/UI.jsx";
import { canApproveAccess, roleLabel } from "../lib/access.js";
import { demoAccessRequests, demoUsers } from "../data/demo.js";
import {
  accessStateLabel,
  adoptLegacyAccessAccount,
  loadSessionAccountActivity,
  loadStaffAccessDirectory,
  resolveCurrentAccessSessionId,
  retireLegacyAccessAccount,
  setStaffWebsiteAccess,
  staffRoleLabel,
} from "../lib/staff-access.js";
import { subscribeSessionPresence } from "../lib/presence.js";
import "./staff-access.css";

const STAFF_LINKED_ROLES = new Set(["assistant_coordinator", "coordinator", "logistics_admin", "session_director"]);
const FILTERS = [["needs", "Needs action"], ["invited", "Invite sent"], ["online", "Online now"], ["active", "Active"], ["disabled", "Disabled"], ["all", "All"]];
const INVITE_STATES = new Set(["pending", "activating"]);

function initials(name = "FSY") { return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase(); }
function personKey(person) { return person.recordKey || person.staffId || person.userId || person.inviteId || person.email || person.name; }
function normalizeEmail(value = "") { return String(value).trim().toLowerCase(); }
function demoDirectory() { return demoUsers.filter((user) => STAFF_LINKED_ROLES.has(user.roleKey)).map((user, index) => ({ recordKey: `staff:demo-${index + 1}`, kind: "staff", staffId: `demo-staff-${index + 1}`, name: user.name, operationalRole: user.roleKey, email: user.email, companyIds: user.roleKey === "assistant_coordinator" ? ["demo-1", "demo-2"] : [], companyNames: user.roleKey === "assistant_coordinator" ? ["Company 01", "Company 02"] : [], userId: `demo-user-${index + 1}`, accountEmail: user.email, accessEnabled: user.status === "Active", accessState: user.status === "Active" ? "active" : "not_enabled" })); }
function displayRole(person) { return person.operationalRole === "committee_viewer" ? "Committee member" : staffRoleLabel(person.operationalRole); }
function isLegacy(person) { return ["legacy_account", "legacy_invite", "legacy_request"].includes(person.kind); }
function needsSetup(person) {
  if (isLegacy(person)) return true;
  return person.kind === "staff" && (person.accessState === "not_enabled" || (person.operationalRole === "assistant_coordinator" && !person.companyIds?.length));
}
function accessLabel(person) {
  if (person.kind === "legacy_account") return "Needs Staff link";
  if (person.kind === "legacy_invite") return "Older invite";
  if (person.kind === "legacy_request") return "Older request";
  if (person.operationalRole === "assistant_coordinator" && !person.companyIds?.length) return "Assignment incomplete";
  if (person.accessState === "not_enabled") return "Not invited";
  if (person.accessState === "invited") return "Invite sent";
  if (person.accessState === "disabled") return "Sign-in disabled";
  return accessStateLabel(person.accessState);
}
function accessTone(person) {
  if (isLegacy(person)) return "warn";
  if (person.accessState === "active") return "good";
  if (person.accessState === "invited" || (person.operationalRole === "assistant_coordinator" && !person.companyIds?.length)) return "warn";
  return "neutral";
}
function formatRelative(value, now = Date.now()) {
  if (!value) return "Never signed in";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Sign-in time unavailable";
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  if (minutes < 1) return "Signed in just now";
  if (minutes < 60) return `Last signed in ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last signed in ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `Last signed in ${days}d ago` : `Last signed in ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value))}`;
}
function formatInviteTiming(value, now = Date.now()) {
  if (!value) return "Waiting for account setup";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Waiting for account setup";
  const diff = time - now;
  if (diff <= 0) return "Setup link expired";
  const hours = Math.ceil(diff / 3600000);
  if (hours < 24) return `Expires in ${hours}h`;
  const days = Math.ceil(hours / 24);
  return `Expires in ${days}d`;
}
function AccountActivity({ person, onlineUserIds, activityByUser, now }) {
  if (person.accessState === "invited") return <span className="account-activity waiting">{formatInviteTiming(person.inviteExpiresAt, now)}</span>;
  if (person.kind === "legacy_request") return <span className="account-activity waiting">No account created yet</span>;
  if (!person.userId) return <span className="account-activity waiting">No account yet</span>;
  if (onlineUserIds.has(person.userId)) return <span className="account-activity online"><i />Online now</span>;
  return <span className="account-activity">{formatRelative(activityByUser.get(person.userId)?.lastSignInAt, now)}</span>;
}
function Scope({ person }) {
  if (person.operationalRole === "committee_viewer") {
    const names = person.committeeNames || [];
    return names.length ? <span className="access-v15-team-chips">{names.map((name) => <i key={name}>{name}</i>)}</span> : <span className="company-chip-empty"><WarningCircle />Choose committee</span>;
  }
  if (person.operationalRole !== "assistant_coordinator") return <span className="staff-access-whole-session">Whole session</span>;
  if (person.companyNames?.length) return <span className="access-v3-scope">{person.companyNames.join(" · ")}</span>;
  if (isLegacy(person) && person.companyIds?.length) return <span className="access-v3-scope">{person.companyIds.length} company{person.companyIds.length === 1 ? "" : "ies"}</span>;
  return <span className="company-chip-empty"><WarningCircle />Choose companies</span>;
}
function scopeHeading(person) { return person.operationalRole === "committee_viewer" ? "Committee" : "Assignment"; }
function filterMatches(person, filter, onlineUserIds) {
  if (filter === "all") return true;
  if (filter === "needs") return needsSetup(person);
  if (filter === "online") return Boolean(person.userId && onlineUserIds.has(person.userId));
  return person.accessState === filter;
}
function sortPeople(a, b, onlineUserIds) {
  const priority = (person) => needsSetup(person) ? 0 : person.userId && onlineUserIds.has(person.userId) ? 1 : person.accessState === "invited" ? 2 : 3;
  return priority(a) - priority(b) || a.name.localeCompare(b.name);
}

function RequestReview({ request, onClose, onDecision, onMoveToNew }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const decide = async (status) => {
    setBusy(status); setError("");
    try { await onDecision?.(request.id, status, { companyIds: request.companyIds || [], committeeScope: request.committeeScope || [] }); onClose(); }
    catch (err) { setError(err.message || "This request could not be reviewed."); }
    finally { setBusy(""); }
  };
  return <DismissibleLayer open onClose={() => !busy && onClose()} title="Review older access request" sheet><div className="field-sheet access-v3-review"><button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} disabled={Boolean(busy)} aria-label="Close"><X /></button><span className="kicker">Older request</span><h2>{request.name}</h2><p>{request.email} · {roleLabel(request.role)}</p><div className="notice compact-notice"><WarningCircle /><div><b>Use the staff-linked setup for new access</b><p>Moving this request to the new setup keeps future role and company changes synchronized with Staff.</p></div></div>{error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}<div className="field-sheet-actions"><button className="secondary" disabled={Boolean(busy)} onClick={() => decide("rejected")}>{busy === "rejected" ? "Rejecting…" : "Reject request"}</button><button className="primary" disabled={Boolean(busy)} onClick={onMoveToNew}>Move to new setup</button></div></div></DismissibleLayer>;
}

export function createInitialAccessRequests() { return demoAccessRequests; }

export function Access({ initialFilter = "", requests = [], invites = [], currentRole = "logistics_admin", currentCapabilities = [], onDecision, onRefreshRoster, onCreateInvite, onRevokeInvite, onCreateRecovery, roster = demoUsers, teams = [], sessionId: requestedSessionId = "", live = false, sessionName }) {
  const [sessionId, setSessionId] = useState(requestedSessionId);
  const [directory, setDirectory] = useState(live ? [] : demoDirectory());
  const [activityByUser, setActivityByUser] = useState(new Map());
  const [onlineUserIds, setOnlineUserIds] = useState(new Set());
  const [now, setNow] = useState(Date.now());
  const [filter, setFilter] = useState(FILTERS.some(([key]) => key === initialFilter) ? initialFilter : "needs");
  const [query, setQuery] = useState("");
  const [setupTarget, setSetupTarget] = useState(null);
  const [teamTarget, setTeamTarget] = useState(null);
  const [migrationTarget, setMigrationTarget] = useState(null);
  const [reviewRequest, setReviewRequest] = useState(null);
  const [recoveryResult, setRecoveryResult] = useState(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [confirmDisable, setConfirmDisable] = useState(null);
  const [confirmRevoke, setConfirmRevoke] = useState(null);
  const [confirmRetire, setConfirmRetire] = useState(null);
  const [undo, setUndo] = useState(null);
  const [toast, setToast] = useState(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const canManage = canApproveAccess(currentRole, currentCapabilities);
  const canAddLeader = canManage && currentCapabilities.includes("staff_manage");
  const canInviteCommittee = canManage && Boolean(onCreateInvite || !live);
  const canInviteAnyone = canAddLeader || canInviteCommittee;

  const teamNameByKey = useMemo(() => new Map((teams || []).map((team) => [team.key, team.name])), [teams]);

  const refresh = async (knownSessionId = sessionId) => {
    if (!live) return directory;
    const resolved = knownSessionId || await resolveCurrentAccessSessionId();
    if (!sessionId) setSessionId(resolved);
    const [nextDirectory, nextActivity] = await Promise.all([loadStaffAccessDirectory(resolved), loadSessionAccountActivity(resolved)]);
    const staffRows = nextDirectory.filter((person) => STAFF_LINKED_ROLES.has(person.operationalRole)).map((person) => ({ ...person, kind: "staff", recordKey: `staff:${person.staffId}` }));
    setDirectory(staffRows);
    setActivityByUser(nextActivity);
    return staffRows;
  };

  useEffect(() => { if (!live) return; (requestedSessionId ? Promise.resolve(requestedSessionId) : resolveCurrentAccessSessionId()).then((id) => { setSessionId(id); return refresh(id); }).catch((err) => setError(err.message || "Website access could not be loaded.")); }, [live, requestedSessionId]);
  useEffect(() => live && sessionId ? subscribeSessionPresence(sessionId, setOnlineUserIds) : undefined, [live, sessionId]);
  useEffect(() => { if (FILTERS.some(([key]) => key === initialFilter)) setFilter(initialFilter); }, [initialFilter]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (!live || !sessionId) return undefined;
    const timer = window.setInterval(() => { loadSessionAccountActivity(sessionId).then(setActivityByUser).catch(() => {}); }, 60000);
    return () => window.clearInterval(timer);
  }, [live, sessionId]);

  useEffect(() => {
    const closeOutside = (event) => document.querySelectorAll(".access-v16 .staff-access-more[open]").forEach((menu) => { if (!menu.contains(event.target)) menu.removeAttribute("open"); });
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  useEffect(() => { document.querySelectorAll(".access-v16 .staff-access-more[open]").forEach((menu) => menu.removeAttribute("open")); }, [filter, query, setupTarget, teamTarget, migrationTarget, confirmDisable, confirmRevoke, confirmRetire]);

  const committeeActive = useMemo(() => (roster || []).filter((user) => (user.role || user.roleKey) === "committee_viewer" && user.active !== false).map((user) => {
    const keys = user.teamKeys || user.committeeScope || [];
    const names = user.teamNames?.length ? user.teamNames : keys.map((key) => teamNameByKey.get(key) || key).filter(Boolean);
    return { recordKey: `committee:${user.userId || user.id || user.email}`, kind: "committee", name: user.name || user.displayName || user.email || "Committee member", email: user.email || "", accountEmail: user.email || "", operationalRole: "committee_viewer", committeeKeys: keys, committeeNames: names, userId: user.userId || user.user_id || null, accessState: "active" };
  }), [roster, teamNameByKey]);

  const committeePending = useMemo(() => (invites || []).filter((invite) => !invite.staff_id && invite.role === "committee_viewer" && INVITE_STATES.has(invite.status)).map((invite) => {
    const keys = invite.committee_scope || invite.committeeScope || [];
    return { recordKey: `invite:${invite.id}`, kind: "committee_invite", name: invite.display_name || invite.email || "Committee member", email: invite.email || "", operationalRole: "committee_viewer", committeeKeys: keys, committeeNames: keys.map((key) => teamNameByKey.get(key) || key).filter(Boolean), userId: null, accessState: "invited", inviteId: invite.id, inviteExpiresAt: invite.expires_at || invite.expiresAt || null };
  }), [invites, teamNameByKey]);

  const linkedUsers = useMemo(() => new Set(directory.map((item) => item.userId).filter(Boolean)), [directory]);
  const legacyAccounts = useMemo(() => (roster || []).filter((user) => (user.role || user.roleKey) !== "committee_viewer" && user.active !== false && !linkedUsers.has(user.userId || user.user_id || user.id)).map((user) => ({
    recordKey: `legacy:${user.userId || user.user_id || user.id}`,
    kind: "legacy_account",
    legacyAssignmentId: user.id,
    name: user.name || user.displayName || user.email || "Older account",
    email: user.email || "",
    accountEmail: user.email || "",
    operationalRole: user.role || user.roleKey,
    companyIds: user.companyIds || user.company_ids || [],
    committeeKeys: user.teamKeys || user.committeeScope || [],
    userId: user.userId || user.user_id || null,
    accessState: "active",
  })), [roster, linkedUsers]);

  const legacyInvites = useMemo(() => (invites || []).filter((invite) => !invite.staff_id && invite.role !== "committee_viewer" && INVITE_STATES.has(invite.status)).map((invite) => ({
    recordKey: `legacy-invite:${invite.id}`,
    kind: "legacy_invite",
    name: invite.display_name || invite.email || "Older invite",
    email: invite.email || "",
    operationalRole: invite.role,
    companyIds: invite.company_ids || invite.companyIds || [],
    userId: null,
    accessState: "invited",
    inviteId: invite.id,
    inviteExpiresAt: invite.expires_at || invite.expiresAt || null,
  })), [invites]);

  const legacyRequests = useMemo(() => (requests || []).filter((request) => request.status === "pending").map((request) => ({
    recordKey: `legacy-request:${request.id}`,
    kind: "legacy_request",
    requestId: request.id,
    request,
    name: request.name || request.email || "Older request",
    email: request.email || "",
    operationalRole: request.role,
    companyIds: request.companyIds || [],
    userId: null,
    accessState: "request",
  })), [requests]);

  const allPeople = useMemo(() => [...directory, ...committeeActive, ...committeePending, ...legacyAccounts, ...legacyInvites, ...legacyRequests], [directory, committeeActive, committeePending, legacyAccounts, legacyInvites, legacyRequests]);
  const counts = useMemo(() => ({
    needs: allPeople.filter(needsSetup).length,
    invited: allPeople.filter((item) => item.accessState === "invited").length,
    online: allPeople.filter((item) => item.userId && onlineUserIds.has(item.userId)).length,
    active: allPeople.filter((item) => item.accessState === "active").length,
    disabled: allPeople.filter((item) => item.accessState === "disabled").length,
    all: allPeople.length,
  }), [allPeople, onlineUserIds]);
  const shown = useMemo(() => {
    const text = query.trim().toLowerCase();
    return allPeople.filter((item) => filterMatches(item, filter, onlineUserIds) && (!text || `${item.name} ${item.email} ${item.accountEmail || ""} ${displayRole(item)} ${(item.companyNames || []).join(" ")} ${(item.committeeNames || []).join(" ")}`.toLowerCase().includes(text))).sort((a, b) => sortPeople(a, b, onlineUserIds));
  }, [allPeople, filter, query, onlineUserIds]);
  const migrationCandidates = useMemo(() => directory.filter((item) => item.staffId && !item.userId), [directory]);
  const knownAccounts = useMemo(() => [...(roster || []), ...directory.filter((item) => item.userId).map((item) => ({ email: item.accountEmail || item.email, accountEmail: item.accountEmail || item.email }))], [roster, directory]);

  const toggleAccess = async (person, enabled, { offerUndo = true } = {}) => {
    if (!person.staffId) return false;
    const key = personKey(person);
    if (!live) { setDirectory((current) => current.map((item) => item.staffId === person.staffId ? { ...item, accessState: enabled ? "active" : "disabled", accessEnabled: enabled } : item)); if (offerUndo) setUndo({ person, enabled: !enabled, message: `Sign-in ${enabled ? "enabled" : "disabled"} for ${person.name}` }); return true; }
    setBusyId(key); setError(""); setToast(null);
    try { await setStaffWebsiteAccess(person.staffId, enabled); await refresh(); if (offerUndo) setUndo({ person, enabled: !enabled, message: `Sign-in ${enabled ? "enabled" : "disabled"} for ${person.name}` }); return true; }
    catch (err) { setError(err.message || "Website access could not be changed."); return false; }
    finally { setBusyId(""); }
  };
  const undoAccess = async () => { if (!undo?.person) return; setUndoBusy(true); try { await toggleAccess(undo.person, undo.enabled, { offerUndo: false }); setUndo(null); } finally { setUndoBusy(false); } };
  const recovery = async (person) => { if (!person.userId || !onCreateRecovery) return; const key = personKey(person); setBusyId(key); setError(""); try { const created = await onCreateRecovery(person.userId); if (created?.code) setRecoveryResult({ ...created, name: person.name }); else setToast({ message: `Recovery prepared for ${person.name}` }); } catch (err) { setError(err.message || "Recovery access could not be prepared."); } finally { setBusyId(""); } };
  const revoke = async (person) => { if (!person.inviteId || !onRevokeInvite) return; const key = personKey(person); setBusyId(key); setError(""); try { await onRevokeInvite(person.inviteId); if (person.kind === "staff") await refresh(); await onRefreshRoster?.(); setUndo(null); setToast({ message: `Invite cancelled for ${person.name}` }); } catch (err) { setError(err.message || "Invite could not be cancelled."); } finally { setBusyId(""); setConfirmRevoke(null); } };
  const migrateLegacy = async (person, staffId) => {
    const key = personKey(person); setBusyId(key); setError("");
    try {
      const result = await adoptLegacyAccessAccount({ sessionId, userId: person.userId, staffId });
      await refresh(); await onRefreshRoster?.();
      setToast({ message: `${result.name || person.name} now uses staff-linked access` });
    } catch (err) { setError(err.message || "Older access could not be moved to Staff."); throw err; }
    finally { setBusyId(""); }
  };
  const retireLegacy = async (person) => {
    const key = personKey(person); setBusyId(key); setError("");
    try { await retireLegacyAccessAccount({ sessionId, userId: person.userId }); await onRefreshRoster?.(); await refresh(); setToast({ message: `Older access retired for ${person.name}` }); setConfirmRetire(null); }
    catch (err) { setError(err.message || "Older access could not be retired."); }
    finally { setBusyId(""); }
  };
  const startInvite = () => { setError(""); setToast(null); setSetupTarget({ newPerson: true }); };
  const moveLegacyInvite = (person) => setSetupTarget({ name: person.name, operationalRole: person.operationalRole, email: person.email, companyIds: person.companyIds || [], legacyInviteId: person.inviteId, fromLegacy: true });
  const moveLegacyRequest = (request) => { setReviewRequest(null); setSetupTarget({ name: request.name, operationalRole: request.role, email: request.email, companyIds: request.companyIds || [], legacyRequestId: request.id, fromLegacy: true }); };

  return <section className="page access-v4 access-v15 access-v16">
    <PageHead title="Access" sessionName={sessionName} description="Invite people, see what they can access, and know who is online or when they last signed in." action={canInviteAnyone ? <button className="primary" onClick={startInvite}><UserPlus />Invite someone</button> : null} />
    {!canManage ? <div className="notice"><WarningCircle /><div><b>View only</b><p>A whole-session administrator is required to change website access.</p></div></div> : null}
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}

    <div className="access-v4-summary access-v16-summary" aria-label="Access summary">
      <button type="button" className={filter === "needs" ? "active" : ""} onClick={() => setFilter("needs")}><b>{counts.needs}</b><span>Needs action</span></button>
      <button type="button" className={filter === "invited" ? "active" : ""} onClick={() => setFilter("invited")}><b>{counts.invited}</b><span>Invite sent</span></button>
      <button type="button" className={filter === "online" ? "active" : ""} onClick={() => setFilter("online")}><b>{counts.online}</b><span>Online now</span></button>
      <button type="button" className={filter === "active" ? "active" : ""} onClick={() => setFilter("active")}><b>{counts.active}</b><span>Active access</span></button>
    </div>
    <p className="access-v16-activity-note"><span className="account-activity online"><i />Online now</span> means the FSY app is currently open for that account. Otherwise, Access shows the most recent sign-in time available from the account system.</p>

    <div className="access-v4-tools"><SearchField value={query} onChange={setQuery} label="Search access" placeholder="Name, email, role, company or committee" /><div className="access-v4-filters" role="group" aria-label="Filter access">{FILTERS.map(([key, label]) => <button type="button" key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{label}{counts[key] ? <b>{counts[key]}</b> : null}</button>)}</div></div>

    <article className="panel access-v4-directory">
      <header className="access-v4-directory-head"><div><span className="kicker">People</span><h2>{FILTERS.find(([key]) => key === filter)?.[1]}</h2></div><p>{shown.length} {shown.length === 1 ? "person" : "people"}</p></header>
      {shown.length ? <div className="access-v4-list">{shown.map((person) => {
        const incomplete = person.operationalRole === "assistant_coordinator" && !person.companyIds?.length;
        const key = personKey(person);
        const rowBusy = busyId === key;
        const rosterUser = roster.find((user) => (user.userId || user.user_id || user.id) === person.userId);
        return <div className={`access-v4-row ${incomplete ? "needs-setup" : ""} ${person.operationalRole === "committee_viewer" ? "is-committee" : ""} ${isLegacy(person) ? "is-legacy" : ""}`} key={key}>
          <div className="access-v4-person"><span className="person-avatar">{initials(person.name)}</span><span><b>{person.name}</b><small>{displayRole(person)}{isLegacy(person) ? " · older access" : ""}</small></span></div>
          <div className="access-v4-scope"><small>{scopeHeading(person)}</small><Scope person={person} /></div>
          <div className="access-v4-state"><Status tone={accessTone(person)}>{accessLabel(person)}</Status><AccountActivity person={person} onlineUserIds={onlineUserIds} activityByUser={activityByUser} now={now} /></div>
          <div className="access-v4-actions">
            {person.kind === "staff" && (incomplete || person.accessState === "not_enabled" || person.accessState === "invited") ? <button className={person.accessState === "not_enabled" && !incomplete ? "primary" : "secondary"} disabled={!canManage || rowBusy} onClick={() => setSetupTarget(person)}>{incomplete ? "Finish assignment" : person.accessState === "invited" ? "New setup link" : "Invite"}</button> : null}
            {person.kind === "staff" && person.accessState === "disabled" ? <button className="primary" disabled={!canManage || rowBusy} onClick={() => toggleAccess(person, true)}>Enable</button> : null}
            {person.kind === "legacy_account" ? <button className="primary" disabled={!canManage || rowBusy} onClick={() => setMigrationTarget(person)}>Move to new system</button> : null}
            {person.kind === "legacy_invite" ? <button className="primary" disabled={!canManage || rowBusy || !canAddLeader} onClick={() => moveLegacyInvite(person)}>Move to new setup</button> : null}
            {person.kind === "legacy_request" ? <button className="primary" disabled={!canManage || rowBusy || !canAddLeader} onClick={() => moveLegacyRequest(person.request)}>Move to new setup</button> : null}

            {person.accessState === "active" ? <details className="staff-access-more"><summary>More</summary><div>
              {person.kind === "legacy_account" ? <button disabled={!canManage || rowBusy} onClick={() => setMigrationTarget(person)}>Connect to Staff</button> : null}
              {person.userId && person.kind !== "legacy_account" ? <button disabled={!canManage || rowBusy} onClick={() => setTeamTarget(rosterUser || { userId: person.userId, name: person.name, teamKeys: person.committeeKeys || [] })}>{person.operationalRole === "committee_viewer" ? "Edit committees" : "Committee tools"}</button> : null}
              {onCreateRecovery && person.userId ? <button disabled={!canManage || rowBusy} onClick={() => recovery(person)}><Key />Recovery</button> : null}
              {person.kind === "staff" ? <button className="danger-text" disabled={!canManage || rowBusy} onClick={() => setConfirmDisable(person)}>Disable sign-in</button> : null}
              {person.kind === "legacy_account" ? <button className="danger-text" disabled={!canManage || rowBusy} onClick={() => setConfirmRetire(person)}>Retire old access</button> : null}
            </div></details> : person.accessState === "invited" ? <details className="staff-access-more"><summary>More</summary><div><button className="danger-text" disabled={!canManage || rowBusy} onClick={() => setConfirmRevoke(person)}>Cancel invite</button></div></details> : person.kind === "legacy_request" ? <details className="staff-access-more"><summary>More</summary><div><button disabled={!canManage || rowBusy} onClick={() => setReviewRequest(person.request)}>Review old request</button></div></details> : null}
          </div>
        </div>;
      })}</div> : <Empty title={query ? "No person found" : filter === "needs" ? "No access work waiting" : filter === "online" ? "No one is online right now" : "Nothing in this view"} text={query ? "Try another name, email, role, company or committee." : filter === "needs" ? "Staff-linked access is ready and there are no older accounts waiting to be reconciled." : filter === "online" ? "Online status updates automatically while people use FSY Ops." : "Choose another access state."} action={!query && filter === "needs" && canInviteAnyone ? <button type="button" className="primary" onClick={startInvite}><UserPlus />Invite someone</button> : null} />}
    </article>

    {setupTarget ? <LeaderSetupFlow sessionId={sessionId} person={setupTarget.newPerson ? null : setupTarget} allowStaffRoles={canAddLeader} allowCommittee={canInviteCommittee && !setupTarget.fromLegacy} requireEmail teams={teams} knownAccounts={knownAccounts} pendingInvites={invites} onCreateCommitteeInvite={onCreateInvite} onClose={() => setSetupTarget(null)} onComplete={async (person) => { if (setupTarget.legacyRequestId && onDecision) await onDecision(setupTarget.legacyRequestId, "rejected", { companyIds: setupTarget.companyIds || [], committeeScope: [] }); if (person.operationalRole !== "committee_viewer") await refresh(); await onRefreshRoster?.(); if (setupTarget.fromLegacy) setToast({ message: `${person.name} moved to staff-linked access` }); }} /> : null}
    {migrationTarget ? <LegacyAccessMigration person={migrationTarget} candidates={migrationCandidates} onClose={() => setMigrationTarget(null)} onMigrate={({ staffId }) => migrateLegacy(migrationTarget, staffId)} /> : null}
    {teamTarget ? <AccountTeams user={teamTarget} sessionId={sessionId} teams={teams} onClose={() => setTeamTarget(null)} onSaved={async () => { await refresh(); await onRefreshRoster?.(); setToast({ message: `Committee access updated for ${teamTarget.name}` }); }} /> : null}
    {reviewRequest ? <RequestReview request={reviewRequest} onClose={() => setReviewRequest(null)} onDecision={onDecision} onMoveToNew={() => moveLegacyRequest(reviewRequest)} /> : null}
    {recoveryResult ? <DismissibleLayer open onClose={() => setRecoveryResult(null)} title="Recovery code" sheet><div className="headcount-create"><h2>Recovery for {recoveryResult.name}</h2><label>One-time code<input readOnly value={recoveryResult.code} /></label><p>Expires {new Date(recoveryResult.expiresAt).toLocaleString()}. Share only with the account owner.</p><button className="secondary" onClick={() => setRecoveryResult(null)}>Done</button></div></DismissibleLayer> : null}
    {confirmDisable ? <ConfirmActionSheet open title={`Disable ${confirmDisable.name}'s sign-in?`} description="Their FSY assignment stays unchanged." impact="They will not be able to use FSY Ops until website access is enabled again." confirmLabel="Disable sign-in" cancelLabel="Keep enabled" busy={busyId === personKey(confirmDisable)} onClose={() => setConfirmDisable(null)} onConfirm={async () => { if (await toggleAccess(confirmDisable, false)) setConfirmDisable(null); }} /> : null}
    {confirmRevoke ? <ConfirmActionSheet open title={`Cancel ${confirmRevoke.name}'s invite?`} description="The current setup link will stop working." impact={confirmRevoke.kind === "staff" ? "Their FSY assignment stays unchanged. You can invite them again from this row." : "No account will be created from this link. You can move them into the staff-linked setup later."} confirmLabel="Cancel invite" cancelLabel="Keep invite" busy={busyId === personKey(confirmRevoke)} onClose={() => setConfirmRevoke(null)} onConfirm={() => revoke(confirmRevoke)} /> : null}
    {confirmRetire ? <ConfirmActionSheet open title={`Retire ${confirmRetire.name}'s older access?`} description="Use this only when the old account should no longer be used." impact="The old website access and committee memberships for this session will be disabled. A staff-linked account is not affected." confirmLabel="Retire old access" cancelLabel="Keep access" busy={busyId === personKey(confirmRetire)} onClose={() => setConfirmRetire(null)} onConfirm={() => retireLegacy(confirmRetire)} /> : null}
    <ActionToast message={undo?.message || toast?.message} onAction={undo ? undoAccess : null} onDismiss={() => { setUndo(null); setToast(null); }} busy={undoBusy} />
  </section>;
}
