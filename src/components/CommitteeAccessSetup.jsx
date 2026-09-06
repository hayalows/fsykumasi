import { useState } from "react";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Copy } from "@phosphor-icons/react/Copy";
import { X } from "@phosphor-icons/react/X";
import { DismissibleLayer, MutationFeedback } from "./UI.jsx";
import { TeamChoices } from "./AccountSetup.jsx";

export function CommitteeAccessSetup({ teams = [], initialName = "", initialEmail = "", onCreate, onClose }) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [teamKeys, setTeamKeys] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState(false);

  const close = () => { if (!busy) onClose?.(); };
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await onCreate?.({
        displayName: name.trim(),
        email: email.trim(),
        role: "committee_viewer",
        companyIds: [],
        committeeScope: teamKeys,
      });
      setCreated(result);
    } catch (err) {
      setError(err.message || "Committee access could not be prepared.");
    } finally {
      setBusy(false);
    }
  };

  const setupLink = created && typeof window !== "undefined"
    ? `${window.location.origin}/?invite=${encodeURIComponent(created.code)}`
    : "";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(setupLink);
      setCopied(true);
    } catch {
      setError("Copy did not work on this device. Select the code manually instead.");
    }
  };

  return <DismissibleLayer open onClose={close} title="Committee website access" sheet className="committee-access-sheet">
    <div className="committee-access-shell">
      <button type="button" data-layer-close className="icon-button modal-close" onClick={close} disabled={busy} aria-label="Close"><X /></button>
      {created ? <div className="committee-access-ready">
        <CheckCircle className="committee-access-ready-icon" weight="fill" />
        <span className="kicker">Setup ready</span>
        <h2>Send this to {name}</h2>
        <p>This account receives only the committee tools selected below. It does not create or change an FSY staff assignment.</p>
        <label>One-time code<input readOnly value={created.code} /></label>
        {created.expiresAt ? <small>Expires {new Date(created.expiresAt).toLocaleString()}.</small> : null}
        {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
        <div className="field-sheet-actions">
          <button type="button" className="primary" onClick={copyLink}><Copy />{copied ? "Link copied" : "Copy setup link"}</button>
          <button type="button" className="secondary" onClick={close}>Done</button>
        </div>
      </div> : <form className="committee-access-form" onSubmit={submit}>
        <header>
          <span className="kicker">Website-only access</span>
          <h2>Invite a committee member</h2>
          <p>Use this only when the person needs committee tools but does not have a staff-linked session role. Staff roles and company assignments belong in Assignments.</p>
        </header>
        <div className="committee-access-grid">
          <label>Name<input required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>
          <label>Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
        </div>
        <section>
          <div className="committee-access-section-head"><b>Committee tools</b><small>Select only the work this person needs.</small></div>
          <TeamChoices teams={teams} selected={teamKeys} onChange={setTeamKeys} compact />
        </section>
        {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
        <footer className="field-sheet-actions">
          <button type="button" className="secondary" onClick={close} disabled={busy}>Cancel</button>
          <button className="primary" disabled={busy || !onCreate || !name.trim() || !email.trim() || !teamKeys.length}>{busy ? "Preparing…" : "Create setup link"}</button>
        </footer>
      </form>}
    </div>
  </DismissibleLayer>;
}
