import { supabase } from './supabase.js';
async function rpc(name,args){const {data,error}=await supabase.rpc(name,args);if(error)throw error;return data;}
export const updateStaffOperations=(person,state)=>rpc('update_staff_operations',{
 p_staff_id:person.id,p_revision:Number(person.operationsRevision||0),p_planning:state.planning,p_arrival:state.arrival,p_clearance:state.clearance,p_authority:state.authority||'',p_reason:state.reason||'',p_duties:state.duties||[]
});
export const setStaffOperationalStatus=(person,status,authority='',reason='')=>rpc('set_staff_operational_status_v1',{
 p_staff_id:person.id,p_status:status,p_revision:Number(person.operationsRevision||0),p_authority:authority||'',p_reason:reason||''
});
export const saveStaffCompanyLimit=(sessionId,limit)=>rpc('set_staff_company_limit',{p_session_id:sessionId,p_limit:Number(limit)});
export const recordParticipantException=(id,form)=>rpc('record_participant_exception',{
 p_participant_id:id,p_allow:form.allow,p_authority:form.authority,p_reason:form.reason,p_registration_confirmed:form.registration,p_guardian_confirmed:form.guardian,p_leadership_confirmed:form.leadership
});
