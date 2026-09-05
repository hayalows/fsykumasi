import { useEffect,useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { ArrowRight } from '@phosphor-icons/react/ArrowRight';
import { overviewFocus } from '../lib/overview-focus.js';
import { roleLabel } from '../lib/access.js';
import './overview-v3.css';

export function Overview({live=false,sessionId,setActive, currentRole, currentUser, capabilities=[], fieldSummary={}, cohort, headcount, companies=[], checkedCount=0, sessionName}) {
  const [summary,setSummary]=useState(null);
  useEffect(()=>{if(!live||!sessionId)return;let active=true;const refresh=async()=>{const {data,error}=await supabase.rpc('get_headcount_summary_v3',{p_session_id:sessionId});if(active&&!error)setSummary(data);};refresh();const timer=setInterval(()=>{if(document.visibilityState!=='hidden')refresh();},12000);return()=>{active=false;clearInterval(timer);};},[live,sessionId]);
  const focus=overviewFocus({role:currentRole,capabilities,headcount,rosterSummary:summary,waitingRooms:fieldSummary.housingWaiting,foodOpen:fieldSummary.foodOpen,wellnessOpen:fieldSummary.wellnessOpen,reviewCount:cohort?.reviewExceptions||0});
  const companyNames=(headcount?.companies||companies).map(c=>c.displayName||c.name);
  const name=currentUser?.display_name?.split(' ')[0];
  return <section className="page overview-home">
    <header><p className="eyebrow">{sessionName}</p><h1>{name ? `Hello, ${name}` : 'Overview'}</h1><p>{roleLabel(currentRole)}{currentRole==='assistant_coordinator' ? ` · ${companyNames.length} assigned ${companyNames.length===1?"company":"companies"}` : focus.whole ? ' · Whole session' : ' · Your committee work'}</p></header>
    <article className="overview-focus" aria-labelledby="next-action-title"><span className="kicker">Up next</span><h2 id="next-action-title">{focus.primary.title}</h2><p>{focus.primary.detail}</p><button className="primary" onClick={()=>setActive(focus.primary.id)}>{focus.primary.action}<ArrowRight/></button></article>
    {focus.whole ? <div className="overview-live-line" aria-label="Session progress"><span><b>{checkedCount.toLocaleString()}</b> checked in</span><span><b>{companies.length}</b> companies</span>{(summary?.round||headcount?.round) ? <span><b>{focus.awaiting}</b> {summary?.round ? "people not checked" : "reports outstanding"}</span>:null}</div> : currentRole==='assistant_coordinator' ? <p className="overview-company-line">{companyNames.join(' · ') || 'Your company assignment will appear here.'}</p> : null}
    {focus.others.length ? <section className="overview-followups" aria-label="Also needs attention"><h2>Also needs attention</h2>{focus.others.map(item=><button key={item.id} onClick={()=>setActive(item.id)}><span><b>{item.title}</b><small>{item.detail}</small></span><ArrowRight/></button>)}</section>:null}
    <p className="overview-signoff">Walk With Me <span>· Moses 6:34</span></p>
  </section>;
}
