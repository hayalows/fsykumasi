import { isSupabaseConfigured, supabase } from "./supabase.js";

function requireClient() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

export async function getCurrentAuthSession() {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthChange(callback) {
  if (!isSupabaseConfigured || !supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function sendMagicLink(email) {
  const client = requireClient();
  const { error } = await client.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: window.location.origin,
    },
  });
  if (error) throw error;
}

export async function signOut() {
  const client = requireClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function getMyAccessState() {
  const client = requireClient();
  const { data, error } = await client.rpc("my_access_state");
  if (error) throw error;
  return data || [];
}

export async function requestSessionAccess({ accessCode, role, scopeNote }) {
  const client = requireClient();
  const { data, error } = await client.rpc("request_session_access", {
    p_access_code: accessCode,
    p_role: role,
    p_scope_note: scopeNote || null,
  });
  if (error) throw error;
  return data;
}

export async function loadProfile(userId) {
  const client = requireClient();
  const { data, error } = await client
    .from("profiles")
    .select("user_id, display_name, email")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadSession(sessionId) {
  const client = requireClient();
  const { data, error } = await client
    .from("sessions")
    .select("id, name, year, starts_on, ends_on, status")
    .eq("id", sessionId)
    .single();
  if (error) throw error;
  return data;
}

export async function loadSessionAccessCode(sessionId) {
  const client = requireClient();
  const { data, error } = await client.rpc("get_session_access_code", { p_session_id: sessionId });
  if (error) throw error;
  return data;
}

export async function loadParticipants(sessionId) {
  const client = requireClient();
  const { data, error } = await client
    .from("participants")
    .select("id, registration_id, first_name, last_name, sex, age, unit_name, group_id")
    .eq("session_id", sessionId)
    .order("last_name", { ascending: true });
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id,
    registrationId: row.registration_id,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: `${row.first_name} ${row.last_name}`.trim(),
    sex: row.sex === "female" ? "Female" : "Male",
    age: row.age,
    unit: row.unit_name,
    groupId: row.group_id,
    status: "Expected",
  }));
}

export async function importParticipants({ sessionId, userId, sourceFilename, participants }) {
  const client = requireClient();
  const { data: batch, error: batchError } = await client
    .from("import_batches")
    .insert({
      session_id: sessionId,
      imported_by: userId,
      source_filename: sourceFilename,
      record_count: participants.length,
      error_count: 0,
      status: "validated",
    })
    .select("id")
    .single();
  if (batchError) throw batchError;

  const rows = participants.map((participant) => ({
    session_id: sessionId,
    import_batch_id: batch.id,
    registration_id: participant.registrationId,
    first_name: participant.firstName,
    last_name: participant.lastName,
    sex: participant.sex === "Female" ? "female" : "male",
    age: participant.age,
    unit_name: participant.unit,
  }));

  const chunkSize = 400;
  try {
    for (let index = 0; index < rows.length; index += chunkSize) {
      const { error } = await client
        .from("participants")
        .upsert(rows.slice(index, index + chunkSize), { onConflict: "session_id,registration_id" });
      if (error) throw error;
    }
    const { error: applyError } = await client
      .from("import_batches")
      .update({ status: "applied" })
      .eq("id", batch.id);
    if (applyError) throw applyError;
  } catch (error) {
    await client.from("import_batches").update({ status: "rejected" }).eq("id", batch.id);
    throw error;
  }

  return batch.id;
}

export async function loadAccessRequests(sessionId) {
  const client = requireClient();
  const { data, error } = await client
    .from("access_requests")
    .select("id, requested_by, requested_role, requested_scope_note, status, requested_at, decision_note, profiles!access_requests_requested_by_fkey(display_name,email)")
    .eq("session_id", sessionId)
    .order("requested_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id,
    userId: row.requested_by,
    name: row.profiles?.display_name || "FSY leader",
    email: row.profiles?.email || "",
    role: row.requested_role,
    scope: row.requested_scope_note || (row.requested_role === "coordinator" ? "Whole session" : "Scope to assign"),
    requested: new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.requested_at)),
    status: row.status,
    note: row.decision_note,
  }));
}

export async function loadAccessRoster(sessionId) {
  const client = requireClient();
  const { data, error } = await client
    .from("access_assignments")
    .select("id, user_id, role, company_ids, committee_scope, active, profiles!access_assignments_user_id_fkey(display_name,email)")
    .eq("session_id", sessionId)
    .eq("active", true)
    .order("role", { ascending: true });
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    name: row.profiles?.display_name || "FSY leader",
    email: row.profiles?.email || "",
    role: row.role,
    companyIds: row.company_ids || [],
    committeeScope: row.committee_scope || [],
    active: row.active,
  }));
}

export async function decideAccessRequest(requestId, status, note = null) {
  const client = requireClient();
  const { error } = await client
    .from("access_requests")
    .update({ status, decision_note: note })
    .eq("id", requestId);
  if (error) throw error;
}

export function subscribeToAccessRequests(sessionId, callback) {
  if (!isSupabaseConfigured || !supabase || !sessionId) return () => {};
  const channel = supabase
    .channel(`session:${sessionId}:access-requests`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "access_requests",
      filter: `session_id=eq.${sessionId}`,
    }, callback)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export async function recordCheckin({ sessionId, participantId, status, userId }) {
  const client = requireClient();
  const { error } = await client.from("check_ins").upsert({
    session_id: sessionId,
    participant_id: participantId,
    status,
    recorded_by: userId,
    recorded_at: new Date().toISOString(),
  }, { onConflict: "session_id,participant_id" });
  if (error) throw error;
}
