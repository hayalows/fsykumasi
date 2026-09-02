import { useMemo, useRef, useState } from "react";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { Copy } from "@phosphor-icons/react/Copy";
import { Key } from "@phosphor-icons/react/Key";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { X } from "@phosphor-icons/react/X";
import { demoAccessRequests, demoUsers } from "../data/demo.js";
import { canApproveAccess, roleLabel, roleVisibility } from "../lib/access.js";
import { DismissibleLayer, Empty, PageHead, SearchField, Status } from "../components/UI.jsx";
import "./access-review.css";
import "./access-invites.css";

const INVITABLE_ROLES = ["assistant_coordinator", "coordinator", "logistics_admin", "session_director", "committee_viewer"];
const ELEVATED_ROLES = new Set(["logistics_admin", "session_director"]);

export function createInitialAccessRequests() {
  return demoAccessRequests;
}

function scopeForRole(role, companyIds = [], committeeScope = []) {
  if (["coordinator", "logistics_admin", "session_director"].includes(role)) return "Whole session";
  if (role === "assistant_coordinator") return companyIds.length ? `${companyIds.length} assigned companies` : "Assigned companies";
  if (role === "committee_viewer") return committeeScope.length ? committeeScope.join(", ") : "Assigned committee scope";
  return roleVisibility(role);
}

function InviteModal({ companies, live, onClose, onCreate, restoreFocusRef }) {
  const [form, setForm] = useState({ name: "", email: "", role: "assistant_coordinator", committee: "", confirmElevated: false });
  const [companyIds, setCompanyIds] = useState([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const filteredCompanies = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return companies;
    return companies.filter((company) => company.name.toLowerCase().includes(query));
  }, [companies, search]);

  const toggleCompany = (id) => setCompanyIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    const committeeScope = form.committee.split(",").map((item) => item.trim()).filter(Boolean);
    if (form.role === "assistant_coordinator" && companyIds.length === 0) return setError("Select at least one company for this Assistant Coordinator.");
    if (form.role === "committee_viewer" && committeeScope.length === 0) return setError("Add at least one committee area.");
    if (ELEVATED_ROLES.has(form.role) && !form.confirmElevated) return setError("Confirm the elevated access before creating this invite.");

    setBusy(true);
    try {
      const created = live
        ? await onCreate({ email: form.email, displayName: form.name, role: form.role, companyIds, committeeScope })
        : { id: `invite-${Date.now()}`, code: "FSY-DEMO-1234-5678-EF90-1234-5678", expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() };
      onClose({
        ...created,
        email: form.email.trim().toLowerCase(),
        name: form.name.trim(),
        role: form.role,
        scope: scopeForRole(form.role, companyIds, committeeScope),
        kind: "invite",
      });
    } catch (err) {
      setError(err.message || "Unable to create this invite.");
    } finally { setBusy(false); }
  };

  return (
    <DismissibleLayer open onClose={() => onClose(null)} title="Invite a leader" className="access-review-modal" sheet restoreFocusRef={restoreFocusRef}>
      <form className="invite-modal" onSubmit={submit}>
        <button type="button" data-layer-close className="icon-button modal-close" onClick={() => onClose(null)} aria-label="Close invite"><X /></button>
        <span className="kicker">New leader</span>
        <h2>Invite someone to FSY Kumasi</h2>
        <p className="review-summary">Choose the role now. The leader will use a one-time code to create their own password.</p>

        <div className="invite-two-col">
          <label>Full name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Leader name" autoComplete="name" /></label>
          <label>Email address<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="leader@example.org" autoComplete="email" /></label>
        </div>
        <label>Role<select value={form.role} onChange={(event) => { setForm({ ...form, role: event.target.value, confirmElevated: false }); setCompanyIds([]); }}>
          {INVITABLE_ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
        </select></label>

        {form.role === "assistant_coordinator" ? (
          <div className="scope-editor">
            <div className="scope-editor-head"><div><b>Assigned companies</b><small>The AC only sees youth and operations in these companies.</small></div><Status tone={companyIds.length ? "good" : "warn"}>{companyIds.length} selected</Status></div>
            {companies.length ? <>
              <SearchField value={search} onChange={setSearch} label="Search assigned companies" placeholder="Find a company" />
              <div className="company-picker">{filteredCompanies.map((company) => (
                <label key={company.id} className={companyIds.includes(company.id) ? "selected" : ""}>
                  <input type="checkbox" checked={companyIds.includes(company.id)} onChange={() => toggleCompany(company.id)} /><span>{company.name}</span>
                </label>
              ))}</div>
            </> : <div className="form-hint warn">Companies need to exist before an Assistant Coordinator can be invited.</div>}
          </div>
        ) : null}

        {form.role === "committee_viewer" ? <label>Committee scope<input value={form.committee} onChange={(event) => setForm({ ...form, committee: event.target.value })} placeholder="e.g. Food, Housing" /><small className="field-help">Separate multiple areas with commas.</small></label> : null}

        {form.role === "coordinator" ? <div className="notice green compact-notice"><ShieldCheck weight="fill" /><div><b>Whole-session visibility</b><p>Coordinators can see whole-session operations but cannot grant access to others.</p></div></div> : null}

        {ELEVATED_ROLES.has(form.role) ? <label className="elevated-confirm"><input type="checkbox" checked={form.confirmElevated} onChange={(event) => setForm({ ...form, confirmElevated: event.target.checked })} /><span><b>Confirm elevated access</b><small>This role can see the whole session and approve or issue access for other leaders.</small></span></label> : null}

        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <div className="review-actions"><button type="button" className="secondary" onClick={() => onClose(null)}>Cancel</button><button className="primary" disabled={busy || (form.role === "assistant_coordinator" && !companies.length)}>{busy ? "Creating…" : "Create invite"}<UserPlus /></button></div>
      </form>
    </DismissibleLayer>
  );
}

function CodeReadyModal({ payload, onClose }) {
  const [copied, setCopied] = useState("");
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/?invite=${encodeURIComponent(payload.code)}`;
  const expires = payload.expiresAt ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(payload.expiresAt)) : "Soon";
  const copy = async (value, label) => { await navigator.clipboard.writeText(value); setCopied(label); window.setTimeout(() => setCopied(""), 1700); };
  const share = async () => {
    if (navigator.share) await navigator.share({ title: "FSY Kumasi account setup", text: `Use this private link to set up your FSY Kumasi account. It works once and expires.`, url: link });
    else await copy(link, "link");
  };

  return (
    <DismissibleLayer open onClose={onClose} title={payload.kind === "recovery" ? "Recovery code ready" : "Invite ready"} className="invite-ready-modal" sheet>
      <div>
        <button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} aria-label="Close"><X /></button>
        <div className="invite-ready-icon"><CheckCircle weight="fill" /></div>
        <span className="kicker">{payload.kind === "recovery" ? "Recovery ready" : "Invite ready"}</span>
        <h2>{payload.kind === "recovery" ? `Help ${payload.name || "this leader"} reset their password` : `Send this to ${payload.name}`}</h2>
        <p>{payload.kind === "recovery" ? "This short-lived code lets the existing account choose a new password without relying on email delivery." : `${roleLabel(payload.role)} · ${payload.scope}`}</p>
        <div className="invite-code-box"><span>One-time code</span><strong>{payload.code}</strong><small>Expires {expires}</small></div>
        <div className="invite-ready-actions">
          <button className="primary" onClick={() => copy(payload.code, "code")}><Copy />{copied === "code" ? "Copied" : "Copy code"}</button>
          <button className="secondary" onClick={() => copy(link, "link")}><Copy />{copied === "link" ? "Link copied" : "Copy setup link"}</button>
          <button className="secondary" onClick={share}>Share setup link</button>
        </div>
        <div className="form-hint">Share the code or setup link directly with the intended leader. It works once and should not be posted in a group chat.</div>
        <button className="text-action invite-done" onClick={onClose}>Done</button>
      </div>
    </DismissibleLayer>
  );
}

function PendingInvite({ invite, onRevoke, busy }) {
  const scope = scopeForRole(invite.role, invite.company_ids || [], invite.committee_scope || []);
  const expiry = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(invite.expires_at));
  return (
    <div className="pending-invite-row">
      <div className="person-avatar">{(invite.display_name || invite.email).split(/\s|@/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</div>
      <div><b>{invite.display_name || "Invited leader"}</b><small>{invite.email}</small><div className="request-meta"><span>{roleLabel(invite.role)}</span><span>{scope}</span><span>Expires {expiry}</span></div></div>
      <button className="secondary compact-button" disabled={busy} onClick={() => onRevoke(invite.id)}>Revoke</button>
    </div>
  );
}

function rosterScope(user, companies) {
  const role = user.roleKey || user.role;
  if (["coordinator", "logistics_admin", "session_director"].includes(role)) return "Whole session";
  if (role === "assistant_coordinator") {
    const names = (user.companyIds || []).map((id) => companies.find((company) => company.id === id)?.name).filter(Boolean);
    return names.length ? names.join(", ") : `${user.companyIds?.length || 0} assigned companies`;
  }
  if (user.committeeScope?.length) return user.committeeScope.join(", ");
  return user.scope || roleVisibility(role);
}

function rosterRole(user) {
  return user.roleKey || user.role;
}

export function Access({ requests = [], setRequests, invites = [], currentRole = "logistics_admin", currentCapabilities = [], onDecision, onCreateInvite, onRevokeInvite, onCreateRecovery, onSetAdminOverride, roster = demoUsers, companies = [], live = false, sessionName }) {
  const inviteTriggerRef = useRef(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [readyPayload, setReadyPayload] = useState(null);
  const [busyId, setBusyId] = useState("");
  const [pageError, setPageError] = useState("");
  const canManage = canApproveAccess(currentRole, currentCapabilities);
  const canDelegateAdmin = ["logistics_admin", "session_director"].includes(currentRole);
  const pendingLegacy = requests.filter((request) => request.status === "pending");
  const activeRoster = roster.filter((user) => user.active !== false && user.status !== "Pending");

  const finishInvite = (payload) => {
    setInviteOpen(false);
    if (payload) setReadyPayload(payload);
  };

  const revoke = async (id) => {
    setBusyId(id); setPageError("");
    try { if (onRevokeInvite) await onRevokeInvite(id); }
    catch (error) { setPageError(error.message || "Unable to revoke this invite."); }
    finally { setBusyId(""); }
  };

  const rejectLegacy = async (request) => {
    setBusyId(request.id); setPageError("");
    try {
      if (onDecision) await onDecision(request.id, "rejected", { note: "Replaced by administrator-issued invite flow." });
      else setRequests?.((current) => current.map((item) => item.id === request.id ? { ...item, status: "rejected" } : item));
    } catch (error) { setPageError(error.message || "Unable to close the old request."); }
    finally { setBusyId(""); }
  };

  const recovery = async (user) => {
    setBusyId(user.userId || user.id); setPageError("");
    try {
      if (!onCreateRecovery) return;
      const created = await onCreateRecovery(user.userId || user.id);
      setReadyPayload({ ...created, email: user.email, name: user.name, role: rosterRole(user), scope: rosterScope(user, companies), kind: "recovery" });
    } catch (error) { setPageError(error.message || "Unable to create a recovery code."); }
    finally { setBusyId(""); }
  };
  const toggleAdmin = async (user) => {
    const role = rosterRole(user);
    if (role !== "coordinator") return;
    const enabled = !(user.capabilities || []).includes("access_admin");
    const wording = enabled ? "grant" : "revoke";
    if (!window.confirm(`${wording === "grant" ? "Grant" : "Revoke"} full administrative access for ${user.name}? Their displayed role will remain Coordinator, and this change will be recorded in the audit history.`)) return;
    setBusyId(user.id); setPageError("");
    try { await onSetAdminOverride?.(user.id, enabled); }
    catch (error) { setPageError(error.message || `Unable to ${wording} administrative access.`); }
    finally { setBusyId(""); }
  };

  return (
    <section className="page access-page">
      <PageHead title="Access" sessionName={sessionName} description="Invite leaders and keep access scoped to the work they need." action={canManage ? <button ref={inviteTriggerRef} className="primary" onClick={() => setInviteOpen(true)}><UserPlus />Invite leader</button> : null} />

      <div className="notice green compact-notice access-rule-note"><ShieldCheck weight="fill"/><div><b>Everyone signs in with their own password.</b><p>Roles and scope decide what each leader can see or change.</p></div></div>
      {pageError ? <div className="form-error page-error" role="alert">{pageError}</div> : null}

      <div className="access-layout invite-access-layout">
        <article className="panel approval-panel">
          <div className="panel-head"><div><span className="kicker">Waiting to activate</span><h2>{invites.length} open invite{invites.length === 1 ? "" : "s"}</h2></div><span className="count">{invites.length}</span></div>
          <div className="request-list">
            {invites.length ? invites.map((invite) => <PendingInvite key={invite.id} invite={invite} onRevoke={revoke} busy={busyId === invite.id} />) : <Empty icon={UserPlus} title="No open invites" text="Invite a leader when you are ready to give them access." />}
          </div>
        </article>

        <details className="panel progressive-section role-panel access-role-disclosure">
          <summary><span><span className="kicker">Permission model</span><b>What each role sees</b><small>Open for the full role matrix</small></span><CaretDown size={20} className="disclosure-icon" /></summary>
          <div className="progressive-section-body"><div className="role-matrix">
            <div><b>Assistant coordinator</b><span>Assigned companies</span><small>No access approval</small></div>
            <div><b>Coordinator</b><span>Whole session</span><small>No access approval</small></div>
            <div><b>Logistical administrator</b><span>Whole session</span><small>Manage access</small></div>
            <div><b>Session directing couple</b><span>Whole session</span><small>Manage access</small></div>
            <div><b>Committee viewer</b><span>Assigned committee scope</span><small>Read-only by design</small></div>
          </div></div>
        </details>
      </div>

      <article className="panel access-roster-panel">
        <div className="panel-head"><div><span className="kicker">Current access</span><h2>Authorized leaders</h2></div><Status>{activeRoster.length} active</Status></div>
        <div className="access-roster-list">{roster.map((user) => {
          const role = rosterRole(user);
          const isActive = user.active !== false && user.status !== "Pending";
          const hasAdminOverride = (user.capabilities || []).includes("access_admin");
          return <details className="access-roster-row" key={user.id || user.userId || user.email}>
            <summary><span className="roster-person"><b>{user.name}</b><small>{roleLabel(role)}</small></span><Status tone={isActive ? "good" : "warn"}>{isActive ? "Active" : "Pending"}</Status><CaretDown size={18} className="disclosure-icon" /></summary>
            <div className="access-roster-detail"><div><span>Email</span><b>{user.email || "Not available"}</b></div><div><span>Visibility</span><b>{rosterScope(user, companies)}</b></div><div><span>Administrative access</span><span>{role === "coordinator" ? <>{hasAdminOverride ? <Status tone="warn">Full admin override</Status> : <Status>Standard coordinator</Status>}{canDelegateAdmin && live ? <button className="table-link admin-toggle" disabled={busyId === user.id} onClick={() => toggleAdmin(user)}>{hasAdminOverride ? "Revoke admin" : "Grant admin"}</button> : null}</> : <span className="muted-cell">Role-defined</span>}</span></div><div><span>Account help</span><span>{canManage && live && user.userId ? <button className="table-link" disabled={busyId === user.userId} onClick={() => recovery(user)}><Key />Recovery code</button> : <Status tone="good">Available</Status>}</span></div></div>
          </details>;
        })}</div>
      </article>

      {pendingLegacy.length ? <details className="panel progressive-section legacy-request-panel"><summary><span><span className="kicker">Older flow</span><b>{pendingLegacy.length} previous access request{pendingLegacy.length === 1 ? "" : "s"}</b><small>Created before administrator-issued invites</small></span><CaretDown size={20} className="disclosure-icon" /></summary><div className="progressive-section-body"><p>Close these requests after moving the person to the named invite flow.</p><div className="request-list">{pendingLegacy.map((request) => <div className="legacy-request-row" key={request.id}><div><b>{request.name}</b><small>{request.email} · {roleLabel(request.role)}</small></div>{canManage ? <button className="secondary compact-button" disabled={busyId === request.id} onClick={() => rejectLegacy(request)}>Close request</button> : null}</div>)}</div></div></details> : null}

      {inviteOpen ? <InviteModal companies={companies} live={live} onCreate={onCreateInvite} onClose={finishInvite} restoreFocusRef={inviteTriggerRef} /> : null}
      {readyPayload ? <CodeReadyModal payload={readyPayload} onClose={() => setReadyPayload(null)} /> : null}
    </section>
  );
}

