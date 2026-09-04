import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "./components/AppShell.jsx";
import { InviteClaimScreen, LoadingScreen, PasswordRecoveryScreen, SignInScreen } from "./components/AuthGate.jsx";
import { createDemoParticipants } from "./data/demo.js";
import { demoSession } from "./data/session.js";
import { isSupabaseConfigured } from "./lib/supabase.js";
import {
  decideAccessRequest, addOnSiteParticipant, assignParticipantToGroup, applyRegistrationSnapshot,
  getCurrentAuthSession, getMyAccessState, loadAccessRequests, loadGroupingPlan, loadHeadcount,
  loadParticipants, loadProfile, loadSession, loadSessionBirthdays, openHeadcountRound, publishGroupingPlan,
  recordCheckin, subscribeToAccessRequests, subscribeToHeadcount, submitCompanyHeadcount, updateMyProfile,
  verifyOnSiteParticipant,
} from "./lib/backend.js";
import { canApproveAccess } from "./lib/access.js";
import { summarizeCohort } from "./lib/cohort.js";
import { readWorkspaceLocation, writeWorkspaceLocation } from "./lib/navigation.js";
import { isOperationalParticipant } from "./lib/registration.js";
import { DEFAULT_STRUCTURE_SETTINGS, loadStructureSettings, setBirthdayAcknowledgement } from "./lib/operations.js";
import {
  hasCapability, loadAccessRosterV2, loadFoodNeeds, loadHousingAssignments, loadParticipantEligibility,
  loadStaffBirthdays, loadTeamCatalog, loadWellnessEncounters, loadWellnessStatus, manageLeaderAccess,
  setStaffBirthdayAcknowledgement,
} from "./lib/field-operations.js";
import { loadOperationalIdentityMap, setArrivalStatus } from "./lib/identity-arrival.js";
import { installLifecycleDiagnostics, recordDiagnostic } from "./lib/diagnostics.js";
import { activateLeaderAccount, changePassword, requestPasswordReset, signInWithPassword, signOutAccount, subscribeToAuth, updateRecoveredPassword } from "./lib/auth.js";
import { claimInviteWhileSignedIn, createLeaderInvite, createLeaderRecoveryCode, loadLeaderInvites, revokeLeaderInvite, subscribeToLeaderInvites } from "./lib/invites.js";
import { loadArrivedParticipantIds, subscribeToCheckins } from "./lib/checkins.js";
import { Overview } from "./pages/Overview.jsx";
import { Birthdays } from "./pages/Birthdays.jsx";
import { Registration } from "./pages/Registration.jsx";
import { People } from "./pages/People.jsx";
import { Assignments } from "./pages/Assignments.jsx";
import { Groups } from "./pages/Groups.jsx";
import { Checkin } from "./pages/Checkin.jsx";
import { Headcount } from "./pages/Headcount.jsx";
import { Access, createInitialAccessRequests } from "./pages/Access.jsx";
import { Profile } from "./pages/Profile.jsx";
import { Housing } from "./pages/Housing.jsx";
import { Wellness } from "./pages/Wellness.jsx";
import { Food } from "./pages/Food.jsx";
import { Reports } from "./pages/Reports.jsx";

const BASE_OPERATIONAL = new Set(["assistant_coordinator","coordinator","logistics_admin","session_director"]);
const WHOLE_SESSION = new Set(["coordinator","logistics_admin","session_director"]);
const DEMO_CAPABILITIES = ["people_lookup","groups_view","checkin_record","headcount_view","headcount_record","housing_view","housing_manage","housing_export","food_view","food_manage","food_export","wellness_status","wellness_private","wellness_manage","wellness_export","registration_view","registration_manage","identity_manage","arrival_manage","staff_view","staff_manage","reports_export","access_admin"];
const REPORT_CAPABILITIES = ["reports_export","housing_export","food_export","wellness_export","access_admin"];

function normalizeDemoGrouping(nextAssignment) {
  const groups=(nextAssignment.groups||[]).map((group)=>({...group,displayName:group.displayName||group.name,memberCount:Number(group.memberCount||group.members?.length||0),counselorId:group.counselorId||null}));
  const groupMap=new Map(groups.map((group)=>[group.id,group]));
  const companies=(nextAssignment.companies||[]).map((company)=>({...company,displayName:company.displayName||company.name,assistantCoordinatorIds:company.assistantCoordinatorIds||[],groups:(company.groups||[]).map((group)=>groupMap.get(group.id)||group)}));
  return {...nextAssignment,groups,companies,published:true};
}

export function App() {
  const initialWorkspace=useMemo(()=>readWorkspaceLocation(),[]);
  const [active,setActive]=useState(initialWorkspace.view); const [selectedPersonId,setSelectedPersonId]=useState(initialWorkspace.personId);
  const [imported,setImported]=useState([]); const [assignment,setAssignment]=useState(null); const [structureSettings,setStructureSettings]=useState(DEFAULT_STRUCTURE_SETTINGS);
  const [accessRequests,setAccessRequests]=useState(createInitialAccessRequests); const [leaderInvites,setLeaderInvites]=useState([]); const [accessRoster,setAccessRoster]=useState([]); const [teamCatalog,setTeamCatalog]=useState([]);
  const [companies,setCompanies]=useState([]); const [headcount,setHeadcount]=useState({round:null,submissions:[]}); const [checkedIds,setCheckedIds]=useState([]); const [birthdays,setBirthdays]=useState([]); const [staffBirthdays,setStaffBirthdays]=useState([]);
  const [eligibilityMap,setEligibilityMap]=useState(new Map()); const [identityMap,setIdentityMap]=useState(new Map()); const [housingAssignments,setHousingAssignments]=useState([]); const [foodNeeds,setFoodNeeds]=useState([]); const [wellnessEncounters,setWellnessEncounters]=useState([]);
  const [authSession,setAuthSession]=useState(null); const [profile,setProfile]=useState(null); const [accessState,setAccessState]=useState([]); const [sessionInfo,setSessionInfo]=useState(null);
  const [selectedSessionId,setSelectedSessionId]=useState(()=>typeof window==="undefined"?"":new URLSearchParams(window.location.search).get("session")||"");
  const selectedSessionRef=useRef(selectedSessionId); const hydrateGeneration=useRef(0);
  const [runtimeStatus,setRuntimeStatus]=useState(isSupabaseConfigured?"loading":"demo"); const [runtimeError,setRuntimeError]=useState("");
  const demoParticipants=useMemo(()=>createDemoParticipants(),[]); const initialInvite=useMemo(()=>typeof window==="undefined"?"":new URLSearchParams(window.location.search).get("invite")||"",[]);

  useEffect(()=>{selectedSessionRef.current=selectedSessionId;},[selectedSessionId]);
  useEffect(()=>installLifecycleDiagnostics(),[]);

  const navigate=useCallback((nextView,options={})=>{const view=nextView||"overview";const personId=view==="people"?(options.personId||""):"";setActive(view);setSelectedPersonId(personId);writeWorkspaceLocation(view,{personId,replace:Boolean(options.replace)});recordDiagnostic("NAVIGATE",{view});},[]);
  useEffect(()=>{const onPopState=()=>{const next=readWorkspaceLocation();setActive(next.view);setSelectedPersonId(next.personId);recordDiagnostic("POPSTATE",{view:next.view});};window.addEventListener("popstate",onPopState);return()=>window.removeEventListener("popstate",onPopState);},[]);

  const loadFieldData=useCallback(async(sessionId,capabilities=[])=>{
    if(!sessionId)return;
    const [teams,eligibility,identities,staffBdays,housing,food,wellness]=await Promise.all([
      loadTeamCatalog(sessionId),
      loadParticipantEligibility(sessionId),
      (hasCapability(capabilities,"people_lookup")||hasCapability(capabilities,"registration_view")||hasCapability(capabilities,"reports_export"))?loadOperationalIdentityMap(sessionId):Promise.resolve(new Map()),
      loadStaffBirthdays(sessionId),
      hasCapability(capabilities,"housing_view")?loadHousingAssignments(sessionId):Promise.resolve([]),
      hasCapability(capabilities,"food_view")?loadFoodNeeds(sessionId):Promise.resolve([]),
      hasCapability(capabilities,"wellness_private")?loadWellnessEncounters(sessionId):hasCapability(capabilities,"wellness_status")?loadWellnessStatus(sessionId):Promise.resolve([]),
    ]);
    setTeamCatalog(teams);setEligibilityMap(eligibility);setIdentityMap(identities);setStaffBirthdays(staffBdays);setHousingAssignments(housing);setFoodNeeds(food);setWellnessEncounters(wellness);
  },[]);

  const hydrateLive=useCallback(async(sessionOverride,requestedSessionOverride="",options={})=>{
    if(!isSupabaseConfigured)return;
    const generation=++hydrateGeneration.current; const blocking=options.blocking!==false;
    recordDiagnostic("HYDRATE_START",{generation,reason:options.reason||"bootstrap"}); setRuntimeError("");
    const session=sessionOverride===undefined?await getCurrentAuthSession():sessionOverride;
    if(generation!==hydrateGeneration.current)return;
    setAuthSession(session||null);
    if(!session){setProfile(null);setAccessState([]);setSessionInfo(null);setImported([]);setAccessRequests([]);setLeaderInvites([]);setAccessRoster([]);setTeamCatalog([]);setCompanies([]);setHeadcount({round:null,submissions:[]});setCheckedIds([]);setBirthdays([]);setStaffBirthdays([]);setEligibilityMap(new Map());setIdentityMap(new Map());setHousingAssignments([]);setFoodNeeds([]);setWellnessEncounters([]);setStructureSettings(DEFAULT_STRUCTURE_SETTINGS);setRuntimeStatus("signed-out");recordDiagnostic("HYDRATE_DONE",{generation,status:"signed-out"});return;}
    if(blocking)setRuntimeStatus("loading");
    try{
      const[nextProfile,nextAccessState]=await Promise.all([loadProfile(session.user.id),getMyAccessState()]);
      if(generation!==hydrateGeneration.current)return;
      setProfile(nextProfile||{user_id:session.user.id,email:session.user.email,display_name:session.user.email});setAccessState(nextAccessState);
      const activeGrants=nextAccessState.filter((item)=>item.active&&item.role);const requestedSession=requestedSessionOverride||selectedSessionRef.current;const granted=activeGrants.find((item)=>item.session_id===requestedSession)||activeGrants.find((item)=>item.session_status!=="training")||activeGrants[0];
      if(!granted){setSessionInfo(null);setImported([]);setAccessRoster([]);setAccessRequests([]);setLeaderInvites([]);setTeamCatalog([]);setCompanies([]);setHeadcount({round:null,submissions:[]});setCheckedIds([]);setBirthdays([]);setStaffBirthdays([]);setEligibilityMap(new Map());setIdentityMap(new Map());setStructureSettings(DEFAULT_STRUCTURE_SETTINGS);setRuntimeStatus("awaiting-access");recordDiagnostic("HYDRATE_DONE",{generation,status:"awaiting-access"});return;}
      if(granted.session_id!==selectedSessionRef.current){selectedSessionRef.current=granted.session_id;setSelectedSessionId(granted.session_id);}const canManageAccess=canApproveAccess(granted.role,granted.capabilities||[]);
      const[nextSession,nextParticipants,nextRequests,nextRoster,nextInvites,nextGrouping,nextChecked,nextHeadcount,nextBirthdays,nextStructureSettings]=await Promise.all([
        loadSession(granted.session_id),loadParticipants(granted.session_id),loadAccessRequests(granted.session_id),loadAccessRosterV2(granted.session_id),canManageAccess?loadLeaderInvites(granted.session_id):Promise.resolve([]),loadGroupingPlan(granted.session_id),loadArrivedParticipantIds(granted.session_id),loadHeadcount(granted.session_id),loadSessionBirthdays(granted.session_id),loadStructureSettings(granted.session_id),
      ]);
      if(generation!==hydrateGeneration.current)return;
      setSessionInfo(nextSession);setImported(nextParticipants);setAccessRequests(nextRequests);setAccessRoster(nextRoster);setLeaderInvites(nextInvites);setCompanies(nextGrouping.companies);setAssignment(nextGrouping.published?nextGrouping:null);setCheckedIds(nextChecked);setHeadcount(nextHeadcount);setBirthdays(nextBirthdays);setStructureSettings(nextStructureSettings);
      await loadFieldData(granted.session_id,granted.capabilities||[]);
      if(generation!==hydrateGeneration.current)return;
      setRuntimeStatus("ready");recordDiagnostic("HYDRATE_DONE",{generation,status:"ready"});
    }catch(error){if(generation!==hydrateGeneration.current)return;setRuntimeError(error.message||"Unable to load FSY operations data.");setRuntimeStatus("error");recordDiagnostic("HYDRATE_ERROR",{generation,status:"error"});}
  },[loadFieldData]);

  useEffect(()=>{if(!isSupabaseConfigured)return undefined;let activeSubscription=true;hydrateLive(undefined,"",{reason:"initial"}).catch((error)=>{if(activeSubscription){setRuntimeError(error.message||"Unable to connect to Supabase.");setRuntimeStatus("error");}});const unsubscribe=subscribeToAuth((event,session)=>{if(!activeSubscription)return;if(event==="PASSWORD_RECOVERY"){setAuthSession(session);setRuntimeStatus("password-recovery");return;}if(event==="TOKEN_REFRESHED"||event==="USER_UPDATED"){setAuthSession(session||null);recordDiagnostic("AUTH_MAINTENANCE",{event});return;}if(event==="INITIAL_SESSION"||event==="SIGNED_IN"){recordDiagnostic("AUTH_IGNORED",{event});return;}if(event==="SIGNED_OUT")hydrateLive(null,"",{reason:"signed-out"});});return()=>{activeSubscription=false;unsubscribe();};},[hydrateLive]);
  useEffect(()=>{if(!isSupabaseConfigured||runtimeStatus!=="ready"||!sessionInfo?.id)return undefined;const currentGrant=accessState.find((item)=>item.session_id===sessionInfo.id&&item.active&&item.role);const canManageAccess=canApproveAccess(currentGrant?.role,currentGrant?.capabilities||[]);const reloadRequests=async()=>{try{const[nextRequests,nextRoster,nextInvites]=await Promise.all([loadAccessRequests(sessionInfo.id),loadAccessRosterV2(sessionInfo.id),canManageAccess?loadLeaderInvites(sessionInfo.id):Promise.resolve([])]);setAccessRequests(nextRequests);setAccessRoster(nextRoster);setLeaderInvites(nextInvites);}catch(error){setRuntimeError(error.message||"Access updates could not be refreshed.");}};const reloadCheckins=async()=>{try{setCheckedIds(await loadArrivedParticipantIds(sessionInfo.id));}catch(error){setRuntimeError(error.message||"Check-in updates could not be refreshed.");}};const reloadHeadcount=async()=>{try{setHeadcount(await loadHeadcount(sessionInfo.id));}catch(error){setRuntimeError(error.message||"Head-count updates could not be refreshed.");}};const unsubscribeAccess=subscribeToAccessRequests(sessionInfo.id,reloadRequests);const unsubscribeInvites=canManageAccess?subscribeToLeaderInvites(sessionInfo.id,reloadRequests):()=>{};const unsubscribeCheckins=subscribeToCheckins(sessionInfo.id,reloadCheckins);const unsubscribeHeadcount=subscribeToHeadcount(sessionInfo.id,reloadHeadcount);return()=>{unsubscribeAccess();unsubscribeInvites();unsubscribeCheckins();unsubscribeHeadcount();};},[runtimeStatus,sessionInfo?.id,accessState]);
  useEffect(()=>{if(runtimeStatus!=="ready"||!sessionInfo?.id||!["overview","reports"].includes(active))return;const grant=accessState.find((item)=>item.session_id===sessionInfo.id&&item.active&&item.role);loadFieldData(sessionInfo.id,grant?.capabilities||[]).catch(()=>{});},[active,runtimeStatus,sessionInfo?.id,accessState,loadFieldData]);

  const saveProfile=async(displayName)=>{const updated=await updateMyProfile(displayName);setProfile((current)=>({...current,display_name:updated?.display_name||displayName}));return updated;};
  const handleSignOut=async()=>{setRuntimeError("");try{await signOutAccount();navigate("overview",{replace:true});await hydrateLive(null,"",{reason:"local-signout"});}catch(error){setRuntimeError(error.message||"Unable to sign out. Please try again.");throw error;}};
  const handleSessionChange=async(sessionId)=>{const next=accessState.find((item)=>item.session_id===sessionId&&item.active&&item.role);if(!next||sessionId===sessionInfo?.id)return;selectedSessionRef.current=sessionId;setSelectedSessionId(sessionId);navigate("overview",{replace:true});if(typeof window!=="undefined"){const url=new URL(window.location.href);if(next.session_status==="training")url.searchParams.set("session",sessionId);else url.searchParams.delete("session");window.history.replaceState({},"",`${url.pathname}${url.search}${url.hash}`);}await hydrateLive(authSession,sessionId,{reason:"session-change"});};
  const clearRecoveryUrl=()=>{if(typeof window!=="undefined")window.history.replaceState({},"",window.location.pathname);};

  if(isSupabaseConfigured){if(runtimeStatus==="loading")return <LoadingScreen/>;if(runtimeStatus==="signed-out")return <SignInScreen initialInvite={initialInvite} onSignIn={async(email,password)=>hydrateLive(await signInWithPassword(email,password),"",{reason:"sign-in"})} onActivate={async(values)=>hydrateLive(await activateLeaderAccount(values),"",{reason:"activation"})} onForgot={requestPasswordReset}/>;if(runtimeStatus==="password-recovery")return <PasswordRecoveryScreen onUpdate={updateRecoveredPassword} onCancel={async()=>{clearRecoveryUrl();await hydrateLive(authSession,"",{reason:"recovery-cancel"});}}/>;if(runtimeStatus==="error")return <main className="auth-page"><section className="auth-card"><h1>Connection problem</h1><p>{runtimeError}</p><button className="primary full" onClick={()=>hydrateLive(authSession,"",{reason:"retry"})}>Try again</button></section></main>;if(runtimeStatus==="awaiting-access")return <InviteClaimScreen profile={profile} onClaim={async(code)=>{await claimInviteWhileSignedIn(code);await hydrateLive(authSession,"",{reason:"invite-claim"});}} onSignOut={handleSignOut}/>;}

  const live=isSupabaseConfigured&&runtimeStatus==="ready";const grantedAccess=live?accessState.find((item)=>item.session_id===sessionInfo?.id&&item.active&&item.role):null;const currentRole=grantedAccess?.role||"logistics_admin";const currentCapabilities=live?(grantedAccess?.capabilities||[]):DEMO_CAPABILITIES;
  const rawParticipants=live?imported:imported.length?imported:demoParticipants;const participants=rawParticipants.map((person)=>{const identity=identityMap.get(person.id)||{};return eligibilityMap.has(person.id)?{...person,...identity,serverEligibility:eligibilityMap.get(person.id)}:{...person,...identity};});const operationalParticipants=participants.filter((person)=>isOperationalParticipant(person,structureSettings));const cohort=summarizeCohort(participants,structureSettings);const operationalParticipantIds=new Set(operationalParticipants.map((person)=>person.id));const operationalCheckedIds=checkedIds.filter((id)=>operationalParticipantIds.has(id));const pendingAccess=accessRequests.filter((request)=>request.status==="pending").length+leaderInvites.filter((invite)=>invite.status==="pending").length;
  const canManageAccess=!live||canApproveAccess(currentRole,currentCapabilities);const canImport=canManageAccess||hasCapability(currentCapabilities,"registration_manage");const canRecordCheckin=!live||["assistant_coordinator", "coordinator", "logistics_admin", "session_director"].includes(currentRole)||hasCapability(currentCapabilities,"checkin_record");const canManageAttendance=!live||WHOLE_SESSION.has(currentRole)||hasCapability(currentCapabilities,"registration_manage");const activeSessions=live?accessState.filter((item)=>item.active&&item.role):[];const sessionName=sessionInfo?.name||demoSession.name;const companyOptions=live?companies:(assignment?.companies||[]).map((company,index)=>({id:company.id||`demo-company-${index+1}`,name:company.name||`Company ${String(index+1).padStart(2,"0")}`}));
  const canOpen=(view)=>{if(["overview","profile","birthdays"].includes(view))return true;if(view==="people")return BASE_OPERATIONAL.has(currentRole)||hasCapability(currentCapabilities,"people_lookup");if(view==="groups")return BASE_OPERATIONAL.has(currentRole)||hasCapability(currentCapabilities,"groups_view");if(view==="checkin")return canRecordCheckin;if(view==="headcount")return BASE_OPERATIONAL.has(currentRole)||hasCapability(currentCapabilities,"headcount_view")||hasCapability(currentCapabilities,"headcount_record");if(view==="housing")return hasCapability(currentCapabilities,"housing_view");if(view==="wellness")return hasCapability(currentCapabilities,"wellness_private")||hasCapability(currentCapabilities,"wellness_status");if(view==="food")return hasCapability(currentCapabilities,"food_view");if(view==="reports")return REPORT_CAPABILITIES.some((capability)=>hasCapability(currentCapabilities,capability));if(view==="registration")return WHOLE_SESSION.has(currentRole)||hasCapability(currentCapabilities,"registration_view")||hasCapability(currentCapabilities,"registration_manage");if(view==="assignments")return WHOLE_SESSION.has(currentRole)||hasCapability(currentCapabilities,"staff_manage");if(view==="access")return currentRole==="coordinator"||["logistics_admin","session_director"].includes(currentRole)||hasCapability(currentCapabilities,"access_admin");return false;};
  const effectiveActive=canOpen(active)?active:"overview";

  const reloadEligibility=async()=>{if(!live)return;setEligibilityMap(await loadParticipantEligibility(sessionInfo.id));};
  const refreshOperationalIdentity=async()=>{if(!live)return;await loadFieldData(sessionInfo.id,currentCapabilities);};
  const applyImport=live?async({records,sourceFilename,sourceSha256})=>{const summary=await applyRegistrationSnapshot({sessionId:sessionInfo.id,sourceFilename,sourceSha256,records});setImported(await loadParticipants(sessionInfo.id));await reloadEligibility();setBirthdays(await loadSessionBirthdays(sessionInfo.id));return summary;}:null;
  const handleAddOnSite=live?async(values)=>{await addOnSiteParticipant({sessionId:sessionInfo.id,...values});setImported(await loadParticipants(sessionInfo.id));await reloadEligibility();await refreshOperationalIdentity();}:null;
  const handleVerifyOnSite=live?async(participantId,approved)=>{await verifyOnSiteParticipant(participantId,approved);setImported(await loadParticipants(sessionInfo.id));await reloadEligibility();await refreshOperationalIdentity();setBirthdays(await loadSessionBirthdays(sessionInfo.id));}:null;
  const handleAssignParticipant=live?async(participantId,groupId)=>{await assignParticipantToGroup(participantId,groupId);setImported(await loadParticipants(sessionInfo.id));await refreshOperationalIdentity();setBirthdays(await loadSessionBirthdays(sessionInfo.id));}:null;
  const handleBirthday=live?async(participantId,acknowledged)=>{await setBirthdayAcknowledgement(sessionInfo.id,participantId,acknowledged);setBirthdays(await loadSessionBirthdays(sessionInfo.id));}:null;
  const handleStaffBirthday=live?async(staffId,acknowledged)=>{await setStaffBirthdayAcknowledgement(sessionInfo.id,staffId,acknowledged);setStaffBirthdays(await loadStaffBirthdays(sessionInfo.id));}:null;
  const handleAttendance=async(participantId,status,note="")=>{
    if(live){await setArrivalStatus(participantId,status,note);await reloadEligibility();await refreshOperationalIdentity();return;}
    setImported((current)=>{
      const source=current.length?current:demoParticipants;
      return source.map((person)=>person.id===participantId?{...person,attendanceStatus:status,attendanceNote:note}:person);
    });
  };
  const handleAccessDecision=live?async(id,status,options)=>{await decideAccessRequest(id,status,options);const[nextRequests,nextRoster]=await Promise.all([loadAccessRequests(sessionInfo.id),loadAccessRosterV2(sessionInfo.id)]);setAccessRequests(nextRequests);setAccessRoster(nextRoster);}:null;
  const handleCreateInvite=live?async(values)=>{const created=await createLeaderInvite({sessionId:sessionInfo.id,...values});setLeaderInvites(await loadLeaderInvites(sessionInfo.id));return created;}:null;
  const handleRevokeInvite=live?async(inviteId)=>{await revokeLeaderInvite(inviteId);setLeaderInvites(await loadLeaderInvites(sessionInfo.id));}:null;
  const handleRecoveryCode=live?async(userId)=>createLeaderRecoveryCode(sessionInfo.id,userId):null;
  const handleManageLeaderAccess=live?async(values)=>{await manageLeaderAccess(values);setAccessRoster(await loadAccessRosterV2(sessionInfo.id));}:null;
  const handleCheckin=live&&canRecordCheckin?async(participantId,status)=>{await recordCheckin({sessionId:sessionInfo.id,participantId,status});}:null;
  const handlePublishGrouping=live?async(nextAssignment)=>{await publishGroupingPlan(sessionInfo.id,nextAssignment);const[nextParticipants,nextGrouping]=await Promise.all([loadParticipants(sessionInfo.id),loadGroupingPlan(sessionInfo.id)]);setImported(nextParticipants);setCompanies(nextGrouping.companies);setAssignment(nextGrouping);await reloadEligibility();await refreshOperationalIdentity();setBirthdays(await loadSessionBirthdays(sessionInfo.id));}:async(nextAssignment)=>{const normalized=normalizeDemoGrouping(nextAssignment);const groupByParticipant=new Map(normalized.groups.flatMap((group)=>group.members.map((person)=>[person.id,group.id])));setImported((current)=>current.map((person)=>groupByParticipant.has(person.id)?{...person,groupId:groupByParticipant.get(person.id)}:person));setCompanies(normalized.companies);setAssignment(normalized);};
  const handleOpenHeadcount=live?async(label)=>{await openHeadcountRound(sessionInfo.id,label);setHeadcount(await loadHeadcount(sessionInfo.id));}:async(label)=>setHeadcount((current)=>{const round={id:`demo-round-${Date.now()}`,label,opens_at:new Date().toISOString(),closes_at:null};return {...current,round,rounds:[round,...(current.rounds||[])],submissions:[],personStatuses:[]};});
  const handleHeadcountSubmit=live?async(values)=>{await submitCompanyHeadcount(values);setHeadcount(await loadHeadcount(sessionInfo.id));}:async(values)=>{const company=companies.find((item)=>item.id===values.companyId);const groupedExpected=(company?.groups||[]).reduce((sum,group)=>sum+Number(group.memberCount||group.members?.length||0),0);const expectedCount=Number.isFinite(Number(company?.expectedCount))?Number(company.expectedCount):groupedExpected;const roundId=headcount.round?.id;const submission={round_id:roundId,company_id:values.companyId,expected_count:expectedCount,accounted_count:Number(values.accountedCount),status:Number(values.accountedCount)===expectedCount?"submitted":"exception",note:values.note||""};setHeadcount((current)=>{const previousSubmissions=(current.submissions||[]).filter((item)=>item.company_id!==values.companyId);const previousAll=(current.allSubmissions||[]).filter((item)=>!(item.round_id===roundId&&item.company_id===values.companyId));const previousStatuses=(current.personStatuses||[]).filter((item)=>!(item.round_id===roundId&&item.company_id===values.companyId));return {...current,submissions:[...previousSubmissions,submission],allSubmissions:[...previousAll,submission],personStatuses:[...previousStatuses,...(values.personStatuses||[]).map((item)=>({...item,round_id:roundId,company_id:values.companyId}))]};});};

  const fieldSummary={housingUnassigned:hasCapability(currentCapabilities,"housing_view")?Math.max(0,operationalParticipants.length-housingAssignments.filter((item)=>item.personType==="participant").length):0,wellnessOpen:wellnessEncounters.filter((item)=>!item.closedAt).length,foodOpen:foodNeeds.filter((item)=>!item.acknowledged).length};
  const content=effectiveActive==="overview"?<Overview setActive={navigate} imported={operationalParticipants} allParticipants={participants} cohort={cohort} assignment={assignment} pendingAccess={pendingAccess} birthdays={[...birthdays,...staffBirthdays]} live={live} companies={companies} checkedCount={operationalCheckedIds.length} sessionName={sessionName} capabilities={currentCapabilities} fieldSummary={fieldSummary}/>
  :effectiveActive==="registration"?<Registration imported={participants} cohort={cohort} setImported={setImported} groups={assignment?.groups||[]} onApply={applyImport} onAdd={handleAddOnSite} onVerify={handleVerifyOnSite} onAssign={handleAssignParticipant} live={live} canManage={canImport} canAdd={!live||WHOLE_SESSION.has(currentRole)||hasCapability(currentCapabilities,"registration_manage")} canVerify={canManageAccess||hasCapability(currentCapabilities,"registration_manage")} sessionId={sessionInfo?.id} sessionName={sessionName} capabilities={currentCapabilities} onOperationalDataChanged={refreshOperationalIdentity}/>
  :effectiveActive==="people"?<People sessionId={sessionInfo?.id} participants={participants} cohort={cohort} assignment={assignment} canManage={canManageAccess} canManageAttendance={canManageAttendance} onSetAttendance={handleAttendance} structureSettings={structureSettings} selectedPersonId={selectedPersonId} onSelectPerson={(id)=>navigate("people",{personId:id})} onClearSelectedPerson={()=>navigate("people",{replace:true})} sessionName={sessionName}/>
  :effectiveActive==="assignments"?<Assignments sessionId={sessionInfo?.id} canManage={canManageAccess||hasCapability(currentCapabilities,"staff_manage")} sessionName={sessionName}/>
  :effectiveActive==="birthdays"?<Birthdays birthdays={birthdays} staffBirthdays={staffBirthdays} onSetAcknowledgement={handleBirthday} onSetStaffAcknowledgement={handleStaffBirthday} sessionName={sessionName}/>
  :effectiveActive==="groups"?<Groups participants={operationalParticipants} assignment={assignment} onPublish={handlePublishGrouping} live={live} canManage={canManageAccess} sessionId={sessionInfo?.id} onNavigatePeople={()=>navigate("people")} onSettingsChange={setStructureSettings} sessionName={sessionName}/>
  :effectiveActive==="checkin"?<Checkin participants={participants} cohort={cohort} checkedIds={operationalCheckedIds} onRecord={handleCheckin} onAddMissing={()=>navigate("registration")} live={live} canRecord={canRecordCheckin} groupsPublished={Boolean(assignment?.published)} structureSettings={structureSettings} sessionName={sessionName}/>
  :effectiveActive==="headcount"?<Headcount live={live} companies={companies} headcount={headcount} currentRole={currentRole} onOpen={handleOpenHeadcount} onSubmit={handleHeadcountSubmit} sessionName={sessionName}/>
  :effectiveActive==="housing"?<Housing sessionId={sessionInfo?.id} participants={participants} capabilities={currentCapabilities} sessionName={sessionName}/>
  :effectiveActive==="wellness"?<Wellness sessionId={sessionInfo?.id} participants={participants} capabilities={currentCapabilities} live={live} sessionName={sessionName}/>
  :effectiveActive==="food"?<Food sessionId={sessionInfo?.id} capabilities={currentCapabilities} participants={participants} live={live} sessionName={sessionName}/>
  :effectiveActive==="reports"?<Reports sessionId={sessionInfo?.id} sessionName={sessionName} capabilities={currentCapabilities} live={live}/>
  :effectiveActive==="profile"?<Profile currentUser={live?profile:{user_id:"demo-fsy-kumasi-leader",display_name:"FSY Leader",email:"demo@example.org"}} currentRole={currentRole} grantedAccess={grantedAccess} companies={companyOptions} sessionInfo={sessionInfo} sessionName={sessionName} live={live} onSave={saveProfile} onChangePassword={changePassword} onSignOut={handleSignOut}/>
  :<Access requests={accessRequests} setRequests={setAccessRequests} invites={leaderInvites} currentRole={currentRole} currentCapabilities={currentCapabilities} onDecision={handleAccessDecision} onCreateInvite={handleCreateInvite} onRevokeInvite={handleRevokeInvite} onCreateRecovery={handleRecoveryCode} onManageLeaderAccess={handleManageLeaderAccess} roster={live?accessRoster:undefined} companies={companyOptions} teams={teamCatalog} live={live} sessionName={sessionName}/>;

  return <AppShell active={effectiveActive} setActive={navigate} attentionCount={pendingAccess} currentUser={live?profile:{user_id:"demo-fsy-kumasi-leader",display_name:"FSY Leader",email:"demo@example.org"}} currentRole={currentRole} currentCapabilities={currentCapabilities} sessionInfo={sessionInfo} sessions={activeSessions} selectedSessionId={sessionInfo?.id||selectedSessionId} onSessionChange={live?handleSessionChange:undefined} onSignOut={live?handleSignOut:undefined} syncError={live?runtimeError:""} onRefresh={()=>hydrateLive(authSession,sessionInfo?.id||"",{reason:"manual-refresh"})}>{content}</AppShell>;
}
