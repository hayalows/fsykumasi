import { useEffect, useState } from "react";
import { ArrowLeft } from "@phosphor-icons/react/ArrowLeft";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Eye } from "@phosphor-icons/react/Eye";
import { EyeSlash } from "@phosphor-icons/react/EyeSlash";
import { Key } from "@phosphor-icons/react/Key";
import { LockKey } from "@phosphor-icons/react/LockKey";
import { SignOut } from "@phosphor-icons/react/SignOut";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { BrandMark } from "./BrandMark.jsx";
import "./auth-password.css";

function formatInviteCode(value = "") {
  const raw = value.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^FSY/, "").slice(0, 24);
  const parts = raw.match(/.{1,4}/g) || [];
  return raw ? `FSY-${parts.join("-")}` : "";
}

function PasswordField({ label, value, onChange, autoComplete = "current-password", hint }) {
  const [shown, setShown] = useState(false);
  return (
    <label className="password-field">
      {label}
      <span className="password-input-wrap">
        <input
          required
          type={shown ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          minLength={10}
        />
        <button type="button" className="password-toggle" onClick={() => setShown((current) => !current)} aria-label={shown ? "Hide password" : "Show password"}>
          {shown ? <EyeSlash /> : <Eye />}
        </button>
      </span>
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function SignInScreen({ onSignIn, onActivate, onForgot, initialInvite = "" }) {
  const [mode, setMode] = useState(initialInvite ? "activate" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState(formatInviteCode(initialInvite));
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialInvite) {
      setMode("activate");
      setInviteCode(formatInviteCode(initialInvite));
    }
  }, [initialInvite]);

  const title = mode === "signin" ? "Sign in" : mode === "activate" ? "Activate your account" : "Reset your password";
  const description = mode === "signin"
    ? "Use the email and password you set up for FSY Kumasi."
    : mode === "activate"
      ? "First time here, or using a recovery code? Enter the code from FSY leadership and choose your password."
      : "Enter your account email. We will send a secure reset link if email delivery is available.";

  const switchMode = (next) => {
    setMode(next);
    setBusy(false);
    setSent(false);
    setError("");
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "signin") {
        await onSignIn(email, password);
      } else if (mode === "activate") {
        if (password !== confirmPassword) throw new Error("The two passwords do not match.");
        await onActivate({ email, code: inviteCode, displayName, password });
      } else {
        await onForgot(email);
        setSent(true);
      }
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card password-auth-card">
        <BrandMark />
        <span className="kicker">FSY Kumasi 2026</span>
        <h1>{title}</h1>
        <p>{description}</p>

        {sent ? (
          <div className="auth-success password-reset-success">
            <CheckCircle weight="fill" />
            <div><b>Check your email</b><span>If a matching account exists, a password-reset link has been requested for {email}.</span></div>
          </div>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            <label>Email address<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" /></label>

            {mode === "signin" ? (
              <>
                <PasswordField label="Password" value={password} onChange={setPassword} />
                <button type="button" className="inline-link auth-forgot" onClick={() => switchMode("forgot")}>Forgot password?</button>
              </>
            ) : null}

            {mode === "activate" ? (
              <>
                <label>Invite or recovery code<input required value={inviteCode} onChange={(event) => setInviteCode(formatInviteCode(event.target.value))} placeholder="FSY-1234-ABCD-5678-EF90-1234-5678" autoCapitalize="characters" autoComplete="one-time-code" /></label>
                <label>Your name<input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Your full name" autoComplete="name" maxLength={80} /></label>
                <PasswordField label="Create password" value={password} onChange={setPassword} autoComplete="new-password" hint="At least 10 characters. You will use this for future sign-ins." />
                <PasswordField label="Confirm password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
              </>
            ) : null}

            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <button className="primary full" disabled={busy}>
              {busy ? "Working…" : mode === "signin" ? "Sign in" : mode === "activate" ? "Activate account" : "Send reset link"}
              <ArrowRight />
            </button>
          </form>
        )}

        <div className="auth-mode-actions">
          {mode !== "signin" ? <button type="button" className="text-action" onClick={() => switchMode("signin")}><ArrowLeft />Back to sign in</button> : null}
          {mode === "signin" ? <button type="button" className="text-action" onClick={() => switchMode("activate")}><UserPlus />First time here? Activate access</button> : null}
          {mode === "forgot" ? <button type="button" className="text-action" onClick={() => switchMode("activate")}><Key />I have a recovery code</button> : null}
        </div>

        <div className="auth-note"><LockKey weight="fill"/><span>Your password signs you in. Your FSY role separately controls what session information you can see.</span></div>
      </section>
    </main>
  );
}

export function InviteClaimScreen({ profile, onClaim, onSignOut }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onClaim(code);
    } catch (err) {
      setError(err.message || "Unable to activate this invite.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card password-auth-card">
        <BrandMark />
        <span className="kicker">Signed in as {profile?.email || "FSY leader"}</span>
        <h1>Enter your invite code</h1>
        <p>Your account is signed in, but it does not have session access yet. Use the one-time code given to you by FSY leadership.</p>
        <form className="auth-form" onSubmit={submit}>
          <label>Invite code<input required value={code} onChange={(event) => setCode(formatInviteCode(event.target.value))} placeholder="FSY-1234-ABCD-5678-EF90-1234-5678" autoComplete="one-time-code" /></label>
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <button className="primary full" disabled={busy}>{busy ? "Activating…" : "Activate access"}<ArrowRight /></button>
        </form>
        <button className="text-action" onClick={onSignOut}><SignOut />Sign out</button>
      </section>
    </main>
  );
}

export function PasswordRecoveryScreen({ onUpdate, onCancel }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (password !== confirm) return setError("The two passwords do not match.");
    setBusy(true);
    try {
      await onUpdate(password);
      setDone(true);
    } catch (err) {
      setError(err.message || "Unable to update your password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card password-auth-card">
        <BrandMark />
        <span className="kicker">Account recovery</span>
        <h1>{done ? "Password updated" : "Choose a new password"}</h1>
        {done ? (
          <>
            <div className="auth-success"><CheckCircle weight="fill"/><div><b>You are ready</b><span>Your new password will work the next time you sign in.</span></div></div>
            <button className="primary full" onClick={onCancel}>Continue</button>
          </>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            <PasswordField label="New password" value={password} onChange={setPassword} autoComplete="new-password" hint="At least 10 characters." />
            <PasswordField label="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <button className="primary full" disabled={busy}>{busy ? "Updating…" : "Save new password"}</button>
          </form>
        )}
      </section>
    </main>
  );
}

export function LoadingScreen({ text = "Connecting to FSY Kumasi…" }) {
  return <main className="auth-page"><section className="auth-card loading-card"><BrandMark /><div className="loading-dot"/><h2>{text}</h2></section></main>;
}
