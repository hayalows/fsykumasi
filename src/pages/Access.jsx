import { useMemo, useState } from "react";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Copy } from "@phosphor-icons/react/Copy";
import { Key } from "@phosphor-icons/react/Key";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { X } from "@phosphor-icons/react/X";
import { demoAccessRequests, demoUsers } from "../data/demo.js";
import { canApproveAccess, roleLabel, roleVisibility } from "../lib/access.js";
import { Empty, PageHead, Status } from "../components/UI.jsx";
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

function InviteModal({ companies, live, onClose, onCreate }) {
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
    <div className="modal-backdrop">
      <form className="modal access-review-modal invite-modal" onSubmit={submit}>
        <button type="button" className="icon-button modal-close" onClick={() => onClose(null)} aria-label="Close"><X /></button>
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
              <div className="company-search"><MagnifyingGlass /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a company" /></div>
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
    </div>
  );
}

function CodeReadyModal({ payload, onClose }) {
  const [copied, setCopied] = useState("");
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/?invite=${encodeURIComponent(payload.code)}`;
  const expires = payload.expiresAt ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(payload.expiresAt)) : "Soon";
  const copy = async (value, label) => { await navigator.clipboard.writeText(value); setCopied(label); window.setTimeout(() => setCopied(""), 1700); };

  return (
    <div className="modal-backdrop">
      <div className="modal invite-ready-modal">
        <button type="button" className="icon-button modal-close" onClick={onClose}><X /></button>
        <div className="invite-ready-icon"><CheckCircle weight="fill" /></div>
        <span className="kicker">{payload.kind === "recovery" ? "Recovery ready" : "Invite ready"}</span>
        <h2>{payload.kind === "recovery" ? `Help ${payload.name || "this leader"} reset their password` : `Send this to ${payload.name}`}</h2>
        <p>{payload.kind === "recovery" ? "This short-lived code lets the existing account choose a new password without relying on email delivery." : `${roleLabel(payload.role)} · ${payload.scope}`}</p>
        <div className="invite-code-box"><span>One-time code</span><strong>{payload.code}</strong><small>Expires {expires}</small></div>
        <div className="invite-ready-actions">
          <button className="primary" onClick={() => copy(payload.code, "code")}><Copy />{copied === "code" ? "Copied" : "Copy code"}</button>
          <button className="secondary" onClick={() => copy(link, "link")}><Copy />{copied === "link" ? "Link copied" : "Copy setup link"}</button>
        </div>
        <div className="form-hint">Share the code or setup link directly with the intended leader. It works once and should not be posted in a group chat.</div>
        <button className="text-action invite-done" onClick={onClose}>Done</button>
      </div>
    </div>
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
  if (["coordinator", "logistics_admin", "session_director"].includes(user.role)) return "Whole session";
  if (user.role === "assistant_coordinator") {
    const names = (user.companyIds || []).map((id) => companies.find((company) => company.id === id)?.name).filter(Boolean);
    return names.length ? names.join(", ") : `${user.companyIds?.length || 0} assigned companies`;
  }
  if (user.committeeScope?.length) return user.committeeScope.join(", ");
  return roleVisibility(user.role);
}

export function Access({ requests = [], setRequests, invites = [], currentRole = "logistics_admin", onDecision, onCreateInvite, onRevokeInvite, onCreateRecovery, roster = demoUsers, companies = [], live = false }) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [readyPayload, setReadyPayload] = useState(null);
  const [busyId, setBusyId] = useState("");
  const [pageError, setPageError] = useState("");
  const canManage = canApproveAccess(currentRole);
  const pendingLegacy = requests.filter((request) => request.status === "pending");

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
      const created = await onCreateRecovery(user.userId);
      setReadyPayload({ ...created, email: user.email, name: user.name, role: user.role, scope: rosterScope(user, companies), kind: "recovery" });
    } catch (error) { setPageError(error.message || "Unable to create a recovery code."); }
    finally { setBusyId(""); }
  };

  return (
    <section className="page">
      <PageHead title="People & access" description="Invite the right people, assign their role once, and let them create their own password. No shared account passwords and no repeated sign-in emails." action={canManage ? <button className="primary" onClick={() => setInviteOpen(true)}><UserPlus />Invite leader</button> : null} />

      <div className="notice green"><ShieldCheck weight="fill"/><div><b>Simple rule: identity first, permissions second</b><p>Each leader signs in with their own email and password. Their role controls what they can see. Only logistical administrators and the session directing couple can issue or revoke access.</p></div></div>
      {pageError ? <div className="form-error page-error" role="alert">{pageError}</div> : null}

      <div className="access-layout invite-access-layout">
        <article className="panel approval-panel">
          <div className="panel-head"><div><span className="kicker">Waiting to activate</span><h2>{invites.length} open invite{invites.length === 1 ? "" : "s"}</h2></div><span className="count">{invites.length}</span></div>
          <div className="request-list">
            {invites.length ? invites.map((invite) => <PendingInvite key={invite.id} invite={invite} onRevoke={revoke} busy={busyId === invite.id} />) : <Empty icon={UserPlus} title="No open invites" text="Invite a leader when you are ready to give them access." />}
          </div>
        </article>

        <article className="panel role-panel">
          <div className="panel-head"><div><span className="kicker">Permission model</span><h2>What each role sees</h2></div></div>
          <div className="role-matrix">
            <div><b>Assistant coordinator</b><span>Assigned companies</span><small>No access approval</small></div>
            <div><b>Coordinator</b><span>Whole session</span><small>No access approval</small></div>
            <div><b>Logistical administrator</b><span>Whole session</span><small>Manage access</small></div>
            <div><b>Session directing couple</b><span>Whole session</span><small>Manage access</small></div>
            <div><b>Committee viewer</b><span>Assigned committee scope</span><small>Read-only by design</small></div>
          </div>
        </article>
      </div>

      <article className="panel">
        <div className="panel-head"><div><span className="kicker">Current access</span><h2>Authorized leaders</h2></div><Status>{roster.filter((user) => user.active !== false).length} active</Status></div>
        <div className="table-wrap"><table><thead><tr><th>Leader</th><th>Role</th><th>Visibility</th><th>Account help</th></tr></thead><tbody>{roster.map((user) => <tr key={user.id || user.userId || user.email}><td><b>{user.name}</b><small className="cell-sub">{user.email}</small></td><td>{roleLabel(user.role)}</td><td>{rosterScope(user, companies)}</td><td>{canManage && live && user.userId ? <button className="table-link" disabled={busyId === user.userId} onClick={() => recovery(user)}><Key />Recovery code</button> : <Status tone="good">Active</Status>}</td></tr>)}</tbody></table></div>
      </article>

      {pendingLegacy.length ? <article className="panel legacy-request-panel"><div className="panel-head"><div><span className="kicker">Older flow</span><h2>Previous access requests</h2></div><Status tone="warn">{pendingLegacy.length} pending</Status></div><p>These were created by the earlier shared session-code flow. The new invite flow is clearer because the role is assigned before account activation.</p><div className="request-list">{pendingLegacy.map((request) => <div className="legacy-request-row" key={request.id}><div><b>{request.name}</b><small>{request.email} · {roleLabel(request.role)}</small></div>{canManage ? <button className="secondary compact-button" disabled={busyId === request.id} onClick={() => rejectLegacy(request)}>Close request</button> : null}</div>)}</div></article> : null}

      {inviteOpen ? <InviteModal companies={companies} live={live} onCreate={onCreateInvite} onClose={finishInvite} /> : null}
      {readyPayload ? <CodeReadyModal payload={readyPayload} onClose={() => setReadyPayload(null)} /> : null}
    </section>
  );
}
