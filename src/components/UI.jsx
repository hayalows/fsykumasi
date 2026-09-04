import { useEffect, useId, useRef } from "react";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { X } from "@phosphor-icons/react/X";
import { demoSession } from "../data/session.js";

export function SearchField({ value = "", onChange, placeholder, label = "Search", className = "", inputRef, autoFocus = false, disabled = false }) {
  const inputId = useId();
  const hasValue = String(value).length > 0;
  return (
    <div className={`search search-field ${className}`.trim()}>
      <label className="sr-only" htmlFor={inputId}>{label}</label>
      <MagnifyingGlass aria-hidden="true" />
      <input
        ref={inputRef}
        id={inputId}
        type="search"
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
      />
      {hasValue ? <button type="button" className="search-clear" onClick={() => onChange?.("")} aria-label={`Clear ${label.toLowerCase()}`}><X size={18} /></button> : null}
    </div>
  );
}

export function SegmentedControl({ options = [], value, onChange, label, className = "" }) {
  const baseId = useId();
  const optionId = (option, index) => option.id || `${baseId}-${String(option.value).replace(/\s+/g, "-")}-${index}`;
  const focusOption = (index) => {
    const next = options[(index + options.length) % options.length];
    if (next) document.getElementById(optionId(next, (index + options.length) % options.length))?.focus();
  };
  return (
    <div className={`segmented ${className}`.trim()} role="tablist" aria-label={label}>
      {options.map((option, index) => {
        const selected = option.value === value;
        const id = optionId(option, index);
        return <button
          key={option.value}
          id={id}
          type="button"
          role="tab"
          aria-selected={selected}
          tabIndex={selected ? 0 : -1}
          className={selected ? "active" : ""}
          onClick={() => onChange?.(option.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); focusOption(index + 1); onChange?.(options[(index + 1) % options.length].value); }
            if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); focusOption(index - 1); onChange?.(options[(index - 1 + options.length) % options.length].value); }
          }}
        ><span className="segmented-label">{option.label}</span>{option.count === undefined ? null : <b aria-label={`${option.count.toLocaleString()} items`}>{option.count.toLocaleString()}</b>}</button>;
      })}
    </div>
  );
}

export function MutationFeedback({ tone = "success", children, className = "" }) {
  if (!children) return null;
  return <div className={`mutation-feedback ${tone} ${className}`.trim()} role={tone === "error" ? "alert" : "status"} aria-live="polite">
    {tone === "success" ? <CheckCircle weight="fill" aria-hidden="true" /> : null}
    <span>{children}</span>
  </div>;
}

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
      {Icon ? <span className="empty-icon"><Icon size={25} /></span> : null}
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
      const compactViewport = window.matchMedia?.("(max-width: 760px)")?.matches;
      const explicit = panel.querySelector("[data-layer-autofocus]");
      const firstField = compactViewport ? null : panel.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
      (explicit || firstField || panel).focus?.();
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
      onPointerDown={(event) => { if (event.target === event.currentTarget) onCloseRef.current?.(); }}
      role="presentation"
    >
      <div
        ref={panelRef}
        className={`modal layer-panel ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={title ? undefined : "Dialog"}
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {title ? <h2 id={titleId} className="sr-only">{title}</h2> : null}
        {children}
      </div>
    </div>
  );
}
