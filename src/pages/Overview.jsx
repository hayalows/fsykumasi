import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { supabase } from "../lib/supabase.js";
import { buildOperationalInbox } from "../lib/overview-inbox.js";
import { roleLabel } from "../lib/access.js";
import "./overview-v3.css";

function demoSummary({ currentRole, companies, imported, checkedCount, fieldSummary }) {
  return {
    wholeSession: ["coordinator", "logistics_admin", "session_director"].includes(currentRole),
    scope: {
      companyCount: companies.length,
      companyNames: companies.map((company) => company.displayName || company.name),
      groupCount: companies.reduce((total, company) => total + Number(company.groups?.length || 0), 0),
      counselorCount: companies.reduce((total, company) => total + (company.groups || []).filter((group) => group.counselorId).length, 0),
      uncoveredGroups: companies.reduce((total, company) => total + (company.groups || []).filter((group) => !group.counselorId).length, 0),
      participantCount: imported.length,
    },
    session: { checkedIn: checkedCount, recentArrivals: 0 },
    registration: { ready: 0, attention: 0, arrived: checkedCount, onSitePendingVerification: 0, onSitePendingId: 0 },
    housing: { waiting: Number(fieldSummary.housingWaiting || 0), assigned: 0 },
    headcount: {},
    wellness: { open: Number(fieldSummary.wellnessOpen || 0) },
    food: { dietaryOpen: Number(fieldSummary.foodOpen || 0), remaining: 0 },
    access: { pending: 0 },
  };
}

export function Overview({
  live = false,
  sessionId,
  setActive,
  currentRole,
  currentUser,
  capabilities = [],
  fieldSummary = {},
  companies = [],
  imported = [],
  checkedCount = 0,
  sessionName,
}) {
  const fallback = useMemo(() => demoSummary({ currentRole, companies, imported, checkedCount, fieldSummary }), [currentRole, companies, imported, checkedCount, fieldSummary]);
  const [summary, setSummary] = useState(fallback);
  const [loading, setLoading] = useState(Boolean(live));
  const [error, setError] = useState("");

  useEffect(() => { if (!live) setSummary(fallback); }, [live, fallback]);

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (!live || !sessionId) return;
    if (!quiet) setLoading(true);
    const { data, error: rpcError } = await supabase.rpc("get_my_operational_overview", { p_session_id: sessionId });
    if (rpcError) {
      setError("Overview could not refresh. Your workspaces are still available.");
      if (!quiet) setLoading(false);
      return;
    }
    setSummary(data || fallback);
    setError("");
    setLoading(false);
  }, [live, sessionId, fallback]);

  useEffect(() => {
    if (!live || !sessionId) return undefined;
    let active = true;
    refresh().catch(() => active && setError("Overview could not refresh. Your workspaces are still available."));
    const timer = window.setInterval(() => {
      if (active && document.visibilityState !== "hidden") refresh({ quiet: true }).catch(() => {});
    }, 20000);
    return () => { active = false; window.clearInterval(timer); };
  }, [live, sessionId, refresh]);

  const inbox = buildOperationalInbox({ role: currentRole, capabilities, summary });
  const name = currentUser?.display_name?.trim().split(/\s+/)[0];
  const updatedAt = summary?.refreshedAt ? new Date(summary.refreshedAt) : null;
  const updatedLabel = updatedAt && Number.isFinite(updatedAt.getTime())
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(updatedAt)
    : "";

  return <section className="page overview-home">
    <header className="overview-intro">
      <p className="eyebrow">{sessionName}</p>
      <h1>{name ? `Hello, ${name}` : "Overview"}</h1>
      <p>{roleLabel(currentRole)} <span aria-hidden="true">·</span> {inbox.scopeLabel}</p>
    </header>

    {error ? <div className="overview-refresh-note" role="status"><span>{error}</span><button type="button" onClick={() => refresh()} disabled={loading}><ArrowClockwise />Retry</button></div> : null}

    <section className="overview-attention" aria-labelledby="overview-attention-title" aria-busy={loading}>
      <div className="overview-section-head">
        <div>
          <span className="kicker">Right now</span>
          <h2 id="overview-attention-title">Your attention</h2>
        </div>
        {updatedLabel ? <small>Updated {updatedLabel}</small> : null}
      </div>

      <article className={`overview-focus tone-${inbox.primary.tone || "default"}`}>
        <div className="overview-focus-icon" aria-hidden="true">{inbox.taskCount ? <span/> : <CheckCircle weight="fill" />}</div>
        <div className="overview-focus-copy">
          <span className="kicker">{inbox.taskCount ? "Next useful action" : "No urgent work"}</span>
          <h3>{inbox.primary.title}</h3>
          <p>{inbox.primary.detail}</p>
        </div>
        <button className="primary" type="button" onClick={() => setActive(inbox.primary.id)}>{inbox.primary.action}<ArrowRight /></button>
      </article>

      {inbox.others.length ? <div className="overview-followups" aria-label="Also needs attention">
        {inbox.others.map((item) => <button key={`${item.id}:${item.title}`} type="button" onClick={() => setActive(item.id)}>
          <span className={`overview-task-dot tone-${item.tone || "default"}`} aria-hidden="true" />
          <span><b>{item.title}</b><small>{item.detail}</small></span>
          <ArrowRight />
        </button>)}
      </div> : null}
    </section>

    {inbox.metrics.length ? <section className="overview-area" aria-labelledby="overview-area-title">
      <div className="overview-section-head">
        <div><span className="kicker">Your scope</span><h2 id="overview-area-title">{inbox.areaTitle}</h2></div>
        <p>{inbox.areaDetail}</p>
      </div>
      <div className="overview-metrics">
        {inbox.metrics.map((metric) => <div key={metric.label} className={metric.attention ? "attention" : ""}>
          <b>{Number(metric.value || 0).toLocaleString()}</b>
          <span>{metric.label}</span>
        </div>)}
      </div>
    </section> : null}

    <p className="overview-signoff">Walk With Me <span>· Moses 6:34</span></p>
  </section>;
}
