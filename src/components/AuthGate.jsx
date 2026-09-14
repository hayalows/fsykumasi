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
import { inspectLeaderInvite } from "../lib/auth.js";
import { APP_NAME } from "../lib/app-meta.js";
import { BrandMark } from "./BrandMark.jsx";
import "./auth-password.css";

function formatInviteCode(value = "") {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact) return "";

  // Keep legacy and recovery FSY codes working exactly as before.
  if (compact.startsWith("FSY")) {
    const raw = compact.slice(3).slice(0, 24);
    const parts = raw.match(/.{1,4}/g) || [];
    return raw ? `FSY-${parts.join("-")}` : "FSY";
  }

  // New onboarding codes use a four-character human label (AC01, CMFO,
  // CO01...) plus ten random characters. Formatting is visual only.
  const raw = compact.slice(0, 14);
  if (raw.length <= 4) return raw;
  const prefix = raw.slice(0, 4);
  const tail = raw.slice(4).match(/.{1,4}/g) || [];
  return `${prefix}-${tail.join("-")}`;
}

function roleLabel(role) {
  return ({
    assistant_coordinator: "Assistant coordinator",
    coordinator: "Coordinator",
    logistics_admin: "Logistical administrator",
    session_director: "Session directing couple",
    area_advisory_couple: "FSY area advisory couple",
    committee_viewer: "Committee member",
  })[role] || "FSY leader";
}

function inviteScope(info) {
  if (!info) return "";
  if (info.role === "assistant_coordinator" && info.companyNames?.length) return info.companyNames.join(" · ");
  if (info.role === "committee_viewer" && info.committeeScope?.length) return info.committeeScope.join(" · ");
  return "";
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
  const [mode, setMode] = useState(initialInvite ? "setup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inviteCode, setInviteCode] = useState(formatInviteCode(initialInvite));
  const [setupInfo, setSetupInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!initialInvite) return undefined;
    let active = true;
    const code = formatInviteCode(initialInvite);
    setMode("setup");
    setInviteCode(code);
    setBusy(true);
    setError("");
    inspectLeaderInvite(code)
      .then((info) => { if (active) setSetupInfo(info); })
      .catch((err) => { if (active) setError(err.message || "We could not verify that setup link."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [initialInvite]);

  const switchMode = (next) => {
    setMode(next);
    setBusy(false);
    setSent(false);
    setError("");
    setPassword("");
    setConfirmPassword("");
    if (next !== "setup") setSetupInfo(null);
  };

  const verifySetupCode = async () => {
    if (!inviteCode) throw new Error("Enter the setup or recovery code from FSY leadership.");
    const info = await inspectLeaderInvite(inviteCode);
    setSetupInfo(info);
    return info;
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "signin") {
        await onSignIn(email, password);
      } else if (mode === "setup") {
        if (!setupInfo) {
          await verifySetupCode();
          return;
        }
        if (password !== confirmPassword) throw new Error("The two passwords do not match.");
        await onActivate({ code: inviteCode, password });
        if (typeof window !== "undefined") window.history.replaceState({}, "", window.location.pathname);
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

  const setupTitle = setupInfo
    ? setupInfo.purpose === "recovery" ? "Choose a new password" : `Welcome, ${setupInfo.displayName}`
    : "Use your FSY setup code";
  const title = mode === "signin" ? "Sign in" : mode === "setup" ? setupTitle : "Reset your password";
  const description = mode === "signin"
    ? "Use your email and password to continue."
    : mode === "setup"
      ? setupInfo
        ? setupInfo.purpose === "recovery"
          ? "Your account is verified. Create a new password and you will be signed in automatically."
          : "We found your FSY assignment. Create your password once and you are ready to go."
        : "Enter the short code from FSY leadership, or open the setup link they sent you."
      : "We can email a reset link. If email is delayed or rate-limited, an FSY administrator can give you a recovery code instead.";
  const scope = inviteScope(setupInfo);

  return (
    <main className="auth-page">
      <section className="auth-card password-auth-card">
        <BrandMark />
        <span className="kicker">{APP_NAME}</span>
        <h1>{title}</h1>
        <p>{description}</p>

        {sent ? (
          <div className="auth-success password-reset-success">
            <CheckCircle weight="fill" />
            <div><b>Check your email</b><span>If a matching account exists, a password-reset link has been requested for {email}.</span></div>
          </div>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            {mode === "signin" ? (
              <>
                <label>Email address<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" /></label>
                <PasswordField label="Password" value={password} onChange={setPassword} />
                <button type="button" className="inline-link auth-forgot" onClick={() => switchMode("forgot")}>Forgot password?</button>
              </>
            ) : null}

            {mode === "setup" && !setupInfo ? (
              <div className="setup-code-step">
                <label>Setup or recovery code<input autoFocus required value={inviteCode} onChange={(event) => setInviteCode(formatInviteCode(event.target.value))} placeholder="AC01-7F3A-9C2D-8B" autoCapitalize="characters" autoComplete="one-time-code" inputMode="text" /></label>
                <small>Your name, role and assigned companies are already attached to the code. You do not need to enter them again.</small>
              </div>
            ) : null}

            {mode === "setup" && setupInfo ? (
              <>
                <div className="setup-identity" aria-label="Verified FSY account">
                  <span className="setup-identity-icon"><CheckCircle weight="fill" /></span>
                  <div className="setup-identity-copy">
                    <span>FSY assignment found</span>
                    <b>{setupInfo.displayName}</b>
                    <small>{setupInfo.maskedEmail} · {roleLabel(setupInfo.role)}</small>
                    {scope ? <small className="setup-identity-scope">{scope}</small> : null}
                  </div>
                </div>
                <PasswordField label={setupInfo.purpose === "recovery" ? "New password" : "Create password"} value={password} onChange={setPassword} autoComplete="new-password" hint="At least 10 characters. After this, your phone can stay signed in." />
                <PasswordField label="Confirm password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
              </>
            ) : null}

            {mode === "forgot" ? (
              <label>Email address<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" /></label>
            ) : null}

            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <button className="primary full" disabled={busy}>
              {busy
                ? mode === "setup" && !setupInfo ? "Checking code…" : "Working…"
                : mode === "signin" ? "Sign in"
                  : mode === "setup" ? setupInfo ? setupInfo.purpose === "recovery" ? "Save password & sign in" : "Finish setup & sign in" : "Continue"
                    : "Send reset link"}
              <ArrowRight />
            </button>
          </form>
        )}

        <div className="auth-mode-actions">
          {mode !== "signin" ? <button type="button" className="text-action" onClick={() => switchMode("signin")}><ArrowLeft />Back to sign in</button> : null}
          {mode === "signin" ? <button type="button" className="text-action" onClick={() => switchMode("setup")}><Key />First time here? Use a setup code</button> : null}
          {mode === "forgot" ? <button type="button" className="text-action" onClick={() => switchMode("setup")}><Key />Use a recovery code instead</button> : null}
          {mode === "setup" && setupInfo ? <button type="button" className="text-action" onClick={() => { setSetupInfo(null); setPassword(""); setConfirmPassword(""); setError(""); }}><UserPlus />Use a different code</button> : null}
        </div>

        <div className="auth-note"><LockKey weight="fill"/><span>Your sign-in proves who you are. Your current FSY assignment controls what you can see and do.</span></div>
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
        <h1>Connect your FSY access</h1>
        <p>Your sign-in is ready. Enter the one-time code from FSY leadership to connect this session.</p>
        <form className="auth-form" onSubmit={submit}>
          <label>Setup code<input required value={code} onChange={(event) => setCode(formatInviteCode(event.target.value))} placeholder="AC01-7F3A-9C2D-8B" autoCapitalize="characters" autoComplete="one-time-code" /></label>
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <button className="primary full" disabled={busy}>{busy ? "Connecting…" : "Connect access"}<ArrowRight /></button>
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

export function WorkspaceRecoveryScreen({ message, supportReference, onRetry, onSignOut }) {
  return <main className="auth-page workspace-recovery-page"><section className="auth-card loading-card workspace-recovery-card"><BrandMark/><span className="kicker">Signed in</span><h2>Your FSY workspace needs another try</h2><p>{message || "Your account is signed in. Some workspace information did not load yet."}</p><div className="runtime-recovery-actions"><button className="primary full" onClick={onRetry}>Try loading workspace again</button><button className="secondary full" onClick={onSignOut}>Sign out</button></div>{supportReference?<small>Support reference: <b>{supportReference}</b></small>:null}</section></main>;
}

export function LoadingScreen({ text = `Connecting to ${APP_NAME}…` }) {
  return <main className="auth-page"><section className="auth-card loading-card"><BrandMark /><div className="loading-dot"/><h2>{text}</h2></section></main>;
}
