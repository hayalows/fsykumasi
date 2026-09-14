const BLOCKING_LAYER_SELECTOR = ".sidebar.open, .modal-backdrop";
const EDITABLE_SELECTOR = "input:not([type='button']):not([type='submit']):not([type='reset']), textarea, select, [contenteditable='true']";
const STALE_CLIENT_RECOVERY_KEY = "fsy:pwa-stale-client-recovery:v73";
const STALE_CLIENT_RECOVERY_WINDOW_MS = 45_000;
const STABLE_CLIENT_CLEAR_MS = 12_000;
const STALE_ASSET_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /importing a module script failed/i,
  /error loading dynamically imported module/i,
  /unable to preload css/i,
  /failed to load module script/i,
  /chunkloaderror/i,
  /loading chunk .* failed/i,
  /preload.*failed/i,
];

function hasBlockingLayer() {
  return Boolean(document.querySelector(BLOCKING_LAYER_SELECTOR));
}

function repairStaleBodyLock() {
  if (hasBlockingLayer()) return;
  const body = document.body;
  if (!body) return;
  if (body.style.overflow === "hidden") body.style.overflow = "";
  if (body.style.overscrollBehavior === "none") body.style.overscrollBehavior = "";
  if (body.style.touchAction === "none") body.style.touchAction = "";
  delete body.dataset.scrollLocked;
}

function editableTarget(target) {
  return target instanceof Element && target.matches(EDITABLE_SELECTOR);
}

function errorText(reason) {
  if (!reason) return "";
  if (typeof reason === "string") return reason;
  return String(reason.message || reason.reason?.message || reason.error?.message || reason.payload?.message || reason);
}

function isStaleAssetFailure(reason) {
  const message = errorText(reason);
  return STALE_ASSET_PATTERNS.some((pattern) => pattern.test(message));
}

function readLastRecoveryAt() {
  try {
    return Number(window.sessionStorage.getItem(STALE_CLIENT_RECOVERY_KEY) || 0);
  } catch {
    return 0;
  }
}

function writeRecoveryAt(value) {
  try {
    window.sessionStorage.setItem(STALE_CLIENT_RECOVERY_KEY, String(value));
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}

function clearRecoveryMarker() {
  try {
    window.sessionStorage.removeItem(STALE_CLIENT_RECOVERY_KEY);
  } catch {
    // No-op when storage is unavailable.
  }
}

function reloadWithLatestServiceWorker() {
  const reload = () => window.location.reload();
  const serviceWorker = globalThis.navigator?.serviceWorker;
  if (!serviceWorker?.getRegistration) {
    reload();
    return;
  }

  Promise.resolve(serviceWorker.getRegistration())
    .then((registration) => registration?.update?.())
    .catch(() => null)
    .finally(reload);
}

function recoverFromStaleClient(reason) {
  if (!isStaleAssetFailure(reason)) return false;

  const now = Date.now();
  const lastRecoveryAt = readLastRecoveryAt();
  if (lastRecoveryAt && now - lastRecoveryAt < STALE_CLIENT_RECOVERY_WINDOW_MS) return true;

  writeRecoveryAt(now);
  reloadWithLatestServiceWorker();
  return true;
}

export function installPwaRuntimeGuards() {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};

  const root = document.documentElement;
  const visualViewport = window.visualViewport;
  let frame = 0;
  let baselineViewportHeight = Math.max(window.innerHeight, visualViewport?.height || 0);

  const scheduleRepair = () => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(repairStaleBodyLock);
  };

  const updateVisualViewport = () => {
    const visualHeight = visualViewport?.height || window.innerHeight;
    const offsetTop = visualViewport?.offsetTop || 0;
    baselineViewportHeight = Math.max(baselineViewportHeight, window.innerHeight, visualHeight);
    root.style.setProperty("--visual-viewport-height", `${Math.round(visualHeight)}px`);
    root.style.setProperty("--visual-viewport-offset-top", `${Math.round(offsetTop)}px`);

    const focusedEditable = editableTarget(document.activeElement);
    const heightLoss = baselineViewportHeight - visualHeight;
    root.classList.toggle("visual-keyboard-open", focusedEditable && heightLoss > 120);
  };

  const onFocusIn = (event) => {
    root.classList.toggle("mobile-input-active", editableTarget(event.target));
    updateVisualViewport();
  };
  const onFocusOut = () => {
    window.setTimeout(() => {
      root.classList.toggle("mobile-input-active", editableTarget(document.activeElement));
      updateVisualViewport();
      scheduleRepair();
    }, 0);
  };
  const onVisibility = () => {
    if (!document.hidden) {
      baselineViewportHeight = Math.max(window.innerHeight, visualViewport?.height || 0);
      updateVisualViewport();
      scheduleRepair();
    }
  };
  const onPageShow = () => {
    baselineViewportHeight = Math.max(window.innerHeight, visualViewport?.height || 0);
    updateVisualViewport();
    scheduleRepair();
  };
  const onPreloadError = (event) => {
    if (!recoverFromStaleClient(event?.payload || event)) return;
    event.preventDefault?.();
  };
  const onWindowError = (event) => {
    if (!recoverFromStaleClient(event?.error || event?.message || event)) return;
    event.preventDefault?.();
  };
  const onUnhandledRejection = (event) => {
    if (!recoverFromStaleClient(event?.reason || event)) return;
    event.preventDefault?.();
  };

  const observer = new MutationObserver(scheduleRepair);
  observer.observe(document.getElementById("root") || document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("orientationchange", onPageShow);
  window.addEventListener("vite:preloadError", onPreloadError);
  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  visualViewport?.addEventListener("resize", updateVisualViewport);
  visualViewport?.addEventListener("scroll", updateVisualViewport);

  const stableClientTimer = window.setTimeout(clearRecoveryMarker, STABLE_CLIENT_CLEAR_MS);

  updateVisualViewport();
  scheduleRepair();

  return () => {
    window.cancelAnimationFrame(frame);
    window.clearTimeout(stableClientTimer);
    observer.disconnect();
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pageshow", onPageShow);
    window.removeEventListener("orientationchange", onPageShow);
    window.removeEventListener("vite:preloadError", onPreloadError);
    window.removeEventListener("error", onWindowError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
    visualViewport?.removeEventListener("resize", updateVisualViewport);
    visualViewport?.removeEventListener("scroll", updateVisualViewport);
    root.classList.remove("mobile-input-active", "visual-keyboard-open");
  };
}
