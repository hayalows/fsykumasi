import { isSupabaseConfigured, supabase } from "./supabase.js";

function topicFor(sessionId) {
  return `fsy-session:${sessionId}:presence`;
}

async function preparePrivateRealtime() {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    await supabase.realtime.setAuth();
    return true;
  } catch {
    return false;
  }
}

export function trackSessionPresence(sessionId, userId) {
  if (!isSupabaseConfigured || !supabase || !sessionId || !userId) return () => {};
  let channel = null;
  let closed = false;

  void (async () => {
    const authorized = await preparePrivateRealtime();
    if (!authorized || closed) return;
    channel = supabase.channel(topicFor(sessionId), {
      config: { private: true, presence: { key: userId } },
    });
    channel.subscribe(async (status) => {
      if (status !== "SUBSCRIBED" || closed || !channel) return;
      try {
        await channel.track({ userId, onlineAt: new Date().toISOString() });
      } catch {
        // Presence is useful but must never interfere with the operations workspace.
      }
    });
  })();

  return () => {
    closed = true;
    if (!channel) return;
    channel.untrack().catch(() => {});
    supabase.removeChannel(channel);
  };
}

function onlineUsersFrom(channel) {
  return new Set(Object.keys(channel?.presenceState?.() || {}));
}

export function subscribeSessionPresence(sessionId, onChange) {
  if (!isSupabaseConfigured || !supabase || !sessionId) return () => {};
  let channel = null;
  let closed = false;
  onChange?.(new Set());

  void (async () => {
    const authorized = await preparePrivateRealtime();
    if (!authorized || closed) return;
    channel = supabase.channel(topicFor(sessionId), { config: { private: true } });
    const emit = () => {
      if (!closed) onChange?.(onlineUsersFrom(channel));
    };
    channel
      .on("presence", { event: "sync" }, emit)
      .on("presence", { event: "join" }, emit)
      .on("presence", { event: "leave" }, emit)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") emit();
        if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) onChange?.(new Set());
      });
  })();

  return () => {
    closed = true;
    onChange?.(new Set());
    if (channel) supabase.removeChannel(channel);
  };
}
