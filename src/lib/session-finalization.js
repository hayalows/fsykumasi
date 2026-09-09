import { isSupabaseConfigured, supabase } from "./supabase.js";

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

export async function loadSessionFinalizationPreview(sessionId) {
  const { data, error } = await client().rpc("get_session_finalization_preview_v2", { p_session_id: sessionId });
  if (error) throw error;
  return data || {};
}

export async function finalizeSessionRoster(sessionId) {
  const { data, error } = await client().rpc("apply_session_finalization_v2", { p_session_id: sessionId });
  if (error) throw error;
  return data || {};
}
