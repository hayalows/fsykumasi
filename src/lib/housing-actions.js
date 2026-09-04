import { isSupabaseConfigured, supabase } from "./supabase.js";

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

export async function saveHousingAssignment({ sessionId, personType, personId, roomId, bedLabel = "", moveReason = "" }) {
  const { data, error } = await client().rpc("assign_housing_person_v2", {
    p_session_id: sessionId,
    p_person_type: personType,
    p_person_id: personId,
    p_room_id: roomId,
    p_bed_label: bedLabel || null,
    p_move_reason: moveReason || null,
  });
  if (error) throw error;
  return first(data);
}

export async function createHousingRoomAndAssignV2({ sessionId, personType, personId, roomName, building = "", floor = "", capacity = 4, notes = "", bedLabel = "", moveReason = "" }) {
  const { data, error } = await client().rpc("create_housing_room_and_assign_v2", {
    p_session_id: sessionId,
    p_person_type: personType,
    p_person_id: personId,
    p_room_name: roomName,
    p_building: building || null,
    p_floor: floor || null,
    p_capacity: Number(capacity),
    p_notes: notes || null,
    p_bed_label: bedLabel || null,
    p_move_reason: moveReason || null,
  });
  if (error) throw error;
  return first(data);
}
