let lockCount = 0;
let previousBodyStyles = null;

function body() {
  return typeof document === "undefined" ? null : document.body;
}

export function acquireDocumentScrollLock() {
  const target = body();
  if (!target) return () => {};

  if (lockCount === 0) {
    previousBodyStyles = {
      overflow: target.style.overflow,
      overscrollBehavior: target.style.overscrollBehavior,
      touchAction: target.style.touchAction,
    };
    target.dataset.scrollLocked = "true";
    target.style.overflow = "hidden";
    target.style.overscrollBehavior = "none";
  }

  lockCount += 1;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount !== 0) return;

    const current = body();
    if (!current) return;
    current.style.overflow = previousBodyStyles?.overflow || "";
    current.style.overscrollBehavior = previousBodyStyles?.overscrollBehavior || "";
    current.style.touchAction = previousBodyStyles?.touchAction || "";
    delete current.dataset.scrollLocked;
    previousBodyStyles = null;
  };
}

export function releaseAllDocumentScrollLocks() {
  const target = body();
  lockCount = 0;
  if (!target) return;
  target.style.overflow = previousBodyStyles?.overflow || "";
  target.style.overscrollBehavior = previousBodyStyles?.overscrollBehavior || "";
  target.style.touchAction = previousBodyStyles?.touchAction || "";
  delete target.dataset.scrollLocked;
  previousBodyStyles = null;
}
