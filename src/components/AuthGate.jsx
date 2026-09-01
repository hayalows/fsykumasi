import { useState } from "react";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { LockKey } from "@phosphor-icons/react/LockKey";
import { SignOut } from "@phosphor-icons/react/SignOut";
import { BrandMark } from "./BrandMark.jsx";
import { REQUESTABLE_ROLES, roleLabel } from "../lib/access.js";

export function SignInScreen({ onSendLink }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSendLink(email);
      setSent(true);
    } catch (err) {
      setError(err.message || "Unable to send sign-in link.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <BrandMark />
        <span className="kicker">FSY Kumasi 2026</span>
        <h1>Operations access</h1>
        <p>Sign in with the email address you will use for your FSY assignment. Participant information stays locked until your session access is approved.</p>
        {sent ? (
          <div className="auth-success"><CheckCircle weight="fill"/><div><b>Check your email</b><span>We sent a secure sign-in link to {email}.</span></div></div>
        ) : (
          <form onSubmit={submit}>
            <label>Email address<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" /></label>
            {error ? <div className="form-error">{error}</div> : null}
            <button className="primary full" disabled={busy}>{busy ? "Sending…" : "Send secure sign-in link"}<ArrowRight /></button>
          </form>
        )}
        <div className="auth-note"><LockKey weight="fill"/><span>This is an operations tool for authorized FSY leaders. Youth participants do not need accounts.</span></div>
      </section>
    </main>
  );
}

export function AccessRequestScreen({ profile, request, onRequest, onSignOut }) {
  const [form, setForm] = useState({ accessCode: "", role: "assistant_coordinator", scopeNote: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(Boolean(request));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onRequest(form);
      setSubmitted(true);
    } catch (err) {
      setError(err.message || "Unable to request access.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card access-gate-card">
        <BrandMark />
        <span className="kicker">Signed in as {profile?.display_name || profile?.email || "FSY leader"}</span>
        {submitted ? (
          <>
            <h1>Access request pending</h1>
            <p>A logistical administrator or member of the session directing couple needs to review your request before participant or operational data becomes available.</p>
            <div className="auth-success"><CheckCircle weight="fill"/><div><b>Request received</b><span>{request?.session_name ? `${request.session_name} · ` : ""}{request?.requested_role ? roleLabel(request.requested_role) : roleLabel(form.role)}</span></div></div>
          </>
        ) : (
          <>
            <h1>Request session access</h1>
            <p>Enter the access code given to you by FSY leadership. Your role request will stay pending until an authorized leader approves it.</p>
            <form onSubmit={submit}>
              <label>Session access code<input required value={form.accessCode} onChange={(event) => setForm({ ...form, accessCode: event.target.value.toUpperCase() })} placeholder="e.g. A1B2C3D4E5" autoComplete="off" /></label>
              <label>Role<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>{REQUESTABLE_ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select></label>
              {form.role !== "coordinator" ? <label>Assignment / scope note<input value={form.scopeNote} onChange={(event) => setForm({ ...form, scopeNote: event.target.value })} placeholder={form.role === "assistant_coordinator" ? "e.g. AC for Companies 21–24" : "e.g. Food committee"} /></label> : null}
              {error ? <div className="form-error">{error}</div> : null}
              <button className="primary full" disabled={busy}>{busy ? "Submitting…" : "Request access"}<ArrowRight /></button>
            </form>
          </>
        )}
        <button className="text-action" onClick={onSignOut}><SignOut />Sign out</button>
      </section>
    </main>
  );
}

export function LoadingScreen({ text = "Connecting to FSY Kumasi…" }) {
  return <main className="auth-page"><section className="auth-card loading-card"><BrandMark /><div className="loading-dot"/><h2>{text}</h2></section></main>;
}
