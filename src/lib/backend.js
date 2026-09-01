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

export async function bootstrapSessionAdmin({ accessCode, role }) {
  const client = requireClient();
  const { data, error } = await client.rpc("bootstrap_session_admin", {
    p_access_code: accessCode,
    p_role: role,
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

export async function updateMyProfile(displayName) {
  const client = requireClient();
  const { data, error } = await client.rpc("update_my_profile", {
    p_display_name: displayName,
  });
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

export async function rotateSessionAccessCode(sessionId) {
  const client = requireClient();
  const { data, error } = await client.rpc("rotate_session_access_code", { p_session_id: sessionId });
  if (error) throw error;
  return data;
}

export async function loadCompanies(sessionId) {
  const client = requireClient();
  const { data, error } = await client
    .from("companies")
    .select("id, name, color")
    .eq("session_id", sessionId)
    .order("name", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function loadParticipants(sessionId) {
  const client = requireClient();
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from("participants")
      .select("id, registration_id, first_name, last_name, sex, age, unit_name, group_id")
      .eq("session_id", sessionId)
      .order("last_name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows.map((row) => ({
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

export async function importParticipants({ sessionId, sourceFilename, participants }) {
  const client = requireClient();
  const payload = participants.map((participant) => ({
    registration_id: participant.registrationId,
    first_name: participant.firstName,
    last_name: participant.lastName,
    sex: participant.sex === "Female" ? "female" : "male",
    age: participant.age,
    unit_name: participant.unit,
  }));

  const { data, error } = await client.rpc("apply_participant_import", {
    p_session_id: sessionId,
    p_source_filename: sourceFilename,
    p_participants: payload,
  });
  if (error) throw error;
  return data;
}

export async function loadAccessRequests(sessionId) {
  const client = requireClient();
  const { data, error } = await client
    .from("access_requests")
    .select("id, requested_by, requested_role, requested_scope_note, company_ids, committee_scope, status, requested_at, decision_note, profiles!access_requests_requested_by_fkey(display_name,email)")
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
    companyIds: row.company_ids || [],
    committeeScope: row.committee_scope || [],
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

export async function decideAccessRequest(requestId, status, { companyIds = [], committeeScope = [], note = null } = {}) {
  const client = requireClient();
  const { error } = await client.rpc("review_access_request", {
    p_request_id: requestId,
    p_decision: status,
    p_company_ids: companyIds,
    p_committee_scope: committeeScope,
    p_note: note,
  });
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

export async function recordCheckin({ sessionId, participantId, status }) {
  const client = requireClient();
  const { error } = await client.rpc("record_participant_checkin", {
    p_session_id: sessionId,
    p_participant_id: participantId,
    p_status: status,
    p_note: null,
  });
  if (error) throw error;
}

export async function publishGroupingPlan(sessionId, assignment) {
  const client = requireClient();
  const plan = assignment.companies.map((company) => ({
    name: company.name,
    groups: company.groups.map((group) => ({
      name: group.name,
      sex: group.sex.toLowerCase(),
      participant_ids: group.members.map((member) => member.id),
    })),
  }));
  const { data, error } = await client.rpc("publish_grouping_plan", {
    p_session_id: sessionId,
    p_plan: plan,
  });
  if (error) throw error;
  return data;
}

export async function loadGroupingPlan(sessionId) {
  const client = requireClient();
  const [{ data: companyRows, error: companyError }, { data: groupRows, error: groupError }] = await Promise.all([
    client.from("companies").select("id, name, color").eq("session_id", sessionId).order("name"),
    client.from("counselor_groups").select("id, company_id, name, sex, state, participants(count)").eq("session_id", sessionId).order("name"),
  ]);
  if (companyError) throw companyError;
  if (groupError) throw groupError;
  const groups = (groupRows || []).map((row) => ({
    id: row.id,
    name: row.name,
    sex: row.sex === "female" ? "Female" : "Male",
    companyId: row.company_id,
    state: row.state,
    memberCount: row.participants?.[0]?.count || 0,
  }));
  const companies = (companyRows || []).map((company) => ({
    ...company,
    groups: groups.filter((group) => group.companyId === company.id),
  }));
  return { groups, companies, published: groups.some((group) => group.state === "published") };
}

export async function loadHeadcount(sessionId) {
  const client = requireClient();
  const { data: rounds, error: roundsError } = await client
    .from("headcount_rounds")
    .select("id, label, opens_at, closes_at")
    .eq("session_id", sessionId)
    .order("opens_at", { ascending: false })
    .limit(1);
  if (roundsError) throw roundsError;
  const round = rounds?.[0] || null;
  if (!round) return { round: null, submissions: [] };
  const { data, error } = await client
    .from("headcount_submissions")
    .select("company_id, expected_count, accounted_count, status, note, submitted_at")
    .eq("round_id", round.id);
  if (error) throw error;
  return { round, submissions: data || [] };
}

export async function openHeadcountRound(sessionId, label) {
  const client = requireClient();
  const { data, error } = await client.rpc("open_headcount_round", {
    p_session_id: sessionId,
    p_label: label,
  });
  if (error) throw error;
  return data;
}

export async function submitCompanyHeadcount({ roundId, companyId, accountedCount, note }) {
  const client = requireClient();
  const { error } = await client.rpc("submit_company_headcount", {
    p_round_id: roundId,
    p_company_id: companyId,
    p_accounted_count: accountedCount,
    p_note: note || null,
  });
  if (error) throw error;
}

export function subscribeToHeadcount(sessionId, callback) {
  if (!isSupabaseConfigured || !supabase || !sessionId) return () => {};
  const channel = supabase
    .channel(`session:${sessionId}:headcount`)
    .on("postgres_changes", { event: "*", schema: "public", table: "headcount_rounds", filter: `session_id=eq.${sessionId}` }, callback)
    .on("postgres_changes", { event: "*", schema: "public", table: "headcount_submissions" }, callback)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
