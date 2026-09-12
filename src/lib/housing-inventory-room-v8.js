import { isSupabaseConfigured, supabase } from "./supabase.js";

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

export async function saveHousingInventoryRoomV8({
  sessionId,
  roomId = null,
  hall,
  area = "",
  floor = "",
  name,
  spaceType = "room",
  availabilityStatus = "available",
  sex = "",
  capacity = 1,
  notes = "",
}) {
  const { data, error } = await client().rpc("save_housing_inventory_room_v1", {
    p_session_id: sessionId,
    p_room_id: roomId || null,
    p_hall: hall || null,
    p_area: area || null,
    p_floor: floor || null,
    p_room_name: name || null,
    p_space_type: spaceType || "room",
    p_availability_status: availabilityStatus || "available",
    p_sex: sex || null,
    p_capacity: Number(capacity),
    p_notes: notes || null,
  });
  if (error) throw error;
  return data;
}
