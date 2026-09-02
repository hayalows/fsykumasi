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
  phone, guardianName, guardianPhone, tshirtSize, medicalInformation, dietaryInformation,
}) {
  const { data, error } = await client().rpc("add_on_site_participant_v2", {
    p_session_id: sessionId,
    p_first_name: firstName,
    p_last_name: lastName,
    p_preferred_name: preferredName || null,
    p_sex: sex.toLowerCase(),
    p_date_of_birth: birthday,
    p_unit_name: unit,
    p_stake_name: stake || null,
    p_phone: phone || null,
    p_contact_name: guardianName || null,
    p_contact_phone: guardianPhone || null,
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
