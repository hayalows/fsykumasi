import { PersonName } from "../components/PersonPeek.jsx";
import { RegistrationLeadershipResolution } from "../components/RegistrationLeadershipResolution.jsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { Check } from "@phosphor-icons/react/Check";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { DismissibleLayer, Empty, MutationFeedback, SearchField, Status } from "../components/UI.jsx";
import { assignParticipantToGroup, loadGroupingPlan, recordCheckin, verifyOnSiteParticipant } from "../lib/backend.js";
import { hasCapability } from "../lib/field-operations.js";
import { loadArrivalVacancies, replaceArrivalVacancy, setArrivalStatus } from "../lib/identity-arrival.js";
import { addOnSiteParticipantDetailed, loadOnSiteReferenceDate } from "../lib/onsite.js";
import { buildUnitDirectory } from "../lib/registration-lookup.js";
import { matchesRegistrationSearchV6, registrationSearchRank } from "../lib/registration-search-v6.js";
import { loadRegistrationWorkspaceV29 } from "../lib/registration-workspace-v29.js";
import { registrationBlocker, isRegistrationReady } from "../lib/registration-workflow-v30.js";
import { DeskFilters, OnSiteDetails, PersonJourney, arrivalLabel, arrivalTone, displaySource, initials } from "./RegistrationJourneyPartsV4.jsx";
import "./registration-journey-v2.css";
import "./registration-journey-v3.css";
import "./registration-journey-v4.css";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const PAGE_SIZE = 60;
const FILTER_LABELS = { all:"Everyone", arrived:"Checked in", expected:"Yet to arrive", ready:"Ready", needs_help:"Needs attention", awaiting:"Awaiting approval", age_review:"Age review", needs_group:"Needs group", needs_id:"Needs FSY ID", on_site:"On-site", not_attending:"Not attending" };
const AGE_REASONS=new Set(["Too young for this FSY year","Turns 19 before or on the end of this session","Date of birth is missing"]);
const SOLUTION_META={
  needs_help:{label:"All blockers",help:"Start here"},
  awaiting:{label:"Awaiting approval",help:"Leadership decision"},
  age_review:{label:"Age review",help:"Eligibility decision"},
  needs_group:{label:"Needs group",help:"Place participant"},
  needs_id:{label:"Needs FSY ID",help:"Finish identity"},
  on_site:{label:"On-site",help:"Verify and place"},
};

function demoRegistrationRows(participants = []) {
  return participants.map((person, index) => ({
    ...person,
    participantId: person.id,
    id: person.id,
    isCurrent: person.isCurrent !== false,
    registrationStatus: person.registrationStatus || "approved",
    verificationStatus: person.verificationStatus || "verified",
    attendanceStatus: person.attendanceStatus || "expected",
    checkinStatus: person.checkinStatus || "expected",
    companyName: person.companyName || `Company ${(index % 44) + 1}`,
    groupName: person.groupName || `Group ${(index % 175) + 1}`,
    fsyId: person.fsyId || `D-${String(index + 1).padStart(4, "0")}`,
    serverEligibility: person.serverEligibility || { eligible: true, reason: "Demo rehearsal eligible" },
  }));
}

function matchesWorkFilter(row,eligibility,filter){
  if(filter==="arrived")return row.checkinStatus==="arrived";
  if(filter==="expected")return row.checkinStatus!=="arrived"&&row.attendanceStatus!=="confirmed_not_attending";
  if(filter==="ready")return Boolean(eligibility)&&isRegistrationReady(row,eligibility);
  if(filter==="needs_help")return Boolean(eligibility)&&Boolean(registrationBlocker(row,eligibility));
  if(filter==="awaiting")return row.registrationStatus==="awaiting"||eligibility?.reason==="Registration is not approved";
  if(filter==="age_review")return AGE_REASONS.has(eligibility?.reason||"");
  if(filter==="needs_group")return Boolean(eligibility?.eligible&&!row.groupName&&row.verificationStatus==="verified");
  if(filter==="needs_id")return Boolean(eligibility?.eligible&&row.groupName&&!row.fsyId);
  if(filter==="on_site")return row.sourceKind==="on_site";
  if(filter==="not_attending")return row.attendanceStatus==="confirmed_not_attending";
  return true;
}

export function RegistrationJourneyV29({ view="desk", participants=[], initialGroups=[], initialFilter="", sessionId, capabilities=[], onOperationalDataChanged, onCheckin, onUndoCheckin, onSetOperationalStatus }){
  const canManageRegistration=hasCapability(capabilities,"registration_manage");
  const canCheckin=hasCapability(capabilities,"checkin_record")||canManageRegistration;
  const[rows,setRows]=useState(()=>sessionId?[]:demoRegistrationRows(participants));
  const[query,setQuery]=useState("");
  const[filter,setFilterState]=useState(initialFilter||(view==="desk"?"ready":"needs_help"));
  const[sourceFilter,setSourceFilter]=useState("all");
  const[shown,setShown]=useState(PAGE_SIZE);
  const[selectedId,setSelectedId]=useState("");
  const[onsiteOpen,setOnsiteOpen]=useState(false);
  const[busyId,setBusyId]=useState("");
  const[error,setError]=useState("");
  const[message,setMessage]=useState(null);
  const[initialLoading,setInitialLoading]=useState(true);
  const[refreshing,setRefreshing]=useState(false);
  const[loadError,setLoadError]=useState("");
  const[placementGroups,setPlacementGroups]=useState(initialGroups);
  const[placementCompanies,setPlacementCompanies]=useState([]);
  const[vacancies,setVacancies]=useState([]);
  const[placementLoading,setPlacementLoading]=useState(false);
  const[sessionStart,setSessionStart]=useState("");
  const searchRef=useRef(null);

  const setFilter=(value)=>{setFilterState(value);setShown(PAGE_SIZE);};
  const reload=useCallback(async({initial=false}={})=>{
    if(!sessionId)return [];
    if(initial)setInitialLoading(true);else setRefreshing(true);
    setLoadError("");
    try{
      const next=await loadRegistrationWorkspaceV29(sessionId);
      setRows(next);
      return next;
    }catch(err){setLoadError(err.message||"Registration workspace could not load.");throw err;}
    finally{if(initial)setInitialLoading(false);setRefreshing(false);}
  },[sessionId]);

  useEffect(()=>{if(!sessionId){setRows(current=>current.length?current:demoRegistrationRows(participants));setInitialLoading(false);setRefreshing(false);setLoadError("");return undefined;}let active=true;reload({initial:true}).catch(()=>{if(active)setInitialLoading(false);});return()=>{active=false;};},[reload,sessionId,participants.length]);
  useEffect(()=>{setFilterState(initialFilter||(view==="desk"?"ready":"needs_help"));setShown(PAGE_SIZE);},[view,initialFilter]);
  useEffect(()=>{setPlacementGroups(initialGroups||[]);},[initialGroups]);
  useEffect(()=>{setPlacementCompanies([]);setVacancies([]);setSessionStart("");},[sessionId]);

  const participantById=useMemo(()=>new Map(participants.map(person=>[person.id,person])),[participants]);
  const enrichedRows=useMemo(()=>rows.map(row=>({...participantById.get(row.participantId),...row,id:row.participantId,age:row.age??participantById.get(row.participantId)?.age??null})),[rows,participantById]);
  const currentRows=useMemo(()=>enrichedRows.filter(row=>row.isCurrent),[enrichedRows]);
  const eligibilityMap=useMemo(()=>new Map(enrichedRows.map(row=>[row.participantId,row.serverEligibility]).filter(([,value])=>Boolean(value))),[enrichedRows]);
  const housingByPerson=useMemo(()=>new Map(enrichedRows.filter(row=>row.roomId).map(row=>[row.participantId,{personId:row.participantId,personType:"participant",roomId:row.roomId,roomName:row.roomName,bedLabel:row.bedLabel,assignedAt:row.housingAssignedAt}])),[enrichedRows]);
  const unitDirectory=useMemo(()=>buildUnitDirectory(enrichedRows),[enrichedRows]);
  const searching=Boolean(query.trim());
  const finalized=useMemo(()=>enrichedRows.some(row=>row.badgeState==="finalized"),[enrichedRows]);
  const identityReadiness=useMemo(()=>({finalizedIds:finalized?1:0}),[finalized]);

  const counts=useMemo(()=>Object.fromEntries(Object.keys(FILTER_LABELS).map(key=>[key,currentRows.filter(row=>matchesWorkFilter(row,eligibilityMap.get(row.participantId),key)).length])),[currentRows,eligibilityMap]);
  const filtered=useMemo(()=>{
    const text=query.trim();
    return currentRows.filter(row=>{
      const eligibility=eligibilityMap.get(row.participantId);
      const housing=housingByPerson.get(row.participantId);
      if(view==="desk"&&text)return matchesRegistrationSearchV6(row,text,housing);
      if(sourceFilter==="official"&&row.sourceKind==="on_site")return false;
      if(sourceFilter==="on_site"&&row.sourceKind!=="on_site")return false;
      if(!matchesWorkFilter(row,eligibility,filter))return false;
      return !text||matchesRegistrationSearchV6(row,text,housing);
    }).sort((a,b)=>{
      if(text){const rank=registrationSearchRank(a,text,housingByPerson.get(a.participantId))-registrationSearchRank(b,text,housingByPerson.get(b.participantId));if(rank)return rank;}
      if(!text&&["all","expected"].includes(filter)){
        const ae=eligibilityMap.get(a.participantId),be=eligibilityMap.get(b.participantId);
        const aReady=Boolean(ae)&&isRegistrationReady(a,ae),bReady=Boolean(be)&&isRegistrationReady(b,be);if(aReady!==bReady)return aReady?-1:1;
        const aProblem=Boolean(ae&&registrationBlocker(a,ae)),bProblem=Boolean(be&&registrationBlocker(b,be));if(aProblem!==bProblem)return aProblem?1:-1;
      }
      return collator.compare(a.fullName,b.fullName);
    });
  },[currentRows,eligibilityMap,housingByPerson,query,filter,sourceFilter,view]);

  const matchingInOtherViews=view==="roster"&&searching?currentRows.filter(row=>matchesRegistrationSearchV6(row,query,housingByPerson.get(row.participantId))).length:0;
  const visible=filtered.slice(0,shown);
  const selectedRow=enrichedRows.find(row=>row.participantId===selectedId)||null;
  const selectedEligibility=selectedRow?eligibilityMap.get(selectedRow.participantId):null;
  const selectedHousing=selectedRow?housingByPerson.get(selectedRow.participantId):null;
  const activeFilterLabel=FILTER_LABELS[filter]||"Participants";
  const defaultFilter=view==="desk"?"ready":"needs_help";

  const refreshParent=()=>{if(!onOperationalDataChanged)return;window.setTimeout(()=>{Promise.resolve(onOperationalDataChanged()).catch(()=>{});},250);};
  const refreshAfterMutation=async()=>{try{await reload();}catch{}refreshParent();};
  const runMutation=async(personId,action,success,{refresh=true,parent=true}={})=>{
    setBusyId(personId||"workspace");setError("");setMessage(null);
    try{
      const result=await action();
      if(success)setMessage({tone:"success",text:success});
      if(refresh)try{await reload();}catch{}
      if(parent)refreshParent();
      return result;
    }catch(err){setError(err.message||"That change could not be saved.");throw err;}
    finally{setBusyId("");}
  };

  const ensurePlacementData=useCallback(async()=>{
    if(!sessionId||placementLoading)return;
    if(placementCompanies.length&&(!finalized||vacancies.length))return;
    setPlacementLoading(true);
    try{
      const[grouping,nextVacancies]=await Promise.all([
        loadGroupingPlan(sessionId),
        canManageRegistration&&finalized?loadArrivalVacancies(sessionId):Promise.resolve([]),
      ]);
      setPlacementGroups(grouping.groups||[]);setPlacementCompanies(grouping.companies||[]);setVacancies(nextVacancies||[]);
    }catch(err){setError(err.message||"Placement options could not load.");}
    finally{setPlacementLoading(false);}
  },[sessionId,placementLoading,placementCompanies.length,finalized,vacancies.length,canManageRegistration]);

  useEffect(()=>{
    const needsPlacement=Boolean(selectedRow&&selectedEligibility?.eligible&&selectedRow.verificationStatus==="verified"&&!selectedRow.groupName);
    if(needsPlacement&&canManageRegistration)ensurePlacementData();
  },[selectedRow?.participantId,selectedRow?.verificationStatus,selectedRow?.groupName,selectedEligibility?.eligible,canManageRegistration,ensurePlacementData]);

  const openOnsite=()=>{
    setOnsiteOpen(true);setError("");
    if(!sessionStart&&sessionId)loadOnSiteReferenceDate(sessionId).then(setSessionStart).catch(()=>{});
  };
  const focusNext=()=>{setSelectedId("");setQuery("");setFilter("ready");window.requestAnimationFrame(()=>{searchRef.current?.scrollIntoView?.({block:"start",behavior:"auto"});searchRef.current?.querySelector?.("input")?.focus?.();});};
  const checkIn=async(row,keepOpen=false)=>{if(!canCheckin)return;try{const housing=housingByPerson.get(row.participantId);const success=housing?`${row.fullName} is checked in · Housing: ${housing.roomName}.`:`${row.fullName} is checked in. Housing can now see them in Arrivals waiting.`;const state=await runMutation(row.participantId,()=>onCheckin?onCheckin(row.participantId,"arrived"):!sessionId?Promise.resolve({recordedAt:new Date().toISOString()}):recordCheckin({sessionId,participantId:row.participantId,status:"arrived"}),success,{refresh:false,parent:false});setRows(current=>current.map(item=>item.participantId===row.participantId?{...item,checkinStatus:"arrived",checkinRecordedAt:state?.recordedAt||item.checkinRecordedAt||null}:item));if(!keepOpen)focusNext();}catch{}};
  const undoCheckIn=async(row)=>{if(!onUndoCheckin&&!sessionId){setRows(current=>current.map(item=>item.participantId===row.participantId?{...item,checkinStatus:"expected",checkinRecordedAt:null}:item));setMessage({tone:"success",text:`${row.fullName} is back to Expected.`});return;}if(!onUndoCheckin)return;try{await runMutation(row.participantId,()=>onUndoCheckin(row.participantId,row.checkinRecordedAt||null),`${row.fullName} is back to Expected.`,{refresh:false,parent:false});setRows(current=>current.map(item=>item.participantId===row.participantId?{...item,checkinStatus:"expected",checkinRecordedAt:null}:item));}catch{}};
  const createOnsite=async(form)=>{setBusyId("onsite-new");setError("");try{const participantId=await addOnSiteParticipantDetailed({sessionId,...form});await refreshAfterMutation();setOnsiteOpen(false);setSelectedId(participantId);setMessage({tone:"success",text:`${form.firstName} ${form.lastName} was added for verification. Once approved, the system provisions a supplemental group, company assignment and FSY ID.`});}catch(err){setError(err.message||"Unable to add this participant.");}finally{setBusyId("");}};
  const verifySelected=async(note)=>{if(!selectedRow)return;try{await runMutation(selectedRow.participantId,()=>verifyOnSiteParticipant(selectedRow.participantId,true,note),`${selectedRow.fullName} is verified, placed in a supplemental group and issued an FSY ID.`);}catch{}};
  const assignGroup=async(group)=>{if(!selectedRow)return;const onSite=selectedRow.sourceKind==="on_site";try{await runMutation(selectedRow.participantId,()=>assignParticipantToGroup(selectedRow.participantId,group.id),onSite?`${selectedRow.fullName} was placed in ${group.displayName||group.name}. Their FSY ID was created automatically.`:`${selectedRow.fullName} was assigned to ${group.displayName||group.name}.`);}catch{}};
  const useVacancy=async(vacancy)=>{if(!selectedRow)return;try{await runMutation(selectedRow.participantId,()=>replaceArrivalVacancy(vacancy.participantId,selectedRow.participantId),`${selectedRow.fullName} was placed in ${vacancy.groupName}. Their FSY ID was issued automatically.`);setVacancies(current=>current.filter(item=>item.participantId!==vacancy.participantId));}catch{}};
  const arrivalStatus=async(next,note="")=>{if(!selectedRow)return;try{const operationalStatus=next==="confirmed_not_attending"?"not_attending":next==="did_not_arrive"?"did_not_arrive":next==="expected"&&selectedRow.operationalStatus&&selectedRow.operationalStatus!=="active"?"active":null;const demoUpdate=()=>{setRows(current=>current.map(item=>item.participantId!==selectedRow.participantId?item:{...item,attendanceStatus:operationalStatus&&operationalStatus!=="active"?"confirmed_not_attending":next,operationalStatus:operationalStatus||item.operationalStatus,operationalRevision:(item.operationalRevision||0)+1}));return Promise.resolve();};await runMutation(selectedRow.participantId,()=>operationalStatus&&onSetOperationalStatus?onSetOperationalStatus({participantId:selectedRow.participantId,status:operationalStatus,revision:selectedRow.operationalRevision||0,reason:note||"Updated from Registration & Check-in desk",authority:note.split(":")[0]||""}):!sessionId?demoUpdate():setArrivalStatus(selectedRow.participantId,next,note||"Updated from Registration & Check-in desk"),`${selectedRow.fullName} is now ${next==="expected_later"?"expected later":next==="unknown"?"marked for follow-up":next==="confirmed_not_attending"?"confirmed not attending":next==="did_not_arrive"?"marked did not arrive":"expected today"}.`);await reload();}catch{}};
  const refreshResolution=async()=>{setMessage({tone:"success",text:"Leadership decision recorded. Rechecking this participant now."});await refreshAfterMutation();};
  const closePerson=()=>{if(!busyId){setSelectedId("");setError("");}};
  const closeOnsite=()=>{if(!busyId){setOnsiteOpen(false);setError("");}};
  const openPerson=(row)=>{setSelectedId(row.participantId);setError("");};
  const clearSearch=()=>{setQuery("");setShown(PAGE_SIZE);window.requestAnimationFrame(()=>searchRef.current?.querySelector?.("input")?.focus?.());};
  const solutionFilters=["needs_help","awaiting","age_review","needs_group","needs_id","on_site"];

  return <section className={`regjourney regjourney-${view} regjourney-v2 regjourney-v3 regjourney-v4 regjourney-v6 regjourney-v29 regjourney-v30`}>
    {view==="roster"?<><div className="regjourney-roster-head regjourney-roster-head-v2 regjourney-roster-head-v3"><div><span className="kicker">Final roster</span><h2>Resolve the blocker, then return to normal check-in</h2><p>Each participant shows one current blocker and the next useful action. Supporting setup lives in Readiness, not in a second exception queue.</p></div><div><b>{counts.needs_help.toLocaleString()}</b><span>blocked</span></div></div><p className="regjourney-solution-principle-v30"><b>One final participant queue.</b> Start with All blockers unless you are working a specific task type.</p></>:null}
    {error&&!selectedRow&&!onsiteOpen?<MutationFeedback tone="error">{error}</MutationFeedback>:null}{message?<MutationFeedback tone={message.tone}>{message.text}</MutationFeedback>:null}{loadError&&rows.length?<MutationFeedback tone="error">Roster refresh failed. Showing the last roster that loaded successfully. <button type="button" className="text-action" onClick={()=>reload()}>Retry</button></MutationFeedback>:null}
    <article className="panel regjourney-worklist regjourney-worklist-v2 regjourney-worklist-v3" aria-busy={initialLoading||refreshing}>
      <div className="regjourney-search-row" ref={searchRef}><SearchField value={query} onChange={value=>{setQuery(value);setShown(PAGE_SIZE);}} label={view==="desk"?"Find a participant":"Find someone in Final roster"} placeholder={view==="desk"?"Name, FSY ID, ward/branch, company or room":"Name, FSY ID, ward/branch, stake, company, group or room"}/>{canManageRegistration&&view!=="desk"?<button type="button" className="secondary regjourney-onsite-button" onClick={openOnsite}><UserPlus/>Add on-site participant</button>:null}</div>
      {view==="desk"&&searching?<div className="regjourney-search-scope-v6"><MagnifyingGlass size={17}/><span><b>Searching all participants</b><small>Ready, checked in and Final roster records are all included.</small></span><button type="button" className="text-action" onClick={clearSearch}>Clear</button></div>:null}
      {view==="desk"&&!searching?<><DeskFilters filter={filter} setFilter={setFilter} counts={counts}/>{canManageRegistration?<div className="regjourney-cant-find-v28"><span><b>Someone is not on the list?</b><small>Search first. If no record exists, start the on-site process without leaving the desk.</small></span><button type="button" className="secondary" onClick={openOnsite}><UserPlus/>Start on-site registration</button></div>:null}</>:view==="roster"?<><div className="regjourney-solutions-queues-v28 regjourney-solutions-queues-v30" role="group" aria-label="Final roster queues">{solutionFilters.map(key=>{const meta=SOLUTION_META[key];return <button type="button" key={key} className={filter===key?"active":""} onClick={()=>setFilter(key)}><span>{meta.label}</span><b>{counts[key]}</b><small>{meta.help}</small></button>;})}</div><div className="regjourney-roster-filters"><label><span>Other views</span><select value={solutionFilters.includes(filter)?"":filter} onChange={event=>setFilter(event.target.value||"needs_help")}><option value="">Final roster queues</option><option value="all">Everyone</option><option value="ready">Ready · {counts.ready}</option><option value="arrived">Checked in · {counts.arrived}</option><option value="expected">Yet to arrive · {counts.expected}</option><option value="not_attending">Not attending · {counts.not_attending}</option></select></label><label><span>Source</span><select value={sourceFilter} onChange={event=>{setSourceFilter(event.target.value);setShown(PAGE_SIZE);}}><option value="all">All sources</option><option value="official">Registration list</option><option value="on_site">On-site only</option></select></label></div></>:null}
      <div className="regjourney-result-line regjourney-result-line-v3 regjourney-result-line-v6" role="status"><span><b>{initialLoading?"—":filtered.length.toLocaleString()}</b> {initialLoading?"loading roster":searching?"matches":activeFilterLabel.toLowerCase()}</span>{refreshing&&!initialLoading?<small className="regjourney-updating">Updating…</small>:null}{filtered.length>shown?<span className="regjourney-result-detail-v6">· showing first {shown.toLocaleString()}</span>:null}{!searching&&(filter!==defaultFilter||sourceFilter!=="all")?<button type="button" className="text-action" onClick={()=>{setFilter(defaultFilter);setSourceFilter("all");}}>Reset</button>:null}</div>
      <div className="regjourney-list regjourney-list-v2">
        {initialLoading?<div className="ops-loading-list" role="status" aria-live="polite"><span className="sr-only">Loading roster</span>{Array.from({length:5},(_,index)=><div className="ops-skeleton-row" key={index}><i/><span><b/><small/></span><em/></div>)}</div>:null}
        {!initialLoading&&loadError&&!rows.length?<Empty icon={WarningCircle} title="Roster did not load" text="Your sign-in is still active. Try loading the roster again." action={<button type="button" className="primary" onClick={()=>reload({initial:true})}>Retry roster</button>}/>:null}
        {!initialLoading&&visible.map(row=>{const eligibility=eligibilityMap.get(row.participantId);const housing=housingByPerson.get(row.participantId);const blocker=eligibility?registrationBlocker(row,eligibility):null;const problem=blocker?.label||"";const ready=eligibility?isRegistrationReady(row,eligibility):false;const idText=row.fsyId?row.fsyId:eligibility?.eligible&&row.groupName?"FSY ID needed":"No active FSY ID";return <div className={`regjourney-row regjourney-row-v2${problem?" needs-help":""}${ready?" ready":""}${row.checkinStatus==="arrived"?" arrived":""}`} key={row.participantId}><div className="regjourney-person-button"><span className="person-avatar">{initials(row.fullName)}</span><span className="regjourney-person-copy"><PersonName person={{...row,id:row.participantId}} context={{label:"Registration",value:problem||arrivalLabel(row)}}/><small>{row.unit||"Unit not recorded"}{row.stake?` · ${row.stake}`:""}</small><em>{displaySource(row)} · {idText}</em>{view==="roster"&&blocker?<span className="regjourney-next-action-v30"><span>Next</span><b>{blocker.nextAction}</b></span>:null}</span></div><div className="regjourney-assignment"><span>{row.companyName||"No company"}</span><small>{row.groupName||"No counselor group"}</small>{row.checkinStatus==="arrived"?<em className={housing?"housing-ready":"housing-waiting"}>{housing?`Room ${housing.roomName}`:"Waiting for Housing"}</em>:null}</div><div className="regjourney-status">{eligibility?<Status tone={problem?"warn":arrivalTone(row)}>{problem||arrivalLabel(row)}</Status>:<Status tone="muted">Checking</Status>}</div><div className="regjourney-row-action">{ready&&canCheckin?<button type="button" className="primary" disabled={busyId===row.participantId} onClick={()=>checkIn(row)}>{busyId===row.participantId?"Saving…":"Check in"}<Check/></button>:problem&&canManageRegistration?<button type="button" className="secondary resolve" onClick={()=>openPerson(row)}>Resolve<ArrowRight/></button>:<button type="button" className="secondary" onClick={()=>openPerson(row)}>View</button>}</div></div>;})}
        {!initialLoading&&!visible.length&&searching?<div className="regjourney-no-match"><MagnifyingGlass size={30}/><div><b>{matchingInOtherViews?"Participant matches are hidden by these filters":"No participant found"}</b><p>{matchingInOtherViews?`${matchingInOtherViews} matching record(s) exist. Reset the filters to see them.`:"Check spelling or try an FSY ID, ward/branch, company, counselor group or room before adding anyone."}</p></div>{matchingInOtherViews?<button type="button" className="primary" onClick={()=>{setFilter("all");setSourceFilter("all");}}>Show matches<ArrowRight/></button>:canManageRegistration?<button type="button" className="primary" onClick={openOnsite}>Start on-site registration<UserPlus/></button>:null}</div>:null}
        {!initialLoading&&!loadError&&!visible.length&&!searching?<Empty icon={CheckCircle} title={filter==="ready"?"No one is ready right now":filter==="needs_help"?"Final roster queue is clear":"Nothing in this view"} text={filter==="ready"?"Open Final roster for unresolved records or search for the participant directly.":filter==="needs_help"?"No current participant is blocked by registration, eligibility, placement, identity or arrival follow-up.":"Choose another status or search for a participant."}/>:null}
      </div>
      {filtered.length>shown?<button type="button" className="secondary regjourney-show-more" onClick={()=>setShown(value=>value+PAGE_SIZE)}>Show {Math.min(PAGE_SIZE,filtered.length-shown)} more</button>:null}
    </article>
    <DismissibleLayer open={onsiteOpen} onClose={closeOnsite} title="On-site registration" sheet className="regjourney-onsite-layer regjourney-onsite-layer-v3"><OnSiteDetails initialSearch={query} sessionStart={sessionStart} unitDirectory={unitDirectory} busy={busyId==="onsite-new"} error={error} onCreate={createOnsite} onCancel={closeOnsite} onClose={closeOnsite}/></DismissibleLayer>
    <DismissibleLayer open={Boolean(selectedRow)} onClose={closePerson} title={selectedRow?selectedRow.fullName:"Participant"} sheet className="regjourney-person-layer regjourney-person-layer-v3">{selectedRow?<><PersonJourney row={selectedRow} eligibility={selectedEligibility} identityReadiness={identityReadiness} vacancies={vacancies} groups={placementGroups} companies={placementCompanies} housingAssignment={selectedHousing} canManageRegistration={canManageRegistration} busy={busyId===selectedRow.participantId||placementLoading} error={error} onVerify={verifySelected} onAssignGroup={assignGroup} onUseVacancy={useVacancy} onCheckin={()=>checkIn(selectedRow,true)} onUndoCheckin={()=>undoCheckIn(selectedRow)} onArrivalStatus={arrivalStatus} onDone={focusNext} onClose={closePerson}/><RegistrationLeadershipResolution sessionId={sessionId} row={selectedRow} eligibility={selectedEligibility} onResolved={refreshResolution}/></>:null}</DismissibleLayer>
  </section>;
}
