import { isSupabaseConfigured, supabase } from "./supabase.js";

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

export async function loadHousingArrivalQueue(sessionId) {
  if (!sessionId) return [];
  const { data, error } = await client().rpc("get_housing_arrival_queue", { p_session_id: sessionId });
  if (error) throw error;
  return (data || []).map((row) => ({
    participantId: row.participant_id,
    name: row.full_name || "Participant",
    preferredName: row.preferred_name || "",
    sex: row.sex || "",
    unit: row.unit_name || "",
    stake: row.stake_name || "",
    fsyId: row.fsy_id || "",
    company: row.company_name || "",
    group: row.group_name || "",
    checkedInAt: row.checked_in_at || null,
  }));
}

export function subscribeToHousingHandoff(sessionId, callback) {
  if (!isSupabaseConfigured || !supabase || !sessionId) return () => {};
  const channel = supabase
    .channel(`session:${sessionId}:housing-handoff`)
    .on("postgres_changes", { event: "*", schema: "public", table: "check_ins", filter: `session_id=eq.${sessionId}` }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "housing_assignments", filter: `session_id=eq.${sessionId}` }, callback)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export async function loadRegistrationHousingStatus(sessionId) {
  if (!sessionId) return [];
  const { data, error } = await client().rpc("get_registration_housing_status", { p_session_id: sessionId });
  if (error) throw error;
  return (data || []).map((row) => ({
    personId: row.participant_id,
    roomId: row.room_id,
    roomName: row.room_name || "",
    bedLabel: row.bed_label || "",
    assignedAt: row.assigned_at || null,
    personType: "participant",
  }));
}
