import { isSupabaseConfigured, supabase } from "./supabase.js";

function topicFor(sessionId) {
  return `fsy-session:${sessionId}:presence`;
}

export function trackSessionPresence(sessionId, userId) {
  if (!isSupabaseConfigured || !supabase || !sessionId || !userId) return () => {};
  const channel = supabase.channel(topicFor(sessionId), {
    config: { private: true, presence: { key: userId } },
  });
  let closed = false;
  channel.subscribe(async (status) => {
    if (status !== "SUBSCRIBED" || closed) return;
    await channel.track({ userId, onlineAt: new Date().toISOString() }).catch(() => {});
  });
  return () => {
    closed = true;
    channel.untrack().catch(() => {});
    supabase.removeChannel(channel);
  };
}

function onlineUsersFrom(channel) {
  return new Set(Object.keys(channel.presenceState?.() || {}));
}

export function subscribeSessionPresence(sessionId, onChange) {
  if (!isSupabaseConfigured || !supabase || !sessionId) return () => {};
  const channel = supabase.channel(topicFor(sessionId), { config: { private: true } });
  const emit = () => onChange?.(onlineUsersFrom(channel));
  channel
    .on("presence", { event: "sync" }, emit)
    .on("presence", { event: "join" }, emit)
    .on("presence", { event: "leave" }, emit)
    .subscribe((status) => { if (status === "SUBSCRIBED") emit(); });
  return () => {
    onChange?.(new Set());
    supabase.removeChannel(channel);
  };
}
