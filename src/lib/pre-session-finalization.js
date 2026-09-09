import { isSupabaseConfigured, supabase } from "./supabase.js";

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

export async function loadPreSessionFinalizationSummary(sessionId) {
  const { data, error } = await client().rpc("get_pre_session_finalization_summary_v1", {
    p_session_id: sessionId,
  });
  if (error) throw error;
  return {
    participantCurrent: Number(data?.participant_current || 0),
    participantFinal: Number(data?.participant_final || 0),
    participantRemaining: Number(data?.participant_remaining || 0),
    participantFinalOut: Number(data?.participant_final_out || 0),
    staffCurrent: Number(data?.staff_current || 0),
    staffFinal: Number(data?.staff_final || 0),
    staffRemaining: Number(data?.staff_remaining || 0),
    groupsTotal: Number(data?.groups_total || 0),
    groupsNeedCounselor: Number(data?.groups_need_counselor || 0),
    companiesTotal: Number(data?.companies_total || 0),
    companiesNeedAssistant: Number(data?.companies_need_assistant || 0),
    assistantCompanyLimit: Number(data?.assistant_company_limit || 1),
  };
}
