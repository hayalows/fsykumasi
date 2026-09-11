import { isSupabaseConfigured, supabase } from "./supabase.js";

export const MEMBERSHIP_OPTIONS = [
  { value: "non_member", label: "Non-member", shortLabel: "Non-member" },
  { value: "recent_convert", label: "Recent convert · under 12 months", shortLabel: "Recent convert" },
  { value: "member_12_plus", label: "Member · 12+ months", shortLabel: "Member 12+" },
  { value: "unconfirmed", label: "Not confirmed", shortLabel: "Not confirmed" },
];

export const MEMBERSHIP_SOURCES = [
  { value: "participant_or_guardian", label: "Participant / guardian" },
  { value: "unit_or_stake_leader", label: "Bishop / branch president or stake leader" },
  { value: "registration_record", label: "Approved registration record" },
  { value: "checkin_confirmation", label: "Confirmed at check-in" },
];

const LABELS = Object.fromEntries(MEMBERSHIP_OPTIONS.map((item) => [item.value, item.label]));
const SHORT_LABELS = Object.fromEntries(MEMBERSHIP_OPTIONS.map((item) => [item.value, item.shortLabel]));

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Live participant membership data is unavailable in this workspace.");
  return supabase;
}

export function membershipLabel(status, { short = false } = {}) {
  const key = String(status || "unconfirmed");
  return (short ? SHORT_LABELS[key] : LABELS[key]) || LABELS.unconfirmed;
}

export async function loadParticipantMembershipStatuses(sessionId) {
  if (!sessionId || !isSupabaseConfigured || !supabase) return new Map();
  const { data, error } = await client().rpc("get_participant_membership_statuses", { p_session_id: sessionId });
  if (error) throw error;
  return new Map((data || []).map((row) => [row.participant_id, {
    status: row.membership_status || "unconfirmed",
    source: row.verification_source || "not_recorded",
    verifiedAt: row.verified_at || null,
  }]));
}

export async function setParticipantMembershipStatus(participantId, status, source = "checkin_confirmation") {
  const { error } = await client().rpc("set_participant_membership_status", {
    p_participant_id: participantId,
    p_membership_status: status,
    p_verification_source: status === "unconfirmed" ? "not_recorded" : source,
  });
  if (error) throw error;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("fsy:membership-updated", { detail: { participantId, status, source } }));
}

export async function loadParticipantMembershipSummary(sessionId) {
  if (!sessionId || !isSupabaseConfigured || !supabase) return [];
  const { data, error } = await client().rpc("get_participant_membership_summary", { p_session_id: sessionId });
  if (error) throw error;
  return (data || []).map((row) => ({
    status: row.membership_status || "unconfirmed",
    label: membershipLabel(row.membership_status || "unconfirmed"),
    roster: Number(row.roster_count || 0),
    checkedIn: Number(row.checked_in_count || 0),
  }));
}
