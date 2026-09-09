import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { supabase } from "../lib/supabase.js";
import { buildOperationalInbox } from "../lib/overview-inbox.js";
import { phaseLabel, preSessionArea, sessionPhase, shapeOverviewForPhase } from "../lib/overview-phase.js";
import { roleLabel } from "../lib/access.js";
import "./overview-v3.css";

function demoSummary({ currentRole, companies, imported, checkedCount, fieldSummary }) {
  return {
    wholeSession: ["coordinator", "logistics_admin", "session_director"].includes(currentRole),
    scope: { companyCount: companies.length, companyNames: companies.map((company) => company.displayName || company.name), groupCount: companies.reduce((total, company) => total + Number(company.groups?.length || 0), 0), counselorCount: companies.reduce((total, company) => total + (company.groups || []).filter((group) => group.counselorId).length, 0), uncoveredGroups: companies.reduce((total, company) => total + (company.groups || []).filter((group) => !group.counselorId).length, 0), participantCount: imported.length },
    session: { checkedIn: checkedCount, recentArrivals: 0 }, registration: { ready: 0, attention: 0, arrived: checkedCount, onSitePendingVerification: 0, onSitePendingId: 0 }, housing: { waiting: Number(fieldSummary.housingWaiting || 0), assigned: 0 }, headcount: {}, wellness: { open: Number(fieldSummary.wellnessOpen || 0) }, food: { dietaryOpen: Number(fieldSummary.foodOpen || 0), remaining: 0 }, access: { pending: 0 },
  };
}

export function Overview({ live = false, sessionId, setActive, currentRole, currentUser, capabilities = [], fieldSummary = {}, companies = [], imported = [], checkedCount = 0, sessionName }) {
  const fallback = useMemo(() => demoSummary({ currentRole, companies, imported, checkedCount, fieldSummary }), [currentRole, companies, imported, checkedCount, fieldSummary]);
  const [summary, setSummary] = useState(live ? null : fallback);const [phase,setPhase]=useState("unknown");const [loading,setLoading]=useState(Boolean(live));const [error,setError]=useState("");
  const summaryRef = useRef(summary);
  useEffect(() => { summaryRef.current = summary; }, [summary]);
  useEffect(() => { if (!live) setSummary(fallback); }, [live, fallback]);
  useEffect(() => { setLoading(Boolean(live));setError("");setPhase("unknown"); }, [live, sessionId]);

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (!live || !sessionId) return;
    if (!quiet) setLoading(true);
    const [overviewResult,sessionResult]=await Promise.all([supabase.rpc("get_my_operational_overview",{p_session_id:sessionId}),supabase.from("sessions").select("starts_on,ends_on").eq("id",sessionId).single()]);
    if (overviewResult.error) { setError(summaryRef.current ? "The overview update failed. Showing the last successful overview." : "The live overview is not available yet.");setLoading(false);return; }
    const nextPhase=sessionResult.error?"unknown":sessionPhase({startsOn:sessionResult.data?.starts_on,endsOn:sessionResult.data?.ends_on});
    setPhase(nextPhase);setSummary(overviewResult.data||null);setError("");setLoading(false);
  }, [live, sessionId]);

  useEffect(() => { if(!live||!sessionId)return undefined;let active=true;refresh().catch(()=>active&&setError("Overview could not refresh. Your workspaces are still available."));const timer=window.setInterval(()=>{if(active&&document.visibilityState!=="hidden")refresh({quiet:true}).catch(()=>{});},20000);return()=>{active=false;window.clearInterval(timer);};},[live,sessionId,refresh]);

  const effectiveSummary=useMemo(()=>summary?shapeOverviewForPhase(summary,phase):null,[summary,phase]);
  const baseInbox=effectiveSummary?buildOperationalInbox({role:currentRole,capabilities,summary:effectiveSummary}):null;
  const inbox=baseInbox&&phase==="pre_session"&&baseInbox.whole?{...baseInbox,...preSessionArea(summary)}:baseInbox;
  const name=currentUser?.display_name?.trim().split(/\s+/)[0];const updatedAt=summary?.refreshedAt?new Date(summary.refreshedAt):null;const updatedLabel=updatedAt&&Number.isFinite(updatedAt.getTime())?new Intl.DateTimeFormat(undefined,{hour:"numeric",minute:"2-digit"}).format(updatedAt):"";const scopeLabel=inbox?.scopeLabel||(loading?"Loading scope":"Session scope");

  return <section className="page overview-home"><header className="overview-intro"><p className="eyebrow">{sessionName}</p><h1>{name?`Hello, ${name}`:"Overview"}</h1><p>{roleLabel(currentRole)} <span aria-hidden="true">·</span> {scopeLabel} <span aria-hidden="true">·</span> {phaseLabel(phase)}</p></header>
    {error?<div className="overview-refresh-note" role="status"><span>{error}</span><button type="button" onClick={()=>refresh()} disabled={loading}><ArrowClockwise/>Retry</button></div>:null}
    {!inbox?<section className="overview-unavailable" aria-live="polite" aria-busy={loading}><div className="overview-unavailable-mark" aria-hidden="true">{loading?<span/>:<ArrowClockwise/>}</div><div><span className="kicker">{loading?"Preparing live overview":"Needs another try"}</span><h2>{loading?"Loading live FSY information":"Overview is not available yet"}</h2><p>{loading?"We are loading the session facts before showing counts and priorities.":"The live overview could not be loaded, so no numbers are being guessed. Your other workspaces remain available."}</p>{!loading?<button type="button" className="secondary" onClick={()=>refresh()} disabled={loading}><ArrowClockwise/>Retry overview</button>:null}</div></section>:<>
      <section className="overview-attention" aria-labelledby="overview-attention-title" aria-busy={loading}><div className="overview-section-head"><div><span className="kicker">{phase==="pre_session"?"Before FSY":"Right now"}</span><h2 id="overview-attention-title">Your attention</h2></div>{updatedLabel?<small>Updated {updatedLabel}</small>:null}</div>
        <article className={`overview-focus tone-${inbox.primary.tone||"default"}`}><div className="overview-focus-icon" aria-hidden="true">{inbox.taskCount?<span/>:<CheckCircle weight="fill"/>}</div><div className="overview-focus-copy"><span className="kicker">{inbox.taskCount?"Next useful action":"No urgent work"}</span><h3>{inbox.primary.title}</h3><p>{inbox.primary.detail}</p></div><button className="primary" type="button" onClick={()=>setActive(inbox.primary.destination||inbox.primary.id)}>{inbox.primary.action}<ArrowRight/></button></article>
        {inbox.others.length?<div className="overview-followups" aria-label="Also needs attention">{inbox.others.map(item=><button key={`${item.id}:${item.title}`} type="button" onClick={()=>setActive(item.destination||item.id)}><span className={`overview-task-dot tone-${item.tone||"default"}`}/><span><b>{item.title}</b><small>{item.detail}</small></span><ArrowRight/></button>)}</div>:null}
      </section>
      {inbox.metrics.length?<section className="overview-area" aria-labelledby="overview-area-title"><div className="overview-section-head"><div><span className="kicker">Your scope</span><h2 id="overview-area-title">{inbox.areaTitle}</h2></div><p>{inbox.areaDetail}</p></div><div className="overview-metrics">{inbox.metrics.map(metric=><div key={metric.label} className={metric.attention?"attention":""}><b>{Number(metric.value||0).toLocaleString()}</b><span>{metric.label}</span></div>)}</div></section>:null}
    </>}
    <p className="overview-signoff">Walk With Me <span>· Moses 6:34</span></p></section>;
}
