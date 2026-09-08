import { useState } from 'react';
import { DismissibleLayer, MutationFeedback } from './UI.jsx';
import { staffState, STAFF_PLANNING, STAFF_ARRIVAL, STAFF_CLEARANCE } from '../lib/staff-state.js';
import { updateStaffOperations } from '../lib/operational-state.js';
import './operational-state.css';
const labels={primary:'Primary',reserve:'Reserve',provisional:'Provisional',excluded:'Excluded',expected:'Expected',arrived:'Arrived',no_show:'No-show',left:'Left',cleared:'Cleared',confirmation_required:'Needs confirmation',not_cleared:'Not cleared'};
export function StaffOperationsSheet({person,currentRole,onClose,onSaved,assignment}){
 const [form,setForm]=useState({...staffState(person),authority:'',reason:'',duties:(person.committeeDuties||[]).join(', ')}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const initial=staffState(person),director=currentRole==='session_director';
 const save=async event=>{event.preventDefault();setBusy(true);setError('');try{await updateStaffOperations(person,{...form,duties:form.duties.split(',').map(s=>s.trim()).filter(Boolean)});await onSaved();onClose();}catch(e){setError(e.message||'Could not save staff state');}finally{setBusy(false);}};
 return <DismissibleLayer open onClose={()=>!busy&&onClose()} title={`Staff arrival: ${person.name}`} sheet className="operations-state-layer"><form className="operations-state-form" onSubmit={save}><header><div><span className="kicker">Staff arrival & service</span><h2>{person.name}</h2></div><button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Close">×</button></header><p>{assignment||'Reserve pool · no current responsibility'}</p><p>Source registration: <b>{person.registrationStatus==='awaiting'?'Awaiting approval':person.registrationStatus}</b></p>{error?<MutationFeedback tone="error">{error}</MutationFeedback>:null}
 {[["planning","Planning",STAFF_PLANNING],["arrival","Arrival",STAFF_ARRIVAL],["clearance","Service clearance",STAFF_CLEARANCE]].map(([key,label,values])=><label key={key}>{label}<select value={form[key]} disabled={busy||(key==='clearance'&&!director)} onChange={e=>setForm({...form,[key]:e.target.value})}>{values.map(value=><option key={value} value={value}>{labels[value]}</option>)}</select></label>)}
 {form.clearance!=='cleared'?<p className="notice">Arrival records physical presence. This person needs confirmation before active service.</p>:null}{!director?<p className="form-hint">Only Session Directing Couples record service confirmation.</p>:null}
 <label>Committee duties <small>Separate duties with commas</small><input value={form.duties} maxLength={500} placeholder="Food, Games Night" onChange={e=>setForm({...form,duties:e.target.value})}/></label>
 {form.clearance!==initial.clearance?<label>Confirming authority<input required minLength={3} maxLength={150} value={form.authority} onChange={e=>setForm({...form,authority:e.target.value})}/></label>:null}
 <label>Reason <textarea required={form.clearance!==initial.clearance||['no_show','left'].includes(form.arrival)} minLength={5} maxLength={500} placeholder="Operational reason only; do not record private health details" value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})}/></label>
 <button className="primary" disabled={busy}>{busy?'Saving…':'Save staff state'}</button></form></DismissibleLayer>;
}
