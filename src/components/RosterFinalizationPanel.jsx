import { useCallback,useEffect,useMemo,useState } from "react";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { ConfirmActionSheet,MutationFeedback,Status } from "./UI.jsx";
import { getMyAccessState } from "../lib/backend.js";
import { applySessionFinalization,previewSessionFinalization } from "../lib/operational-state.js";
import "./session-finalization-v38.css";

const LEADERS=new Set(["logistics_admin","coordinator","session_director"]);
const n=(value)=>Number(value||0).toLocaleString();

export function RosterFinalizationPanel({sessionId,onApplied}){
 const[role,setRole]=useState("");
 const[preview,setPreview]=useState(null);
 const[loading,setLoading]=useState(true);
 const[busy,setBusy]=useState(false);
 const[confirming,setConfirming]=useState(false);
 const[error,setError]=useState("");
 const[result,setResult]=useState(null);
 const allowed=LEADERS.has(role);

 const load=useCallback(async()=>{
  if(!sessionId)return;
  setLoading(true);setError("");
  try{
   const access=await getMyAccessState();
   const grant=(access||[]).find(item=>item.session_id===sessionId&&item.active&&item.role);
   const nextRole=grant?.role||"";setRole(nextRole);
   if(LEADERS.has(nextRole))setPreview(await previewSessionFinalization(sessionId));
   else setPreview(null);
  }catch(err){setError(err.message||"Final-roster review could not load.");}
  finally{setLoading(false);}
 },[sessionId]);
 useEffect(()=>{load();},[load]);

 const alreadyFinal=useMemo(()=>preview&&Number(preview.participantsToPlace||0)===0&&Number(preview.adultsToExclude||0)===0&&Number(preview.staffToClear||0)===0&&Number(preview.existingGroupsMissingCounselor||0)===0,[preview]);
 if(!loading&&!allowed)return null;

 const apply=async()=>{
  setBusy(true);setError("");
  try{
   const receipt=await applySessionFinalization(sessionId);
   setResult(receipt||{});setConfirming(false);
   await onApplied?.();
   await load();
  }catch(err){setError(err.message||"The final roster was not applied. Nothing partial was kept.");}
  finally{setBusy(false);}
 };

 return <section className="roster-finalization-v38" aria-busy={loading||busy}>
  <div className="roster-finalization-v38-copy">
   <span className="kicker">Pre-session final roster</span>
   <h3>{alreadyFinal?"The working rosters are finalized":"Finish the roster without moving anyone already placed"}</h3>
   <p>{alreadyFinal?"New arrivals can now be handled through on-site registration. Source registration records remain available for reference.":"This applies the local Kumasi session decisions, removes age 20+ records from active participant work, clears pending staff for local planning, and adds only the new groups and companies needed for people who are still unplaced."}</p>
  </div>
  {loading?<div className="roster-finalization-v38-loading" role="status">Checking the final roster…</div>:null}
  {error?<MutationFeedback tone="error">{error}</MutationFeedback>:null}
  {!loading&&preview?<>
   <div className="roster-finalization-v38-summary" aria-label="Finalization impact">
    <span><small>Participants to place</small><b>{n(preview.participantsToPlace)}</b><em>{n(preview.femaleParticipantsToPlace)} YW · {n(preview.maleParticipantsToPlace)} YM</em></span>
    <span><small>Leave active participant roster</small><b>{n(preview.adultsToExclude)}</b><em>Age 20+</em></span>
    <span><small>Staff to clear locally</small><b>{n(preview.staffToClear)}</b><em>Source approval stays unchanged</em></span>
    <span><small>Structure added</small><b>{n(preview.suggestedNewGroups)} groups</b><em>{n(preview.suggestedNewCompanies)} new companies</em></span>
   </div>
   <div className="roster-finalization-v38-rules">
    <span><CheckCircle weight="fill" aria-hidden="true"/>Existing participant groups and companies stay where they are.</span>
    <span><CheckCircle weight="fill" aria-hidden="true"/>Current valid counselor and Assistant Coordinator assignments stay in place.</span>
    <span><ShieldCheck weight="fill" aria-hidden="true"/>Imported approval and age data are preserved as source history.</span>
   </div>
   {Number(preview.adultsWithLiveWork||0)>0?<div className="roster-finalization-v38-blocked"><WarningCircle weight="fill"/><span><b>{n(preview.adultsWithLiveWork)} adult record(s) need individual review first.</b><small>They already have live check-in, housing or placement activity, so the batch will not run.</small></span></div>:null}
   <div className="roster-finalization-v38-actions">
    {alreadyFinal?<Status tone="good">Final roster ready</Status>:<Status tone={preview.readyToApply?"good":"warn"}>{preview.readyToApply?"Ready to finalize":"Review required"}</Status>}
    <button type="button" className="secondary" disabled={busy} onClick={load}>Refresh impact</button>
    {!alreadyFinal?<button type="button" className="primary" disabled={busy||!preview.readyToApply} onClick={()=>setConfirming(true)}>Finalize roster</button>:null}
   </div>
  </>:null}
  {result?<MutationFeedback tone="success">Final roster applied. {n(result.participantsLocallyCleared)} participant decisions, {n(result.staffLocallyCleared)} staff clearances, {n(result.newGroups)} new groups and {n(result.newCompanies)} new companies were recorded. Existing assignments moved: 0.</MutationFeedback>:null}
  <ConfirmActionSheet open={confirming} onClose={()=>setConfirming(false)} busy={busy} tone="warn"
   title="Finalize the Kumasi working rosters?"
   description="This is the pre-session cut-off. Source records stay intact, but local decisions become the working truth for Registration, Groups, Assignments, FSY IDs and operations."
   impact={<div className="roster-finalization-v38-confirm"><b>{n(preview?.participantsToPlace)} participants will be placed</b><span>{n(preview?.adultsToExclude)} age 20+ records leave active participant work</span><span>{n(preview?.staffToClear)} pending staff become locally cleared</span><span>No existing participant placement will be changed</span></div>}
   cancelLabel="Go back" confirmLabel="Finalize roster" onConfirm={apply}/>
 </section>;
}
