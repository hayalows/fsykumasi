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

const RETRYABLE_READ_STATUS = new Set([502, 503, 504]);
const SAFE_READ_RPCS = new Set(["my_access_state"]);
const READ_RETRY_BASE_MS = 850;
const READ_RETRY_JITTER_MS = 450;

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

function requestMethod(input, init) {
  if (init?.method) return String(init.method).toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  return String(input || "");
}

function safeReadRequest(input, init) {
  const method = requestMethod(input, init);
  if (method === "GET" || method === "HEAD") return true;
  if (method !== "POST") return false;
  try {
    const pathname = new URL(requestUrl(input), typeof window !== "undefined" ? window.location.origin : "http://localhost").pathname;
    const marker = "/rest/v1/rpc/";
    const index = pathname.indexOf(marker);
    if (index < 0) return false;
    return SAFE_READ_RPCS.has(pathname.slice(index + marker.length).split("/")[0]);
  } catch {
    return false;
  }
}

function fetchAttempt(input, init) {
  const target = typeof Request !== "undefined" && input instanceof Request ? input.clone() : input;
  return fetch(target, init);
}

function retryDelay() {
  return READ_RETRY_BASE_MS + Math.floor(Math.random() * READ_RETRY_JITTER_MS);
}

async function resilientReadFetch(input, init) {
  const retryable = safeReadRequest(input, init);
  try {
    const response = await fetchAttempt(input, init);
    if (!retryable || !RETRYABLE_READ_STATUS.has(response.status)) return response;
    await new Promise((resolve) => setTimeout(resolve, retryDelay()));
    return fetchAttempt(input, init);
  } catch (error) {
    if (!retryable) throw error;
    await new Promise((resolve) => setTimeout(resolve, retryDelay()));
    return fetchAttempt(input, init);
  }
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
      global: { fetch: resilientReadFetch },
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
