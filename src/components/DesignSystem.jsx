import { ArrowRight } from "@phosphor-icons/react/ArrowRight";

/**
 * Small compositional primitives for new and migrated screens.
 * They intentionally carry almost no product logic. Feature pages own data and
 * permissions; these components keep visual hierarchy and interaction grammar
 * consistent.
 */
export function Section({ eyebrow, title, description, action, children, className = "", as: Tag = "section" }) {
  return <Tag className={`ds-section ${className}`.trim()}>
    {(eyebrow || title || description || action) ? <header className="ds-section-head">
      <div>
        {eyebrow ? <span className="kicker">{eyebrow}</span> : null}
        {title ? <h2>{title}</h2> : null}
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="ds-section-action">{action}</div> : null}
    </header> : null}
    {children}
  </Tag>;
}

export function SummaryStrip({ items = [], label = "Summary", className = "" }) {
  return <div className={`ds-summary-strip ${className}`.trim()} aria-label={label}>
    {items.map((item) => <div key={item.key || item.label} className={item.tone ? `tone-${item.tone}` : ""}>
      <span>{item.label}</span>
      <strong>{item.value}</strong>
      {item.note ? <small>{item.note}</small> : null}
    </div>)}
  </div>;
}

export function Toolbar({ children, className = "", label = "Page controls" }) {
  return <div className={`ds-toolbar ${className}`.trim()} role="group" aria-label={label}>{children}</div>;
}

export function ActionList({ children, className = "", label }) {
  return <div className={`ds-action-list ${className}`.trim()} role={label ? "group" : undefined} aria-label={label}>{children}</div>;
}

export function ActionListItem({ title, detail, meta, icon: Icon, onClick, actionLabel, tone = "default", disabled = false, children }) {
  const content = <>
    {Icon ? <span className={`ds-action-icon tone-${tone}`} aria-hidden="true"><Icon size={19} /></span> : null}
    <span className="ds-action-copy"><b>{title}</b>{detail ? <small>{detail}</small> : null}{children}</span>
    {meta ? <span className="ds-action-meta">{meta}</span> : null}
    {actionLabel ? <span className="ds-action-label">{actionLabel}<ArrowRight size={16} /></span> : onClick ? <ArrowRight className="ds-action-arrow" size={17} aria-hidden="true" /> : null}
  </>;
  return onClick
    ? <button type="button" className={`ds-action-item tone-${tone}`} onClick={onClick} disabled={disabled}>{content}</button>
    : <div className={`ds-action-item tone-${tone}`}>{content}</div>;
}

export function DetailPane({ eyebrow, title, description, actions, children, className = "" }) {
  return <aside className={`ds-detail-pane ${className}`.trim()}>
    <header className="ds-detail-head">
      <div>{eyebrow ? <span className="kicker">{eyebrow}</span> : null}{title ? <h2>{title}</h2> : null}{description ? <p>{description}</p> : null}</div>
      {actions ? <div className="ds-detail-actions">{actions}</div> : null}
    </header>
    <div className="ds-detail-body">{children}</div>
  </aside>;
}

export function InlineBanner({ title, children, tone = "info", action, className = "" }) {
  return <div className={`ds-banner tone-${tone} ${className}`.trim()} role={tone === "danger" ? "alert" : "status"}>
    <div>{title ? <b>{title}</b> : null}{children ? <p>{children}</p> : null}</div>
    {action ? <div className="ds-banner-action">{action}</div> : null}
  </div>;
}
