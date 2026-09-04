import { isSupabaseConfigured, supabase } from "./supabase.js";

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

export async function loadMealProgress(serviceId) {
  const { data, error } = await client().rpc("get_meal_progress", { p_meal_service_id: serviceId });
  if (error) throw error;
  return (data || []).map((row) => ({
    companyId: row.company_id || "",
    company: row.company_name || "Unassigned",
    expectedCount: Number(row.expected_count || 0),
    servedCount: Number(row.served_count || 0),
  }));
}

export async function setParticipantMealServed({ serviceId, participantId, served }) {
  const { data, error } = await client().rpc("set_participant_meal_served", {
    p_meal_service_id: serviceId,
    p_participant_id: participantId,
    p_served: Boolean(served),
  });
  if (error) throw error;
  const row = first(data) || {};
  return {
    id: row.attendance_id || null,
    servedAt: row.served_at || null,
    served: Boolean(row.served),
  };
}
