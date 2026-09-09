import { isSupabaseConfigured, supabase } from "./supabase.js";
import { friendlyRuntimeError } from "./ux-errors.js";

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

function rawErrorText(error) {
  if (!error) return "";
  return String(error.message || error.error_description || error.details || error.hint || error);
}

export function describeSessionFinalizationError(error, phase = "preview") {
  const raw = rawErrorText(error).trim();
  const lower = raw.toLowerCase();
  const code = String(error?.code || "");

  if (/final roster access required/i.test(raw)) {
    return {
      accessDenied: true,
      title: "Final roster access required",
      message: "This final-roster action is not assigned to your account.",
      retryable: false,
    };
  }

  if (/reset all live check-ins/i.test(raw)) {
    return {
      accessDenied: false,
      title: "Reset check-ins first",
      message: "The controlled rebalance is intentionally blocked while anyone is checked in. Reset the current check-ins, then refresh the plan.",
      retryable: true,
      safeNoChange: true,
      code: "FINAL_ROSTER_LIVE_CHECKINS",
    };
  }

  if (/active housing assignments/i.test(raw)) {
    return {
      accessDenied: false,
      title: "Housing is already in use",
      message: "Active Housing assignments exist. Review them before changing or restoring the final roster.",
      retryable: false,
      safeNoChange: true,
      code: "FINAL_ROSTER_HOUSING_ACTIVE",
    };
  }

  if (/head-count history references/i.test(raw)) {
    return {
      accessDenied: false,
      title: "This version cannot be restored yet",
      message: "A later head-count round references roster structure that did not exist in this saved version. Void that operational round before restoring.",
      retryable: false,
      safeNoChange: true,
      code: "FINAL_ROSTER_HEADCOUNT_DEPENDENCY",
    };
  }

  if (code === "57014" || /canceling statement due to statement timeout|statement timeout/.test(lower)) {
    return {
      accessDenied: false,
      title: phase === "apply" ? "Final roster did not finish in time" : "Final roster preview needs another try",
      message: phase === "apply"
        ? "The database stopped the finalization because it took too long. Nothing was changed. Refresh the plan before trying again."
        : "The roster check took too long. Nothing was changed. Try the plan again.",
      retryable: true,
      safeNoChange: true,
      code: "FINAL_ROSTER_TIMEOUT",
    };
  }

  const friendly = friendlyRuntimeError(error);
  return {
    accessDenied: false,
    title: phase === "restore"
      ? "Saved roster could not be restored"
      : phase === "save"
        ? "Roster version could not be saved"
        : phase === "apply"
          ? "Final roster could not be finalized"
          : "Final roster plan could not load",
    message: friendly.message,
    supportReference: friendly.supportReference,
    retryable: friendly.transient,
    safeNoChange: false,
    code: "FINAL_ROSTER_ERROR",
  };
}

export async function loadSessionFinalizationPreview(sessionId) {
  const { data, error } = await client().rpc("get_controlled_final_roster_preview_v3", { p_session_id: sessionId });
  if (error) throw error;
  return data || {};
}

export async function finalizeSessionRoster(sessionId) {
  const { data, error } = await client().rpc("apply_controlled_final_roster_rebalance_v3", { p_session_id: sessionId });
  if (error) throw error;
  return data || {};
}

export async function saveSessionRosterVersion(sessionId, label = "Current roster", reason = null) {
  const { data, error } = await client().rpc("save_session_roster_version_v1", {
    p_session_id: sessionId,
    p_label: label,
    p_reason: reason,
  });
  if (error) throw error;
  return data || {};
}

export async function loadSessionRosterVersions(sessionId) {
  const { data, error } = await client().rpc("list_session_roster_versions_v1", { p_session_id: sessionId });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function restoreSessionRosterVersion(sessionId, versionId) {
  const { data, error } = await client().rpc("restore_session_roster_version_v1", {
    p_session_id: sessionId,
    p_version_id: versionId,
  });
  if (error) throw error;
  return data || {};
}
