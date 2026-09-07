import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Key } from "@phosphor-icons/react/Key";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { AccountTeams } from "../components/AccountSetup.jsx";
import { LeaderSetupFlow } from "../components/LeaderSetupFlow.jsx";
import { ActionToast, ConfirmActionSheet, DismissibleLayer, Empty, MutationFeedback, PageHead, SearchField, Status } from "../components/UI.jsx";
import { canApproveAccess, roleLabel } from "../lib/access.js";
import { demoAccessRequests, demoUsers } from "../data/demo.js";
import { accessStateLabel, loadSessionAccountActivity, loadStaffAccessDirectory, resolveCurrentAccessSessionId, setStaffWebsiteAccess, staffRoleLabel } from "../lib/staff-access.js";
import { subscribeSessionPresence } from "../lib/presence.js";
import "./staff-access.css";

const STAFF_LINKED_ROLES = new Set(["assistant_coordinator", "coordinator", "logistics_admin", "session_director"]);
const FILTERS = [["needs", "Needs action"], ["online", "Online now"], ["invited", "Invite sent"], ["active", "Active"], ["disabled", "Disabled"], ["all", "All"]];
const INVITE_STATES = new Set(["pending", "activating"]);

function initials(name = "FSY") { return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase(); }
function normalizeEmail(value = "") { return String(value || "").trim().toLowerCase(); }
function needsSetup(person) { return person.accessState === "legacy" || person.accessState === "review" || (person.kind === "staff" && (person.accessState === "not_enabled" || (person.operationalRole === "assistant_coordinator" && !person.companyIds?.length))); }
function personKey(person) { return person.recordKey || person.staffId || person.userId || person.inviteId || person.email || person.name; }
function demoDirectory() { return demoUsers.filter((user) => STAFF_LINKED_ROLES.has(user.roleKey)).map((user, index) => ({ recordKey: `staff:demo-${index + 1}`, kind: "staff", staffId: `demo-staff-${index + 1}`, name: user.name, operationalRole: user.roleKey, email: user.email, companyIds: user.roleKey === "assistant_coordinator" ? ["demo-1", "demo-2"] : [], companyNames: user.roleKey === "assistant_coordinator" ? ["Company 01", "Company 02"] : [], userId: `demo-user-${index + 1}`, accountEmail: user.email, accessEnabled: user.status === "Active", accessState: user.status === "Active" ? "active" : "not_enabled" })); }
function displayRole(person) { return person.operationalRole === "committee_viewer" ? "Committee member" : staffRoleLabel(person.operationalRole); }
function accessLabel(person) { if (person.operationalRole === "assistant_coordinator" && !person.companyIds?.length && person.accessState !== "legacy") return "Assignment incomplete"; if (person.accessState === "legacy") return "Needs linking"; if (person.accessState === "review") return "Needs review"; if (person.accessState === "not_enabled") return "Not invited"; if (person.accessState === "invited") return "Invite sent"; if (person.accessState === "disabled") return "Sign-in disabled"; return accessStateLabel(person.accessState); }
function accessTone(person) { if (person.accessState === "active") return "good"; if (["invited", "legacy", "review"].includes(person.accessState) || (person.operationalRole === "assistant_coordinator" && !person.companyIds?.length)) return "warn"; return "neutral"; }
function formatRelative(value) { if (!value) return "Never signed in"; const ms = Date.now() - new Date(value).getTime(); if (!Number.isFinite(ms)) return "Sign-in time unavailable"; const minutes = Math.max(0, Math.floor(ms / 60000)); if (minutes < 1) return "Last signed in just now"; if (minutes < 60) return `Last signed in ${minutes}m ago`; const hours = Math.floor(minutes / 60); if (hours < 24) return `Last signed in ${hours}h ago`; const days = Math.floor(hours / 24); return days < 7 ? `Last signed in ${days}d ago` : `Last signed in ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value))}`; }
function formatInviteTiming(value) { if (!value) return "Waiting for account setup"; const time = new Date(value).getTime(); if (!Number.isFinite(time)) return "Waiting for account setup"; const diff = time - Date.now(); if (diff <= 0) return "Setup link expired"; const hours = Math.ceil(diff / 3600000); if (hours < 24) return `Expires in ${hours}h`; const days = Math.ceil(hours / 24); return `Expires in ${days}d`; }
function AccountActivity({ person, onlineUserIds, activityByUser }) { if (person.accessState === "review") return <span className="account-activity waiting">Review before granting access</span>; if (person.accessState === "invited") return <span className="account-activity waiting">{person.legacyInvite ? "Older invite · " : ""}{formatInviteTiming(person.inviteExpiresAt)}</span>; if (!person.userId) return <span className="account-activity waiting">No account yet</span>; if (onlineUserIds.has(person.userId)) return <span className="account-activity online" role="status"><i />Online now</span>; return <span className="account-activity">{formatRelative(activityByUser.get(person.userId)?.lastSignInAt)}</span>; }
function Scope({ person }) { if (person.operationalRole === "committee_viewer") { const names = person.committeeNames || []; return names.length ? <span className="access-v15-team-chips">{names.map((name) => <i key={name}>{name}</i>)}</span> : <span className="company-chip-empty"><WarningCircle />Choose committee</span>; } if (person.operationalRole !== "assistant_coordinator") return <span className="staff-access-whole-session">Whole session</span>; if (person.companyNames?.length) return <span className="access-v3-scope">{person.companyNames.join(" · ")}</span>; if (person.companyIds?.length) return <span className="access-v3-scope">{person.companyIds.length} assigned {person.companyIds.length === 1 ? "company" : "companies"}</span>; return <span className="company-chip-empty"><WarningCircle />Choose companies</span>; }
function scopeHeading(person) { return person.operationalRole === "committee_viewer" ? "Committee" : "Assignment"; }

function AccessActionMenu({ actions = [], disabled = false }) {
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const update = () => {
      const isCompact = Boolean(window.matchMedia?.("(max-width: 640px)")?.matches);
      setCompact(isCompact);
      if (isCompact || !triggerRef.current) return;
      const trigger = triggerRef.current.getBoundingClientRect();
      const menuWidth = Math.max(200, menuRef.current?.offsetWidth || 214);
      const menuHeight = Math.max(44, menuRef.current?.offsetHeight || 150);
      const margin = 12;
      let left = trigger.right - menuWidth;
      left = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin));
      let top = trigger.bottom + 7;
      if (top + menuHeight > window.innerHeight - margin) top = Math.max(margin, trigger.top - menuHeight - 7);
      setPosition({ top, left });
    };
    const closeOutside = (event) => {
      if (menuRef.current?.contains(event.target) || triggerRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };
    update();
    const frame = window.requestAnimationFrame(() => { update(); menuRef.current?.querySelector("button:not([disabled])")?.focus(); });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!actions.length) return null;
  const menu = open && typeof document !== "undefined" ? createPortal(<>
    {compact ? <button type="button" className="access-action-menu-scrim" tabIndex={-1} aria-label="Close actions" onClick={() => setOpen(false)} /> : null}
    <div ref={menuRef} className={`access-action-menu ${compact ? "compact" : ""}`} style={compact ? undefined : position} role="menu" aria-label="Person actions">
      {actions.map((action) => {
        const Icon = action.icon;
        return <button type="button" role="menuitem" key={action.label} className={action.danger ? "danger-text" : ""} disabled={disabled || action.disabled} onClick={() => { setOpen(false); action.onClick?.(); }}>{Icon ? <Icon /> : null}<span>{action.label}</span></button>;
      })}
    </div>
  </>, document.body) : null;

  return <>
    <button ref={triggerRef} type="button" className="staff-access-more-trigger" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>More</button>
    {menu}
  </>;
}

function RequestReview({ request, onClose, onDecision }) {
  const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  const decide = async (status) => { setBusy(status); setError(""); try { await onDecision?.(request.id, status, { companyIds: request.companyIds || [], committeeScope: request.committeeScope || [] }); onClose(); } catch (err) { setError(err.message || "This request could not be reviewed."); } finally { setBusy(""); } };
  return <DismissibleLayer open onClose={() => !busy && onClose()} title="Review older access request" sheet><div className="field-sheet access-v3-review"><button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} disabled={Boolean(busy)} aria-label="Close"><X /></button><span className="kicker">Older request</span><h2>{request.name}</h2><p>{request.email} · {roleLabel(request.role)}</p><div className="notice compact-notice"><WarningCircle /><div><b>Older request</b><p>Review only if this request is still needed. New invitations should use Invite someone.</p></div></div>{error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}<div className="field-sheet-actions"><button className="secondary" disabled={Boolean(busy)} onClick={() => decide("rejected")}>{busy === "rejected" ? "Rejecting…" : "Reject"}</button><button className="primary" disabled={Boolean(busy)} onClick={() => decide("approved")}>{busy === "approved" ? "Approving…" : "Approve"}</button></div></div></DismissibleLayer>;
}

export function createInitialAccessRequests() { return demoAccessRequests; }

export function Access({ initialFilter = "", requests = [], invites = [], currentRole = "logistics_admin", currentCapabilities = [], onDecision, onRefreshRoster, onCreateInvite, onRevokeInvite, onCreateRecovery, roster = demoUsers, teams = [], sessionId: requestedSessionId = "", live = false, sessionName }) {
  const [sessionId, setSessionId] = useState(requestedSessionId);
  const [directory, setDirectory] = useState(live ? [] : demoDirectory());
  const [activityByUser, setActivityByUser] = useState(new Map());
  const [onlineUserIds, setOnlineUserIds] = useState(new Set());
  const [filter, setFilter] = useState(FILTERS.some(([key]) => key === initialFilter) ? initialFilter : "needs");
  const [query, setQuery] = useState("");
  const [setupTarget, setSetupTarget] = useState(null);
  const [teamTarget, setTeamTarget] = useState(null);
  const [reviewRequest, setReviewRequest] = useState(null);
  const [recoveryResult, setRecoveryResult] = useState(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [confirmDisable, setConfirmDisable] = useState(null);
  const [confirmRevoke, setConfirmRevoke] = useState(null);
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

  const committeeActive = useMemo(() => (roster || []).filter((user) => (user.role || user.roleKey) === "committee_viewer").map((user) => {
    const keys = user.teamKeys || user.committeeScope || [];
    const names = user.teamNames?.length ? user.teamNames : keys.map((key) => teamNameByKey.get(key) || key).filter(Boolean);
    return { recordKey: `committee:${user.userId || user.id || user.email}`, kind: "committee", name: user.name || user.displayName || user.email || "Committee member", email: user.email || "", accountEmail: user.email || "", operationalRole: "committee_viewer", committeeKeys: keys, committeeNames: names, userId: user.userId || user.user_id || null, accessState: user.active === false ? "disabled" : "active" };
  }), [roster, teamNameByKey]);

  const committeePending = useMemo(() => (invites || []).filter((invite) => !invite.staff_id && invite.role === "committee_viewer" && INVITE_STATES.has(invite.status)).map((invite) => {
    const keys = invite.committee_scope || invite.committeeScope || [];
    return { recordKey: `invite:${invite.id}`, kind: "committee_invite", name: invite.display_name || invite.email || "Committee member", email: invite.email || "", operationalRole: "committee_viewer", committeeKeys: keys, committeeNames: keys.map((key) => teamNameByKey.get(key) || key).filter(Boolean), userId: null, accessState: "invited", inviteId: invite.id, inviteExpiresAt: invite.expires_at || invite.expiresAt || null };
  }), [invites, teamNameByKey]);

  const linkedUsers = useMemo(() => new Set(directory.map((item) => item.userId).filter(Boolean)), [directory]);
  const olderAccounts = useMemo(() => (roster || []).filter((user) => (user.role || user.roleKey) !== "committee_viewer" && user.active !== false && !linkedUsers.has(user.userId || user.user_id || user.id)), [roster, linkedUsers]);
  const olderInvites = useMemo(() => (invites || []).filter((invite) => !invite.staff_id && invite.role !== "committee_viewer" && INVITE_STATES.has(invite.status)), [invites]);
  const pendingRequests = useMemo(() => (requests || []).filter((request) => request.status === "pending"), [requests]);

  const allPeople = useMemo(() => {
    const accountByEmail = new Map();
    olderAccounts.forEach((account) => { const email = normalizeEmail(account.email || account.accountEmail); if (email && !accountByEmail.has(email)) accountByEmail.set(email, account); });
    const inviteByEmail = new Map();
    olderInvites.forEach((invite) => { const email = normalizeEmail(invite.email); if (email && !inviteByEmail.has(email)) inviteByEmail.set(email, invite); });
    const consumedAccounts = new Set();
    const consumedInvites = new Set();

    const staffRows = directory.map((person) => {
      const emails = [person.accountEmail, person.email].map(normalizeEmail).filter(Boolean);
      const account = emails.map((email) => accountByEmail.get(email)).find(Boolean);
      const olderInvite = emails.map((email) => inviteByEmail.get(email)).find(Boolean);
      if (account) consumedAccounts.add(account.userId || account.user_id || account.id || account.email);
      if (olderInvite) consumedInvites.add(olderInvite.id);
      if (person.accessState === "not_enabled" && account) return { ...person, userId: account.userId || account.user_id || account.id || null, accountEmail: account.email || person.accountEmail || person.email, accessState: "legacy", legacy: true, legacyAccount: true };
      if (person.accessState === "not_enabled" && olderInvite) return { ...person, accessState: "invited", inviteId: olderInvite.id, inviteExpiresAt: olderInvite.expires_at || olderInvite.expiresAt || null, legacy: true, legacyInvite: true };
      if (account || olderInvite) return { ...person, legacyTransition: true };
      return person;
    });

    const legacyAccountRows = olderAccounts.filter((account) => !consumedAccounts.has(account.userId || account.user_id || account.id || account.email)).map((account) => ({
      recordKey: `legacy-account:${account.userId || account.user_id || account.id || account.email}`,
      kind: "legacy_account",
      name: account.name || account.displayName || account.email || "Older account",
      email: account.email || "",
      accountEmail: account.email || "",
      operationalRole: account.role || account.roleKey || "coordinator",
      companyIds: account.companyIds || account.company_ids || [],
      companyNames: account.companyNames || [],
      userId: account.userId || account.user_id || account.id || null,
      accessState: "legacy",
      legacy: true,
      legacyAccount: true,
    }));

    const legacyInviteRows = olderInvites.filter((invite) => !consumedInvites.has(invite.id)).map((invite) => ({
      recordKey: `legacy-invite:${invite.id}`,
      kind: "legacy_invite",
      name: invite.display_name || invite.displayName || invite.email || "Invited leader",
      email: invite.email || "",
      accountEmail: invite.email || "",
      operationalRole: invite.role || "coordinator",
      companyIds: invite.company_ids || invite.companyIds || [],
      companyNames: [],
      userId: null,
      accessState: "invited",
      inviteId: invite.id,
      inviteExpiresAt: invite.expires_at || invite.expiresAt || null,
      legacy: true,
      legacyInvite: true,
    }));

    const requestRows = pendingRequests.map((request) => {
      const keys = request.committeeScope || [];
      return {
        recordKey: `legacy-request:${request.id}`,
        kind: "legacy_request",
        name: request.name || request.email || "Access request",
        email: request.email || "",
        accountEmail: request.email || "",
        operationalRole: request.role || "coordinator",
        companyIds: request.companyIds || [],
        companyNames: [],
        committeeKeys: keys,
        committeeNames: keys.map((key) => teamNameByKey.get(key) || key).filter(Boolean),
        userId: null,
        accessState: "review",
        legacy: true,
        request,
      };
    });

    return [...staffRows, ...committeeActive, ...committeePending, ...legacyAccountRows, ...legacyInviteRows, ...requestRows];
  }, [directory, committeeActive, committeePending, olderAccounts, olderInvites, pendingRequests, teamNameByKey]);

  const counts = useMemo(() => ({
    needs: allPeople.filter(needsSetup).length,
    online: allPeople.filter((item) => item.userId && onlineUserIds.has(item.userId)).length,
    invited: allPeople.filter((item) => item.accessState === "invited").length,
    active: allPeople.filter((item) => item.accessState === "active").length,
    disabled: allPeople.filter((item) => item.accessState === "disabled").length,
    all: allPeople.length,
  }), [allPeople, onlineUserIds]);

  const shown = useMemo(() => {
    const text = query.trim().toLowerCase();
    return allPeople.filter((item) => {
      const matchesState = filter === "all" || (filter === "needs" ? needsSetup(item) : filter === "online" ? Boolean(item.userId && onlineUserIds.has(item.userId)) : item.accessState === filter);
      const matchesText = !text || `${item.name} ${item.email} ${item.accountEmail || ""} ${displayRole(item)} ${(item.companyNames || []).join(" ")} ${(item.committeeNames || []).join(" ")} ${item.legacy ? "older access legacy" : ""}`.toLowerCase().includes(text);
      return matchesState && matchesText;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [allPeople, filter, query, onlineUserIds]);

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

  const startInvite = () => { setError(""); setToast(null); setSetupTarget({ newPerson: true }); };
  const startMigration = (person) => { setError(""); setToast(null); setSetupTarget({ ...person, migrationMode: true, email: person.accountEmail || person.email || "" }); };

  return <section className="page access-v4 access-v15 access-v16">
    <PageHead title="Access" sessionName={sessionName} description="Invite people, connect older access to the staff directory, and see who is online right now." action={canInviteAnyone ? <button className="primary" onClick={startInvite}><UserPlus />Invite someone</button> : null} />
    {!canManage ? <div className="notice"><WarningCircle /><div><b>View only</b><p>A whole-session administrator is required to change website access.</p></div></div> : null}
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}

    <div className="access-v4-summary access-v16-summary" aria-label="Access summary">
      <button type="button" className={filter === "needs" ? "active" : ""} onClick={() => setFilter("needs")}><b>{counts.needs}</b><span>Needs action</span></button>
      <button type="button" className={filter === "online" ? "active" : ""} onClick={() => setFilter("online")}><b>{counts.online}</b><span>Online now</span></button>
      <button type="button" className={filter === "invited" ? "active" : ""} onClick={() => setFilter("invited")}><b>{counts.invited}</b><span>Invite sent</span></button>
      <button type="button" className={filter === "active" ? "active" : ""} onClick={() => setFilter("active")}><b>{counts.active}</b><span>Active</span></button>
    </div>

    <div className="access-v4-tools"><SearchField value={query} onChange={setQuery} label="Search access" placeholder="Name, email, role, company or committee" /><div className="access-v4-filters" role="group" aria-label="Filter access">{FILTERS.map(([key, label]) => <button type="button" key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{label}{counts[key] ? <b>{counts[key]}</b> : null}</button>)}</div></div>

    <article className="panel access-v4-directory">
      <header className="access-v4-directory-head"><div><span className="kicker">People</span><h2>{FILTERS.find(([key]) => key === filter)?.[1]}</h2></div><div className="access-v16-directory-meta"><span className="access-v16-live"><i />{counts.online} online</span><span>{shown.length} {shown.length === 1 ? "person" : "people"}</span></div></header>
      {shown.length ? <div className="access-v4-list">{shown.map((person) => {
        const incomplete = person.operationalRole === "assistant_coordinator" && !person.companyIds?.length;
        const migrationNeeded = person.accessState === "legacy" || person.kind === "legacy_invite";
        const key = personKey(person);
        const rowBusy = busyId === key;
        const rosterUser = roster.find((user) => (user.userId || user.user_id || user.id) === person.userId);
        const menuActions = [];
        if (person.accessState === "active" && person.userId) menuActions.push({ label: person.operationalRole === "committee_viewer" ? "Edit committees" : "Committee tools", onClick: () => setTeamTarget(rosterUser || { userId: person.userId, name: person.name, teamKeys: person.committeeKeys || [] }) });
        if (["active", "legacy"].includes(person.accessState) && onCreateRecovery && person.userId) menuActions.push({ label: "Recovery", icon: Key, onClick: () => recovery(person) });
        if (person.accessState === "active" && person.kind === "staff") menuActions.push({ label: "Disable sign-in", danger: true, onClick: () => setConfirmDisable(person) });
        if (person.accessState === "invited" && onRevokeInvite) menuActions.push({ label: "Cancel invite", danger: true, onClick: () => setConfirmRevoke(person) });
        return <div className={`access-v4-row ${incomplete || needsSetup(person) ? "needs-setup" : ""} ${person.operationalRole === "committee_viewer" ? "is-committee" : ""} ${person.legacy ? "is-legacy" : ""}`} key={key}>
          <div className="access-v4-person"><span className="person-avatar">{initials(person.name)}</span><span><b>{person.name}</b><small>{displayRole(person)}{person.legacy ? " · Older access" : ""}</small></span></div>
          <div className="access-v4-scope"><small>{scopeHeading(person)}</small><Scope person={person} /></div>
          <div className="access-v4-state"><Status tone={accessTone(person)}>{accessLabel(person)}</Status><AccountActivity person={person} onlineUserIds={onlineUserIds} activityByUser={activityByUser} /></div>
          <div className="access-v4-actions">
            {person.kind === "legacy_request" ? <button className="primary" disabled={!canManage || rowBusy} onClick={() => setReviewRequest(person.request)}>Review</button> : null}
            {migrationNeeded ? <button className="primary" disabled={!canAddLeader || rowBusy} onClick={() => startMigration(person)}>{person.kind === "legacy_invite" ? "Move to current setup" : "Connect to staff"}</button> : null}
            {person.kind === "staff" && !migrationNeeded && (incomplete || person.accessState === "not_enabled" || person.accessState === "invited") ? <button className={person.accessState === "not_enabled" && !incomplete ? "primary" : "secondary"} disabled={!canManage || rowBusy} onClick={() => setSetupTarget(person)}>{incomplete ? "Finish assignment" : person.accessState === "invited" ? person.legacyInvite ? "Replace older invite" : "New setup link" : "Invite"}</button> : null}
            {person.kind === "staff" && person.accessState === "disabled" ? <button className="primary" disabled={!canManage || rowBusy} onClick={() => toggleAccess(person, true)}>Enable</button> : null}
            <AccessActionMenu actions={menuActions} disabled={!canManage || rowBusy} />
          </div>
        </div>;
      })}</div> : <Empty title={query ? "No person found" : filter === "needs" ? "No access work waiting" : filter === "online" ? "No one is online right now" : "Nothing in this view"} text={query ? "Try another name, email, role, company or committee." : filter === "needs" ? "Everyone who needs action is ready or already invited." : filter === "online" ? "This updates automatically as signed-in staff open and leave FSY Ops." : "Choose another access state."} action={!query && filter === "needs" && canInviteAnyone ? <button type="button" className="primary" onClick={startInvite}><UserPlus />Invite someone</button> : null} />}
    </article>

    {setupTarget ? <LeaderSetupFlow sessionId={sessionId} person={setupTarget.newPerson ? null : setupTarget} allowStaffRoles={canAddLeader} allowCommittee={canInviteCommittee} requireEmail teams={teams} knownAccounts={setupTarget.migrationMode ? [] : roster} pendingInvites={setupTarget.migrationMode ? [] : invites} onCreateCommitteeInvite={onCreateInvite} onClose={() => setSetupTarget(null)} onComplete={async (person) => { if (person.operationalRole !== "committee_viewer") await refresh(); await onRefreshRoster?.(); }} /> : null}
    {teamTarget ? <AccountTeams user={teamTarget} sessionId={sessionId} teams={teams} onClose={() => setTeamTarget(null)} onSaved={async () => { await refresh(); await onRefreshRoster?.(); setToast({ message: `Committee access updated for ${teamTarget.name}` }); }} /> : null}
    {reviewRequest ? <RequestReview request={reviewRequest} onClose={() => setReviewRequest(null)} onDecision={onDecision} /> : null}
    {recoveryResult ? <DismissibleLayer open onClose={() => setRecoveryResult(null)} title="Recovery code" sheet><div className="headcount-create"><h2>Recovery for {recoveryResult.name}</h2><label>One-time code<input readOnly value={recoveryResult.code} /></label><p>Expires {new Date(recoveryResult.expiresAt).toLocaleString()}. Share only with the account owner.</p><button className="secondary" onClick={() => setRecoveryResult(null)}>Done</button></div></DismissibleLayer> : null}
    {confirmDisable ? <ConfirmActionSheet open title={`Disable ${confirmDisable.name}'s sign-in?`} description="Their FSY assignment stays unchanged." impact="They will not be able to use FSY Ops until website access is enabled again." confirmLabel="Disable sign-in" cancelLabel="Keep enabled" busy={busyId === personKey(confirmDisable)} onClose={() => setConfirmDisable(null)} onConfirm={async () => { if (await toggleAccess(confirmDisable, false)) setConfirmDisable(null); }} /> : null}
    {confirmRevoke ? <ConfirmActionSheet open title={`Cancel ${confirmRevoke.name}'s invite?`} description="The current setup link will stop working." impact={confirmRevoke.kind === "staff" ? "Their FSY assignment stays unchanged. You can invite them again from this row." : "No account will be created from this link. You can invite them again later."} confirmLabel="Cancel invite" cancelLabel="Keep invite" busy={busyId === personKey(confirmRevoke)} onClose={() => setConfirmRevoke(null)} onConfirm={() => revoke(confirmRevoke)} /> : null}
    <ActionToast message={undo?.message || toast?.message} onAction={undo ? undoAccess : null} onDismiss={() => { setUndo(null); setToast(null); }} busy={undoBusy} />
  </section>;
}
