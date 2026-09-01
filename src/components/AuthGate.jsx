import { useEffect, useState } from "react";
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
      await onSendLink(email.trim());
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
        <h1>Sign in</h1>
        <p>No password to remember. Enter your email and we will send you a secure sign-in link.</p>
        {sent ? (
          <>
            <div className="auth-success"><CheckCircle weight="fill"/><div><b>Check your email</b><span>Open the secure link sent to {email}. It will bring you back here signed in.</span></div></div>
            <button className="text-action" onClick={() => { setSent(false); setError(""); }}>Use a different email</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <label>Email address<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" /></label>
            {error ? <div className="form-error">{error}</div> : null}
            <button className="primary full" disabled={busy}>{busy ? "Sending…" : "Send sign-in link"}<ArrowRight /></button>
          </form>
        )}
        <div className="auth-note"><LockKey weight="fill"/><span>Signing in does not automatically reveal participant information. Session access must also be approved.</span></div>
      </section>
    </main>
  );
}

export function AccessRequestScreen({ profile, request, onRequest, onBootstrap, onSignOut }) {
  const [form, setForm] = useState({ displayName: profile?.display_name || "", accessCode: "", role: "assistant_coordinator", scopeNote: "" });
  const [bootstrap, setBootstrap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(Boolean(request));

  useEffect(() => {
    if (profile?.display_name) setForm((current) => ({ ...current, displayName: profile.display_name }));
  }, [profile?.display_name]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const nextForm = { ...form, displayName: form.displayName.trim().replace(/\s+/g, " ") };
      if (nextForm.displayName.length < 2) throw new Error("Enter your name so FSY leaders know who is requesting access.");
      if (bootstrap) {
        await onBootstrap(nextForm);
      } else {
        await onRequest(nextForm);
        setSubmitted(true);
      }
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
        <span className="kicker">Signed in as {profile?.email || "FSY leader"}</span>
        {submitted ? (
          <>
            <h1>Access request pending</h1>
            <p>A logistical administrator or member of the session directing couple needs to review your request before participant or operational data becomes available.</p>
            <div className="auth-success"><CheckCircle weight="fill"/><div><b>Request received</b><span>{request?.session_name ? `${request.session_name} · ` : ""}{request?.requested_role ? roleLabel(request.requested_role) : roleLabel(form.role)}</span></div></div>
          </>
        ) : (
          <>
            <h1>{bootstrap ? "Initialize leadership access" : "Request session access"}</h1>
            <p>{bootstrap ? "Use this once, only if you are the trusted first logistical administrator or session directing couple. The code rotates immediately after a successful claim." : "Use the session code shared by FSY leadership. Your request stays pending until an authorized leader approves it."}</p>
            <form onSubmit={submit}>
              <label>Your name<input required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="Your full name" autoComplete="name" maxLength={80} /></label>
              <label>Session access code<input required value={form.accessCode} onChange={(event) => setForm({ ...form, accessCode: event.target.value.toUpperCase() })} placeholder="e.g. A1B2C3D4E5" autoComplete="off" /></label>
              <label>Role<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>{(bootstrap ? ["logistics_admin", "session_director"] : REQUESTABLE_ROLES).map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select></label>
              {!bootstrap && form.role !== "coordinator" ? <label>Assignment / scope note<input value={form.scopeNote} onChange={(event) => setForm({ ...form, scopeNote: event.target.value })} placeholder={form.role === "assistant_coordinator" ? "e.g. AC for Companies 21–24" : "e.g. Food committee"} /></label> : null}
              {error ? <div className="form-error">{error}</div> : null}
              <button className="primary full" disabled={busy}>{busy ? "Submitting…" : bootstrap ? "Initialize secure access" : "Request access"}<ArrowRight /></button>
            </form>
            <button className="text-action bootstrap-toggle" onClick={() => { setBootstrap((value) => !value); setForm((current) => ({ ...current, accessCode: "", role: bootstrap ? "assistant_coordinator" : "logistics_admin", scopeNote: "" })); setError(""); }}>
              <LockKey />{bootstrap ? "I need to request regular access" : "I am the trusted first administrator"}
            </button>
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
