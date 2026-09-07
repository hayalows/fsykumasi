import { isSupabaseConfigured, supabase } from "./supabase.js";

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

function registrationPayload(record) {
  return {
    source_record_key: record.sourceKey,
    person_type: record.personType,
    first_name: record.firstName,
    last_name: record.lastName,
    preferred_name: record.preferredName || null,
    birthday: record.birthday,
    sex: record.sex.toLowerCase(),
    age: Number(record.age),
    unit_name: record.unit || null,
    stake_name: record.stake || null,
    registration_status: record.registrationStatus,
    source_registered_at: record.registeredAt,
    email: record.email || null,
    phone: record.phone || null,
    medical_information: record.medicalInformation || null,
    dietary_information: record.dietaryInformation || null,
    tshirt_size: record.tshirtSize || null,
    contact_1_name: record.contact1Name || null,
    contact_1_email: record.contact1Email || null,
    contact_1_phone: record.contact1Phone || null,
    contact_2_name: record.contact2Name || null,
    contact_2_email: record.contact2Email || null,
    contact_2_phone: record.contact2Phone || null,
    bishop_name: record.bishopName || null,
    bishop_email: record.bishopEmail || null,
  };
}

export async function previewFinalRegistrationBaseline({ sessionId, records }) {
  const { data, error } = await client().rpc("preview_final_registration_baseline", {
    p_session_id: sessionId,
    p_records: records.map(registrationPayload),
  });
  if (error) throw error;
  return data || {};
}

export async function applyFinalRegistrationBaseline({ sessionId, sourceFilename, sourceSha256, records }) {
  const { data, error } = await client().rpc("apply_final_registration_baseline", {
    p_session_id: sessionId,
    p_source_filename: sourceFilename,
    p_source_sha256: sourceSha256,
    p_records: records.map(registrationPayload),
  });
  if (error) throw error;
  return data || {};
}

export async function loadFinalRegistrationBaseline(sessionId) {
  const { data, error } = await client()
    .from("import_batches")
    .select("id, source_filename, source_sha256, record_count, participant_count, staff_count, omitted_count, exception_count, status, created_at, baseline_kind")
    .eq("session_id", sessionId)
    .eq("status", "applied")
    .eq("baseline_kind", "final")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? {
    id: data.id,
    sourceFilename: data.source_filename,
    sourceSha256: data.source_sha256,
    recordCount: data.record_count,
    participantCount: data.participant_count,
    staffCount: data.staff_count,
    omittedCount: data.omitted_count,
    exceptionCount: data.exception_count,
    status: data.status,
    createdAt: data.created_at,
  } : null;
}
