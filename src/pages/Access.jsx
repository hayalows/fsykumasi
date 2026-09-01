import { useMemo, useState } from "react";
import { Check } from "@phosphor-icons/react/Check";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Copy } from "@phosphor-icons/react/Copy";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { X } from "@phosphor-icons/react/X";
import { demoAccessRequests, demoUsers } from "../data/demo.js";
import { canApproveAccess, REQUESTABLE_ROLES, roleLabel, roleVisibility } from "../lib/access.js";
import { Empty, PageHead, Status } from "../components/UI.jsx";

function AccessRequest({ request, onDecision, canReview, processing }) {
  return (
    <div className="access-request">
      <div className="person-avatar">{request.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</div>
      <div className="access-request-main">
        <b>{request.name}</b>
        <small>{request.email}</small>
        <div className="request-meta"><span>{roleLabel(request.role)}</span><span>{request.scope}</span><span>{request.requested}</span></div>
      </div>
      {request.status === "pending" && canReview ? (
        <div className="decision-actions">
          <button className="approve" disabled={processing} onClick={() => onDecision(request.id, "approved")}><Check />Approve</button>
          <button className="reject" disabled={processing} onClick={() => onDecision(request.id, "rejected")}><X />Reject</button>
        </div>
      ) : <Status tone={request.status === "approved" ? "good" : request.status === "rejected" ? "danger" : "warn"}>{request.status}</Status>}
    </div>
  );
}

function scopeForRoster(user) {
  if (user.scope) return user.scope;
  if (["coordinator", "logistics_admin", "session_director"].includes(user.role)) return "Whole session";
  if (user.role === "assistant_coordinator") return user.companyIds?.length ? `${user.companyIds.length} assigned companies` : "Scope to assign";
  if (user.committeeScope?.length) return user.committeeScope.join(", ");
  return roleVisibility(user.role);
}

export function Access({
  requests,
  setRequests,
  currentRole = "logistics_admin",
  onDecision,
  roster = demoUsers,
  sessionAccessCode,
  live = false,
}) {
  const [show, setShow] = useState(false);
  const [created, setCreated] = useState(false);
  const [processing, setProcessing] = useState("");
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "assistant_coordinator", scope: "" });
  const canReview = canApproveAccess(currentRole);
  const pending = useMemo(() => requests.filter((request) => request.status === "pending"), [requests]);

  const decide = async (id, status) => {
    setProcessing(id);
    try {
      if (onDecision) await onDecision(id, status);
      setRequests((current) => current.map((request) => request.id === id ? { ...request, status } : request));
    } finally {
      setProcessing("");
    }
  };

  const createRequest = (event) => {
    event.preventDefault();
    setRequests((current) => [{
      id: `req-${Date.now()}`,
      ...form,
      scope: form.role === "coordinator" ? "Whole session" : form.scope || roleVisibility(form.role),
      requested: "Just now",
      status: "pending",
    }, ...current]);
    setCreated(true);
  };

  const copyCode = async () => {
    if (!sessionAccessCode) return;
    await navigator.clipboard.writeText(sessionAccessCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const action = live && sessionAccessCode && canReview
    ? <button className="primary" onClick={copyCode}><Copy />{copied ? "Access code copied" : "Copy session access code"}</button>
    : !live
      ? <button className="primary" onClick={() => { setCreated(false); setShow(true); }}><UserPlus />New access request</button>
      : null;

  return (
    <section className="page">
      <PageHead title="People & access" description="Access is role-based, scope-aware and approval-controlled. Visibility can be broad without giving everyone the same authority." action={action} />

      <div className="notice green"><ShieldCheck weight="fill"/><div><b>Access follows responsibility</b><p>Coordinators, logistical administrators and the session directing couple have whole-session operational visibility. Only logistical administrators and session directors can approve or reject access requests for lower roles.</p></div></div>

      {live && canReview && sessionAccessCode ? <div className="access-code-strip"><span>Session access code</span><b>{sessionAccessCode}</b><small>Share only with leaders who need to request access. It does not expose participant data by itself.</small></div> : null}

      <div className="access-layout">
        <article className="panel approval-panel">
          <div className="panel-head"><div><span className="kicker">Approval queue</span><h2>{pending.length} waiting for review</h2></div><span className="count">{pending.length}</span></div>
          <div className="request-list">
            {requests.length ? requests.map((request) => <AccessRequest key={request.id} request={request} onDecision={decide} canReview={canReview} processing={processing === request.id} />) : <Empty icon={ShieldCheck} title="No access requests" text="New requests will appear here for review." />}
          </div>
        </article>

        <article className="panel role-panel">
          <div className="panel-head"><div><span className="kicker">Permission model</span><h2>Who sees what</h2></div></div>
          <div className="role-matrix">
            <div><b>Assistant coordinator</b><span>Assigned companies</span><small>No access approval</small></div>
            <div><b>Coordinator</b><span>Whole session</span><small>No access approval</small></div>
            <div><b>Logistical administrator</b><span>Whole session</span><small>Approve / reject access</small></div>
            <div><b>Session directing couple</b><span>Whole session</span><small>Approve / reject access</small></div>
            <div><b>Committee viewer</b><span>Assigned committee scope</span><small>Read-only by design</small></div>
          </div>
        </article>
      </div>

      <article className="panel">
        <div className="panel-head"><div><span className="kicker">Current access</span><h2>Authorized leaders</h2></div><Status>{roster.filter((user) => user.active !== false && user.status !== "Invited").length} active</Status></div>
        <div className="table-wrap"><table><thead><tr><th>Leader</th><th>Role</th><th>Visibility</th><th>Status</th></tr></thead><tbody>{roster.map((user) => <tr key={user.id || user.email}><td><b>{user.name}</b><small className="cell-sub">{user.email}</small></td><td>{user.role?.includes(" ") ? user.role : roleLabel(user.role)}</td><td>{scopeForRoster(user)}</td><td><Status tone={user.status === "Invited" || user.active === false ? "warn" : "good"}>{user.status || "Active"}</Status></td></tr>)}</tbody></table></div>
      </article>

      {show && (
        <div className="modal-backdrop" onMouseDown={() => setShow(false)}>
          <form className="modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={createRequest}>
            <button type="button" className="icon-button modal-close" onClick={() => setShow(false)}><X/></button>
            {created ? (
              <Empty icon={CheckCircle} title="Access request created" text="Demo mode has added the request to the approval queue." action={<button type="button" className="primary" onClick={() => setShow(false)}>Done</button>} />
            ) : (
              <>
                <span className="kicker">Controlled access</span>
                <h2>Request access for a leader</h2>
                <p>This demo mirrors the live approval flow. In the connected system, leaders sign in and request access with the session code.</p>
                <label>Full name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Leader name" /></label>
                <label>Email address<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="leader@example.org" /></label>
                <label>Role<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>{REQUESTABLE_ROLES.map((role) => <option value={role} key={role}>{roleLabel(role)}</option>)}</select></label>
                {form.role !== "coordinator" ? <label>Scope<input value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value })} placeholder={form.role === "assistant_coordinator" ? "e.g. Companies 21–24" : "e.g. Food overview"} /></label> : null}
                <button className="primary full">Submit for approval</button>
              </>
            )}
          </form>
        </div>
      )}
    </section>
  );
}

export function createInitialAccessRequests() {
  return demoAccessRequests.map((request) => ({ ...request }));
}
