import { useEffect, useMemo, useState } from "react";
import { Key } from "@phosphor-icons/react/Key";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { AccountTeams } from "../components/AccountSetup.jsx";
import { CommitteeAccessSetup } from "../components/CommitteeAccessSetup.jsx";
import { LeaderSetupFlow } from "../components/LeaderSetupFlow.jsx";
import { ActionToast, ConfirmActionSheet, DismissibleLayer, Empty, MutationFeedback, PageHead, SearchField, Status } from "../components/UI.jsx";
import { canApproveAccess, roleLabel } from "../lib/access.js";
import { demoAccessRequests, demoUsers } from "../data/demo.js";
import { accessStateLabel, loadSessionAccountActivity, loadStaffAccessDirectory, resolveCurrentAccessSessionId, setStaffWebsiteAccess, staffRoleLabel } from "../lib/staff-access.js";
import { subscribeSessionPresence } from "../lib/presence.js";
import "./staff-access.css";

const STAFF_LINKED_ROLES = new Set(["assistant_coordinator", "coordinator", "logistics_admin", "session_director"]);
const FILTERS = [["needs", "Needs setup"], ["invited", "Invited"], ["active", "Active"], ["disabled", "Disabled"], ["all", "All"]];

function initials(name = "FSY") { return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase(); }
function needsSetup(person) { return person.accessState === "not_enabled" || (person.operationalRole === "assistant_coordinator" && !person.companyIds?.length); }
function demoDirectory() { return demoUsers.filter((user) => STAFF_LINKED_ROLES.has(user.roleKey)).map((user, index) => ({ staffId: `demo-staff-${index + 1}`, name: user.name, operationalRole: user.roleKey, email: user.email, companyIds: user.roleKey === "assistant_coordinator" ? ["demo-1", "demo-2"] : [], companyNames: user.roleKey === "assistant_coordinator" ? ["Company 01", "Company 02"] : [], userId: `demo-user-${index + 1}`, accountEmail: user.email, accessEnabled: user.status === "Active", accessState: user.status === "Active" ? "active" : "not_enabled" })); }
function formatRelative(value) { if (!value) return "Never signed in"; const ms = Date.now() - new Date(value).getTime(); if (!Number.isFinite(ms)) return "Sign-in time unavailable"; const minutes = Math.max(0, Math.floor(ms / 60000)); if (minutes < 1) return "Signed in just now"; if (minutes < 60) return `Last signed in ${minutes}m ago`; const hours = Math.floor(minutes / 60); if (hours < 24) return `Last signed in ${hours}h ago`; const days = Math.floor(hours / 24); return days < 7 ? `Last signed in ${days}d ago` : `Last signed in ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value))}`; }
function AccountActivity({ person, onlineUserIds, activityByUser }) { if (!person.userId) return <span className="account-activity waiting">{person.accessState === "invited" ? "Waiting for setup" : "No account yet"}</span>; if (onlineUserIds.has(person.userId)) return <span className="account-activity online"><i />Online now</span>; return <span className="account-activity">{formatRelative(activityByUser.get(person.userId)?.lastSignInAt)}</span>; }
function Scope({ person }) { if (person.operationalRole !== "assistant_coordinator") return <span className="staff-access-whole-session">Whole session</span>; if (!person.companyNames?.length) return <span className="company-chip-empty"><WarningCircle />Choose companies</span>; return <span className="access-v3-scope">{person.companyNames.join(" · ")}</span>; }

function RequestReview({ request, onClose, onDecision }) {
  const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  const decide = async (status) => { setBusy(status); setError(""); try { await onDecision?.(request.id, status, { companyIds: request.companyIds || [], committeeScope: request.committeeScope || [] }); onClose(); } catch (err) { setError(err.message || "This request could not be reviewed."); } finally { setBusy(""); } };
  return <DismissibleLayer open onClose={onClose} title="Review older access request" sheet><div className="field-sheet access-v3-review"><button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} aria-label="Close"><X /></button><span className="kicker">Older request</span><h2>{request.name}</h2><p>{request.email} · {roleLabel(request.role)}</p><div className="notice compact-notice"><WarningCircle /><div><b>Legacy access request</b><p>Review only if this request is still needed.</p></div></div>{error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}<div className="field-sheet-actions"><button className="secondary" disabled={Boolean(busy)} onClick={() => decide("rejected")}>{busy === "rejected" ? "Rejecting…" : "Reject"}</button><button className="primary" disabled={Boolean(busy)} onClick={() => decide("approved")}>{busy === "approved" ? "Approving…" : "Approve"}</button></div></div></DismissibleLayer>;
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
  const [committeeInvite, setCommitteeInvite] = useState(null);
  const [reviewRequest, setReviewRequest] = useState(null);
  const [recoveryResult, setRecoveryResult] = useState(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDisable, setConfirmDisable] = useState(null);
  const [confirmRevoke, setConfirmRevoke] = useState(null);
  const [undo, setUndo] = useState(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const canManage = canApproveAccess(currentRole, currentCapabilities);
  const canAddLeader = canManage && currentCapabilities.includes("staff_manage");

  const refresh = async (knownSessionId = sessionId) => {
    if (!live) return directory;
    const resolved = knownSessionId || await resolveCurrentAccessSessionId();
    if (!sessionId) setSessionId(resolved);
    const [nextDirectory, nextActivity] = await Promise.all([loadStaffAccessDirectory(resolved), loadSessionAccountActivity(resolved)]);
    setDirectory(nextDirectory.filter((person) => STAFF_LINKED_ROLES.has(person.operationalRole)));
    setActivityByUser(nextActivity);
    return nextDirectory;
  };

  useEffect(() => { if (!live) return; (requestedSessionId ? Promise.resolve(requestedSessionId) : resolveCurrentAccessSessionId()).then((id) => { setSessionId(id); return refresh(id); }).catch((err) => setError(err.message || "Website access could not be loaded.")); }, [live, requestedSessionId]);
  useEffect(() => live && sessionId ? subscribeSessionPresence(sessionId, setOnlineUserIds) : undefined, [live, sessionId]);

  useEffect(() => { if (FILTERS.some(([key]) => key === initialFilter)) setFilter(initialFilter); }, [initialFilter]);

  const counts = useMemo(() => ({ needs: directory.filter(needsSetup).length, invited: directory.filter((item) => item.accessState === "invited").length, active: directory.filter((item) => item.accessState === "active").length, disabled: directory.filter((item) => item.accessState === "disabled").length, all: directory.length }), [directory]);
  const shown = useMemo(() => { const text = query.trim().toLowerCase(); return directory.filter((item) => (filter === "all" || (filter === "needs" ? needsSetup(item) : item.accessState === filter)) && (!text || `${item.name} ${item.email} ${item.accountEmail} ${staffRoleLabel(item.operationalRole)} ${(item.companyNames || []).join(" ")}`.toLowerCase().includes(text))); }, [directory, filter, query]);
  const linkedUsers = new Set(directory.map((item) => item.userId).filter(Boolean));
  const independent = (roster || []).filter((user) => user.active !== false && user.status !== "Pending" && !linkedUsers.has(user.userId || user.id));
  const pendingRequests = requests.filter((request) => request.status === "pending");
  const independentInvites = invites.filter((invite) => !invite.staff_id && invite.status === "pending");

  const toggleAccess = async (person, enabled, { offerUndo = true } = {}) => {
    if (!live) { setDirectory((current) => current.map((item) => item.staffId === person.staffId ? { ...item, accessState: enabled ? "active" : "disabled", accessEnabled: enabled } : item)); if (offerUndo) setUndo({ person, enabled: !enabled, message: `${person.name}'s sign-in was ${enabled ? "enabled" : "disabled"}.` }); return true; }
    setBusyId(person.staffId); setError(""); setNotice("");
    try { await setStaffWebsiteAccess(person.staffId, enabled); await refresh(); if (offerUndo) setUndo({ person, enabled: !enabled, message: `${person.name}'s sign-in was ${enabled ? "enabled" : "disabled"}.` }); return true; }
    catch (err) { setError(err.message || "Website access could not be changed."); return false; }
    finally { setBusyId(""); }
  };
  const undoAccess = async () => { if (!undo?.person) return; setUndoBusy(true); try { await toggleAccess(undo.person, undo.enabled, { offerUndo: false }); setUndo(null); } finally { setUndoBusy(false); } };
  const recovery = async (person) => { if (!person.userId || !onCreateRecovery) return; setBusyId(person.staffId); setError(""); try { const created = await onCreateRecovery(person.userId); if (created?.code) setRecoveryResult({ ...created, name: person.name }); else setNotice(`Recovery access was prepared for ${person.name}.`); } catch (err) { setError(err.message || "Recovery access could not be prepared."); } finally { setBusyId(""); } };
  const revoke = async (person) => { if (!person.inviteId || !onRevokeInvite) return; setBusyId(person.staffId); setError(""); try { await onRevokeInvite(person.inviteId); await refresh(); setNotice(`${person.name}'s pending invite was revoked.`); } catch (err) { setError(err.message || "Invite could not be revoked."); } finally { setBusyId(""); setConfirmRevoke(null); } };

  return <section className="page access-v4">
    <PageHead title="Access" sessionName={sessionName} description="Set up sign-in, recover accounts, and finish a leader without leaving this page." action={canAddLeader ? <button className="primary" onClick={() => setSetupTarget({ newLeader: true })}><UserPlus />Add & set up leader</button> : null} />
    {!canManage ? <div className="notice"><WarningCircle /><div><b>View only</b><p>A whole-session administrator is required to change website access.</p></div></div> : null}
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
    {notice ? <MutationFeedback>{notice}</MutationFeedback> : null}

    <div className="access-v4-summary" aria-label="Access summary"><button type="button" className={filter === "needs" ? "active" : ""} onClick={() => setFilter("needs")}><b>{counts.needs}</b><span>Need setup</span></button><button type="button" className={filter === "invited" ? "active" : ""} onClick={() => setFilter("invited")}><b>{counts.invited}</b><span>Invited</span></button><button type="button" className={filter === "active" ? "active" : ""} onClick={() => setFilter("active")}><b>{counts.active}</b><span>Active</span></button></div>

    <div className="access-v4-tools"><SearchField value={query} onChange={setQuery} label="Search leaders" placeholder="Name, email, role or company" /><div className="access-v4-filters" role="group" aria-label="Filter access">{FILTERS.map(([key, label]) => <button type="button" key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{label}{counts[key] ? <b>{counts[key]}</b> : null}</button>)}</div></div>

    <article className="panel access-v4-directory">
      <header className="access-v4-directory-head"><div><span className="kicker">Leaders</span><h2>{FILTERS.find(([key]) => key === filter)?.[1]}</h2></div><p>{shown.length} {shown.length === 1 ? "person" : "people"}</p></header>
      {shown.length ? <div className="access-v4-list">{shown.map((person) => {
        const incomplete = person.operationalRole === "assistant_coordinator" && !person.companyIds?.length;
        const rowBusy = busyId === person.staffId;
        const rosterUser = roster.find((user) => (user.userId || user.user_id || user.id) === person.userId);
        return <div className={`access-v4-row ${incomplete ? "needs-setup" : ""}`} key={person.staffId}>
          <div className="access-v4-person"><span className="person-avatar">{initials(person.name)}</span><span><b>{person.name}</b><small>{staffRoleLabel(person.operationalRole)}</small></span></div>
          <div className="access-v4-scope"><small>Assignment</small><Scope person={person} /></div>
          <div className="access-v4-state"><Status tone={person.accessState === "active" ? "good" : person.accessState === "invited" ? "warn" : incomplete ? "warn" : "neutral"}>{incomplete ? "Setup incomplete" : accessStateLabel(person.accessState)}</Status><AccountActivity person={person} onlineUserIds={onlineUserIds} activityByUser={activityByUser} /></div>
          <div className="access-v4-actions">
            {(incomplete || person.accessState === "not_enabled" || person.accessState === "invited") ? <button className={person.accessState === "not_enabled" && !incomplete ? "primary" : "secondary"} disabled={!canManage || rowBusy} onClick={() => setSetupTarget(person)}>{incomplete ? "Finish setup" : person.accessState === "invited" ? "New setup link" : "Give access"}</button> : null}
            {person.accessState === "disabled" ? <button className="primary" disabled={!canManage || rowBusy} onClick={() => toggleAccess(person, true)}>Enable</button> : null}
            {person.accessState === "active" ? <details className="staff-access-more"><summary>More</summary><div>{person.userId ? <button disabled={!canManage || rowBusy} onClick={() => setTeamTarget(rosterUser || { userId: person.userId, name: person.name, teamKeys: [] })}>Committee tools</button> : null}{onCreateRecovery ? <button disabled={!canManage || rowBusy} onClick={() => recovery(person)}><Key />Recovery</button> : null}<button className="danger-text" disabled={!canManage || rowBusy} onClick={() => setConfirmDisable(person)}>Disable sign-in</button></div></details> : person.accessState === "invited" ? <details className="staff-access-more"><summary>More</summary><div><button className="danger-text" disabled={!canManage || rowBusy} onClick={() => setConfirmRevoke(person)}>Revoke invite</button></div></details> : null}
          </div>
        </div>;
      })}</div> : <Empty title={query ? "No leader found" : filter === "needs" ? "No setup work waiting" : "Nothing in this view"} text={query ? "Try another name, email, role or company." : filter === "needs" ? "Everyone who needs website access is ready or already active." : "Choose another access state."} action={!query && filter === "needs" && canAddLeader ? <button type="button" className="primary" onClick={() => setSetupTarget({ newLeader: true })}><UserPlus />Add & set up leader</button> : null} />}
    </article>

    {(independent.length || independentInvites.length || pendingRequests.length || onCreateInvite) ? <details className="panel access-v3-committee"><summary><span><b>Committee & older accounts</b><small>Website-only committee access and legacy requests</small></span></summary><div className="access-v3-committee-body">{onCreateInvite ? <div className="access-v3-committee-callout"><div><b>Committee-only website access</b><p>Use this only when someone needs committee tools without a staff-linked leader role.</p></div><button className="secondary" type="button" onClick={() => setCommitteeInvite({})}><UserPlus />Invite committee member</button></div> : null}{independent.map((user) => <div className="legacy-access-row" key={user.id || user.userId || user.email}><span><b>{user.name}</b><small>{roleLabel(user.role || user.roleKey)} · {user.email}</small></span>{onCreateRecovery && (user.userId || user.user_id) ? <button className="secondary" onClick={() => recovery({ userId: user.userId || user.user_id, name: user.name, staffId: user.userId || user.user_id })}><Key />Recovery</button> : null}</div>)}{independentInvites.map((invite) => <div className="legacy-access-row" key={invite.id}><span><b>{invite.display_name || invite.email}</b><small>Setup pending · {roleLabel(invite.role)}</small></span><button className="secondary" onClick={() => onRevokeInvite?.(invite.id)}>Revoke</button></div>)}{pendingRequests.map((request) => <div className="legacy-access-row" key={request.id}><span><b>{request.name}</b><small>Older request · {roleLabel(request.role)}</small></span><button className="secondary" onClick={() => setReviewRequest(request)}>Review</button></div>)}</div></details> : null}

    {setupTarget ? <LeaderSetupFlow sessionId={sessionId} person={setupTarget.newLeader ? null : setupTarget} onClose={() => setSetupTarget(null)} onComplete={async (person) => { await refresh(); await onRefreshRoster?.(); setNotice(`${person.name}'s leader setup is complete.`); }} /> : null}
    {teamTarget ? <AccountTeams user={teamTarget} sessionId={sessionId} teams={teams} onClose={() => setTeamTarget(null)} onSaved={async () => { await refresh(); await onRefreshRoster?.(); }} /> : null}
    {committeeInvite ? <CommitteeAccessSetup teams={teams} onCreate={onCreateInvite} onClose={() => setCommitteeInvite(null)} /> : null}
    {reviewRequest ? <RequestReview request={reviewRequest} onClose={() => setReviewRequest(null)} onDecision={onDecision} /> : null}
    {recoveryResult ? <DismissibleLayer open onClose={() => setRecoveryResult(null)} title="Recovery code" sheet><div className="headcount-create"><h2>Recovery for {recoveryResult.name}</h2><label>One-time code<input readOnly value={recoveryResult.code} /></label><p>Expires {new Date(recoveryResult.expiresAt).toLocaleString()}. Share only with the account owner.</p><button className="secondary" onClick={() => setRecoveryResult(null)}>Done</button></div></DismissibleLayer> : null}
    {confirmDisable ? <ConfirmActionSheet open title={`Disable ${confirmDisable.name}'s sign-in?`} description="Their FSY assignment stays unchanged." impact="They will not be able to use FSY Ops until website access is enabled again." confirmLabel="Disable sign-in" cancelLabel="Keep enabled" busy={busyId === confirmDisable.staffId} onClose={() => setConfirmDisable(null)} onConfirm={async () => { if (await toggleAccess(confirmDisable, false)) setConfirmDisable(null); }} /> : null}
    {confirmRevoke ? <ConfirmActionSheet open title={`Revoke ${confirmRevoke.name}'s setup link?`} description="The current invitation will stop working." impact="Their FSY assignment stays unchanged. You can create a new setup link from this same row later." confirmLabel="Revoke invite" cancelLabel="Keep invite" busy={busyId === confirmRevoke.staffId} onClose={() => setConfirmRevoke(null)} onConfirm={() => revoke(confirmRevoke)} /> : null}
    <ActionToast message={undo?.message} onAction={undo ? undoAccess : null} onDismiss={() => setUndo(null)} busy={undoBusy} />
  </section>;
}
