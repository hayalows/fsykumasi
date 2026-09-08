import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { PersonName } from "../components/PersonPeek.jsx";
import { Empty, MutationFeedback, SearchField, Status } from "../components/UI.jsx";
import { loadStaff } from "../lib/operations.js";
import { searchPeople } from "../lib/person-search.js";
import { staffException, staffState } from "../lib/staff-state.js";

const ROLE_LABELS={counselor:"Counselor",assistant_coordinator:"Assistant coordinator",coordinator:"Coordinator",committee_member:"Committee member",logistics_admin:"Logistical administrator",session_director:"Session directing couple",other:"Other staff"};

export function StaffReadiness({sessionId,onNavigate}){
 const[staff,setStaff]=useState([]);const[query,setQuery]=useState("");const[filter,setFilter]=useState("attention");const[loading,setLoading]=useState(true);const[error,setError]=useState("");
 useEffect(()=>{let active=true;setLoading(true);loadStaff(sessionId).then(rows=>active&&setStaff(rows)).catch(err=>active&&setError(err.message||"Staff readiness could not load.")).finally(()=>active&&setLoading(false));return()=>{active=false;};},[sessionId]);
 const current=staff.filter(person=>person.isCurrent!==false&&person.registrationStatus!=="cancelled");
 const counts=useMemo(()=>({approved:current.filter(p=>p.registrationStatus==="approved").length,confirmation:current.filter(p=>staffState(p).clearance==="confirmation_required").length,cleared:current.filter(p=>staffState(p).clearance==="cleared").length,cancelled:staff.filter(p=>p.registrationStatus==="cancelled"||p.isCurrent===false).length,attention:current.filter(p=>Boolean(staffException(p))).length}),[staff]);
 const rows=useMemo(()=>searchPeople(current.filter(person=>filter==="all"||filter==="attention"&&Boolean(staffException(person))||filter==="confirmation"&&staffState(person).clearance==="confirmation_required"||filter==="cleared"&&staffState(person).clearance==="cleared"),query).slice(0,120),[current,filter,query]);
 return <section className="staff-readiness-v28">
  {error?<MutationFeedback tone="error">{error}</MutationFeedback>:null}
  <article className="panel staff-readiness-summary-v28"><div><span className="kicker">Staff readiness</span><h2>{loading?"Checking Staff…":counts.confirmation?`${counts.confirmation} Staff need confirmation`:"Staff clearance is ready"}</h2><p>Source approval stays intact. Day-of service clearance and assignments are managed from Staff & responsibilities.</p></div><Status tone={counts.confirmation?"warn":"good"}>{counts.confirmation?"Needs action":"Ready"}</Status></article>
  <div className="staff-readiness-metrics-v28"><button type="button" onClick={()=>setFilter("confirmation")}><b>{counts.confirmation}</b><span>Need confirmation</span><small>Source status is not rewritten</small></button><button type="button" onClick={()=>setFilter("cleared")}><b>{counts.cleared}</b><span>Cleared to plan</span><small>{counts.approved} source-approved</small></button><button type="button" onClick={()=>setFilter("attention")}><b>{counts.attention}</b><span>Need attention</span><small>Clearance, arrival or replacement</small></button><button type="button" onClick={()=>setFilter("all")}><b>{current.length}</b><span>Current Staff</span><small>{counts.cancelled} cancelled / inactive kept for history</small></button></div>
  <article className="panel staff-readiness-list-v28"><div className="staff-readiness-tools-v28"><SearchField value={query} onChange={setQuery} label="Find Staff" placeholder="Name, unit or responsibility"/><button type="button" className="primary" onClick={()=>onNavigate?.({view:"assignments",tab:"people",filter:filter==="confirmation"||filter==="attention"?"attention":"all"})}>Open Staff assignments<ArrowRight/></button></div><div className="staff-readiness-rows-v28">{rows.map(person=><div key={person.id}><span><PersonName person={person} kind="staff"/><small>{ROLE_LABELS[person.operationalRole]||"Staff"} · {person.unit||"Unit not recorded"}</small></span><Status tone={staffException(person)?"warn":"good"}>{staffException(person)||"Cleared"}</Status></div>)}</div>{!loading&&!rows.length?<Empty icon={WarningCircle} title="No Staff in this view" text="Change the filter or search for another person."/>:null}</article>
 </section>;
}
