import { PersonName } from "../components/PersonPeek.jsx";
import { buildStaffingPlan } from "../lib/staffing-planner.js";
import { personSearchRank } from "../lib/person-search.js";
import { canPlanStaff, staffException } from "../lib/staff-state.js";
import { naturalCompare, sortByNatural } from "../lib/ux-foundation.js";
import { useEffect, useMemo, useState } from "react";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { CloudArrowUp } from "@phosphor-icons/react/CloudArrowUp";
import { FloppyDisk } from "@phosphor-icons/react/FloppyDisk";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { UsersThree } from "@phosphor-icons/react/UsersThree";
import { Empty, MutationFeedback, PageHead, SearchField, SegmentedControl, Status } from "../components/UI.jsx";
import { buildBalancedAssignments } from "../lib/grouping.js";
import { DEFAULT_STRUCTURE_SETTINGS, applyStaffAssignmentPlan, assignCounselorToGroup, loadOperationalStructure, loadStaff, loadStructureSettings, saveStructureSettings, unassignCounselorFromGroup, updateCompanyDetails } from "../lib/operations.js";
import "./operations.css";

function companyName(company){return company.displayName||company.customName||company.name||"Company";}
function groupName(group){return group.displayName||group.customName||group.name||"Counselor group";}
function personName(person){return person.fullName||person.name||`${person.firstName||""} ${person.lastName||""}`.trim();}

function LiveGroup({group,members,staff}){
 const [open,setOpen]=useState(false);
 const counselor=staff.find(person=>person.id===group.counselorId);
 const covered=Boolean(counselor&&canPlanStaff(counselor));
 const issue=counselor?staffException(counselor):"";
 const orderedMembers=sortByNatural(members,personName);
 return <div className="groups-v2-group">
  <button type="button" onClick={()=>setOpen(value=>!value)} aria-expanded={open}>
   <span><b>{groupName(group)}</b><small>{group.sex==="Female"?"YW":"YM"} · {group.memberCount||members.length} youth</small></span>
   <span><b>{covered?counselor.name:counselor?"Replacement needed":"Counselor needed"}</b><small>{open?"Hide people":issue||"Open group"}</small></span>
  </button>
  {open?<div className="groups-v2-members">
   {counselor?<div><span><PersonName person={counselor} kind="staff" context={{label:"Counselor group",value:groupName(group)}}/>{issue?<small className="danger-text">{issue}</small>:null}</span></div>:null}
   {orderedMembers.map(person=><div key={person.id}><span className="person-avatar">{`${person.firstName?.[0]||""}${person.lastName?.[0]||""}`}</span><span><PersonName person={person} context={{label:"Counselor group",value:groupName(group)}}/><small>{[person.fsyId,person.unit].filter(Boolean).join(" · ")}</small></span></div>)}
  </div>:null}
 </div>;
}

function LiveCompany({company,participantsByGroup,staff}){
 const [open,setOpen]=useState(false);
 const assistants=(company.assistantCoordinatorIds||[]).map(id=>staff.find(person=>person.id===id)).filter(Boolean);
 const activeAssistants=assistants.filter(canPlanStaff);
 const orderedGroups=sortByNatural(company.groups||[],groupName);
 const youth=orderedGroups.reduce((sum,group)=>sum+Number(group.memberCount||0),0);
 const staffed=orderedGroups.filter(group=>{const counselor=staff.find(person=>person.id===group.counselorId);return counselor&&canPlanStaff(counselor);}).length;
 return <article className="groups-v2-company">
  <button type="button" className="groups-v2-company-head" onClick={()=>setOpen(value=>!value)} aria-expanded={open}>
   <span><b>{companyName(company)}</b><small>{youth} youth · {orderedGroups.length} groups · {staffed}/{orderedGroups.length} active counselors</small></span>
   <span><b>{company.meetingSpot||"Meeting spot not set"}</b><small>{activeAssistants.length?activeAssistants.map(person=>person.name).join(", "):assistants.length?"Assistant Coordinator replacement needed":"Assistant Coordinator not assigned"}</small></span>
  </button>
  {open?<div className="groups-v2-company-body">
   {assistants.map(person=><span key={person.id}><PersonName person={person} kind="staff" context={{label:"Company responsibility",value:companyName(company)}}/>{staffException(person)?<small className="danger-text">{staffException(person)}</small>:null}</span>)}
   {company.scriptureReference?<p><b>Scripture</b> {company.scriptureReference}</p>:null}
   <div>{orderedGroups.map(group=><LiveGroup key={group.id} group={group} members={participantsByGroup.get(group.id)||[]} staff={staff}/>)}</div>
  </div>:null}
 </article>;
}

function DraftCompany({company}){const youth=company.groups.reduce((sum,group)=>sum+group.members.length,0);return <div className="groups-v2-draft-company"><b>{company.name}</b><span>{youth} youth · {company.groups.length} groups</span></div>;}

export function Groups({companyIds=null,participants,assignment,onPublish,live=false,canManage=false,sessionId,onNavigatePeople,onSettingsChange,sessionName}){
 const [settings,setSettings]=useState(DEFAULT_STRUCTURE_SETTINGS);
 const [draftSettings,setDraftSettings]=useState(DEFAULT_STRUCTURE_SETTINGS);
 const [structure,setStructure]=useState({groups:[],companies:[],published:false});
 const [staff,setStaff]=useState([]);
 const [mode,setMode]=useState("live");
 const [query,setQuery]=useState("");
 const [draft,setDraft]=useState(null);
 const [error,setError]=useState("");
 const [busy,setBusy]=useState("");
 const [staffSuggestions,setStaffSuggestions]=useState(null);
 const scoped=companyIds!==null;

 const refresh=async()=>{if(!live||!sessionId)return;const[nextSettings,nextStructure,nextStaff]=await Promise.all([loadStructureSettings(sessionId),loadOperationalStructure(sessionId),loadStaff(sessionId)]);setSettings(nextSettings);setDraftSettings(nextSettings);setStructure(nextStructure);setStaff(nextStaff);if(!nextStructure.published)setMode("planning");};
 useEffect(()=>{refresh().catch(err=>setError(err.message||"Unable to load the current structure."));},[sessionId,live,assignment?.published]);

 const published=live?structure.published:Boolean(assignment?.published);
 const groups=sortByNatural((live?structure.groups:(assignment?.groups||[])).filter(group=>companyIds===null||companyIds.includes(group.companyId)),groupName);
 const companies=sortByNatural((live?structure.companies:(assignment?.companies||[])).filter(company=>companyIds===null||companyIds.includes(company.id)),companyName);
 const staffById=useMemo(()=>new Map(staff.map(person=>[person.id,person])),[staff]);
 const participantsByGroup=useMemo(()=>participants.reduce((map,person)=>{if(person.groupId){if(!map.has(person.groupId))map.set(person.groupId,[]);map.get(person.groupId).push(person);}return map;},new Map()),[participants]);

 const filtered=useMemo(()=>{
  const text=query.trim();
  if(!text)return companies;
  return companies.map(company=>{
   const groupRanks=company.groups.map(group=>personSearchRank({name:groupName(group)},text,[companyName(company),company.meetingSpot||""]));
   const personRanks=company.groups.flatMap(group=>(participantsByGroup.get(group.id)||[]).map(person=>personSearchRank(person,text,[groupName(group),companyName(company)])));
   const assistantRanks=(company.assistantCoordinatorIds||[]).map(id=>staffById.get(id)).filter(Boolean).map(person=>personSearchRank(person,text,[companyName(company)]));
   const companyRank=personSearchRank({name:companyName(company)},text,[company.meetingSpot||"",company.scriptureReference||"",...company.groups.map(groupName)]);
   return {company,rank:Math.min(companyRank,...groupRanks,...personRanks,...assistantRanks)};
  }).filter(item=>Number.isFinite(item.rank)).sort((a,b)=>a.rank-b.rank||naturalCompare(companyName(a.company),companyName(b.company))).map(item=>item.company);
 },[companies,query,participantsByGroup,staffById]);

 const counselorsAssigned=groups.filter(group=>{const person=staffById.get(group.counselorId);return person&&canPlanStaff(person);}).length;
 const needCounselors=Math.max(0,groups.length-counselorsAssigned);
 const needCompanyAC=companies.filter(company=>!(company.assistantCoordinatorIds||[]).some(id=>canPlanStaff(staffById.get(id)||{isCurrent:false}))).length;

 const generate=()=>{setError("");setDraft(buildBalancedAssignments(participants,{minSize:Number(draftSettings.groupMinSize),maxSize:Number(draftSettings.groupMaxSize),groupsPerCompany:Number(draftSettings.groupsPerCompany),useAgeBands:Boolean(draftSettings.useAgeBands),avoidSameUnit:Boolean(draftSettings.avoidSameUnit),balanceSexes:Boolean(draftSettings.balanceSexes)}));};
 const saveRules=async()=>{setBusy("rules");setError("");try{await saveStructureSettings(sessionId,draftSettings);setSettings({...draftSettings});generate();onSettingsChange?.(draftSettings);}catch(err){setError(err.message||"Grouping rules could not be saved.");}finally{setBusy("");}};
 const publish=async()=>{if(!draft||draft.issues?.length)return;setBusy("publish");setError("");try{await onPublish?.(draft);setDraft(null);await refresh();setMode("live");}catch(err){setError(err.message||"Unable to publish this structure.");}finally{setBusy("");}};
 const suggestStaff=()=>setStaffSuggestions(buildStaffingPlan(staff,groups,companies,Number(settings.companiesPerAssistantCoordinator||4)));
 const applyStaff=async()=>{if(!staffSuggestions)return;setBusy("staff");setError("");try{await applyStaffAssignmentPlan(sessionId,staffSuggestions);setStaffSuggestions(null);await refresh();}catch(err){setError(err.message||"Staff suggestions could not be applied.");}finally{setBusy("");}};
 const changeCounselor=async(group,staffId)=>{setBusy(`group:${group.id}`);setError("");try{if(staffId)await assignCounselorToGroup(staffId,group.id);else await unassignCounselorFromGroup(group.id);await refresh();}catch(err){setError(err.message||"Counselor assignment could not be saved.");}finally{setBusy("");}};
 const saveCompany=async(company,meetingSpot)=>{setBusy(`company:${company.id}`);setError("");try{await updateCompanyDetails(company.id,{customName:company.customName||"",scriptureReference:company.scriptureReference||"",meetingSpot});await refresh();}catch(err){setError(err.message||"Company details could not be saved.");}finally{setBusy("");}};
 const liveTitle=scoped&&companies.length===1?"My company":"Groups & companies";
 const plannedCount=(staffSuggestions?.counselors?.length||0)+(staffSuggestions?.assistants?.length||0);

 return <section className="page groups-v2">
  <PageHead title={mode==="live"?liveTitle:"Plan groups & companies"} sessionName={sessionName} description={mode==="live"?(scoped?"Find your company, counselor groups, youth and meeting location without planning controls in the way.":"Find a company, counselor group, participant, counselor or meeting location."):"Build, review, staff and publish the session structure before live operations."} action={mode==="live"&&canManage&&!scoped?<button type="button" className="secondary" onClick={()=>setMode("planning")}>Edit structure</button>:mode==="planning"&&published?<button type="button" className="secondary" onClick={()=>setMode("live")}>Back to live structure</button>:null}/>
  {error?<MutationFeedback tone="error">{error}</MutationFeedback>:null}
  {canManage&&!scoped&&published?<SegmentedControl className="groups-v2-mode" label="Structure work mode" value={mode} onChange={setMode} options={[{value:"live",label:"Live structure"},{value:"planning",label:"Planning"}]}/>:null}

  {mode==="live"?<>
   <div className="groups-v2-live-summary"><span><b>{companies.length}</b><small>{companies.length===1?"company":"companies"}</small></span><span><b>{groups.length}</b><small>counselor groups</small></span><span><b>{counselorsAssigned}/{groups.length}</b><small>active counselors</small></span>{needCounselors?<span className="attention"><b>{needCounselors}</b><small>need counselor</small></span>:null}{needCompanyAC?<span className="attention"><b>{needCompanyAC}</b><small>need AC coverage</small></span>:null}</div>
   <article className="panel groups-v2-live"><div className="groups-v2-live-head"><div><span className="kicker">Live structure</span><h2>{scoped&&companies.length===1?companyName(companies[0]):"Find a company or group"}</h2></div>{onNavigatePeople?<button type="button" className="secondary" onClick={onNavigatePeople}><UsersThree/>Find person</button>:null}</div>{companies.length>1?<SearchField value={query} onChange={setQuery} label="Search live structure" placeholder="Company, group, youth, counselor, ward or meeting spot"/>:null}<div className="groups-v2-company-list">{filtered.map(company=><LiveCompany key={company.id} company={company} participantsByGroup={participantsByGroup} staff={staff}/>)}</div>{!filtered.length?<Empty icon={Buildings} title="No company found" text="Try another company, group, person or meeting location."/>:null}</article>
  </>:<>
   <article className="panel groups-v2-planning-rules"><div className="panel-head"><div><span className="kicker">1 · Rules</span><h2>Choose how groups should be built</h2><p>Nothing changes in the live structure until a reviewed draft is published.</p></div></div><div className="groups-v2-rule-grid"><label>Minimum youth<input type="number" min="6" max="12" value={draftSettings.groupMinSize} onChange={event=>setDraftSettings({...draftSettings,groupMinSize:Number(event.target.value)})}/></label><label>Maximum youth<input type="number" min={draftSettings.groupMinSize} max="15" value={draftSettings.groupMaxSize} onChange={event=>setDraftSettings({...draftSettings,groupMaxSize:Number(event.target.value)})}/></label><label>Groups per company<select value={draftSettings.groupsPerCompany} onChange={event=>setDraftSettings({...draftSettings,groupsPerCompany:Number(event.target.value)})}>{[1,2,3,4,5,6].map(number=><option value={number} key={number}>{number}</option>)}</select></label><label className="toggle-setting"><input type="checkbox" checked={!draftSettings.useAgeBands} onChange={event=>setDraftSettings({...draftSettings,useAgeBands:!event.target.checked})}/><span><b>Mix ages fairly</b><small>Spread available ages across same-sex counselor groups.</small></span></label></div><details className="advanced-settings"><summary>Advanced mixing options</summary><div><label className="toggle-setting"><input type="checkbox" checked={draftSettings.avoidSameUnit} onChange={event=>setDraftSettings({...draftSettings,avoidSameUnit:event.target.checked})}/><span>Avoid repeating the same ward/branch where possible</span></label><label className="toggle-setting"><input type="checkbox" checked={draftSettings.balanceSexes} onChange={event=>setDraftSettings({...draftSettings,balanceSexes:event.target.checked})}/><span>Balance YW and YM groups inside companies</span></label></div></details><div className="panel-actions"><span>Current: {settings.groupMinSize}–{settings.groupMaxSize} youth/group · {settings.groupsPerCompany} groups/company</span><button className="primary" disabled={busy==="rules"||!participants.length} onClick={saveRules}><FloppyDisk/>{busy==="rules"?"Building…":"Save rules & build draft"}</button></div></article>
   {draft?<article className="panel groups-v2-draft"><div className="panel-head"><div><span className="kicker">2 · Review draft</span><h2>{draft.groups.length} groups · {draft.companies.length} companies</h2><p>{draft.issues.length?`${draft.issues.length} blocking conflict${draft.issues.length===1?"":"s"} must be resolved.`:"The draft passed its blocking checks. Inspect the mix before publishing."}</p></div><Status tone={draft.issues.length?"warn":"good"}>{draft.issues.length?"Needs review":"Ready"}</Status></div><div className="groups-v2-draft-list">{draft.companies.slice(0,12).map(company=><DraftCompany key={company.id} company={company}/>)}</div><div className="panel-actions"><button className="secondary" onClick={generate}><Sparkle/>Build another draft</button><button className="primary" disabled={busy==="publish"||Boolean(draft.issues.length)} onClick={publish}><CloudArrowUp/>{busy==="publish"?"Publishing…":published?"Publish as new structure":"Publish reviewed structure"}</button></div></article>:null}
   {published?<article className="panel groups-v2-staffing"><div className="panel-head"><div><span className="kicker">3 · Staff coverage</span><h2>{needCounselors||needCompanyAC?"Finish open staff assignments":"Staff coverage is complete"}</h2><p>{needCounselors} counselor groups and {needCompanyAC} companies need active planning coverage.</p></div></div>{staffSuggestions?<><div className="groups-v2-suggestion-list">{staffSuggestions.counselors.map(item=><span key={`c-${item.groupId}`}>{item.staffName} → {item.groupName}{item.needsConfirmation?" · Needs confirmation":""}</span>)}{staffSuggestions.assistants.map(item=><span key={`a-${item.companyId}`}>{item.staffName} → {item.companyName}{item.needsConfirmation?" · Needs confirmation":""}</span>)}</div>{staffSuggestions.exceptions?.length?<div className="notice"><b>Still needs a decision</b>{staffSuggestions.exceptions.map(item=><small key={`${item.type}-${item.targetId}`}>{item.message}</small>)}</div>:null}<div className="panel-actions"><button className="secondary" onClick={suggestStaff}>Regenerate plan</button>{plannedCount?<button className="primary" disabled={busy==="staff"} onClick={applyStaff}>{busy==="staff"?"Applying…":`Apply ${plannedCount} reviewed assignment${plannedCount===1?"":"s"}`}</button>:null}</div></>:<div className="panel-actions"><span>The planner fills genuine gaps only. Valid assignments stay untouched.</span><button className="secondary" onClick={suggestStaff}><Sparkle/>Generate staffing plan</button></div>}
   <details className="groups-v2-manual"><summary>Assign counselors manually</summary><div>{groups.map(group=>{const choices=staff.filter(person=>person.operationalRole==="counselor"&&canPlanStaff(person)&&person.sex===group.sex&&(!person.counselorGroupId||person.counselorGroupId===group.id));return <label key={group.id}><span>{groupName(group)}</span><select value={group.counselorId||""} disabled={busy===`group:${group.id}`} onChange={event=>changeCounselor(group,event.target.value)}><option value="">No counselor assigned</option>{choices.map(person=><option value={person.id} key={person.id}>{person.name}{staffException(person)?` · ${staffException(person)}`:""}</option>)}</select></label>;})}</div></details><details className="groups-v2-manual"><summary>Meeting locations</summary><div>{companies.map(company=><label key={company.id}><span>{companyName(company)}</span><input defaultValue={company.meetingSpot||""} placeholder="Company meeting spot" onBlur={event=>{if(event.target.value!==(company.meetingSpot||""))saveCompany(company,event.target.value);}}/></label>)}</div></details></article>:null}
  </>}
 </section>;
}
