import { isSupabaseConfigured, supabase } from "./supabase.js";

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

export async function loadLeaderInvites(sessionId) {
  const { data, error } = await client()
    .from("leader_invites")
    .select("id, session_id, email, display_name, role, company_ids, committee_scope, purpose, status, created_at, expires_at")
    .eq("session_id", sessionId)
    .in("status", ["pending", "activating"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createLeaderInvite({ sessionId, email, displayName, role, companyIds = [], committeeScope = [] }) {
  const { data, error } = await client().rpc("create_leader_invite", {
    p_session_id: sessionId,
    p_email: email.trim().toLowerCase(),
    p_display_name: displayName.trim(),
    p_role: role,
    p_company_ids: companyIds,
    p_committee_scope: committeeScope,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("The invite could not be created.");
  return {
    id: row.invite_id,
    code: row.invite_code,
    expiresAt: row.expires_at,
  };
}

export async function revokeLeaderInvite(inviteId) {
  const { error } = await client().rpc("revoke_leader_invite", { p_invite_id: inviteId });
  if (error) throw error;
}

export async function claimInviteWhileSignedIn(code) {
  const { data, error } = await client().rpc("claim_leader_invite_authenticated", { p_code: code });
  if (error) throw error;
  return data;
}

export async function createLeaderRecoveryCode(sessionId, userId) {
  const { data, error } = await client().rpc("create_leader_recovery_code", {
    p_session_id: sessionId,
    p_user_id: userId,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("The recovery code could not be created.");
  return {
    id: row.invite_id,
    code: row.recovery_code,
    expiresAt: row.expires_at,
  };
}

export function subscribeToLeaderInvites(sessionId, callback) {
  if (!isSupabaseConfigured || !supabase || !sessionId) return () => {};
  const channel = supabase
    .channel(`session:${sessionId}:leader-invites`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "leader_invites",
      filter: `session_id=eq.${sessionId}`,
    }, callback)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
