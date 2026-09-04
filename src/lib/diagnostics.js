const STORAGE_KEY = "fsy:diagnostics:v1";
const LIMIT = 80;

function safeDetail(detail = {}) {
  const allowed = ["event", "reason", "status", "view", "visible", "online", "discarded", "generation", "sessionChanged"];
  return Object.fromEntries(Object.entries(detail).filter(([key]) => allowed.includes(key)).map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 100) : value]));
}

export function recordDiagnostic(type, detail = {}) {
  if (typeof window === "undefined") return;
  try {
    const current = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || "[]");
    current.push({ at: new Date().toISOString(), type, ...safeDetail(detail) });
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(current.slice(-LIMIT)));
    window.__FSY_DIAGNOSTICS__ = () => [...current.slice(-LIMIT)];
  } catch {
    // Diagnostics must never affect conference operations.
  }
}

export function installLifecycleDiagnostics() {
  if (typeof window === "undefined") return () => {};
  const onPageShow = (event) => recordDiagnostic("PAGE_SHOW", { discarded: Boolean(event.persisted || document.wasDiscarded) });
  const onVisibility = () => recordDiagnostic("VISIBILITY", { visible: document.visibilityState === "visible" });
  const onOnline = () => recordDiagnostic("NETWORK", { online: true });
  const onOffline = () => recordDiagnostic("NETWORK", { online: false });
  window.addEventListener("pageshow", onPageShow);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  recordDiagnostic("LIFECYCLE_DIAGNOSTICS_READY", { online: navigator.onLine, visible: document.visibilityState === "visible" });
  return () => {
    window.removeEventListener("pageshow", onPageShow);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
}
