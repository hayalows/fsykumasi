import { useEffect, useMemo, useState } from "react";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { EnvelopeSimple } from "@phosphor-icons/react/EnvelopeSimple";
import { PencilSimple } from "@phosphor-icons/react/PencilSimple";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { SignOut } from "@phosphor-icons/react/SignOut";
import { AccountAvatar } from "../components/Avatar.jsx";
import { MutationFeedback, PageHead, Status } from "../components/UI.jsx";
import { demoSession } from "../data/session.js";
import { roleLabel } from "../lib/access.js";
import { recoverableWriteError, usePendingPageGuard, useSingleFlight } from "../lib/reliable-action.js";

function accessScope(grantedAccess, companies, currentRole, live) {
  if (!grantedAccess) return !live && ["coordinator", "logistics_admin", "session_director", "area_advisory_couple"].includes(currentRole) ? (currentRole === "area_advisory_couple" ? "Whole FSY program · demo" : "Whole session · demo") : "No active session access";
  if (["coordinator", "logistics_admin", "session_director", "area_advisory_couple"].includes(grantedAccess.role)) return grantedAccess.role === "area_advisory_couple" ? "Whole FSY program" : "Whole session";
  if (grantedAccess.role === "assistant_coordinator") {
    const names = (grantedAccess.company_ids || []).map((id) => companies.find((company) => company.id === id)?.name).filter(Boolean);
    return names.length ? names.join(", ") : `${(grantedAccess.company_ids || []).length} assigned companies`;
  }
  if (grantedAccess.committee_scope?.length) return grantedAccess.committee_scope.join(", ");
  return "Assigned scope";
}

function timeReceipt(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function Profile({ currentUser, currentRole, grantedAccess, companies = [], sessionInfo, sessionName = demoSession.name, live = false, onSave, onChangePassword, onSignOut }) {
  const displayName = currentUser?.display_name || "FSY Leader";
  const email = currentUser?.email || "Not available";
  const runSingleFlight = useSingleFlight();
  const [name, setName] = useState(displayName);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordSavedAt, setPasswordSavedAt] = useState("");
  const [passwordError, setPasswordError] = useState("");

  usePendingPageGuard(busy || passwordBusy);
  useEffect(() => { setName(displayName); }, [displayName]);

  const scope = useMemo(() => accessScope(grantedAccess, companies, currentRole, live), [grantedAccess, companies, currentRole, live]);
  const activeSessionName = sessionInfo?.name || sessionName;
  const passwordTooShort = passwords.next.length > 0 && passwords.next.length < 10;
  const passwordMismatch = passwords.confirm.length > 0 && passwords.next !== passwords.confirm;
  const passwordUnchanged = passwords.current.length > 0 && passwords.next.length > 0 && passwords.current === passwords.next;
  const passwordReady = Boolean(passwords.current && passwords.next.length >= 10 && passwords.confirm && !passwordMismatch && !passwordUnchanged);

  const submit = async (event) => {
    event.preventDefault();
    const cleaned = name.trim().replace(/\s+/g, " ");
    if (cleaned.length < 2) return setError("Enter the name you want other FSY leaders to see.");
    if (!onSave) return;
    await runSingleFlight("profile-name", async () => {
      setBusy(true); setSaved(false); setError("");
      try {
        await onSave(cleaned);
        setName(cleaned);
        setSaved(true);
        setEditing(false);
        window.setTimeout(() => setSaved(false), 2200);
      } catch (err) {
        setError(recoverableWriteError(err, "Your name could not be saved."));
      } finally { setBusy(false); }
    });
  };

  const submitPassword = async (event) => {
    event.preventDefault();
    setPasswordError(""); setPasswordSavedAt("");
    if (!passwords.current) return setPasswordError("Enter your current password.");
    if (passwords.next.length < 10) return setPasswordError("Use at least 10 characters for your new password.");
    if (passwords.next !== passwords.confirm) return setPasswordError("The two new passwords do not match.");
    if (passwords.current === passwords.next) return setPasswordError("Choose a new password that is different from your current password.");
    if (!onChangePassword) return;
    await runSingleFlight("account-password", async () => {
      setPasswordBusy(true);
      try {
        await onChangePassword(passwords.current, passwords.next);
        setPasswords({ current: "", next: "", confirm: "" });
        setPasswordSavedAt(new Date().toISOString());
      } catch (err) {
        setPasswordError(recoverableWriteError(err, "Your password could not be changed."));
      } finally { setPasswordBusy(false); }
    });
  };

  return (
    <section className="page profile-page">
      <PageHead title="Account" sessionName={activeSessionName} description="Your details, access and sign-in security." />

      <article className="panel profile-identity-card">
        <div className="profile-identity-main">
          <AccountAvatar seed={currentUser?.user_id || currentUser?.id} label={`${displayName} profile`} size={68} className="profile-avatar-large" />
          <div className="profile-identity-copy"><span className="kicker">Signed-in account</span><h2>{displayName}</h2><p>{email}</p><span className="profile-role-chip"><ShieldCheck weight="fill" />{roleLabel(currentRole)}</span></div>
        </div>
        <button className="secondary profile-edit-trigger" onClick={() => { setError(""); setEditing((value) => !value); }} aria-expanded={editing} aria-label={editing ? "Close name editor" : "Edit account name"}><PencilSimple /><span className="profile-edit-label">{editing ? "Close" : "Edit"}</span></button>
      </article>

      {editing ? <article className="panel profile-edit-card profile-inline-card" aria-busy={busy}>
        <div className="panel-head"><div><span className="kicker">Identity</span><h2>Edit your name</h2></div></div>
        <form className="profile-form" onSubmit={submit}>
          <label>Display name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your full name" autoComplete="name" maxLength={80} autoFocus /></label>
          <label>Email address<div className="profile-readonly"><EnvelopeSimple /><span>{email}</span></div></label>
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <div className="profile-form-actions"><button type="button" className="secondary" onClick={() => { setName(displayName); setEditing(false); }} disabled={busy}>Cancel</button><button className="primary profile-save" disabled={busy || !live}>{busy ? "Saving…" : "Save name"}</button></div>
        </form>
      </article> : saved ? <div className="auth-success profile-save-confirmation" role="status"><Status tone="good">Name saved</Status></div> : null}

      <details className="panel progressive-section profile-disclosure">
        <summary><span><span className="kicker">Access</span><b>{roleLabel(currentRole)}</b><small>{scope} · {activeSessionName}</small></span><CaretDown className="disclosure-icon" size={20} /></summary>
        <div className="progressive-section-body profile-disclosure-body">
          <dl className="profile-details">
            <div><dt>Role</dt><dd>{roleLabel(currentRole)}</dd></div>
            <div><dt>Visibility</dt><dd>{scope}</dd></div>
            <div><dt>Session</dt><dd>{activeSessionName}</dd></div>
          </dl>
          {grantedAccess?.capabilities?.length ? <div className="profile-capabilities"><span className="kicker">Additional capabilities</span><div>{grantedAccess.capabilities.map((capability) => <Status key={capability}>{capability === "access_admin" ? "Access administration" : capability.replace(/_/g, " ")}</Status>)}</div></div> : <p className="form-hint">No additional capabilities are attached to this session access.</p>}
        </div>
      </details>

      <details className="panel progressive-section profile-disclosure profile-security-disclosure">
        <summary><span><span className="kicker">Security</span><b>Password</b><small>Change the password you use to sign in.</small></span><CaretDown className="disclosure-icon" size={20} /></summary>
        <div className="progressive-section-body profile-disclosure-body">
          <form className="profile-form" onSubmit={submitPassword} aria-busy={passwordBusy}>
            <label>Current password<input required type="password" value={passwords.current} onChange={(event) => { setPasswordError(""); setPasswordSavedAt(""); setPasswords({ ...passwords, current: event.target.value }); }} autoComplete="current-password" aria-invalid={Boolean(passwordError && !passwords.current)} /></label>
            <label>New password<input required type="password" minLength={10} value={passwords.next} onChange={(event) => { setPasswordError(""); setPasswordSavedAt(""); setPasswords({ ...passwords, next: event.target.value }); }} autoComplete="new-password" aria-describedby="profile-new-password-help" aria-invalid={passwordTooShort || passwordUnchanged} /><small id="profile-new-password-help">Use at least 10 characters and choose something different from your current password.</small></label>
            <label>Confirm new password<input required type="password" minLength={10} value={passwords.confirm} onChange={(event) => { setPasswordError(""); setPasswordSavedAt(""); setPasswords({ ...passwords, confirm: event.target.value }); }} autoComplete="new-password" aria-describedby="profile-confirm-password-help" aria-invalid={passwordMismatch} /><small id="profile-confirm-password-help">Retype the new password exactly.</small></label>
            <div className="profile-password-state" aria-live="polite">
              {passwordTooShort ? <span className="invalid">New password is still shorter than 10 characters.</span> : null}
              {passwordMismatch ? <span className="invalid">The confirmation does not match yet.</span> : null}
              {passwordUnchanged ? <span className="invalid">The new password matches the current password.</span> : null}
              {passwordReady ? <span className="valid">Password fields are ready to submit.</span> : null}
            </div>
            {passwordError ? <div className="form-error" role="alert">{passwordError}</div> : null}
            <button className="secondary profile-save" disabled={passwordBusy || !live || !passwordReady}>{passwordBusy ? "Updating…" : "Update password"}</button>
            {passwordSavedAt ? <MutationFeedback className="profile-password-receipt" tone="success">Password updated at {timeReceipt(passwordSavedAt)}. Use the new password the next time you sign in.</MutationFeedback> : null}
          </form>
        </div>
      </details>

      <div className="profile-signout-row">
        <span className="profile-signout-copy"><span className="kicker">Session</span><small>Sign out of this device when you are done.</small></span>
        <button className="secondary compact-button" onClick={onSignOut} disabled={!onSignOut}><SignOut /><span>Sign out</span></button>
      </div>
    </section>
  );
}
