import { useCallback, useEffect, useRef } from "react";

/**
 * Prevent the same UI action from being submitted twice before React has had
 * time to paint the disabled state. The guard is intentionally local to the
 * mounted component, so separate workspaces never block one another.
 */
export function useSingleFlight() {
  const active = useRef(new Set());

  return useCallback(async (key, action) => {
    const actionKey = String(key || "default");
    if (active.current.has(actionKey)) return undefined;
    active.current.add(actionKey);
    try {
      return await action();
    } finally {
      active.current.delete(actionKey);
    }
  }, []);
}

/**
 * Protect refresh/close while a consequential request is still in flight.
 * In-app controls should also remain disabled while `active` is true.
 */
export function usePendingPageGuard(active) {
  useEffect(() => {
    if (!active || typeof window === "undefined") return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
}

export function recoverableWriteError(error, fallback = "That change could not be saved.") {
  const message = String(error?.message || "").trim();
  if (!message) return fallback;
  if (/network|fetch|timeout|timed out|offline|connection|failed to fetch/i.test(message)) {
    return `${fallback} Check the connection and try again. No success is assumed until the server confirms it.`;
  }
  return message;
}
