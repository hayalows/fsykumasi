import { isSupabaseConfigured, supabase } from "./supabase.js";

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

export function hasCapability(capabilities = [], capability) {
  return Array.isArray(capabilities) && capabilities.includes(capability);
}

export async function loadTeamCatalog(sessionId) {
  const { data, error } = await client().rpc("get_session_team_catalog", { p_session_id: sessionId });
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.team_id,
    key: row.team_key,
    name: row.display_name,
    description: row.description || "",
    presetKey: row.preset_key || row.team_key,
    capabilities: row.capabilities || [],
    active: row.active !== false,
  }));
}

export async function loadAccessRosterV2(sessionId) {
  const { data, error } = await client().rpc("get_access_roster_v2", { p_session_id: sessionId });
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.assignment_id,
    userId: row.user_id,
    name: row.display_name || "FSY leader",
    email: row.email || "",
    role: row.role,
    companyIds: row.company_ids || [],
    committeeScope: row.committee_scope || [],
    capabilities: row.capabilities || [],
    teamKeys: row.team_keys || [],
    teamNames: row.team_names || [],
    active: row.active !== false,
  }));
}

export async function manageLeaderAccess({ assignmentId, role, companyIds = [], teamKeys = [], accessAdmin = false }) {
  const { data, error } = await client().rpc("manage_leader_access", {
    p_assignment_id: assignmentId,
    p_role: role,
    p_company_ids: companyIds,
    p_team_keys: teamKeys,
    p_access_admin: Boolean(accessAdmin),
  });
  if (error) throw error;
  return first(data);
}

export async function loadParticipantEligibility(sessionId) {
  const { data, error } = await client().rpc("get_participant_eligibility", { p_session_id: sessionId });
  if (error) throw error;
  return new Map((data || []).map((row) => [row.participant_id, { eligible: Boolean(row.eligible), reason: row.reason || "Needs review" }]));
}

export async function setParticipantAttendanceStatus(participantId, status, note = "") {
  const { error } = await client().rpc("set_participant_attendance_status", {
    p_participant_id: participantId,
    p_status: status,
    p_note: note || null,
  });
  if (error) throw error;
}

export async function loadHousingRooms(sessionId) {
  const { data, error } = await client().rpc("get_housing_rooms", { p_session_id: sessionId });
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id,
    name: row.room_name,
    building: row.building || "",
    floor: row.floor || "",
    sex: row.sex || "",
    capacity: Number(row.capacity || 0),
    occupancy: Number(row.occupancy || 0),
    notes: row.notes || "",
  }));
}

export async function loadHousingAssignments(sessionId) {
  const { data, error } = await client().rpc("get_housing_assignments", { p_session_id: sessionId });
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
  }));
}

export async function saveHousingRoom({ sessionId, roomId = null, name, building = "", floor = "", sex = null, capacity = 1, notes = "" }) {
  const { data, error } = await client().rpc("save_housing_room", {
    p_session_id: sessionId,
    p_room_id: roomId,
    p_room_name: name,
    p_building: building || null,
    p_floor: floor || null,
    p_sex: sex || null,
    p_capacity: Number(capacity),
    p_notes: notes || null,
  });
  if (error) throw error;
  return first(data);
}

export async function assignHousingPerson({ sessionId, personType, personId, roomId, bedLabel = "" }) {
  const { data, error } = await client().rpc("assign_housing_person", {
    p_session_id: sessionId,
    p_person_type: personType,
    p_person_id: personId,
    p_room_id: roomId,
    p_bed_label: bedLabel || null,
  });
  if (error) throw error;
  return first(data);
}

export async function clearHousingAssignment({ sessionId, personType, personId }) {
  const { error } = await client().rpc("clear_housing_assignment", {
    p_session_id: sessionId,
    p_person_type: personType,
    p_person_id: personId,
  });
  if (error) throw error;
}

export async function loadWellnessEncounters(sessionId) {
  const { data, error } = await client().rpc("get_wellness_encounters", { p_session_id: sessionId });
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.encounter_id,
    personType: row.person_type,
    personId: row.person_id,
    name: row.display_name,
    concern: row.concern || "",
    careProvided: row.care_provided || "",
    medicineProvided: row.medicine_provided || "",
    outcome: row.outcome,
    startedAt: row.started_at,
    closedAt: row.closed_at,
    recordedBy: row.recorded_by_name || "FSY Wellness",
  }));
}

export async function loadWellnessPersonDetails(sessionId, personType, personId) {
  const { data, error } = await client().rpc("get_wellness_person_details", {
    p_session_id: sessionId,
    p_person_type: personType,
    p_person_id: personId,
  });
  if (error) throw error;
  const row = first(data) || {};
  return {
    medicalInformation: row.medical_information || "",
    dietaryInformation: row.dietary_information || "",
    phone: row.phone || "",
    emergencyContactName: row.emergency_contact_name || "",
    emergencyContactPhone: row.emergency_contact_phone || "",
  };
}

export async function createWellnessEncounter({ sessionId, personType, personId, concern = "" }) {
  const { data, error } = await client().rpc("create_wellness_encounter", {
    p_session_id: sessionId,
    p_person_type: personType,
    p_person_id: personId,
    p_concern: concern || null,
  });
  if (error) throw error;
  return first(data);
}

export async function updateWellnessEncounter({ encounterId, concern = "", careProvided = "", medicineProvided = "", outcome, close = false }) {
  const { error } = await client().rpc("update_wellness_encounter", {
    p_encounter_id: encounterId,
    p_concern: concern || null,
    p_care_provided: careProvided || null,
    p_medicine_provided: medicineProvided || null,
    p_outcome: outcome,
    p_close: Boolean(close),
  });
  if (error) throw error;
}

export async function loadFoodNeeds(sessionId) {
  const { data, error } = await client().rpc("get_food_needs", { p_session_id: sessionId });
  if (error) throw error;
  return (data || []).map((row) => ({
    personType: row.person_type,
    personId: row.person_id,
    name: row.display_name,
    dietaryInformation: row.dietary_information || "",
    group: row.group_name || "",
    company: row.company_name || "",
    acknowledged: Boolean(row.acknowledged),
    acknowledgedAt: row.acknowledged_at,
  }));
}

export async function setFoodAcknowledgement({ sessionId, personType, personId, acknowledged, note = "" }) {
  const { error } = await client().rpc("set_food_acknowledgement", {
    p_session_id: sessionId,
    p_person_type: personType,
    p_person_id: personId,
    p_acknowledged: Boolean(acknowledged),
    p_note: note || null,
  });
  if (error) throw error;
}

export async function loadStaffBirthdays(sessionId) {
  const { data, error } = await client().rpc("get_staff_birthdays", { p_session_id: sessionId });
  if (error) throw error;
  return (data || []).map((row) => ({
    staffId: row.staff_id,
    name: row.display_name,
    date: row.birthday_date,
    staffRole: row.staff_role || "counselor",
    company: row.company_name || "",
    acknowledged: Boolean(row.acknowledged),
    acknowledgedAt: row.acknowledged_at,
  }));
}

export async function setStaffBirthdayAcknowledgement(sessionId, staffId, acknowledged) {
  const { error } = await client().rpc("set_staff_birthday_acknowledgement", {
    p_session_id: sessionId,
    p_staff_id: staffId,
    p_acknowledged: Boolean(acknowledged),
  });
  if (error) throw error;
}
