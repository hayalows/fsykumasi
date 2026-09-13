import { isSupabaseConfigured, supabase } from "./supabase.js";

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

async function rpc(name, args) {
  const { data, error } = await client().rpc(name, args);
  if (error) throw error;
  return data;
}

export async function loadStaffArrivalRoster(sessionId) {
  if (!sessionId) return [];
  const { data, error } = await client().rpc("get_staff_arrival_roster_v1", { p_session_id: sessionId });
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.staff_id,
    name: row.full_name || "Staff member",
    preferredName: row.preferred_name || "",
    unit: row.unit_name || "",
    stake: row.stake_name || "",
    operationalRole: row.operational_role || "other",
    planningState: row.planning_state || "reserve",
    arrivalState: row.arrival_state || "expected",
    serviceClearance: row.service_clearance || "confirmation_required",
    operationsRevision: Number(row.operations_revision || 0),
    assignmentLabel: row.assignment_label || "",
    committeeDuties: row.committee_duties || [],
    isCurrent: row.is_current !== false,
    registrationStatus: row.registration_status || "",
  }));
}

export async function recordStaffArrival(person, arrival) {
  if (!person?.id) throw new Error("Choose a staff member first.");
  if (!["expected", "arrived"].includes(arrival)) throw new Error("Registration can only check staff in or undo that check-in.");
  return rpc("record_staff_arrival_v1", {
    p_staff_id: person.id,
    p_arrival: arrival,
    p_revision: Number(person.operationsRevision || 0),
  });
}

export function subscribeStaffArrivals(sessionId, onChange) {
  if (!isSupabaseConfigured || !supabase || !sessionId) return () => {};
  let closed = false;
  let channel = null;
  let timer = null;

  const emit = () => {
    if (!closed) onChange?.();
  };

  try {
    channel = supabase
      .channel(`staff-arrivals:${sessionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "staff_operations" }, emit)
      .subscribe();
  } catch {
    channel = null;
  }

  // Realtime is the fast path. A light polling fallback keeps a second desk in
  // sync if the browser or network drops the channel for a while.
  timer = window.setInterval(emit, 15000);

  return () => {
    closed = true;
    if (timer) window.clearInterval(timer);
    if (channel) supabase.removeChannel(channel);
  };
}
