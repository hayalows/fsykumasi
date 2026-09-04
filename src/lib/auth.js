import { isSupabaseConfigured, supabase } from "./supabase.js";
import { recordDiagnostic } from "./diagnostics.js";

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

async function invokeAccountSetup(body) {
  const { data, error } = await client().functions.invoke("activate-leader", { body });
  if (error) {
    let message = data?.error || error.message || "Unable to continue account setup.";
    if (error.context instanceof Response) {
      try {
        const responseBody = await error.context.clone().json();
        if (responseBody?.error) message = responseBody.error;
      } catch {
        // Keep the SDK message when the function response is not JSON.
      }
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export function subscribeToAuth(callback) {
  if (!isSupabaseConfigured || !supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    recordDiagnostic("AUTH_EVENT", { event });
    callback(event, session);
  });
  return () => data.subscription.unsubscribe();
}

export async function signInWithPassword(email, password) {
  const { data, error } = await client().auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) {
    if (/invalid login credentials/i.test(error.message || "")) {
      throw new Error("Email or password is incorrect.");
    }
    throw error;
  }
  return data.session;
}

export async function requestPasswordReset(email) {
  const { error } = await client().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${window.location.origin}/?recovery=1`,
  });
  if (error) {
    if (/rate limit/i.test(error.message || "")) {
      throw new Error("Email reset is temporarily rate-limited. Use a recovery code from an FSY administrator instead.");
    }
    throw error;
  }
}

export async function updateRecoveredPassword(password) {
  if (password.length < 10) throw new Error("Use at least 10 characters for your password.");
  const { error } = await client().auth.updateUser({ password });
  if (error) throw error;
}

export async function changePassword(currentPassword, newPassword) {
  if (newPassword.length < 10) throw new Error("Use at least 10 characters for your new password.");
  const { error } = await client().auth.updateUser({
    password: newPassword,
    current_password: currentPassword,
  });
  if (error) throw error;
}

export async function inspectLeaderInvite(code) {
  return invokeAccountSetup({ action: "inspect", code });
}

export async function activateLeaderAccount({ code, password }) {
  const data = await invokeAccountSetup({ action: "activate", code, password });
  if (!data?.email) throw new Error("Account setup finished, but automatic sign-in could not continue. Return to sign in and use your new password.");
  return signInWithPassword(data.email, password);
}

export async function signOutAccount() {
  recordDiagnostic("SIGN_OUT", { reason: "local-device" });
  const { error } = await client().auth.signOut({ scope: "local" });
  if (error) throw error;
}

export async function signOutEverywhere() {
  recordDiagnostic("SIGN_OUT", { reason: "all-devices" });
  const { error } = await client().auth.signOut({ scope: "global" });
  if (error) throw error;
}
