import { useState } from "react";
import { X } from "@phosphor-icons/react/X";
import { DismissibleLayer, MutationFeedback } from "./UI.jsx";
import { supabase } from "../lib/supabase.js";

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
        displayName: name,
        email,
        role,
        companyIds: role === "assistant_coordinator" ? companyIds : [],
        committeeScope: teamKeys,
      });
      setCreated(result);
    } catch (err) {
      setError(err.message || "Website access could not be prepared.");
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (!busy) onClose?.();
  };

  return <DismissibleLayer open onClose={close} title="Invite website account" sheet className="account-setup-sheet">
    <div className="headcount-create account-setup-shell">
      <button type="button" data-layer-close className="icon-button modal-close" onClick={close} disabled={busy} aria-label="Close"><X/></button>
      {created ? <>
        <div className="account-setup-header">
          <span className="kicker">Website access</span>
          <h2>Setup is ready</h2>
          <p>Share this one-time setup link with {name}. It is valid only for their email address.</p>
        </div>
        <label>Setup code<input readOnly value={created.code}/></label>
        <p className="form-hint">Expires {new Date(created.expiresAt).toLocaleString()}.</p>
        {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
        <div className="account-ready-actions">
          <button className="primary" onClick={async () => {
            try {
              await navigator.clipboard.writeText(`${window.location.origin}/?invite=${encodeURIComponent(created.code)}`);
              setCopied(true);
            } catch {
              setError("Copy failed. Select the code above to copy it.");
            }
          }}>{copied ? "Link copied" : "Copy setup link"}</button>
          <button className="secondary" onClick={close}>Done</button>
        </div>
      </> : <form className="account-setup-form" onSubmit={submit}>
        <div className="account-setup-header">
          <span className="kicker">Website access</span>
          <h2>Invite website account</h2>
          <p>A Staff record is not required. Choose only the responsibilities this person needs.</p>
        </div>
        <label>Name<input required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name"/></label>
        <label>Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email"/></label>
        <label>Website role<select value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="committee_viewer">Committee member</option>
          <option value="assistant_coordinator">Assistant coordinator</option>
          <option value="coordinator">Coordinator</option>
          <option value="logistics_admin">Logistical administrator</option>
          <option value="session_director">Session directing couple</option>
        </select></label>
        {role === "assistant_coordinator" ? <fieldset>
          <legend>Assigned companies</legend>
          <p>For existing Staff, use their linked account so assignment changes sync automatically.</p>
          {companies.map((company) => <label className="account-choice" key={company.id}>
            <input type="checkbox" checked={companyIds.includes(company.id)} onChange={(event) => setCompanyIds((ids) => event.target.checked ? [...ids, company.id] : ids.filter((id) => id !== company.id))}/>
            <span><b>{company.name}</b></span>
          </label>)}
        </fieldset> : null}
        <TeamChoices teams={teams} selected={teamKeys} onChange={setTeamKeys}/>
        {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
        <div className="field-sheet-actions">
          <button type="button" className="secondary" disabled={busy} onClick={close}>Cancel</button>
          <button className="primary" disabled={busy || !onCreate || (role === "committee_viewer" && !teamKeys.length) || (role === "assistant_coordinator" && !companyIds.length)}>{busy ? "Preparing…" : "Create setup code"}</button>
        </div>
      </form>}
    </div>
  </DismissibleLayer>;
}

export function TeamChoices({ teams, selected, onChange }) {
  return <fieldset>
    <legend>Additional committee responsibilities</legend>
    {teams.map((team) => <label className="account-choice" key={team.key}>
      <input type="checkbox" checked={selected.includes(team.key)} onChange={(event) => onChange(event.target.checked ? [...selected, team.key] : selected.filter((key) => key !== team.key))}/>
      <span><b>{team.name}</b><small>{team.description}</small></span>
    </label>)}
  </fieldset>;
}

export function AccountTeams({ user, sessionId, teams, onClose, onSaved }) {
  const [selected, setSelected] = useState(user.teamKeys || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = () => {
    if (!busy) onClose?.();
  };

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

  return <DismissibleLayer open onClose={close} title="Committee responsibilities" sheet className="account-team-sheet">
    <div className="headcount-create account-team-shell">
      <button type="button" data-layer-close className="icon-button modal-close" onClick={close} disabled={busy} aria-label="Close"><X/></button>
      <div className="account-team-header">
        <span className="kicker">Additional access</span>
        <h2>{user.name}</h2>
        <p>These tools are added to the person's existing role and company responsibilities.</p>
      </div>
      <TeamChoices teams={teams} selected={selected} onChange={setSelected}/>
      {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      <div className="field-sheet-actions">
        <button className="secondary" onClick={close} disabled={busy}>Cancel</button>
        <button className="primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save responsibilities"}</button>
      </div>
    </div>
  </DismissibleLayer>;
}
