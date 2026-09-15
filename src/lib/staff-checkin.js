import { isSupabaseConfigured, supabase } from "./supabase.js";

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
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

export async function addStaffFromCheckin({
  sessionId,
  firstName,
  lastName,
  preferredName,
  sex,
  birthday,
  unit,
  stake,
  phone,
  email,
  tshirtSize,
  medicalInformation,
  dietaryInformation,
  operationalRole,
  companyIds = [],
}) {
  if (!sessionId) throw new Error("Choose a session first.");
  const { data, error } = await client().rpc("add_on_site_staff_from_checkin_v2", {
    p_session_id: sessionId,
    p_first_name: firstName,
    p_last_name: lastName,
    p_preferred_name: preferredName || null,
    p_sex: String(sex || "").toLowerCase(),
    p_date_of_birth: birthday,
    p_unit_name: unit,
    p_stake_name: stake || null,
    p_phone: phone || null,
    p_email: email || null,
    p_tshirt_size: tshirtSize || null,
    p_medical_information: medicalInformation || null,
    p_dietary_information: dietaryInformation || null,
    p_operational_role: operationalRole || "counselor",
    p_company_ids: companyIds || [],
    p_search_confirmed: true,
  });
  if (error) throw error;
  return data;
}

export async function recordStaffArrival(person, arrival) {
  if (!person?.id) throw new Error("Choose a staff member first.");
  if (!["expected", "arrived"].includes(arrival)) throw new Error("Registration can only check staff in or undo that check-in.");
  const { data, error } = await client().rpc("record_staff_arrival_v1", {
    p_staff_id: person.id,
    p_arrival: arrival,
    p_revision: Number(person.operationsRevision || 0),
  });
  if (error) throw error;
  return data;
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
