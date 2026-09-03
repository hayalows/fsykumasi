const BLOCKING_LAYER_SELECTOR = ".sidebar.open, .modal-backdrop";
const EDITABLE_SELECTOR = "input:not([type='button']):not([type='submit']):not([type='reset']), textarea, select, [contenteditable='true']";

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
  visualViewport?.addEventListener("resize", updateVisualViewport);
  visualViewport?.addEventListener("scroll", updateVisualViewport);

  updateVisualViewport();
  scheduleRepair();

  return () => {
    window.cancelAnimationFrame(frame);
    observer.disconnect();
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pageshow", onPageShow);
    window.removeEventListener("orientationchange", onPageShow);
    visualViewport?.removeEventListener("resize", updateVisualViewport);
    visualViewport?.removeEventListener("scroll", updateVisualViewport);
    root.classList.remove("mobile-input-active", "visual-keyboard-open");
  };
}
