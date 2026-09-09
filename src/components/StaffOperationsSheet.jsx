import { useState } from 'react';
import { DismissibleLayer, MutationFeedback } from './UI.jsx';
import { staffResponsibilityLabel, staffState, STAFF_PLANNING, STAFF_ARRIVAL, STAFF_CLEARANCE } from '../lib/staff-state.js';
import { setStaffOperationalStatus, updateStaffOperations } from '../lib/operational-state.js';
import './operational-state.css';

const labels={
 primary:'Primary staff',reserve:'Reserve staff',provisional:'Provisional',excluded:'Not serving',
 expected:'Expected to arrive',arrived:'Present at session',no_show:'Did not arrive',left:'Left session',
 cleared:'Ready to serve',confirmation_required:'Needs confirmation',not_cleared:'Not cleared'
};

const fieldHelp={
 planning:'Where this person sits in the staffing plan.',
 arrival:'Whether they are physically at the FSY session.',
 clearance:'Whether session leadership has confirmed they may actively serve.'
};

export function StaffOperationsSheet({person,currentRole,onClose,onSaved,assignment}){
 const initial=staffState(person),canConfirm=['session_director','logistics_admin'].includes(currentRole),leadership=['coordinator','logistics_admin','session_director'].includes(currentRole);
 const initialLifecycle=person.isCurrent===false?'withdrawn':['no_show','left'].includes(initial.arrival)?initial.arrival:'active';
 const [form,setForm]=useState({...initial,authority:'',reason:'',duties:(person.committeeDuties||[]).join(', ')}),[lifecycle,setLifecycle]=useState(initialLifecycle),[lifecycleAuthority,setLifecycleAuthority]=useState(''),[lifecycleReason,setLifecycleReason]=useState(''),[busy,setBusy]=useState(false),[lifecycleBusy,setLifecycleBusy]=useState(false),[error,setError]=useState('');
 const save=async event=>{event.preventDefault();setBusy(true);setError('');try{await updateStaffOperations(person,{...form,duties:form.duties.split(',').map(s=>s.trim()).filter(Boolean)});await onSaved();onClose();}catch(e){setError(e.message||'Could not save staff status');}finally{setBusy(false);}};
 const saveLifecycle=async()=>{if(lifecycle!=='active'&&lifecycleReason.trim().length<5){setError('Add an operational reason before changing this staff member’s active status.');return;}if(lifecycle==='withdrawn'&&lifecycleAuthority.trim().length<3){setError('Add the authorized confirming authority before withdrawing this staff member.');return;}setLifecycleBusy(true);setError('');try{await setStaffOperationalStatus(person,lifecycle,lifecycleAuthority.trim(),lifecycleReason.trim());await onSaved();onClose();}catch(e){setError(e.message||'Could not update this staff member’s operational status. Refresh and review coverage.');}finally{setLifecycleBusy(false);}};
 const registrationLabel=person.registrationStatus==='awaiting'?'Awaiting source approval':person.registrationStatus||'Not recorded';
 const responsibility=person.operationalRole==='committee_member'?staffResponsibilityLabel({...person,committeeDuties:form.duties.split(',').map(s=>s.trim()).filter(Boolean)}):(assignment||staffResponsibilityLabel(person));
 return <DismissibleLayer open onClose={()=>!busy&&!lifecycleBusy&&onClose()} title={`Staff status: ${person.name}`} sheet className="operations-state-layer staff-status-v36-layer"><form className="operations-state-form staff-status-v36" onSubmit={save}>
  <header><div><span className="kicker">Staff status</span><h2>{person.name}</h2><p>{responsibility||'Reserve pool · no current responsibility'}</p></div><button type="button" className="icon-button" onClick={onClose} disabled={busy||lifecycleBusy} aria-label="Close">×</button></header>
  <div className="staff-status-v36-summary" aria-label="Current staff status">
   <span><small>Plan</small><b>{labels[form.planning]||form.planning}</b></span>
   <span><small>Presence</small><b>{labels[form.arrival]||form.arrival}</b></span>
   <span><small>Ready to serve</small><b>{labels[form.clearance]||form.clearance}</b></span>
  </div>
  <p className="staff-status-v36-source">Registration: <b>{registrationLabel}</b></p>
  <div className="staff-status-v36-explainer"><b>These three statuses answer different questions.</b><p><strong>Plan</strong> says whether the person is part of the staffing plan. <strong>Presence</strong> says whether they are physically here. <strong>Ready to serve</strong> is the local session confirmation for active service.</p></div>
  {error?<MutationFeedback tone="error">{error}</MutationFeedback>:null}
  <section className="staff-status-v36-fields" aria-label="Staff operational status">
   {[["planning","Plan",STAFF_PLANNING],["arrival","Presence",STAFF_ARRIVAL],["clearance","Ready to serve",STAFF_CLEARANCE]].map(([key,label,values])=><label key={key}><span className="staff-status-v36-label"><b>{label}</b><small>{fieldHelp[key]}</small></span><select value={form[key]} disabled={busy||(key==='clearance'&&!canConfirm)} onChange={e=>setForm({...form,[key]:e.target.value})}>{values.map(value=><option key={value} value={value}>{labels[value]||value}</option>)}</select></label>)}
  </section>
  {!canConfirm?<p className="form-hint staff-status-v36-authority">A Session Directing Couple or Logistical Administrator records <b>Ready to serve</b>.</p>:null}
  {form.arrival==='arrived'&&form.clearance!=='cleared'?<p className="notice">This person is physically present, but they are not yet marked Ready to serve.</p>:null}
  <details className="staff-status-v36-details"><summary>Responsibility & operational note</summary><div>
   <label>{person.operationalRole==='committee_member'?'Committee responsibility':'Committee duties'} <small>{person.operationalRole==='committee_member'?'Use a simple name such as Materials or Food. It will show as “Materials committee”.':'Separate additional duties with commas.'}</small><input value={form.duties} maxLength={500} placeholder={person.operationalRole==='committee_member'?'Materials':'Food, Games Night'} onChange={e=>setForm({...form,duties:e.target.value})}/></label>
   {form.clearance!==initial.clearance?<label>Confirming authority<input required minLength={3} maxLength={150} value={form.authority} onChange={e=>setForm({...form,authority:e.target.value})} placeholder="Name or role of confirming leader"/></label>:null}
   <label>Operational note <small>Only add what the next operations leader needs to know.</small><textarea required={form.clearance!==initial.clearance||['no_show','left'].includes(form.arrival)} minLength={5} maxLength={500} placeholder="Do not record private health details" value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})}/></label>
  </div></details>
  <details className="staff-operational-lifecycle staff-status-v36-lifecycle"><summary>No-show, left, or withdrawn</summary><div><p>Use this only when the person will no longer cover their current responsibility. Their source registration and history stay intact. A replacement still needs to be assigned separately.</p><label>Session status<select value={lifecycle} disabled={lifecycleBusy} onChange={e=>{setLifecycle(e.target.value);setError('');}}><option value="active">Active in operations</option><option value="no_show">Did not arrive</option><option value="left">Left the session</option>{leadership?<option value="withdrawn">Withdrawn from session</option>:null}</select></label>{lifecycle!=='active'?<label>Operational reason<textarea required minLength={5} maxLength={240} value={lifecycleReason} onChange={e=>{setLifecycleReason(e.target.value);setError('');}} placeholder="Why coverage must be cleared"/></label>:null}{lifecycle==='withdrawn'?<label>Authorized authority<input required minLength={3} maxLength={150} value={lifecycleAuthority} onChange={e=>{setLifecycleAuthority(e.target.value);setError('');}} placeholder="Confirming leader or role"/></label>:null}<button type="button" className="secondary danger-text" disabled={lifecycleBusy||busy||(!leadership&&lifecycle==='withdrawn')} onClick={saveLifecycle}>{lifecycleBusy?'Saving…':lifecycle==='active'?'Restore active operations':'Clear assignments & record status'}</button></div></details>
  <footer className="staff-status-v36-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy||lifecycleBusy}>Cancel</button><button className="primary" disabled={busy||lifecycleBusy}>{busy?'Saving…':'Save staff status'}</button></footer>
 </form></DismissibleLayer>;
}
