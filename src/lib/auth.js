import { isSupabaseConfigured, supabase } from "./supabase.js";

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

export function subscribeToAuth(callback) {
  if (!isSupabaseConfigured || !supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, session) => callback(event, session));
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
      throw new Error("Too many email requests were sent recently. Wait a little, or ask a logistical administrator for a recovery code.");
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

export async function activateLeaderAccount({ email, code, displayName, password }) {
  const { data, error } = await client().functions.invoke("activate-leader", {
    body: { email, code, displayName, password },
  });
  if (error) {
    let message = data?.error || error.message || "Unable to activate this account.";
    if (error.context instanceof Response) {
      try {
        const body = await error.context.clone().json();
        if (body?.error) message = body.error;
      } catch {
        // Keep the SDK error message when the function response is not JSON.
      }
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return signInWithPassword(email, password);
}

export async function signOutAccount() {
  const { error } = await client().auth.signOut();
  if (error) throw error;
}
