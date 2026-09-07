import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Key } from "@phosphor-icons/react/Key";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { AccessAddFlowV18 } from "../components/AccessAddFlowV18.jsx";
import { AccessIdentityReviewV18 } from "../components/AccessIdentityReviewV18.jsx";
import { AccountTeams } from "../components/AccountSetup.jsx";
import { LeaderSetupFlow } from "../components/LeaderSetupFlow.jsx";
import { ActionToast, ConfirmActionSheet, DismissibleLayer, Empty, MutationFeedback, PageHead, SearchField, Status } from "../components/UI.jsx";
import { canApproveAccess, roleLabel } from "../lib/access.js";
import { demoAccessRequests, demoUsers } from "../data/demo.js";
import {
  accessStateLabel,
  adoptLegacyAccessAccount,
  createManualStaffLeader,
  loadSessionAccountActivity,
  loadStaffAccessDirectory,
  resolveCurrentAccessSessionId,
  retireLegacyAccessAccount,
  setStaffWebsiteAccess,
  staffRoleLabel,
} from "../lib/staff-access.js";
import { subscribeSessionPresence } from "../lib/presence.js";
import "./staff-access.css";
import "../access-operations-v17.css";
import "../access-operations-v18.css";

const STAFF_LINKED_ROLES = new Set(["assistant_coordinator", "coordinator", "logistics_admin", "session_director"]);
const INVITE_STATES = new Set(["pending", "activating"]);
const ROLE_FILTERS = [
  ["all", "All responsibilities"],
  ["assistant_coordinator", "Assistant Coordinators"],
  ["coordinator", "Coordinators"],
  ["logistics_admin", "Logistical administrators"],
  ["session_director", "Session directing couple"],
  ["committee_viewer", "Committee members"],
];
const STATUS_FILTERS = [["all", "All access states"], ["active", "Active"], ["invited", "Invite sent"], ["disabled", "Disabled"], ["online", "Online now"]];

function initials(name = "FSY") { return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase(); }
function normalizeEmail(value = "") { return String(value).trim().toLowerCase(); }
function normalizeName(value = "") { return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function personKey(person) { return person.recordKey || person.staffId || person.userId || person.inviteId || person.email || person.name; }
function sourceUserId(user) { return user?.userId || user?.user_id || null; }
function sourceAssignmentId(user) { return user?.id || null; }
function sourceRole(user) { return user?.role || user?.roleKey || ""; }
function sourceName(user) { return user?.name || user?.displayName || user?.email || "FSY leader"; }
function createdStaffId(value) { return typeof value === "string" ? value : value?.staff_id || value?.staffId || value?.id || ""; }
function displayRole(person) { return person.operationalRole === "committee_viewer" ? "Committee member" : staffRoleLabel(person.operationalRole); }
function scopeHeading(person) { return person.operationalRole === "committee_viewer" ? "Committee" : "Assignment"; }

function demoDirectory() {
  return demoUsers.filter((user) => STAFF_LINKED_ROLES.has(user.roleKey)).map((user, index) => ({
    recordKey: `staff:demo-${index + 1}`, kind: "staff", staffId: `demo-staff-${index + 1}`, name: user.name,
    operationalRole: user.roleKey, email: user.email, companyIds: user.roleKey === "assistant_coordinator" ? ["demo-1", "demo-2"] : [],
    companyNames: user.roleKey === "assistant_coordinator" ? ["Company 01", "Company 02"] : [], userId: `demo-user-${index + 1}`,
    accountEmail: user.email, accessEnabled: user.status === "Active", accessState: user.status === "Active" ? "active" : "not_enabled",
  }));
}
function hasExpiredInvite(person, now = Date.now()) {
  if (person.accessState !== "invited" || !person.inviteExpiresAt) return false;
  const time = new Date(person.inviteExpiresAt).getTime();
  return Number.isFinite(time) && time <= now;
}
function needsAttention(person, now = Date.now()) {
  if (person.identityReview || person.legacyRequest || person.unmatchedLegacyInvite) return true;
  if (person.operationalRole === "assistant_coordinator" && person.staffId && !person.companyIds?.length) return true;
  if (person.staffId && person.accessState === "not_enabled") return true;
  return hasExpiredInvite(person, now);
}
function accessLabel(person, now = Date.now()) {
  if (person.identityReview) return "Identity needs review";
  if (person.legacyRequest) return "Access request needs setup";
  if (person.unmatchedLegacyInvite) return "Invite needs current setup";
  if (person.operationalRole === "assistant_coordinator" && person.staffId && !person.companyIds?.length) return "Choose companies";
  if (person.accessState === "not_enabled") return "No sign-in yet";
  if (person.accessState === "invited") return hasExpiredInvite(person, now) ? "Setup link expired" : "Invite sent";
  if (person.accessState === "disabled") return "Sign-in disabled";
  return accessStateLabel(person.accessState);
}
function accessTone(person, now = Date.now()) {
  if (needsAttention(person, now)) return "warn";
  if (person.accessState === "active") return "good";
  if (person.accessState === "invited") return "warn";
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
  return hours < 24 ? `Expires in ${hours}h` : `Expires in ${Math.ceil(hours / 24)}d`;
}
function AccountActivity({ person, onlineUserIds, activityByUser, now }) {
  if (person.userId && onlineUserIds.has(person.userId)) return <span className="account-activity online"><i />Online now</span>;
  if (person.userId) return <span className="account-activity">{formatRelative(activityByUser.get(person.userId)?.lastSignInAt, now)}</span>;
  if (person.accessState === "invited") return <span className="account-activity waiting">{formatInviteTiming(person.inviteExpiresAt, now)}</span>;
  return <span className="account-activity waiting">No account yet</span>;
}
function Scope({ person }) {
  if (person.operationalRole === "committee_viewer") {
    const names = person.committeeNames || [];
    return names.length ? <span className="access-v15-team-chips">{names.map((name) => <i key={name}>{name}</i>)}</span> : <span className="company-chip-empty"><WarningCircle />Choose committee</span>;
  }
  if (person.operationalRole !== "assistant_coordinator") return <span className="staff-access-whole-session">Whole session</span>;
  if (person.companyNames?.length) return <span className="access-v3-scope">{person.companyNames.join(" · ")}</span>;
  if (person.companyIds?.length) return <span className="access-v3-scope">{person.companyIds.length} compan{person.companyIds.length === 1 ? "y" : "ies"}</span>;
  return <span className="company-chip-empty"><WarningCircle />Choose companies</span>;
}
function strongStaffMatch(staff, account) {
  const eligible = staff.filter((candidate) => candidate.staffId && !candidate.userId);
  const accountEmail = normalizeEmail(account.accountEmail || account.email);
  if (accountEmail) {
    const exact = eligible.filter((candidate) => normalizeEmail(candidate.accountEmail || candidate.email) === accountEmail);
    if (exact.length === 1) return exact[0];
  }
  const name = normalizeName(account.name);
  if (!name) return null;
  const same = eligible.filter((candidate) => normalizeName(candidate.name) === name && candidate.operationalRole === account.operationalRole);
  return same.length === 1 ? same[0] : null;
}
function hasPossibleIdentity(staff, account) {
  const accountEmail = normalizeEmail(account.accountEmail || account.email);
  const name = normalizeName(account.name);
  return staff.some((candidate) => (accountEmail && normalizeEmail(candidate.accountEmail || candidate.email) === accountEmail) || (name && normalizeName(candidate.name) === name));
}
function mergeInvite(person, invite, legacy = false) {
  return { ...person, name: person.name || invite.name, email: person.email || invite.email, operationalRole: person.operationalRole || invite.operationalRole,
    companyIds: person.companyIds?.length ? person.companyIds : invite.companyIds || [], committeeKeys: person.committeeKeys?.length ? person.committeeKeys : invite.committeeKeys || [],
    committeeNames: person.committeeNames?.length ? person.committeeNames : invite.committeeNames || [], accessState: person.userId ? person.accessState : "invited",
    inviteId: person.inviteId || invite.inviteId, inviteExpiresAt: person.inviteExpiresAt || invite.inviteExpiresAt, legacyInviteId: legacy ? invite.inviteId : person.legacyInviteId,
    unmatchedLegacyInvite: legacy && !person.staffId && !person.userId };
}
export function reconcileAccessPeopleV18({ staffRows = [], committeeActive = [], committeePending = [], legacyAccounts = [], legacyInvites = [], legacyRequests = [] }) {
  let people = [...staffRows, ...committeeActive].map((item) => ({ ...item }));
  for (const account of legacyAccounts) {
    const match = strongStaffMatch(people, account);
    if (match) people = people.map((item) => personKey(item) === personKey(match) ? { ...item, userId: account.userId, accountEmail: account.accountEmail || account.email || item.accountEmail,
      legacyAssignmentId: account.legacyAssignmentId, legacyRole: account.operationalRole, legacyCompanyIds: account.companyIds || [], identityReview: true, accessState: "review" } : item);
    else people.push({ ...account, identityReview: true, accessState: "review" });
  }
  for (const invite of committeePending) {
    const email = normalizeEmail(invite.email); const index = email ? people.findIndex((item) => normalizeEmail(item.accountEmail || item.email) === email) : -1;
    if (index >= 0) people[index] = mergeInvite(people[index], invite); else people.push(invite);
  }
  for (const invite of legacyInvites) {
    const email = normalizeEmail(invite.email); const index = email ? people.findIndex((item) => normalizeEmail(item.accountEmail || item.email) === email) : -1;
    if (index >= 0) people[index] = mergeInvite(people[index], invite, true); else people.push({ ...invite, unmatchedLegacyInvite: true });
  }
  for (const request of legacyRequests) {
    const email = normalizeEmail(request.email); const index = email ? people.findIndex((item) => normalizeEmail(item.accountEmail || item.email) === email) : -1;
    if (index >= 0) people[index] = { ...people[index], legacyRequest: request.request, legacyRequestId: request.requestId }; else people.push({ ...request, legacyRequest: request.request });
  }
  return people.map((person) => ({ ...person, recordKey: person.recordKey || `person:${person.staffId || person.userId || person.inviteId || normalizeEmail(person.email) || normalizeName(person.name)}` }));
}
function sortPeople(a, b, onlineUserIds, now) {
  const priority = (person) => needsAttention(person, now) ? 0 : person.userId && onlineUserIds.has(person.userId) ? 1 : person.accessState === "invited" ? 2 : person.accessState === "active" ? 3 : 4;
  return priority(a) - priority(b) || a.name.localeCompare(b.name);
}
function statusMatches(person, filter, onlineUserIds) {
  if (filter === "all") return true;
  if (filter === "online") return Boolean(person.userId && onlineUserIds.has(person.userId));
  if (filter === "active") return person.accessState === "active" || person.accessState === "review";
  return person.accessState === filter;
}
function setupAccountEmail(account) { return normalizeEmail(account?.email || account?.accountEmail || account?.account_email || ""); }

function RequestReview({ request, onClose, onDecision, onMoveToNew }) {
  const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  const decide = async (status) => { setBusy(status); setError(""); try { await onDecision?.(request.id, status, { companyIds: request.companyIds || [], committeeScope: request.committeeScope || [] }); onClose(); } catch (err) { setError(err.message || "This request could not be reviewed."); } finally { setBusy(""); } };
  return <DismissibleLayer open onClose={() => !busy && onClose()} title="Review access request" sheet><div className="field-sheet access-v3-review"><button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} disabled={Boolean(busy)} aria-label="Close"><X /></button><span className="kicker">Access request</span><h2>{request.name}</h2><p>{request.email} · {roleLabel(request.role)}</p><div className="notice compact-notice"><WarningCircle /><div><b>Set up this person's current responsibility</b><p>Staff remains the source for responsibility and company scope.</p></div></div>{error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}<div className="field-sheet-actions"><button className="secondary" disabled={Boolean(busy)} onClick={() => decide("rejected")}>{busy === "rejected" ? "Rejecting…" : "Reject request"}</button><button className="primary" disabled={Boolean(busy)} onClick={onMoveToNew}>Set up access</button></div></div></DismissibleLayer>;
}

export function createInitialAccessRequests() { return demoAccessRequests; }

export function Access({ initialFilter = "", requests = [], invites = [], currentRole = "logistics_admin", currentCapabilities = [], onDecision, onRefreshRoster, onCreateInvite, onRevokeInvite, onCreateRecovery, roster = demoUsers, teams = [], sessionId: requestedSessionId = "", live = false, sessionName }) {
  const [sessionId, setSessionId] = useState(requestedSessionId); const [directory, setDirectory] = useState(live ? [] : demoDirectory());
  const [activityByUser, setActivityByUser] = useState(new Map()); const [onlineUserIds, setOnlineUserIds] = useState(new Set()); const [now, setNow] = useState(Date.now());
  const [view, setView] = useState(initialFilter === "all" ? "all" : "needs"); const [statusFilter, setStatusFilter] = useState(["active", "invited", "disabled", "online"].includes(initialFilter) ? initialFilter : "all");
  const [roleFilter, setRoleFilter] = useState("all"); const [query, setQuery] = useState(""); const [setupTarget, setSetupTarget] = useState(null); const [addOpen, setAddOpen] = useState(false);
  const [teamTarget, setTeamTarget] = useState(null); const [identityTarget, setIdentityTarget] = useState(null); const [reviewRequest, setReviewRequest] = useState(null); const [recoveryResult, setRecoveryResult] = useState(null);
  const [busyId, setBusyId] = useState(""); const [error, setError] = useState(""); const [preparing, setPreparing] = useState(live); const [confirmDisable, setConfirmDisable] = useState(null);
  const [confirmRevoke, setConfirmRevoke] = useState(null); const [confirmRetire, setConfirmRetire] = useState(null); const [undo, setUndo] = useState(null); const [toast, setToast] = useState(null); const [undoBusy, setUndoBusy] = useState(false);
  const attemptedRef = useRef(new Set());
  const canManage = canApproveAccess(currentRole, currentCapabilities); const canAddLeader = canManage && currentCapabilities.includes("staff_manage"); const canInviteCommittee = canManage && Boolean(onCreateInvite || !live); const canInviteAnyone = canAddLeader || canInviteCommittee;
  const teamNameByKey = useMemo(() => new Map((teams || []).map((team) => [team.key, team.name])), [teams]);
  const rosterSignature = useMemo(() => (roster || []).map((item) => `${sourceUserId(item) || ""}:${sourceRole(item)}:${item.active === false ? 0 : 1}`).sort().join("|"), [roster]);

  const mapStaffRows = (rows) => rows.filter((person) => STAFF_LINKED_ROLES.has(person.operationalRole)).map((person) => ({ ...person, kind: "staff", recordKey: `staff:${person.staffId}` }));
  const refresh = async (knownSessionId = sessionId) => {
    if (!live) return directory;
    const resolved = knownSessionId || await resolveCurrentAccessSessionId(); if (!sessionId) setSessionId(resolved);
    const [nextDirectory, nextActivity] = await Promise.all([loadStaffAccessDirectory(resolved), loadSessionAccountActivity(resolved)]);
    const staffRows = mapStaffRows(nextDirectory); setDirectory(staffRows); setActivityByUser(nextActivity); return staffRows;
  };

  useEffect(() => {
    if (!live) { setPreparing(false); return undefined; }
    let cancelled = false;
    const prepare = async () => {
      setPreparing(true); setError("");
      try {
        const resolved = requestedSessionId || await resolveCurrentAccessSessionId(); if (cancelled) return; setSessionId(resolved);
        let staffRows = await refresh(resolved); if (cancelled) return;
        if (canManage) {
          const linked = new Set(staffRows.map((item) => item.userId).filter(Boolean));
          const oldAccounts = (roster || []).filter((user) => STAFF_LINKED_ROLES.has(sourceRole(user)) && user.active !== false && sourceUserId(user) && !linked.has(sourceUserId(user)));
          let changed = false;
          for (const account of oldAccounts) {
            const userId = sourceUserId(account); const attemptKey = `${resolved}:${userId}`; if (attemptedRef.current.has(attemptKey)) continue; attemptedRef.current.add(attemptKey);
            const legacy = { name: sourceName(account), email: account.email || "", accountEmail: account.email || "", operationalRole: sourceRole(account), companyIds: account.companyIds || account.company_ids || [], userId };
            const match = strongStaffMatch(staffRows, legacy);
            try {
              await adoptLegacyAccessAccount({ sessionId: resolved, userId, staffId: match?.staffId || null }); changed = true;
            } catch (err) {
              const message = err.message || "";
              const safeMissingAc = legacy.operationalRole === "assistant_coordinator" && !match && !hasPossibleIdentity(staffRows, legacy) && /compan|scope|limit/i.test(message) && normalizeName(legacy.name) && !normalizeEmail(legacy.name).includes("@");
              if (safeMissingAc) {
                try {
                  const created = await createManualStaffLeader({ sessionId: resolved, name: legacy.name, email: legacy.email, role: legacy.operationalRole });
                  const staffId = createdStaffId(created); if (!staffId) throw new Error("Staff identity was created but could not be read back.");
                  await adoptLegacyAccessAccount({ sessionId: resolved, userId, staffId }); changed = true;
                } catch { /* leave a genuine conflict for the review surface */ }
              }
            }
          }
          if (changed) { await onRefreshRoster?.(); staffRows = await refresh(resolved); }
        }
      } catch (err) { if (!cancelled) setError(err.message || "Website access could not be prepared."); }
      finally { if (!cancelled) setPreparing(false); }
    };
    prepare(); return () => { cancelled = true; };
  }, [live, requestedSessionId, canManage, rosterSignature]);

  useEffect(() => live && sessionId ? subscribeSessionPresence(sessionId, setOnlineUserIds) : undefined, [live, sessionId]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (!live || !sessionId) return undefined; const timer = window.setInterval(() => loadSessionAccountActivity(sessionId).then(setActivityByUser).catch(() => {}), 60000); return () => window.clearInterval(timer); }, [live, sessionId]);
  useEffect(() => { const closeOutside = (event) => document.querySelectorAll(".access-v18 .staff-access-more[open]").forEach((menu) => { if (!menu.contains(event.target)) menu.removeAttribute("open"); }); document.addEventListener("pointerdown", closeOutside); return () => document.removeEventListener("pointerdown", closeOutside); }, []);
  useEffect(() => { document.querySelectorAll(".access-v18 .staff-access-more[open]").forEach((menu) => menu.removeAttribute("open")); }, [view, statusFilter, roleFilter, query, setupTarget, addOpen, teamTarget, identityTarget, confirmDisable, confirmRevoke, confirmRetire]);

  const committeeActive = useMemo(() => (roster || []).filter((user) => sourceRole(user) === "committee_viewer" && user.active !== false).map((user) => { const keys = user.teamKeys || user.committeeScope || []; const names = user.teamNames?.length ? user.teamNames : keys.map((key) => teamNameByKey.get(key) || key).filter(Boolean); return { recordKey: `committee:${sourceUserId(user) || sourceAssignmentId(user) || user.email}`, kind: "committee", name: sourceName(user), email: user.email || "", accountEmail: user.email || "", operationalRole: "committee_viewer", committeeKeys: keys, committeeNames: names, userId: sourceUserId(user), accessState: "active" }; }), [roster, teamNameByKey]);
  const committeePending = useMemo(() => (invites || []).filter((invite) => !invite.staff_id && invite.role === "committee_viewer" && INVITE_STATES.has(invite.status)).map((invite) => { const keys = invite.committee_scope || invite.committeeScope || []; return { recordKey: `invite:${invite.id}`, kind: "committee_invite", name: invite.display_name || invite.email || "Committee member", email: invite.email || "", operationalRole: "committee_viewer", committeeKeys: keys, committeeNames: keys.map((key) => teamNameByKey.get(key) || key).filter(Boolean), userId: null, accessState: "invited", inviteId: invite.id, inviteExpiresAt: invite.expires_at || invite.expiresAt || null }; }), [invites, teamNameByKey]);
  const linkedUsers = useMemo(() => new Set(directory.map((item) => item.userId).filter(Boolean)), [directory]);
  const legacyAccounts = useMemo(() => (roster || []).filter((user) => STAFF_LINKED_ROLES.has(sourceRole(user)) && user.active !== false && sourceUserId(user) && !linkedUsers.has(sourceUserId(user))).map((user) => ({ recordKey: `legacy:${sourceUserId(user)}`, kind: "legacy_account", legacyAssignmentId: sourceAssignmentId(user), name: sourceName(user), email: user.email || "", accountEmail: user.email || "", operationalRole: sourceRole(user), companyIds: user.companyIds || user.company_ids || [], committeeKeys: user.teamKeys || user.committeeScope || [], userId: sourceUserId(user), accessState: "active" })), [roster, linkedUsers]);
  const legacyInvites = useMemo(() => (invites || []).filter((invite) => !invite.staff_id && invite.role !== "committee_viewer" && INVITE_STATES.has(invite.status)).map((invite) => ({ recordKey: `legacy-invite:${invite.id}`, kind: "legacy_invite", name: invite.display_name || invite.email || "FSY leader", email: invite.email || "", operationalRole: invite.role, companyIds: invite.company_ids || invite.companyIds || [], userId: null, accessState: "invited", inviteId: invite.id, inviteExpiresAt: invite.expires_at || invite.expiresAt || null })), [invites]);
  const legacyRequests = useMemo(() => (requests || []).filter((request) => request.status === "pending").map((request) => ({ recordKey: `legacy-request:${request.id}`, kind: "legacy_request", requestId: request.id, request, name: request.name || request.email || "FSY leader", email: request.email || "", operationalRole: request.role, companyIds: request.companyIds || [], userId: null, accessState: "request" })), [requests]);
  const people = useMemo(() => reconcileAccessPeopleV18({ staffRows: directory, committeeActive, committeePending, legacyAccounts, legacyInvites, legacyRequests }), [directory, committeeActive, committeePending, legacyAccounts, legacyInvites, legacyRequests]);
  const counts = useMemo(() => ({ needs: people.filter((person) => needsAttention(person, now)).length, online: people.filter((person) => person.userId && onlineUserIds.has(person.userId)).length, active: people.filter((person) => person.accessState === "active" || person.accessState === "review").length, invited: people.filter((person) => person.accessState === "invited").length, disabled: people.filter((person) => person.accessState === "disabled").length, all: people.length }), [people, onlineUserIds, now]);
  const shown = useMemo(() => { const text = query.trim().toLowerCase(); return people.filter((person) => { if (view === "needs" && !needsAttention(person, now)) return false; if (!statusMatches(person, statusFilter, onlineUserIds)) return false; if (roleFilter !== "all" && person.operationalRole !== roleFilter) return false; if (!text) return true; return `${person.name} ${person.email || ""} ${person.accountEmail || ""} ${displayRole(person)} ${(person.companyNames || []).join(" ")} ${(person.committeeNames || []).join(" ")}`.toLowerCase().includes(text); }).sort((a, b) => sortPeople(a, b, onlineUserIds, now)); }, [people, view, statusFilter, roleFilter, query, onlineUserIds, now]);
  const knownAccounts = useMemo(() => [...(roster || []), ...directory.filter((item) => item.userId).map((item) => ({ email: item.accountEmail || item.email, accountEmail: item.accountEmail || item.email }))], [roster, directory]);
  const setupKnownAccounts = useMemo(() => { if (!setupTarget?.fromLegacy || !setupTarget?.email) return knownAccounts; const ownEmail = normalizeEmail(setupTarget.email); return knownAccounts.filter((account) => setupAccountEmail(account) !== ownEmail); }, [knownAccounts, setupTarget]);
  const setupInvites = useMemo(() => !setupTarget?.fromLegacy ? invites : (invites || []).filter((invite) => invite.id !== setupTarget.legacyInviteId && invite.id !== setupTarget.inviteId), [invites, setupTarget]);

  const toggleAccess = async (person, enabled, { offerUndo = true } = {}) => { if (!person.staffId) return false; const key = personKey(person); if (!live) { setDirectory((current) => current.map((item) => item.staffId === person.staffId ? { ...item, accessState: enabled ? "active" : "disabled", accessEnabled: enabled } : item)); if (offerUndo) setUndo({ person, enabled: !enabled, message: `Sign-in ${enabled ? "enabled" : "disabled"} for ${person.name}` }); return true; } setBusyId(key); setError(""); setToast(null); try { await setStaffWebsiteAccess(person.staffId, enabled); await refresh(); if (offerUndo) setUndo({ person, enabled: !enabled, message: `Sign-in ${enabled ? "enabled" : "disabled"} for ${person.name}` }); return true; } catch (err) { setError(err.message || "Website access could not be changed."); return false; } finally { setBusyId(""); } };
  const undoAccess = async () => { if (!undo?.person) return; setUndoBusy(true); try { await toggleAccess(undo.person, undo.enabled, { offerUndo: false }); setUndo(null); } finally { setUndoBusy(false); } };
  const recovery = async (person) => { if (!person.userId || !onCreateRecovery) return; const key = personKey(person); setBusyId(key); setError(""); try { const created = await onCreateRecovery(person.userId); if (created?.code) setRecoveryResult({ ...created, name: person.name }); else setToast({ message: `Recovery prepared for ${person.name}` }); } catch (err) { setError(err.message || "Recovery access could not be prepared."); } finally { setBusyId(""); } };
  const revoke = async (person) => { const inviteId = person.inviteId || person.legacyInviteId; if (!inviteId || !onRevokeInvite) return; const key = personKey(person); setBusyId(key); setError(""); try { await onRevokeInvite(inviteId); if (person.staffId) await refresh(); await onRefreshRoster?.(); setToast({ message: `Invite cancelled for ${person.name}` }); } catch (err) { setError(err.message || "Invite could not be cancelled."); } finally { setBusyId(""); setConfirmRevoke(null); } };
  const resolveIdentity = async (person, staffId) => { const key = personKey(person); setBusyId(key); setError(""); try { const result = await adoptLegacyAccessAccount({ sessionId, userId: person.userId, staffId }); await onRefreshRoster?.(); await refresh(); setToast({ message: `${result.name || person.name} is ready with the same sign-in` }); } catch (err) { setError(err.message || "This identity could not be matched safely."); throw err; } finally { setBusyId(""); } };
  const createIdentityAndResolve = async (person) => { if (!person.userId) return; const exact = directory.filter((candidate) => normalizeEmail(candidate.email || candidate.accountEmail) && normalizeEmail(candidate.email || candidate.accountEmail) === normalizeEmail(person.email || person.accountEmail)); if (exact.length) throw new Error("A Staff record already uses this email. Choose that person instead."); const sameName = directory.filter((candidate) => normalizeName(candidate.name) === normalizeName(person.name)); if (sameName.length) throw new Error("A Staff record already uses this name. Review those records instead of creating another person."); const created = await createManualStaffLeader({ sessionId, name: person.name, email: person.email || person.accountEmail || "", role: person.operationalRole }); const staffId = createdStaffId(created); if (!staffId) throw new Error("The Staff identity was created but could not be read back."); await resolveIdentity(person, staffId); };
  const retireLegacy = async (person) => { const key = personKey(person); setBusyId(key); setError(""); try { await retireLegacyAccessAccount({ sessionId, userId: person.userId }); await onRefreshRoster?.(); await refresh(); setToast({ message: `Old website access removed for ${person.name}` }); setConfirmRetire(null); } catch (err) { setError(err.message || "Old website access could not be removed."); } finally { setBusyId(""); } };
  const startLegacySetup = (person) => setSetupTarget({ ...person, fromLegacy: true, legacyInviteId: person.legacyInviteId || person.inviteId, legacyRequestId: person.legacyRequestId, email: person.email || person.accountEmail || "" });
  const clearFilters = () => { setStatusFilter("all"); setRoleFilter("all"); };

  return <section className="page access-v4 access-v15 access-v16 access-v17 access-v18">
    <PageHead title="Access" sessionName={sessionName} description="Manage who can sign in to FSY Ops. Staff responsibility controls what each person can see." action={canInviteAnyone ? <button className="primary" onClick={() => setAddOpen(true)}><UserPlus />Add access</button> : null} />
    {!canManage ? <div className="notice"><WarningCircle /><div><b>View only</b><p>A whole-session administrator is required to change website access.</p></div></div> : null}
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
    {preparing ? <div className="access-v18-preparing"><span className="access-v18-spinner" /><div><b>Preparing access</b><p>Checking existing sign-ins against current Staff so routine account moves happen automatically.</p></div></div> : counts.needs ? <div className="access-v17-attention"><WarningCircle /><div><b>{counts.needs} {counts.needs === 1 ? "person needs" : "people need"} attention</b><p>Only decisions and setup work that need a person are shown here.</p></div>{view !== "needs" ? <button className="secondary" type="button" onClick={() => setView("needs")}>Review</button> : null}</div> : <div className="access-v17-ready"><CheckCircle weight="fill" /><div><b>Access is ready</b><p>No setup decision is waiting right now.</p></div></div>}

    <div className="access-v17-toolbar"><div className="access-v17-tabs" role="tablist" aria-label="Access views"><button type="button" role="tab" aria-selected={view === "needs"} className={view === "needs" ? "active" : ""} onClick={() => setView("needs")}>Needs attention <b>{counts.needs}</b></button><button type="button" role="tab" aria-selected={view === "all"} className={view === "all" ? "active" : ""} onClick={() => setView("all")}>Everyone <b>{counts.all}</b></button></div><div className="access-v17-search"><SearchField value={query} onChange={setQuery} label="Search people" placeholder="Search name, email, responsibility, company or committee" /></div><details className="access-v17-filters"><summary>Filters{statusFilter !== "all" || roleFilter !== "all" ? <b>1</b> : null}</summary><div className="access-v17-filter-popover"><label><span>Access state</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>{STATUS_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>Responsibility</span><select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>{ROLE_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button type="button" className="text-action" onClick={clearFilters} disabled={statusFilter === "all" && roleFilter === "all"}>Clear filters</button></div></details></div>
    <div className="access-v17-meta" aria-label="Access activity summary"><span><i className="online-dot" />{counts.online} online now</span><span>{counts.active} active</span><span>{counts.invited} invite{counts.invited === 1 ? "" : "s"} waiting</span>{counts.disabled ? <span>{counts.disabled} disabled</span> : null}</div>

    <article className="panel access-v17-directory"><header className="access-v17-directory-head"><div><span className="kicker">People</span><h2>{view === "needs" ? "Needs attention" : "Everyone"}</h2><p>{view === "needs" ? "Only people who need a decision or setup step appear here." : "One row per person. Their Staff responsibility controls website scope."}</p></div><strong>{shown.length}</strong></header>
      {preparing ? <div className="access-v18-directory-loading"><span /><span /><span /></div> : shown.length ? <div className="access-v17-list">{shown.map((person) => {
        const key = personKey(person); const rowBusy = busyId === key; const incomplete = person.operationalRole === "assistant_coordinator" && person.staffId && !person.companyIds?.length; const rosterUser = (roster || []).find((user) => sourceUserId(user) === person.userId); const expired = hasExpiredInvite(person, now);
        const primary = person.identityReview && person.userId ? <button className="primary" disabled={!canManage || rowBusy} onClick={() => setIdentityTarget(person)}>Review identity</button> : incomplete ? <button className="primary" disabled={!canManage || rowBusy} onClick={() => setSetupTarget(person)}>Choose companies</button> : person.staffId && person.accessState === "not_enabled" ? <button className="primary" disabled={!canManage || rowBusy} onClick={() => setSetupTarget(person)}>Invite</button> : person.staffId && person.accessState === "disabled" ? <button className="primary" disabled={!canManage || rowBusy} onClick={() => toggleAccess(person, true)}>Enable</button> : (person.unmatchedLegacyInvite || person.legacyRequest) && !person.userId ? <button className="primary" disabled={!canManage || rowBusy || !canAddLeader} onClick={() => startLegacySetup(person)}>Set up access</button> : expired && person.staffId ? <button className="primary" disabled={!canManage || rowBusy} onClick={() => setSetupTarget(person)}>New setup link</button> : null;
        const showMore = Boolean(person.userId || person.inviteId || person.legacyInviteId || person.legacyRequest || person.staffId);
        return <div className={`access-v17-row ${needsAttention(person, now) ? "needs-attention" : ""} ${person.identityReview ? "needs-identity-review" : ""}`} key={key}><div className="access-v17-person"><span className="person-avatar">{initials(person.name)}</span><span><b>{person.name}</b><small>{displayRole(person)}</small>{person.identityReview ? <em>Review needed</em> : null}</span></div><div className="access-v17-scope"><small>{scopeHeading(person)}</small><Scope person={person} /></div><div className="access-v17-state"><Status tone={accessTone(person, now)}>{accessLabel(person, now)}</Status><AccountActivity person={person} onlineUserIds={onlineUserIds} activityByUser={activityByUser} now={now} /></div><div className="access-v17-actions">{primary}{showMore ? <details className="staff-access-more"><summary aria-label={`More actions for ${person.name}`}>More</summary><div>{person.identityReview ? <button disabled={!canManage || rowBusy} onClick={() => setIdentityTarget(person)}>Review identity</button> : null}{person.staffId && person.operationalRole === "assistant_coordinator" && !person.identityReview ? <button disabled={!canManage || rowBusy} onClick={() => setSetupTarget(person)}>Edit companies</button> : null}{person.userId && !person.identityReview ? <button disabled={!canManage || rowBusy} onClick={() => setTeamTarget(rosterUser || { userId: person.userId, name: person.name, teamKeys: person.committeeKeys || [] })}>{person.operationalRole === "committee_viewer" ? "Edit committees" : "Committee access"}</button> : null}{onCreateRecovery && person.userId ? <button disabled={!canManage || rowBusy} onClick={() => recovery(person)}><Key />Recovery</button> : null}{person.staffId && person.accessState === "active" && !person.identityReview ? <button className="danger-text" disabled={!canManage || rowBusy} onClick={() => setConfirmDisable(person)}>Disable sign-in</button> : null}{(person.inviteId || person.legacyInviteId) && !person.userId ? <button className="danger-text" disabled={!canManage || rowBusy} onClick={() => setConfirmRevoke(person)}>Cancel invite</button> : null}{person.legacyRequest ? <button disabled={!canManage || rowBusy} onClick={() => setReviewRequest(person.legacyRequest)}>Review request</button> : null}{person.identityReview && person.userId ? <button className="danger-text" disabled={!canManage || rowBusy} onClick={() => setConfirmRetire(person)}>Remove old access</button> : null}</div></details> : null}</div></div>;
      })}</div> : <Empty title={query ? "No person found" : view === "needs" ? "Nothing needs attention" : "No people in this view"} text={query ? "Try another name, email, responsibility, company or committee." : view === "needs" ? "Everyone shown in Access is ready for the state they are in." : "Clear filters or add access for someone new."} action={!query && view === "all" && canInviteAnyone ? <button type="button" className="primary" onClick={() => setAddOpen(true)}><UserPlus />Add access</button> : null} />}
    </article>

    {addOpen ? <AccessAddFlowV18 staff={directory} canAddLeader={canAddLeader} canInviteCommittee={canInviteCommittee} onClose={() => setAddOpen(false)} onChooseStaff={(person) => { setAddOpen(false); setSetupTarget(person); }} onAddStaff={() => { setAddOpen(false); setSetupTarget({ newPerson: true, newStaffOnly: true }); }} onAddCommittee={() => { setAddOpen(false); setSetupTarget({ newPerson: true, committeeOnly: true }); }} /> : null}
    {setupTarget ? <LeaderSetupFlow sessionId={sessionId} person={setupTarget.newPerson ? null : setupTarget} allowStaffRoles={setupTarget.committeeOnly ? false : canAddLeader} allowCommittee={setupTarget.committeeOnly ? canInviteCommittee : false} requireEmail teams={teams} knownAccounts={setupKnownAccounts} pendingInvites={setupInvites} onCreateCommitteeInvite={onCreateInvite} onClose={() => setSetupTarget(null)} onComplete={async (person) => { if (setupTarget.legacyRequestId && onDecision) await onDecision(setupTarget.legacyRequestId, "rejected", { companyIds: setupTarget.companyIds || [], committeeScope: [] }); if (setupTarget.legacyInviteId && onRevokeInvite) { try { await onRevokeInvite(setupTarget.legacyInviteId); } catch {} } if (person.operationalRole !== "committee_viewer") await refresh(); await onRefreshRoster?.(); setToast({ message: `${person.name} is ready in Access` }); }} /> : null}
    {identityTarget ? <AccessIdentityReviewV18 person={identityTarget} candidates={directory} onClose={() => setIdentityTarget(null)} onResolve={({ staffId }) => resolveIdentity(identityTarget, staffId)} onCreateAndResolve={() => createIdentityAndResolve(identityTarget)} /> : null}
    {teamTarget ? <AccountTeams user={teamTarget} sessionId={sessionId} teams={teams} onClose={() => setTeamTarget(null)} onSaved={async () => { await refresh(); await onRefreshRoster?.(); setToast({ message: `Committee access updated for ${teamTarget.name}` }); }} /> : null}
    {reviewRequest ? <RequestReview request={reviewRequest} onClose={() => setReviewRequest(null)} onDecision={onDecision} onMoveToNew={() => { setReviewRequest(null); startLegacySetup({ legacyRequest: reviewRequest, legacyRequestId: reviewRequest.id, name: reviewRequest.name, email: reviewRequest.email, operationalRole: reviewRequest.role, companyIds: reviewRequest.companyIds || [] }); }} /> : null}
    {recoveryResult ? <DismissibleLayer open onClose={() => setRecoveryResult(null)} title="Recovery code" sheet><div className="headcount-create"><h2>Recovery for {recoveryResult.name}</h2><label>One-time code<input readOnly value={recoveryResult.code} /></label><p>Expires {new Date(recoveryResult.expiresAt).toLocaleString()}. Share only with the account owner.</p><button className="secondary" onClick={() => setRecoveryResult(null)}>Done</button></div></DismissibleLayer> : null}
    {confirmDisable ? <ConfirmActionSheet open title={`Disable ${confirmDisable.name}'s sign-in?`} description="Their FSY assignment stays unchanged." impact="They will not be able to use FSY Ops until website access is enabled again." confirmLabel="Disable sign-in" cancelLabel="Keep enabled" busy={busyId === personKey(confirmDisable)} onClose={() => setConfirmDisable(null)} onConfirm={async () => { if (await toggleAccess(confirmDisable, false)) setConfirmDisable(null); }} /> : null}
    {confirmRevoke ? <ConfirmActionSheet open title={`Cancel ${confirmRevoke.name}'s invite?`} description="The current setup link will stop working." impact={confirmRevoke.staffId ? "Their FSY assignment stays unchanged. You can invite them again from this row." : "No account will be created from this link."} confirmLabel="Cancel invite" cancelLabel="Keep invite" busy={busyId === personKey(confirmRevoke)} onClose={() => setConfirmRevoke(null)} onConfirm={() => revoke(confirmRevoke)} /> : null}
    {confirmRetire ? <ConfirmActionSheet open title={`Remove ${confirmRetire.name}'s old website access?`} description="Use this only when this old sign-in genuinely belongs to a different or obsolete identity." impact="Their old website access and committee memberships for this session will be disabled. A current Staff record is not deleted." confirmLabel="Remove old access" cancelLabel="Keep access" busy={busyId === personKey(confirmRetire)} onClose={() => setConfirmRetire(null)} onConfirm={() => retireLegacy(confirmRetire)} /> : null}
    <ActionToast message={undo?.message || toast?.message} onAction={undo ? undoAccess : null} onDismiss={() => { setUndo(null); setToast(null); }} busy={undoBusy} />
  </section>;
}
