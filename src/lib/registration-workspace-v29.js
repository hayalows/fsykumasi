import { loadRpcPages } from "./rpc-pages.js";
import { isSupabaseConfigured, supabase } from "./supabase.js";
import { loadParticipantOperationalStates } from "./field-operations.js";

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

export async function loadRegistrationWorkspaceV29(sessionId) {
  if (!sessionId) return [];
  const [rows, operationalStates, checkinStates] = await Promise.all([
    loadRpcPages(client(), "get_registration_workspace_v29", { p_session_id: sessionId }, ["participant_id"], 1000),
    loadParticipantOperationalStates(sessionId),
    loadRpcPages(client(), "get_participant_checkin_states", { p_session_id: sessionId }, ["participant_id"], 1000).catch(() => []),
  ]);

  const checkinByParticipant = new Map((checkinStates || []).map((row) => [row.participant_id, row]));

  return (rows || []).map((row) => ({
    participantId: row.participant_id,
    id: row.participant_id,
    fsyId: row.fsy_id || "",
    fullName: row.full_name || "",
    preferredName: row.preferred_name || "",
    sex: row.sex || "",
    age: row.age == null ? null : Number(row.age),
    stake: row.stake_name || "",
    unit: row.unit_name || "",
    companyId: row.company_id || null,
    companyName: row.company_name || "",
    groupId: row.group_id || null,
    groupName: row.group_name || "",
    slotNumber: row.slot_number ?? null,
    badgeState: row.badge_state || "",
    attendanceStatus: row.attendance_status || "expected",
    checkinStatus: row.checkin_status || "",
    sourceKind: row.source_kind || "import",
    verificationStatus: row.verification_status || "",
    registrationStatus: row.registration_status || "",
    isCurrent: Boolean(row.is_current),
    serverEligibility: {
      eligible: Boolean(row.eligible),
      reason: row.eligibility_reason || "Needs review",
    },
    roomId: row.room_id || null,
    roomName: row.room_name || "",
    bedLabel: row.bed_label || "",
    housingAssignedAt: row.housing_assigned_at || null,
    ...(operationalStates.get(row.participant_id) || { operationalStatus: "active", operationalNote: "", operationalRevision: 0, operationalUpdatedAt: null }),
    checkinRecordedAt: checkinByParticipant.get(row.participant_id)?.recorded_at || null,
  }));
}
