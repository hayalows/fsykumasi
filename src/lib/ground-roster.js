import { isSupabaseConfigured, supabase } from "./supabase.js";

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

function normalizeGroundResult(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  return {
    participantId: row.participant_id || null,
    groupId: row.group_id || null,
    groupName: row.group_name || "",
    companyId: row.company_id || null,
    companyName: row.company_name || "",
    fsyId: row.fsy_id || "",
    recordedAt: row.recorded_at || null,
    paperworkFollowUp: Boolean(row.paperwork_follow_up),
  };
}

export async function loadParticipantGroundRoster(sessionId) {
  const { data, error } = await client().rpc("get_participant_ground_roster_v1", {
    p_session_id: sessionId,
  });
  if (error) throw error;
  return (data || []).map((row) => ({
    companyId: row.company_id,
    companyName: row.company_custom_name || row.company_name || "Company",
    companyNumber: row.company_number == null ? null : Number(row.company_number),
    groupId: row.group_id,
    groupName: row.group_custom_name || row.group_name || "Counselor group",
    groupNumber: row.group_number == null ? null : Number(row.group_number),
    sex: String(row.sex || "").toLowerCase(),
    state: row.state || "",
    arrivedCount: Number(row.arrived_count || 0),
    rosterCount: Number(row.roster_count || 0),
    maxSize: Number(row.max_size || 15),
    counselorId: row.counselor_id || null,
    counselorName: row.counselor_name || "",
    counselorArrived: Boolean(row.counselor_arrived),
    arrivedAssistantCount: Number(row.arrived_assistant_count || 0),
  }));
}

export async function checkInParticipantOnGround({ sessionId, participantId }) {
  const { data, error } = await client().rpc("check_in_participant_on_ground_v1", {
    p_session_id: sessionId,
    p_participant_id: participantId,
  });
  if (error) throw error;
  return normalizeGroundResult(data);
}

export async function addOnSiteGroundParticipant({
  sessionId,
  firstName,
  lastName,
  preferredName,
  sex,
  birthday,
  unit,
  stake,
  phone,
  guardianName,
  guardianPhone,
  tshirtSize,
  medicalInformation,
  dietaryInformation,
}) {
  const { data, error } = await client().rpc("add_on_site_ground_participant_v1", {
    p_session_id: sessionId,
    p_first_name: firstName,
    p_last_name: lastName,
    p_preferred_name: preferredName || null,
    p_sex: String(sex || "").toLowerCase(),
    p_date_of_birth: birthday,
    p_unit_name: unit,
    p_stake_name: stake,
    p_phone: phone || null,
    p_contact_1_name: guardianName || null,
    p_contact_1_phone: guardianPhone,
    p_tshirt_size: tshirtSize || null,
    p_medical_information: medicalInformation || null,
    p_dietary_information: dietaryInformation || null,
    p_search_confirmed: true,
  });
  if (error) throw error;
  return normalizeGroundResult(data);
}

export async function moveParticipantOnGround({ participantId, groupId }) {
  const { data, error } = await client().rpc("move_ground_participant_v1", {
    p_participant_id: participantId,
    p_group_id: groupId,
  });
  if (error) throw error;
  return normalizeGroundResult(data);
}

export function subscribeParticipantGroundRoster(sessionId, onChange) {
  if (!sessionId || !isSupabaseConfigured || !supabase) return () => {};
  let closed = false;
  let timer = null;
  const emit = () => {
    if (closed) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => onChange?.(), 250);
  };
  const channel = supabase
    .channel(`participant-ground-${sessionId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "check_ins", filter: `session_id=eq.${sessionId}` }, emit)
    .on("postgres_changes", { event: "*", schema: "public", table: "participants", filter: `session_id=eq.${sessionId}` }, emit)
    .subscribe();
  const fallback = window.setInterval(emit, 15000);
  return () => {
    closed = true;
    window.clearTimeout(timer);
    window.clearInterval(fallback);
    supabase.removeChannel(channel);
  };
}
