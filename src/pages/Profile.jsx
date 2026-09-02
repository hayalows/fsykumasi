import { useEffect, useMemo, useState } from "react";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { EnvelopeSimple } from "@phosphor-icons/react/EnvelopeSimple";
import { IdentificationBadge } from "@phosphor-icons/react/IdentificationBadge";
import { Key } from "@phosphor-icons/react/Key";
import { PencilSimple } from "@phosphor-icons/react/PencilSimple";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { SignOut } from "@phosphor-icons/react/SignOut";
import { AccountAvatar } from "../components/Avatar.jsx";
import { PageHead, Status } from "../components/UI.jsx";
import { demoSession } from "../data/session.js";
import { roleLabel } from "../lib/access.js";

function accessScope(grantedAccess, companies, currentRole, live) {
  if (!grantedAccess) return !live && ["coordinator", "logistics_admin", "session_director"].includes(currentRole) ? "Whole session · demo" : "No active session access";
  if (["coordinator", "logistics_admin", "session_director"].includes(grantedAccess.role)) return "Whole session";
  if (grantedAccess.role === "assistant_coordinator") {
    const names = (grantedAccess.company_ids || []).map((id) => companies.find((company) => company.id === id)?.name).filter(Boolean);
    return names.length ? names.join(", ") : `${(grantedAccess.company_ids || []).length} assigned companies`;
  }
  if (grantedAccess.committee_scope?.length) return grantedAccess.committee_scope.join(", ");
  return "Assigned scope";
}

export function Profile({ currentUser, currentRole, grantedAccess, companies = [], sessionInfo, sessionName = demoSession.name, live = false, onSave, onChangePassword, onSignOut }) {
  const displayName = currentUser?.display_name || "FSY Leader";
  const email = currentUser?.email || "Not available";
  const [name, setName] = useState(displayName);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => { setName(displayName); }, [displayName]);

  const scope = useMemo(() => accessScope(grantedAccess, companies, currentRole, live), [grantedAccess, companies, currentRole, live]);
  const activeSessionName = sessionInfo?.name || sessionName;

  const submit = async (event) => {
    event.preventDefault();
    const cleaned = name.trim().replace(/\s+/g, " ");
    if (cleaned.length < 2) return setError("Enter the name you want other FSY leaders to see.");
    if (!onSave) return;
    setBusy(true); setSaved(false); setError("");
    try {
      await onSave(cleaned);
      setName(cleaned);
      setSaved(true);
      setEditing(false);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (err) {
      setError(err.message || "Unable to save your profile.");
    } finally { setBusy(false); }
  };

  const submitPassword = async (event) => {
    event.preventDefault();
    setPasswordError(""); setPasswordSaved(false);
    if (passwords.next !== passwords.confirm) return setPasswordError("The two new passwords do not match.");
    if (passwords.next.length < 10) return setPasswordError("Use at least 10 characters for your new password.");
    if (!onChangePassword) return;
    setPasswordBusy(true);
    try {
      await onChangePassword(passwords.current, passwords.next);
      setPasswords({ current: "", next: "", confirm: "" });
      setPasswordSaved(true);
      window.setTimeout(() => setPasswordSaved(false), 2400);
    } catch (err) {
      setPasswordError(err.message || "Unable to change your password.");
    } finally { setPasswordBusy(false); }
  };

  return (
    <section className="page profile-page">
      <PageHead title="Account" sessionName={activeSessionName} description="Update your name, review access, or manage security." />

      <article className="panel profile-identity-card">
        <div className="profile-identity-main">
          <AccountAvatar seed={currentUser?.user_id || currentUser?.id} label={`${displayName} profile`} size={68} className="profile-avatar-large" />
          <div className="profile-identity-copy"><span className="kicker">Signed-in account</span><h2>{displayName}</h2><p>{email}</p><span className="profile-role-chip"><ShieldCheck weight="fill" />{roleLabel(currentRole)}</span></div>
        </div>
        <button className="secondary profile-edit-trigger" onClick={() => { setError(""); setEditing((value) => !value); }} aria-expanded={editing}><PencilSimple />{editing ? "Close edit" : "Edit"}</button>
      </article>

      {editing ? <article className="panel profile-edit-card profile-inline-card">
        <div className="panel-head"><div><span className="kicker">Identity</span><h2>Edit your name</h2></div></div>
        <form className="profile-form" onSubmit={submit}>
          <label>Display name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your full name" autoComplete="name" maxLength={80} autoFocus /></label>
          <label>Email address<div className="profile-readonly"><EnvelopeSimple /><span>{email}</span></div></label>
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <div className="profile-form-actions"><button type="button" className="secondary" onClick={() => { setName(displayName); setEditing(false); }}>Cancel</button><button className="primary profile-save" disabled={busy || !live}>{busy ? "Saving…" : saved ? "Saved" : "Save name"}</button></div>
        </form>
      </article> : saved ? <div className="auth-success profile-save-confirmation" role="status"><Status tone="good">Name saved</Status></div> : null}

      <details className="panel progressive-section profile-disclosure">
        <summary><span><span className="kicker">Permissions</span><b>{roleLabel(currentRole)} · {scope}</b><small>{activeSessionName}</small></span><CaretDown className="disclosure-icon" size={20} /></summary>
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
        <summary><span><span className="kicker">Security</span><b>Change password</b><small>Password-first sign-in for daily use</small></span><Key size={20} className="panel-symbol" /></summary>
        <div className="progressive-section-body profile-disclosure-body">
          <form className="profile-form" onSubmit={submitPassword}>
            <label>Current password<input required type="password" value={passwords.current} onChange={(event) => setPasswords({ ...passwords, current: event.target.value })} autoComplete="current-password" /></label>
            <label>New password<input required type="password" minLength={10} value={passwords.next} onChange={(event) => setPasswords({ ...passwords, next: event.target.value })} autoComplete="new-password" /><small>Use at least 10 characters.</small></label>
            <label>Confirm new password<input required type="password" minLength={10} value={passwords.confirm} onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })} autoComplete="new-password" /></label>
            {passwordError ? <div className="form-error" role="alert">{passwordError}</div> : null}
            <button className="secondary profile-save" disabled={passwordBusy || !live}>{passwordBusy ? "Updating…" : passwordSaved ? "Password updated" : "Update password"}</button>
          </form>
        </div>
      </details>

      <div className="profile-signout-row">
        <span className="kicker">Session</span>
        <button className="secondary compact-button" onClick={onSignOut} disabled={!onSignOut}><SignOut />Sign out</button>
      </div>
    </section>
  );
}

