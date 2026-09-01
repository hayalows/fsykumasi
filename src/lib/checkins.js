import { supabase, isSupabaseConfigured } from "./supabase.js";

export async function loadArrivedParticipantIds(sessionId) {
  if (!isSupabaseConfigured || !supabase || !sessionId) return [];
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("check_ins")
      .select("participant_id")
      .eq("session_id", sessionId)
      .eq("status", "arrived")
      .order("participant_id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows.map((row) => row.participant_id);
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
