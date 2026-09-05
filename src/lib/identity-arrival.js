import { loadRpcPages } from "./rpc-pages.js";
import { isSupabaseConfigured, supabase } from "./supabase.js";

export const NO_SHOW_CONFIRMATION_SOURCES = [
  "Parent or guardian confirmed",
  "Participant confirmed",
  "Unit or stake leader confirmed",
  "Other authorized confirmation",
];

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

async function rpc(name, args) {
  const { data, error } = await client().rpc(name, args);
  if (error) throw error;
  return data;
}

async function loadIdentityAliases(sessionId) {
  const rows=await loadRpcPages(client(),"get_fsy_id_history",{p_session_id:sessionId},["participant_id","changed_at","previous_fsy_id"]);
  const map=new Map(); for(const row of rows) map.set(row.participant_id,[...(map.get(row.participant_id)||[]),row.previous_fsy_id]); return map;
}

export async function loadOperationalIdentityMap(sessionId) {
  if (!sessionId) return new Map();
  const rows = await loadRpcPages(client(), "get_participant_operational_identity", { p_session_id: sessionId }, ["participant_id"]);
  const aliases=await loadIdentityAliases(sessionId);
  return new Map((rows || []).map((row) => [row.participant_id, {
    previousFsyIds: aliases.get(row.participant_id)||[],
    fsyId: row.fsy_id || "",
    badgeName: row.badge_name || "",
    badgeState: row.badge_state || "",
    badgeNeedsReprint: Boolean(row.needs_reprint),
    rosterSlot: row.slot_number ?? null,
    originCode: row.origin_code || "",
    companyId: row.company_id || null,
    companyName: row.company_name || "",
    groupId: row.group_id || null,
    groupName: row.group_name || "",
    attendanceStatus: row.attendance_status || "expected",
    checkinStatus: row.checkin_status || "",
    nameReviewRequired: Boolean(row.name_review_required),
  }]));
}

export async function loadIdentityRoster(sessionId) {
  const rows = await loadRpcPages(client(), "get_participant_operational_identity", { p_session_id: sessionId }, ["participant_id"]);
  const aliases=await loadIdentityAliases(sessionId);
  return (rows || []).map((row) => ({
    participantId: row.participant_id,
    previousFsyIds: aliases.get(row.participant_id)||[],
    fsyId: row.fsy_id || "",
    badgeName: row.badge_name || row.full_name || "",
    badgeState: row.badge_state || "",
    needsReprint: Boolean(row.needs_reprint),
    slotNumber: row.slot_number ?? null,
    originCode: row.origin_code || "",
    companyId: row.company_id || null,
    companyName: row.company_name || "",
    groupId: row.group_id || null,
    groupName: row.group_name || "",
    attendanceStatus: row.attendance_status || "expected",
    checkinStatus: row.checkin_status || "",
    sourceKind: row.source_kind || "import",
    verificationStatus: row.verification_status || "",
    isCurrent: Boolean(row.is_current),
    stake: row.stake_name || "",
    unit: row.unit_name || "",
    sex: row.sex || "",
    fullName: row.full_name || "",
    preferredName: row.preferred_name || "",
    nameReviewRequired: Boolean(row.name_review_required),
  }));
}

export async function loadIdentityReadiness(sessionId) {
  const rows = await rpc("get_identity_readiness", { p_session_id: sessionId });
  const row = rows?.[0] || {};
  return {
    eligibleGrouped: Number(row.eligible_grouped || 0),
    activeIds: Number(row.active_ids || 0),
    draftIds: Number(row.draft_ids || 0),
    finalizedIds: Number(row.finalized_ids || 0),
    unresolvedOrigin: Number(row.unresolved_origin || 0),
    nameReviews: Number(row.name_reviews || 0),
  };
}

export async function loadOriginCodes(sessionId) {
  const rows = await rpc("get_origin_code_registry", { p_session_id: sessionId });
  return (rows || []).map((row) => ({ name: row.canonical_name, code: row.code, aliases: row.aliases || [], participantCount: Number(row.participant_count || 0) }));
}

export async function rebuildDraftFsyIds(sessionId) {
  return rpc("rebuild_draft_fsy_ids", { p_session_id: sessionId });
}

export async function finalizeFsyIds(sessionId) {
  return rpc("finalize_fsy_ids", { p_session_id: sessionId });
}

export async function updateBadgeName(participantId, badgeName) {
  return rpc("update_participant_badge_name", { p_participant_id: participantId, p_badge_name: badgeName });
}

export async function loadArrivalRoster(sessionId) {
  const rows = await loadRpcPages(client(), "get_arrival_reconciliation", { p_session_id: sessionId }, ["participant_id"]);
  return (rows || []).map((row) => ({
    participantId: row.participant_id,
    fsyId: row.fsy_id || "",
    fullName: row.full_name || "",
    preferredName: row.preferred_name || "",
    sex: row.sex || "",
    stake: row.stake_name || "",
    unit: row.unit_name || "",
    companyName: row.company_name || "",
    groupName: row.group_name || "",
    slotNumber: row.slot_number ?? null,
    attendanceStatus: row.attendance_status || "expected",
    checkinStatus: row.checkin_status || "",
    sourceKind: row.source_kind || "import",
    verificationStatus: row.verification_status || "",
    isCurrent: Boolean(row.is_current),
  }));
}

export async function setArrivalStatus(participantId, status, note = "") {
  return rpc("set_participant_arrival_status", { p_participant_id: participantId, p_status: status, p_note: note || null });
}

export async function loadArrivalVacancies(sessionId) {
  const rows = await rpc("get_arrival_vacancies", { p_session_id: sessionId });
  return (rows || []).map((row) => ({
    participantId: row.participant_id,
    fsyId: row.fsy_id || "",
    fullName: row.full_name || "",
    sex: row.sex || "",
    companyId: row.company_id,
    companyName: row.company_name || "",
    groupId: row.group_id,
    groupName: row.group_name || "",
    slotNumber: row.slot_number,
  }));
}

export async function replaceArrivalVacancy(absentParticipantId, newParticipantId) {
  return rpc("replace_arrival_vacancy", { p_absent_participant_id: absentParticipantId, p_new_participant_id: newParticipantId });
}
