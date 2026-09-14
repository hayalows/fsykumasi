import { supabase, isSupabaseConfigured } from "./supabase.js";

export async function loadArrivedParticipantIds(sessionId) {
  if (!isSupabaseConfigured || !supabase || !sessionId) return [];
  const { data, error } = await supabase.rpc("get_participant_checkin_states", {
    p_session_id: sessionId,
  });
  if (error) throw error;
  return (data || [])
    .filter((row) => row.status === "arrived")
    .map((row) => row.participant_id)
    .sort();
}

export function subscribeToCheckins(sessionId, callback) {
  if (!isSupabaseConfigured || !supabase || !sessionId) return () => {};
  const channel = supabase
    .channel(`session:${sessionId}:checkins-view`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "check_ins",
      filter: `session_id=eq.${sessionId}`,
    }, callback)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
