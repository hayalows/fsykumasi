import { useState } from "react";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { X } from "@phosphor-icons/react/X";
import { DismissibleLayer, MutationFeedback } from "./UI.jsx";
import { supabase } from "../lib/supabase.js";
import "./account-setup-v2.css";

const RESPONSIBILITIES = [
  ["committee_viewer", "Committee member"],
  ["assistant_coordinator", "Assistant coordinator"],
  ["coordinator", "Coordinator"],
  ["logistics_admin", "Logistical administrator"],
  ["session_director", "Session directing couple"],
];

export function AccountSetup({ teams = [], companies = [], onCreate, onClose }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("committee_viewer");
  const [teamKeys, setTeamKeys] = useState([]);
  const [companyIds, setCompanyIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await onCreate({
        displayName: name.trim(),
        email: email.trim(),
        role,
        companyIds: role === "assistant_coordinator" ? companyIds : [],
        committeeScope: teamKeys,
      });
      setCreated(result);
    } catch (err) {
      setError(err.message || "Invite could not be prepared.");
    } finally {
      setBusy(false);
    }
  };

  const close = () => { if (!busy) onClose?.(); };
  const needsCommittee = role === "committee_viewer";
  const needsCompanies = role === "assistant_coordinator";

  return <DismissibleLayer open onClose={close} title="Invite someone" sheet className="account-setup-sheet account-setup-sheet-v2">
    <div className="account-setup-shell-v2">
      <button type="button" data-layer-close className="icon-button modal-close" onClick={close} disabled={busy} aria-label="Close"><X /></button>

      {created ? <div className="account-invite-ready">
        <div className="account-ready-mark"><CheckCircle weight="fill" /></div>
        <span className="kicker">Invite ready</span>
        <h2>{name} can set up their account</h2>
        <p>Send the one-time link to the email address you entered. Their responsibilities are already attached to the invite.</p>
        <label className="account-code-field">Setup code<input readOnly value={created.code} /></label>
        <small>Expires {new Date(created.expiresAt).toLocaleString()}.</small>
        {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
        <div className="account-ready-actions">
          <button className="primary" type="button" onClick={async () => {
            try {
              await navigator.clipboard.writeText(`${window.location.origin}/?invite=${encodeURIComponent(created.code)}`);
              setCopied(true);
            } catch {
              setError("Copy failed. Select the setup code above to copy it.");
            }
          }}>{copied ? "Invite link copied" : "Copy invite link"}</button>
          <button className="secondary" type="button" onClick={close}>Done</button>
        </div>
      </div> : <form className="account-setup-form-v2" onSubmit={submit}>
        <header className="account-setup-header-v2">
          <span className="kicker">New website account</span>
          <h2>Invite someone new</h2>
          <p>They do not need to already exist in Staff. Choose what they are responsible for now. You can change it later.</p>
        </header>

        <section className="account-step-v2">
          <div className="account-step-heading"><span>1</span><div><b>Who is this?</b><small>Use the name they will recognize on the app.</small></div></div>
          <div className="account-basic-grid">
            <label>Name<input required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="e.g. Ama Mensah" /></label>
            <label>Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="name@example.com" /></label>
          </div>
        </section>

        <section className="account-step-v2">
          <div className="account-step-heading"><span>2</span><div><b>Primary responsibility</b><small>This decides the person's default scope and starting experience.</small></div></div>
          <label className="account-role-field"><span className="sr-only">Primary responsibility</span><select value={role} onChange={(event) => { setRole(event.target.value); if (event.target.value !== "assistant_coordinator") setCompanyIds([]); }}>{RESPONSIBILITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </section>

        {needsCompanies ? <section className="account-step-v2 account-scope-step">
          <div className="account-step-heading"><span>3</span><div><b>Which companies?</b><small>The Assistant Coordinator sees and supervises only these companies.</small></div></div>
          <div className="account-choice-list-v2">
            {companies.map((company) => <label className={companyIds.includes(company.id) ? "account-choice-v2 selected" : "account-choice-v2"} key={company.id}>
              <input type="checkbox" checked={companyIds.includes(company.id)} onChange={(event) => setCompanyIds((ids) => event.target.checked ? [...ids, company.id] : ids.filter((id) => id !== company.id))} />
              <span><b>{company.displayName || company.name}</b><small>Company responsibility</small></span>
            </label>)}
          </div>
        </section> : null}

        {needsCommittee ? <section className="account-step-v2 account-scope-step">
          <div className="account-step-heading"><span>3</span><div><b>Which committee?</b><small>Choose the work this committee member needs in the app.</small></div></div>
          <TeamChoices teams={teams} selected={teamKeys} onChange={setTeamKeys} compact />
        </section> : <details className="account-extra-responsibility">
          <summary><span><b>Add another committee responsibility</b><small>Optional. Only add tools they genuinely need.</small></span><span aria-hidden="true">+</span></summary>
          <TeamChoices teams={teams} selected={teamKeys} onChange={setTeamKeys} compact />
        </details>}

        {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
        <footer className="account-setup-actions-v2">
          <button type="button" className="secondary" disabled={busy} onClick={close}>Cancel</button>
          <button className="primary" disabled={busy || !onCreate || !name.trim() || !email.trim() || (needsCommittee && !teamKeys.length) || (needsCompanies && !companyIds.length)}>{busy ? "Creating invite…" : <>Create invite<ArrowRight /></>}</button>
        </footer>
      </form>}
    </div>
  </DismissibleLayer>;
}

export function TeamChoices({ teams, selected, onChange, compact = false }) {
  return <div className={compact ? "account-choice-list-v2 compact" : "account-choice-list-v2"} role="group" aria-label="Committee responsibilities">
    {teams.map((team) => <label className={selected.includes(team.key) ? "account-choice-v2 selected" : "account-choice-v2"} key={team.key}>
      <input type="checkbox" checked={selected.includes(team.key)} onChange={(event) => onChange(event.target.checked ? [...selected, team.key] : selected.filter((key) => key !== team.key))} />
      <span><b>{team.name}</b><small>{team.description}</small></span>
    </label>)}
  </div>;
}

export function AccountTeams({ user, sessionId, teams, onClose, onSaved }) {
  const [selected, setSelected] = useState(user.teamKeys || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = () => { if (!busy) onClose?.(); };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const { error: saveError } = await supabase.rpc("set_account_teams", {
        p_session_id: sessionId,
        p_user_id: user.userId,
        p_team_keys: selected,
      });
      if (saveError) throw saveError;
      await onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err.message || "Committee responsibilities could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return <DismissibleLayer open onClose={close} title="Committee responsibilities" sheet className="account-team-sheet account-setup-sheet-v2">
    <div className="account-setup-shell-v2">
      <button type="button" data-layer-close className="icon-button modal-close" onClick={close} disabled={busy} aria-label="Close"><X /></button>
      <header className="account-setup-header-v2"><span className="kicker">Additional access</span><h2>{user.name}</h2><p>Add only the committee tools this person needs beyond their primary responsibility.</p></header>
      <TeamChoices teams={teams} selected={selected} onChange={setSelected} />
      {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      <footer className="account-setup-actions-v2"><button className="secondary" type="button" onClick={close} disabled={busy}>Cancel</button><button className="primary" type="button" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save responsibilities"}</button></footer>
    </div>
  </DismissibleLayer>;
}
