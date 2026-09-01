import { createClient } from "npm:@supabase/supabase-js@2.112.4";

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowed = origin === "http://localhost:5173"
    || origin === "http://localhost:3000"
    || origin === "https://fsy-kumasi-operations.vercel.app"
    || /^https:\/\/fsy-kumasi-operations-[a-z0-9-]+\.vercel\.app$/i.test(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://fsy-kumasi-operations.vercel.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

function json(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(req) });
}

function normalizeCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json(req, 500, { error: "Account activation is temporarily unavailable." });

  let body: { email?: string; code?: string; displayName?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { error: "Invalid request." });
  }

  const email = String(body.email || "").trim().toLowerCase();
  const code = normalizeCode(String(body.code || ""));
  const displayName = String(body.displayName || "").trim().replace(/\s+/g, " ");
  const password = String(body.password || "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(req, 400, { error: "Enter a valid email address." });
  if (code.length < 24) return json(req, 400, { error: "Enter the full invite code." });
  if (displayName.length < 2 || displayName.length > 80) return json(req, 400, { error: "Enter your full name." });
  if (password.length < 10) return json(req, 400, { error: "Use at least 10 characters for your password." });

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const codeHash = await sha256Hex(code);
  const { data: invite, error: inviteError } = await admin
    .from("leader_invites")
    .select("id, session_id, email, display_name, role, purpose, status, expires_at")
    .eq("code_hash", codeHash)
    .eq("email", email)
    .eq("status", "pending")
    .maybeSingle();

  if (inviteError) return json(req, 500, { error: "Unable to verify this invite right now." });
  if (!invite || new Date(invite.expires_at).getTime() <= Date.now()) {
    return json(req, 400, { error: "That invite code is invalid or has expired." });
  }

  const { data: claimed, error: claimError } = await admin
    .from("leader_invites")
    .update({ status: "activating" })
    .eq("id", invite.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (claimError || !claimed) return json(req, 409, { error: "That invite is already being used. Ask for a new one if needed." });

  let userId = "";
  try {
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("user_id")
      .eq("email", email)
      .maybeSingle();
    if (profileError) throw profileError;

    if (profile?.user_id) {
      if (invite.purpose !== "recovery") {
        throw new Error("ACCOUNT_EXISTS");
      }
      const { data, error } = await admin.auth.admin.updateUserById(profile.user_id, {
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName },
      });
      if (error) throw error;
      userId = data.user.id;
    } else {
      if (invite.purpose === "recovery") throw new Error("ACCOUNT_MISSING");
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName },
      });
      if (error) throw error;
      userId = data.user.id;
    }

    const { error: finalizeError } = await admin.rpc("finalize_leader_invite", {
      p_invite_id: invite.id,
      p_user_id: userId,
    });
    if (finalizeError) throw finalizeError;

    return json(req, 200, { ok: true });
  } catch (error) {
    await admin.from("leader_invites").update({ status: "pending" }).eq("id", invite.id).eq("status", "activating");
    const message = error instanceof Error ? error.message : "";
    if (message === "ACCOUNT_EXISTS") {
      return json(req, 409, { error: "An account already exists for this email. Sign in, use Forgot password, or ask a logistical administrator for a recovery code." });
    }
    if (message === "ACCOUNT_MISSING") {
      return json(req, 400, { error: "This recovery code does not match an existing account." });
    }
    console.error("activate-leader", error);
    return json(req, 500, { error: "We could not activate this account. Please try again or ask a logistical administrator for a new code." });
  }
});
