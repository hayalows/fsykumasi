import { useEffect, useId, useRef } from "react";
import { demoSession } from "../data/session.js";

export function Metric({ label, value, note, tone = "blue" }) {
  return (
    <article className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

export function Status({ children, tone = "good" }) {
  return <span className={`status ${tone}`}><i />{children}</span>;
}

export function Empty({ icon: Icon, title, text, action }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon size={25} /></span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function PageHead({ eyebrow, sessionName = demoSession.name, title, description, action }) {
  return (
    <div className="page-head">
      <div>
        <p className="eyebrow">{eyebrow || sessionName}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function focusableElements(container) {
  return [...container.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.getAttribute("aria-hidden") !== "true");
}

/** Shared modal/sheet behavior for short admin flows and mobile detail surfaces. */
export function DismissibleLayer({ open, onClose, title, children, className = "", sheet = false, restoreFocusRef }) {
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const previousActive = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusInitial = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = panel.querySelector("[data-layer-close], input, select, textarea, button, summary") || panel;
      target.focus?.();
    };
    const frame = window.requestAnimationFrame(focusInitial);
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const items = focusableElements(panelRef.current);
      if (!items.length) {
        event.preventDefault();
        panelRef.current.focus?.();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      const restoreTarget = restoreFocusRef?.current || (previousActive && previousActive !== document.body ? previousActive : null);
      restoreTarget?.focus?.();
    };
  }, [open, restoreFocusRef]);

  if (!open) return null;

  return (
    <div
      className={`modal-backdrop dismissible-layer ${sheet ? "sheet-layer" : ""}`.trim()}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onCloseRef.current?.(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onCloseRef.current?.(); }}
      role="presentation"
    >
      <div
        ref={panelRef}
        className={`modal layer-panel ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {title ? <h2 id={titleId} className="sr-only">{title}</h2> : null}
        {children}
      </div>
    </div>
  );
}

