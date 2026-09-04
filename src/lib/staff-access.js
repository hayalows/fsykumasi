import { isSupabaseConfigured, supabase } from "./supabase.js";

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

export const ACCOUNT_ROLES = new Set(["assistant_coordinator", "coordinator", "logistics_admin", "session_director"]);

export function staffRoleLabel(role) {
  return ({
    assistant_coordinator: "Assistant coordinator",
    coordinator: "Coordinator",
    logistics_admin: "Logistical administrator",
    session_director: "Session directing couple",
  })[role] || role || "FSY leader";
}

export function staffScopeLabel(person) {
  if (person?.operationalRole === "assistant_coordinator") {
    const names = person.companyNames || [];
    if (names.length) return names.join(", ");
    const count = person.companyIds?.length || 0;
    return count ? `${count} assigned companies` : "No companies assigned yet";
  }
  return "Whole session";
}

export function accessStateLabel(state) {
  return ({
    active: "Access active",
    invited: "Invite sent",
    disabled: "Access disabled",
    not_enabled: "No website access",
  })[state] || "No website access";
}

export async function resolveCurrentAccessSessionId() {
  const { data, error } = await client().rpc("my_access_state");
  if (error) throw error;
  const active = (data || []).filter((item) => item.active && item.role);
  if (!active.length) throw new Error("No active FSY session access was found.");
  const requested = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("session") || "";
  return active.find((item) => item.session_id === requested)?.session_id
    || active.find((item) => item.session_status !== "training")?.session_id
    || active[0].session_id;
}

export async function loadStaffAccessDirectory(sessionId) {
  const { data, error } = await client().rpc("get_staff_access_directory", { p_session_id: sessionId });
  if (error) throw error;
  return (data || []).map((row) => ({
    staffId: row.staff_id,
    name: row.display_name || "FSY leader",
    operationalRole: row.operational_role,
    email: row.email || "",
    companyIds: row.company_ids || [],
    companyNames: row.company_names || [],
    userId: row.user_id || null,
    accountEmail: row.account_email || "",
    accessEnabled: Boolean(row.access_enabled),
    accessState: row.access_state || "not_enabled",
    inviteId: row.invite_id || null,
    inviteExpiresAt: row.invite_expires_at || null,
    accountRole: row.account_role || null,
  }));
}

export async function loadSessionAccountActivity(sessionId) {
  const { data, error } = await client().rpc("get_session_account_activity", { p_session_id: sessionId });
  if (error) throw error;
  return new Map((data || []).map((row) => [row.user_id, { lastSignInAt: row.last_sign_in_at || null }]));
}

export async function loadAssistantCoordinatorCompanySuggestions(staffId) {
  const { data, error } = await client().rpc("suggest_assistant_coordinator_companies", { p_staff_id: staffId });
  if (error) throw error;
  return (data || []).map((row) => ({
    companyId: row.company_id,
    companyName: row.company_name,
    currentStaffId: row.current_staff_id || null,
    currentStaffName: row.current_staff_name || "",
    currentLoad: Number(row.current_load || 0),
    targetCount: Number(row.target_count || 0),
  }));
}

export async function setAssistantCoordinatorCompanies(staffId, companyIds = []) {
  const { data, error } = await client().rpc("set_assistant_coordinator_companies", {
    p_staff_id: staffId,
    p_company_ids: companyIds,
  });
  if (error) throw error;
  return first(data) || data;
}

export async function createStaffLeaderInvite(staffId, email = "") {
  const { data, error } = await client().rpc("create_staff_leader_invite", {
    p_staff_id: staffId,
    p_email: email.trim() || null,
  });
  if (error) throw error;
  const row = first(data) || {};
  return {
    id: row.invite_id,
    code: row.invite_code,
    expiresAt: row.expires_at,
    existingAccount: Boolean(row.existing_account),
  };
}

export async function setStaffWebsiteAccess(staffId, enabled) {
  const { error } = await client().rpc("set_staff_website_access", {
    p_staff_id: staffId,
    p_enabled: Boolean(enabled),
  });
  if (error) throw error;
}

export async function createManualStaffLeader({ sessionId, name, email = "", role }) {
  const { data, error } = await client().rpc("create_manual_staff_leader", {
    p_session_id: sessionId,
    p_display_name: name,
    p_email: email.trim() || null,
    p_role: role,
  });
  if (error) throw error;
  return first(data) || data;
}
