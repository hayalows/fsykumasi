import { isSupabaseConfigured, supabase } from "./supabase.js";

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

export async function loadSessionFinalizationPreview(sessionId) {
  const { data, error } = await client().rpc("get_session_finalization_preview", { p_session_id: sessionId });
  if (error) throw error;
  return data || null;
}

export async function finalizeSessionRoster(sessionId, note = "Kumasi 2026 pre-session final roster") {
  const { data, error } = await client().rpc("apply_session_finalization_v1", {
    p_session_id: sessionId,
    p_note: note,
  });
  if (error) throw error;
  return data || null;
}
