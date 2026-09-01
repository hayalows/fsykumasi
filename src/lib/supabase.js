import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(url && publishableKey);

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
    .on("postgres_changes", { event: "*", schema: "public", table: "headcount_submissions", filter: `session_id=eq.${sessionId}` }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
