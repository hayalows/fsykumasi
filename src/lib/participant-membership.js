import { isSupabaseConfigured, supabase } from "./supabase.js";

export const PARTICIPANT_MEMBERSHIP_REQUIRED = "PARTICIPANT_MEMBERSHIP_STATUS_REQUIRED";

export const PARTICIPANT_MEMBERSHIP_OPTIONS = [
  {
    value: "member_12_plus",
    label: "Member · 12+ months",
    help: "Baptized at least 12 months ago",
  },
  {
    value: "recent_convert",
    label: "Recent convert",
    help: "Baptized within the last 12 months",
  },
  {
    value: "non_member",
    label: "Non-member",
    help: "Not currently a member of the Church",
  },
  {
    value: "not_sure",
    label: "Not sure",
    help: "Check in now and confirm later",
  },
];

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

export function requiresParticipantMembership(error) {
  return String(error?.message || "").includes(PARTICIPANT_MEMBERSHIP_REQUIRED);
}

export async function recordParticipantMembershipCheckin({ sessionId, participantId, membershipStatus }) {
  const { error } = await client().rpc("record_participant_checkin_with_membership", {
    p_session_id: sessionId,
    p_participant_id: participantId,
    p_membership_status: membershipStatus,
  });
  if (error) throw error;
}

export async function loadParticipantMembershipReport(sessionId) {
  const { data, error } = await client().rpc("get_participant_membership_report", {
    p_session_id: sessionId,
  });
  if (error) throw error;
  return data || {};
}
