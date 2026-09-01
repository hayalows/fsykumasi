import { createClient } from "@supabase/supabase-js";

const PROD_HOSTS = new Set([
  "fsy-kumasi-operations.vercel.app",
  "fsy-kumasi-operations-mensahpkaygmailcoms-projects.vercel.app",
]);

const BUILTIN_PROJECTS = {
  development: {
    url: "https://lizqbihlxeorswibzwyx.supabase.co",
    publishableKey: "sb_publishable_ZmL4QWnvZ5b3XeVdOJLDEw_PdzszTK_",
  },
  production: {
    url: "https://rqwhfiwhuwxhyziallyt.supabase.co",
    publishableKey: "sb_publishable_ZislmmzsTGlIAJ_v33CvTQ_4n_TbFUu",
  },
};

function runtimeFallback() {
  if (typeof window === "undefined") return null;
  const host = window.location.hostname.toLowerCase();

  if (PROD_HOSTS.has(host)) return BUILTIN_PROJECTS.production;

  if (
    host === "localhost"
    || host === "127.0.0.1"
    || host.endsWith(".localhost")
    || (host.endsWith(".vercel.app") && host.startsWith("fsy-kumasi-operations-"))
  ) {
    return BUILTIN_PROJECTS.development;
  }

  return null;
}

const fallback = runtimeFallback();
const url = import.meta.env.VITE_SUPABASE_URL || fallback?.url;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || fallback?.publishableKey;
const localDemo = typeof window !== "undefined"
  && ["localhost", "127.0.0.1"].includes(window.location.hostname)
  && new URLSearchParams(window.location.search).get("demo") === "1";

export const isSupabaseConfigured = !localDemo && Boolean(url && publishableKey);
export const supabaseEnvironment = localDemo ? "local-demo" : fallback === BUILTIN_PROJECTS.production ? "production" : fallback ? "development" : "environment";

export const supabase = isSupabaseConfigured
  ? createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export function subscribeToOperations(sessionId, onChange) {
  if (!supabase || !sessionId) return () => {};
  const channel = supabase
    .channel(`session:${sessionId}:operations`)
    .on("postgres_changes", { event: "*", schema: "public", table: "check_ins", filter: `session_id=eq.${sessionId}` }, onChange)
    // headcount_submissions does not store session_id directly. RLS limits the records
    // delivered to an authenticated user, so the subscription stays table-scoped.
    .on("postgres_changes", { event: "*", schema: "public", table: "headcount_submissions" }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
