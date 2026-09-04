import { useState } from "react";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Copy } from "@phosphor-icons/react/Copy";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { X } from "@phosphor-icons/react/X";
import { DismissibleLayer, MutationFeedback, Status } from "./UI.jsx";
import { createStaffLeaderInvite, staffRoleLabel, staffScopeLabel } from "../lib/staff-access.js";

export function StaffAccessInvite({ staff, onClose, onInvited }) {
  const [email, setEmail] = useState(staff?.email || staff?.accountEmail || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState("");

  if (!staff) return null;

  const copy = async (value, label) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1800);
    } catch {
      setError("Copy did not work on this device. Select the code manually instead.");
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await createStaffLeaderInvite(staff.staffId, email);
      setCreated(result);
      await onInvited?.();
    } catch (err) {
      setError(err.message || "Website access could not be prepared.");
    } finally {
      setBusy(false);
    }
  };

  const setupLink = created && typeof window !== "undefined"
    ? `${window.location.origin}/?invite=${encodeURIComponent(created.code)}`
    : "";

  return <DismissibleLayer open onClose={onClose} title={created ? "Website access ready" : "Give website access"} sheet className="staff-access-sheet">
    <div className="staff-access-sheet-body">
      <button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} aria-label="Close"><X/></button>
      {!created ? <form onSubmit={submit} className="staff-access-invite-form">
        <span className="kicker">Website access</span>
        <h2>Give {staff.name} access</h2>
        <p className="staff-access-lead">Their FSY assignment is already set. You only need to confirm the email they will use to sign in.</p>

        <div className="staff-access-context" aria-label="Current FSY assignment">
          <div><span>FSY role</span><b>{staffRoleLabel(staff.operationalRole)}</b></div>
          <div><span>Scope</span><b>{staffScopeLabel(staff)}</b></div>
          <Status tone="good">From Assignments</Status>
        </div>

        <label>Email address
          <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="leader@example.com" />
          <small>This email verifies the account setup. Role and company access come from Assignments and stay in sync automatically.</small>
        </label>
        {staff.operationalRole === "assistant_coordinator" && !staff.companyIds?.length
          ? <MutationFeedback tone="error">Assign at least one company before giving this Assistant Coordinator website access.</MutationFeedback>
          : null}
        {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
        <div className="field-sheet-actions">
          <button type="button" className="secondary" onClick={onClose}>Not now</button>
          <button className="primary" disabled={busy || (staff.operationalRole === "assistant_coordinator" && !staff.companyIds?.length)}>{busy ? "Preparing…" : staff.accessState === "invited" ? "Create new setup link" : "Create setup link"}</button>
        </div>
      </form> : <div className="staff-access-ready">
        <div className="invite-ready-icon"><CheckCircle weight="fill"/></div>
        <span className="kicker">Access prepared</span>
        <h2>Send this to {staff.name}</h2>
        <p>{staffRoleLabel(staff.operationalRole)} · {staffScopeLabel(staff)}</p>

        {created.existingAccount ? <div className="notice compact-notice"><ShieldCheck weight="fill"/><div><b>An account already uses this email</b><p>Ask them to sign in first and use the invite code to connect this FSY assignment. The code will not silently replace another account.</p></div></div> : null}

        <div className="invite-code-box">
          <span>One-time code</span>
          <strong>{created.code}</strong>
          <small>{created.expiresAt ? `Expires ${new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(new Date(created.expiresAt))}` : "Use once to finish setup"}</small>
        </div>
        <div className="invite-ready-actions">
          <button className="primary" onClick={() => copy(setupLink, "link")}><Copy/>{copied === "link" ? "Link copied" : "Copy setup link"}</button>
          <button className="secondary" onClick={() => copy(created.code, "code")}><Copy/>{copied === "code" ? "Code copied" : "Copy code"}</button>
        </div>
        {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
        <button className="text-action invite-done" onClick={onClose}>Done</button>
      </div>}
    </div>
  </DismissibleLayer>;
}
