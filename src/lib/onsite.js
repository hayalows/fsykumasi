import { isSupabaseConfigured, supabase } from "./supabase.js";

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

export async function loadOnSiteReferenceDate(sessionId) {
  const { data, error } = await client().from("sessions").select("starts_on").eq("id", sessionId).single();
  if (error) throw error;
  return data?.starts_on || "";
}

export async function addOnSiteParticipantDetailed({
  sessionId, firstName, lastName, preferredName, sex, birthday, unit, stake,
  phone, guardianName, guardianPhone, secondGuardianName, secondGuardianPhone,
  tshirtSize, medicalInformation, dietaryInformation,
}) {
  const { data, error } = await client().rpc("add_on_site_participant_v3", {
    p_session_id: sessionId,
    p_first_name: firstName,
    p_last_name: lastName,
    p_preferred_name: preferredName || null,
    p_sex: sex.toLowerCase(),
    p_date_of_birth: birthday,
    p_unit_name: unit,
    p_stake_name: stake || null,
    p_phone: phone || null,
    p_contact_1_name: guardianName || null,
    p_contact_1_phone: guardianPhone || null,
    p_contact_2_name: secondGuardianName || null,
    p_contact_2_phone: secondGuardianPhone || null,
    p_tshirt_size: tshirtSize || null,
    p_medical_information: medicalInformation || null,
    p_dietary_information: dietaryInformation || null,
    p_search_confirmed: true,
  });
  if (error) throw error;
  return data;
}

export async function addOnSiteStaff({
  sessionId, firstName, lastName, preferredName, sex, birthday, unit, stake,
  phone, email, tshirtSize, medicalInformation, dietaryInformation, operationalRole,
}) {
  const { data, error } = await client().rpc("add_on_site_staff", {
    p_session_id: sessionId,
    p_first_name: firstName,
    p_last_name: lastName,
    p_preferred_name: preferredName || null,
    p_sex: sex.toLowerCase(),
    p_date_of_birth: birthday,
    p_unit_name: unit,
    p_stake_name: stake || null,
    p_phone: phone || null,
    p_email: email || null,
    p_tshirt_size: tshirtSize || null,
    p_medical_information: medicalInformation || null,
    p_dietary_information: dietaryInformation || null,
    p_operational_role: operationalRole,
    p_search_confirmed: true,
  });
  if (error) throw error;
  return data;
}

export async function previewOnSiteOverflowPlacement(participantId) {
  const { data, error } = await client().rpc("preview_onsite_supplemental_placement_v1", {
    p_participant_id: participantId,
  });
  if (error) throw error;
  return data || null;
}

export async function applyOnSiteOverflowPlacement({ participantId, counselorId, assistantId = null }) {
  const { data, error } = await client().rpc("apply_onsite_supplemental_placement_v1", {
    p_participant_id: participantId,
    p_expected_counselor_id: counselorId || null,
    p_expected_assistant_id: assistantId || null,
  });
  if (error) throw error;
  return data || null;
}
