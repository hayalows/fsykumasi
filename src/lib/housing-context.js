import { isSupabaseConfigured, supabase } from "./supabase.js";

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

export async function loadHousingAssignmentsV2(sessionId) {
  const { data, error } = await client().rpc("get_housing_assignments_v2", { p_session_id: sessionId });
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.assignment_id,
    roomId: row.room_id,
    roomName: row.room_name,
    personType: row.person_type,
    personId: row.person_id,
    name: row.display_name,
    sex: row.sex || "",
    group: row.group_name || "",
    company: row.company_name || "",
    bedLabel: row.bed_label || "",
    assignedAt: row.assigned_at,
    fsyId: row.fsy_id || "",
    checkinStatus: row.checkin_status || (row.person_type === "staff" ? "staff" : "not_checked_in"),
    checkedInAt: row.checked_in_at || null,
  }));
}
