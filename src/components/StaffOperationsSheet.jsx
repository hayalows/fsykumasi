import { useEffect, useState } from 'react';
import { DismissibleLayer, MutationFeedback } from './UI.jsx';
import { staffResponsibilityLabel, staffState, STAFF_PLANNING, STAFF_ARRIVAL, STAFF_CLEARANCE } from '../lib/staff-state.js';
import { setStaffOperationalStatus, updateStaffOperations } from '../lib/operational-state.js';
import './operational-state.css';

const labels = {
  primary: 'Primary staff', reserve: 'Reserve staff', provisional: 'Provisional', excluded: 'Not serving',
  expected: 'Expected to arrive', arrived: 'Present at session', no_show: 'Did not arrive', left: 'Left session',
  cleared: 'Ready to serve', confirmation_required: 'Needs confirmation', not_cleared: 'Not cleared',
};

const fieldHelp = {
  planning: 'Where this person sits in the staffing plan.',
  arrival: 'Whether they are physically at the FSY session.',
  clearance: 'Whether whole-session leadership has confirmed they may actively serve.',
};

const WHOLE_SESSION_LEADERS = ['session_director', 'logistics_admin', 'coordinator', 'area_advisory_couple'];

export function StaffOperationsSheet({ person, currentRole, onClose, onSaved, assignment }) {
  const initial = staffState(person);
  const canConfirm = WHOLE_SESSION_LEADERS.includes(currentRole);
  const leadership = WHOLE_SESSION_LEADERS.includes(currentRole);
  const initialLifecycle = person.isCurrent === false ? 'withdrawn' : ['no_show', 'left'].includes(initial.arrival) ? initial.arrival : 'active';
  const [form, setForm] = useState({ ...initial, authority: '', reason: '', duties: (person.committeeDuties || []).join(', ') });
  const [lifecycle, setLifecycle] = useState(initialLifecycle);
  const [lifecycleAuthority, setLifecycleAuthority] = useState('');
  const [lifecycleReason, setLifecycleReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [error, setError] = useState('');

  const clearanceChanged = form.clearance !== initial.clearance;
  const presenceNeedsReason = ['no_show', 'left'].includes(form.arrival) && form.arrival !== initial.arrival;
  const requiresEvidence = clearanceChanged || presenceNeedsReason;

  useEffect(() => {
    if (requiresEvidence) setDetailsOpen(true);
  }, [requiresEvidence]);

  const validate = () => {
    if (clearanceChanged && !canConfirm) {
      setError('A whole-session leader must record Ready to serve.');
      setDetailsOpen(true);
      return false;
    }
    if (clearanceChanged && form.authority.trim().length < 3) {
      setError('Add the confirming authority in Change details.');
      setDetailsOpen(true);
      return false;
    }
    if (requiresEvidence && form.reason.trim().length < 5) {
      setError('Add a short operational note in Change details before saving.');
      setDetailsOpen(true);
      return false;
    }
    return true;
  };

  const save = async (event) => {
    event.preventDefault();
    setError('');
    if (!validate()) return;
    setBusy(true);
    try {
      await updateStaffOperations(person, {
        ...form,
        duties: form.duties.split(',').map((value) => value.trim()).filter(Boolean),
      });
      await onSaved();
      onClose();
    } catch (saveError) {
      setError(saveError.message || 'Could not save staff status.');
    } finally {
      setBusy(false);
    }
  };

  const saveLifecycle = async () => {
    if (lifecycle !== 'active' && lifecycleReason.trim().length < 5) {
      setError('Add an operational reason before changing this staff member’s active status.');
      return;
    }
    if (lifecycle === 'withdrawn' && lifecycleAuthority.trim().length < 3) {
      setError('Add the authorized confirming authority before withdrawing this staff member.');
      return;
    }
    setLifecycleBusy(true);
    setError('');
    try {
      await setStaffOperationalStatus(person, lifecycle, lifecycleAuthority.trim(), lifecycleReason.trim());
      await onSaved();
      onClose();
    } catch (statusError) {
      setError(statusError.message || 'Could not update this staff member’s operational status. Refresh and review coverage.');
    } finally {
      setLifecycleBusy(false);
    }
  };

  const registrationLabel = person.registrationStatus === 'awaiting' ? 'Awaiting source approval' : person.registrationStatus || 'Not recorded';
  const responsibility = person.operationalRole === 'committee_member'
    ? staffResponsibilityLabel({ ...person, committeeDuties: form.duties.split(',').map((value) => value.trim()).filter(Boolean) })
    : (assignment || staffResponsibilityLabel(person));

  return <DismissibleLayer open onClose={() => !busy && !lifecycleBusy && onClose()} title={`Staff status: ${person.name}`} sheet className="operations-state-layer staff-status-v36-layer">
    <form className="operations-state-form staff-status-v36" onSubmit={save} noValidate aria-busy={busy || lifecycleBusy}>
      <header>
        <div><span className="kicker">Staff status</span><h2>{person.name}</h2><p>{responsibility || 'Reserve pool · no current responsibility'}</p></div>
        <button type="button" className="icon-button" onClick={onClose} disabled={busy || lifecycleBusy} aria-label="Close">×</button>
      </header>

      <div className="staff-status-v36-summary" aria-label="Current staff status">
        <span><small>Plan</small><b>{labels[form.planning] || form.planning}</b></span>
        <span><small>Presence</small><b>{labels[form.arrival] || form.arrival}</b></span>
        <span><small>Ready to serve</small><b>{labels[form.clearance] || form.clearance}</b></span>
      </div>
      <p className="staff-status-v36-source">Registration: <b>{registrationLabel}</b></p>
      <div className="staff-status-v36-explainer"><b>These three statuses answer different questions.</b><p><strong>Plan</strong> says whether the person is part of the staffing plan. <strong>Presence</strong> says whether they are physically here. <strong>Ready to serve</strong> is the local session confirmation for active service.</p></div>

      <section className="staff-status-v36-fields" aria-label="Staff operational status">
        {[['planning', 'Plan', STAFF_PLANNING], ['arrival', 'Presence', STAFF_ARRIVAL], ['clearance', 'Ready to serve', STAFF_CLEARANCE]].map(([key, label, values]) => <label key={key}>
          <span className="staff-status-v36-label"><b>{label}</b><small>{fieldHelp[key]}</small></span>
          <select value={form[key]} disabled={busy || (key === 'clearance' && !canConfirm)} onChange={(event) => { setForm({ ...form, [key]: event.target.value }); setError(''); }}>
            {values.map((value) => <option key={value} value={value}>{labels[value] || value}</option>)}
          </select>
        </label>)}
      </section>

      {!canConfirm ? <p className="form-hint staff-status-v36-authority">A whole-session leader records <b>Ready to serve</b>.</p> : null}
      {form.arrival === 'arrived' && form.clearance !== 'cleared' ? <p className="notice">This person is physically present, but they are not yet marked Ready to serve.</p> : null}

      <details className="staff-status-v36-details" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
        <summary>Change details & responsibilities</summary>
        <div>
          {requiresEvidence ? <p className="form-hint staff-status-v36-required-note">This change needs a confirming authority or short operational note before it can be saved.</p> : null}
          <label>{person.operationalRole === 'committee_member' ? 'Committee responsibility' : 'Committee duties'} <small>{person.operationalRole === 'committee_member' ? 'Use a simple name such as Materials or Food. It will show as “Materials committee”.' : 'Separate additional duties with commas.'}</small><input value={form.duties} maxLength={500} placeholder={person.operationalRole === 'committee_member' ? 'Materials' : 'Food, Games Night'} onChange={(event) => setForm({ ...form, duties: event.target.value })} /></label>
          {clearanceChanged ? <label>Confirming authority<input required value={form.authority} minLength={3} maxLength={150} onChange={(event) => setForm({ ...form, authority: event.target.value })} placeholder="Name or role of confirming leader" /></label> : null}
          <label>Operational note <small>Only add what the next operations leader needs to know.</small><textarea required={requiresEvidence} minLength={requiresEvidence ? 5 : undefined} maxLength={500} placeholder="Do not record private health details" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label>
        </div>
      </details>

      <details className="staff-operational-lifecycle staff-status-v36-lifecycle"><summary>No-show, left, or withdrawn</summary><div><p>Use this only when the person will no longer cover their current responsibility. Their source registration and history stay intact. A replacement still needs to be assigned separately.</p><label>Session status<select value={lifecycle} disabled={lifecycleBusy} onChange={(event) => { setLifecycle(event.target.value); setError(''); }}><option value="active">Active in operations</option><option value="no_show">Did not arrive</option><option value="left">Left the session</option>{leadership ? <option value="withdrawn">Withdrawn from session</option> : null}</select></label>{lifecycle !== 'active' ? <label>Operational reason<textarea required minLength={5} maxLength={240} value={lifecycleReason} onChange={(event) => { setLifecycleReason(event.target.value); setError(''); }} placeholder="Why coverage must be cleared" /></label> : null}{lifecycle === 'withdrawn' ? <label>Authorized authority<input required minLength={3} maxLength={150} value={lifecycleAuthority} onChange={(event) => { setLifecycleAuthority(event.target.value); setError(''); }} placeholder="Confirming leader or role" /></label> : null}<button type="button" className="secondary danger-text" disabled={lifecycleBusy || busy || (!leadership && lifecycle === 'withdrawn')} onClick={saveLifecycle}>{lifecycleBusy ? 'Saving…' : lifecycle === 'active' ? 'Restore active operations' : 'Clear assignments & record status'}</button></div></details>

      <footer className="staff-status-v36-actions">
        {error ? <MutationFeedback tone="error" className="staff-status-v36-error">{error}</MutationFeedback> : null}
        <div className="staff-status-v36-action-buttons"><button type="button" className="secondary" onClick={onClose} disabled={busy || lifecycleBusy}>Cancel</button><button type="submit" className="primary" disabled={busy || lifecycleBusy}>{busy ? 'Saving…' : 'Save staff status'}</button></div>
      </footer>
    </form>
  </DismissibleLayer>;
}
