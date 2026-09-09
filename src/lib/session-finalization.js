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

  if (code === "57014" || /canceling statement due to statement timeout|statement timeout/.test(lower)) {
    return {
      accessDenied: false,
      title: phase === "apply" ? "Final roster did not finish in time" : "Final roster preview needs another try",
      message: phase === "apply"
        ? "The database stopped the finalization because it took too long. Nothing was changed. Refresh the preview before trying again."
        : "The roster check took too long. Nothing was changed. Try the preview again.",
      retryable: true,
      safeNoChange: true,
      code: "FINAL_ROSTER_TIMEOUT",
    };
  }

  const friendly = friendlyRuntimeError(error);
  return {
    accessDenied: false,
    title: phase === "apply" ? "Final roster could not be finalized" : "Final roster preview could not load",
    message: friendly.message,
    supportReference: friendly.supportReference,
    retryable: friendly.transient,
    safeNoChange: false,
    code: "FINAL_ROSTER_ERROR",
  };
}

export async function loadSessionFinalizationPreview(sessionId) {
  const { data, error } = await client().rpc("get_session_finalization_preview_v2", { p_session_id: sessionId });
  if (error) throw error;
  return data || {};
}

export async function finalizeSessionRoster(sessionId) {
  const { data, error } = await client().rpc("apply_session_finalization_v2", { p_session_id: sessionId });
  if (error) throw error;
  return data || {};
}
