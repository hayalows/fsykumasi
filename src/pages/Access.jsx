import { useMemo, useState } from "react";
import { Check } from "@phosphor-icons/react/Check";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { X } from "@phosphor-icons/react/X";
import { demoAccessRequests, demoUsers } from "../data/demo.js";
import { canApproveAccess, REQUESTABLE_ROLES, roleLabel, roleVisibility } from "../lib/access.js";
import { Empty, PageHead, Status } from "../components/UI.jsx";

const CURRENT_ROLE = "logistics_admin";

function AccessRequest({ request, onDecision, canReview }) {
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
          <button className="approve" onClick={() => onDecision(request.id, "approved")}><Check />Approve</button>
          <button className="reject" onClick={() => onDecision(request.id, "rejected")}><X />Reject</button>
        </div>
      ) : <Status tone={request.status === "approved" ? "good" : request.status === "rejected" ? "danger" : "warn"}>{request.status}</Status>}
    </div>
  );
}

export function Access({ requests, setRequests }) {
  const [show, setShow] = useState(false);
  const [created, setCreated] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "assistant_coordinator", scope: "" });
  const canReview = canApproveAccess(CURRENT_ROLE);
  const pending = useMemo(() => requests.filter((request) => request.status === "pending"), [requests]);

  const decide = (id, status) => {
    setRequests((current) => current.map((request) => request.id === id ? { ...request, status } : request));
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

  return (
    <section className="page">
      <PageHead title="People & access" description="Access is role-based, scope-aware and approval-controlled. Visibility can be broad without giving everyone the same authority." action={<button className="primary" onClick={() => { setCreated(false); setShow(true); }}><UserPlus />New access request</button>} />

      <div className="notice green"><ShieldCheck weight="fill"/><div><b>Updated hierarchy</b><p>Coordinators, logistical administrators and the session directing couple have whole-session operational visibility. Only logistical administrators and session directors can approve or reject access requests for lower roles.</p></div></div>

      <div className="access-layout">
        <article className="panel approval-panel">
          <div className="panel-head"><div><span className="kicker">Approval queue</span><h2>{pending.length} waiting for review</h2></div><span className="count">{pending.length}</span></div>
          <div className="request-list">
            {requests.length ? requests.map((request) => <AccessRequest key={request.id} request={request} onDecision={decide} canReview={canReview} />) : <Empty icon={ShieldCheck} title="No access requests" text="New requests will appear here for review." />}
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
        <div className="panel-head"><div><span className="kicker">Current access</span><h2>Authorized leaders</h2></div><Status>{demoUsers.filter((user) => user.status === "Active").length} active</Status></div>
        <div className="table-wrap"><table><thead><tr><th>Leader</th><th>Role</th><th>Visibility</th><th>Status</th></tr></thead><tbody>{demoUsers.map((user) => <tr key={user.email}><td><b>{user.name}</b><small className="cell-sub">{user.email}</small></td><td>{user.role}</td><td>{user.scope}</td><td><Status tone={user.status === "Active" ? "good" : "warn"}>{user.status}</Status></td></tr>)}</tbody></table></div>
      </article>

      {show && (
        <div className="modal-backdrop" onMouseDown={() => setShow(false)}>
          <form className="modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={createRequest}>
            <button type="button" className="icon-button modal-close" onClick={() => setShow(false)}><X/></button>
            {created ? (
              <Empty icon={CheckCircle} title="Access request created" text="It is now pending approval. In production, approval will create the user’s session access in Supabase." action={<button type="button" className="primary" onClick={() => setShow(false)}>Done</button>} />
            ) : (
              <>
                <span className="kicker">Controlled access</span>
                <h2>Request access for a leader</h2>
                <p>Top-level roles are not self-requestable. Logistics and session directors are provisioned through the trusted admin setup.</p>
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
