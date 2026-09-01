import { useMemo, useState } from "react";
import { Check } from "@phosphor-icons/react/Check";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Copy } from "@phosphor-icons/react/Copy";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { X } from "@phosphor-icons/react/X";
import { demoAccessRequests, demoUsers } from "../data/demo.js";
import { canApproveAccess, REQUESTABLE_ROLES, roleLabel, roleVisibility } from "../lib/access.js";
import { Empty, PageHead, Status } from "../components/UI.jsx";
import "./access-review.css";

function AccessRequest({ request, onReview, canReview, processing }) {
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
          <button className="approve" disabled={processing} onClick={() => onReview(request, "approved")}><Check />Review</button>
          <button className="reject" disabled={processing} onClick={() => onReview(request, "rejected")}><X />Reject</button>
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

function ReviewModal({ request, decision, companies, processing, onClose, onSubmit }) {
  const [companySearch, setCompanySearch] = useState("");
  const [companyIds, setCompanyIds] = useState(request.companyIds || []);
  const [committeeText, setCommitteeText] = useState((request.committeeScope || []).join(", "));
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const filteredCompanies = useMemo(() => {
    const query = companySearch.trim().toLowerCase();
    if (!query) return companies;
    return companies.filter((company) => company.name.toLowerCase().includes(query));
  }, [companies, companySearch]);

  const toggleCompany = (id) => {
    setCompanyIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    const committeeScope = committeeText.split(",").map((item) => item.trim()).filter(Boolean);

    if (decision === "approved" && request.role === "assistant_coordinator" && companyIds.length === 0) {
      setError(companies.length ? "Select at least one company before approving this Assistant Coordinator." : "Create and publish companies before approving an Assistant Coordinator.");
      return;
    }
    if (decision === "approved" && request.role === "committee_viewer" && committeeScope.length === 0) {
      setError("Add at least one committee area before approving this viewer.");
      return;
    }

    try {
      await onSubmit(request.id, decision, { companyIds, committeeScope, note });
    } catch (err) {
      setError(err.message || "Unable to save this access decision.");
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="modal access-review-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}>
        <button type="button" className="icon-button modal-close" onClick={onClose} aria-label="Close review"><X/></button>
        <span className="kicker">Access review</span>
        <h2>{decision === "approved" ? `Approve ${request.name}` : `Reject ${request.name}`}</h2>
        <p className="review-summary"><b>{roleLabel(request.role)}</b> · {request.email}</p>
        {request.scope ? <div className="request-note"><span>Requested scope</span><p>{request.scope}</p></div> : null}

        {decision === "approved" && request.role === "assistant_coordinator" ? (
          <div className="scope-editor">
            <div className="scope-editor-head"><div><b>Assigned companies</b><small>This controls which youth and group data the AC can actually read.</small></div><Status tone={companyIds.length ? "good" : "warn"}>{companyIds.length} selected</Status></div>
            <div className="company-search"><MagnifyingGlass/><input value={companySearch} onChange={(event) => setCompanySearch(event.target.value)} placeholder="Find a company" /></div>
            <div className="company-picker">
              {filteredCompanies.length ? filteredCompanies.map((company) => (
                <label key={company.id} className={companyIds.includes(company.id) ? "selected" : ""}>
                  <input type="checkbox" checked={companyIds.includes(company.id)} onChange={() => toggleCompany(company.id)} />
                  <span>{company.name}</span>
                </label>
              )) : <p className="scope-empty">{companies.length ? "No companies match this search." : "No companies exist yet. Build and publish companies first."}</p>}
            </div>
          </div>
        ) : null}

        {decision === "approved" && request.role === "committee_viewer" ? (
          <label>Committee scope<input value={committeeText} onChange={(event) => setCommitteeText(event.target.value)} placeholder="e.g. Food, Housing"/><small className="field-help">Separate multiple areas with commas.</small></label>
        ) : null}

        {decision === "approved" && request.role === "coordinator" ? <div className="notice green compact-notice"><ShieldCheck weight="fill"/><div><b>Whole-session visibility</b><p>Coordinators can see the same operational session data as Logistics and Session Directors, but cannot approve access.</p></div></div> : null}

        <label>Decision note <span className="optional">Optional</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={decision === "approved" ? "Anything the leader should know about their access" : "Reason for rejection"}/></label>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="review-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button className={decision === "approved" ? "primary" : "danger-button"} disabled={processing}>{processing ? "Saving…" : decision === "approved" ? "Approve access" : "Reject request"}</button>
        </div>
      </form>
    </div>
  );
}

export function Access({
  requests,
  setRequests,
  currentRole = "logistics_admin",
  onDecision,
  onRotateCode,
  roster = demoUsers,
  companies = [],
  sessionAccessCode,
  live = false,
}) {
  const [show, setShow] = useState(false);
  const [created, setCreated] = useState(false);
  const [processing, setProcessing] = useState("");
  const [copied, setCopied] = useState(false);
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewDecision, setReviewDecision] = useState("approved");
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [pageError, setPageError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", role: "assistant_coordinator", scope: "" });
  const canReview = canApproveAccess(currentRole);
  const pending = useMemo(() => requests.filter((request) => request.status === "pending"), [requests]);

  const openReview = (request, decision) => {
    setReviewTarget(request);
    setReviewDecision(decision);
  };

  const decide = async (id, status, options = {}) => {
    setProcessing(id);
    try {
      if (onDecision) {
        await onDecision(id, status, options);
      } else {
        setRequests((current) => current.map((request) => request.id === id ? {
          ...request,
          status,
          companyIds: options.companyIds || [],
          committeeScope: options.committeeScope || [],
        } : request));
      }
      setReviewTarget(null);
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

  const rotateCode = async () => {
    setRotating(true);
    setPageError("");
    try {
      await onRotateCode();
      setConfirmRotate(false);
    } catch (error) {
      setPageError(error.message || "Unable to rotate the session access code.");
    } finally {
      setRotating(false);
    }
  };

  const action = live && sessionAccessCode && canReview
    ? <div className="page-head-actions"><button className="secondary" onClick={() => setConfirmRotate(true)}>Rotate code</button><button className="primary" onClick={copyCode}><Copy />{copied ? "Access code copied" : "Copy session code"}</button></div>
    : !live
      ? <button className="primary" onClick={() => { setCreated(false); setShow(true); }}><UserPlus />New access request</button>
      : null;

  return (
    <section className="page">
      <PageHead title="People & access" description="Access is role-based, scope-aware and approval-controlled. Visibility can be broad without giving everyone the same authority." action={action} />

      <div className="notice green"><ShieldCheck weight="fill"/><div><b>Access follows responsibility</b><p>Coordinators, logistical administrators and the session directing couple have whole-session operational visibility. Only logistical administrators and session directors can approve or reject access requests for lower roles.</p></div></div>

      {pageError ? <div className="form-error page-error" role="alert">{pageError}</div> : null}
      {confirmRotate ? <div className="notice rotate-confirm"><ShieldCheck weight="fill"/><div><b>Rotate the session code?</b><p>The current code will stop working immediately. Existing approved access stays active.</p><div className="confirm-actions"><button className="secondary" onClick={() => setConfirmRotate(false)}>Cancel</button><button className="primary" disabled={rotating} onClick={rotateCode}>{rotating ? "Rotating…" : "Rotate now"}</button></div></div></div> : null}

      {live && canReview && sessionAccessCode ? <div className="access-code-strip"><span>Session access code</span><b>{sessionAccessCode}</b><small>Share only with leaders who need to request access. The code alone does not reveal participant data.</small></div> : null}

      <div className="access-layout">
        <article className="panel approval-panel">
          <div className="panel-head"><div><span className="kicker">Approval queue</span><h2>{pending.length} waiting for review</h2></div><span className="count">{pending.length}</span></div>
          <div className="request-list">
            {requests.length ? requests.map((request) => <AccessRequest key={request.id} request={request} onReview={openReview} canReview={canReview} processing={processing === request.id} />) : <Empty icon={ShieldCheck} title="No access requests" text="New requests will appear here for review." />}
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

      {reviewTarget ? <ReviewModal key={`${reviewTarget.id}-${reviewDecision}`} request={reviewTarget} decision={reviewDecision} companies={companies} processing={processing === reviewTarget.id} onClose={() => setReviewTarget(null)} onSubmit={decide} /> : null}

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
