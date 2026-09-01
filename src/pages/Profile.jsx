import { useEffect, useMemo, useState } from "react";
import { EnvelopeSimple } from "@phosphor-icons/react/EnvelopeSimple";
import { IdentificationBadge } from "@phosphor-icons/react/IdentificationBadge";
import { Key } from "@phosphor-icons/react/Key";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { SignOut } from "@phosphor-icons/react/SignOut";
import { UserCircle } from "@phosphor-icons/react/UserCircle";
import { roleLabel } from "../lib/access.js";
import { PageHead } from "../components/UI.jsx";

function initials(name = "FSY") {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function accessScope(grantedAccess, companies) {
  if (!grantedAccess) return "No active session access";
  if (["coordinator", "logistics_admin", "session_director"].includes(grantedAccess.role)) return "Whole session";
  if (grantedAccess.role === "assistant_coordinator") {
    const names = (grantedAccess.company_ids || []).map((id) => companies.find((company) => company.id === id)?.name).filter(Boolean);
    return names.length ? names.join(", ") : `${(grantedAccess.company_ids || []).length} assigned companies`;
  }
  if (grantedAccess.committee_scope?.length) return grantedAccess.committee_scope.join(", ");
  return "Assigned scope";
}

export function Profile({ currentUser, currentRole, grantedAccess, companies = [], sessionInfo, live = false, onSave, onChangePassword, onSignOut }) {
  const [name, setName] = useState(currentUser?.display_name || "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => { setName(currentUser?.display_name || ""); }, [currentUser?.display_name]);

  const scope = useMemo(() => accessScope(grantedAccess, companies), [grantedAccess, companies]);
  const email = currentUser?.email || "Not available";
  const avatar = initials(name || currentUser?.display_name || email);

  const submit = async (event) => {
    event.preventDefault();
    const cleaned = name.trim().replace(/\s+/g, " ");
    if (cleaned.length < 2) return setError("Enter the name you want other FSY leaders to see.");
    setBusy(true); setSaved(false); setError("");
    try {
      await onSave(cleaned);
      setName(cleaned);
      setSaved(true);
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
      <PageHead title="Your profile" description="Manage your FSY identity, password and the access attached to this account." />

      <div className="profile-grid">
        <article className="panel profile-identity-card">
          <div className="profile-avatar-large">{avatar}</div>
          <div><span className="kicker">Signed-in account</span><h2>{currentUser?.display_name || "FSY Leader"}</h2><p>{email}</p></div>
          <div className="profile-role-chip"><ShieldCheck weight="fill" />{roleLabel(currentRole)}</div>
        </article>

        <article className="panel profile-edit-card">
          <div className="panel-head"><div><span className="kicker">Identity</span><h2>How your name appears</h2></div><UserCircle className="panel-symbol" size={24} /></div>
          <form className="profile-form" onSubmit={submit}>
            <label>Display name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your full name" autoComplete="name" maxLength={80} /></label>
            <label>Email address<div className="profile-readonly"><EnvelopeSimple /><span>{email}</span></div><small>Your email is the username for this account.</small></label>
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <button className="primary profile-save" disabled={busy || !live}>{busy ? "Saving…" : saved ? "Saved" : "Save profile"}</button>
          </form>
        </article>

        <article className="panel profile-access-card">
          <div className="panel-head"><div><span className="kicker">Session access</span><h2>Your permissions</h2></div><IdentificationBadge className="panel-symbol" size={24} /></div>
          <dl className="profile-details">
            <div><dt>Role</dt><dd>{roleLabel(currentRole)}</dd></div>
            <div><dt>Visibility</dt><dd>{scope}</dd></div>
            <div><dt>Session</dt><dd>{sessionInfo?.name || "FSY Kumasi 2026"}</dd></div>
          </dl>
          <p className="profile-help">Your password proves who you are. Your role and scope decide what you can see or change.</p>
        </article>

        <article className="panel profile-security-card">
          <div className="panel-head"><div><span className="kicker">Security</span><h2>Change password</h2></div><Key className="panel-symbol" size={24} /></div>
          <form className="profile-form" onSubmit={submitPassword}>
            <label>Current password<input required type="password" value={passwords.current} onChange={(event) => setPasswords({ ...passwords, current: event.target.value })} autoComplete="current-password" /></label>
            <label>New password<input required type="password" minLength={10} value={passwords.next} onChange={(event) => setPasswords({ ...passwords, next: event.target.value })} autoComplete="new-password" /><small>Use at least 10 characters.</small></label>
            <label>Confirm new password<input required type="password" minLength={10} value={passwords.confirm} onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })} autoComplete="new-password" /></label>
            {passwordError ? <div className="form-error" role="alert">{passwordError}</div> : null}
            <button className="secondary profile-save" disabled={passwordBusy || !live}>{passwordBusy ? "Updating…" : passwordSaved ? "Password updated" : "Update password"}</button>
          </form>
        </article>

        <article className="panel profile-signout-card">
          <div><span className="kicker">Account</span><h2>Sign out on this device</h2><p>You can sign back in anytime with this email address and your password.</p></div>
          <button className="secondary signout-full" onClick={onSignOut}><SignOut />Sign out</button>
        </article>
      </div>
    </section>
  );
}
