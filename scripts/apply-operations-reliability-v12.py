from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text()


def write(path, content):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)


def replace_once(path, old, new):
    text = read(path)
    if text.count(old) != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {text.count(old)} for {old[:80]!r}")
    write(path, text.replace(old, new, 1))


def replace_block(path, start_marker, end_marker, new_block):
    text = read(path)
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    write(path, text[:start] + new_block + text[end:])


def extract_sql_function(text, marker):
    start = text.index(marker)
    end = text.index("\n$$;", start) + len("\n$$;")
    return text[start:end]

# ---------------------------------------------------------------------------
# A. Structured navigation and one canonical check-in destination.
# ---------------------------------------------------------------------------
write("src/lib/navigation.js", r'''export const WORKSPACE_VIEWS = [
  "overview",
  "registration",
  "people",
  "assignments",
  "birthdays",
  "groups",
  "headcount",
  "housing",
  "wellness",
  "food",
  "reports",
  "profile",
  "access",
];

const viewSet = new Set(WORKSPACE_VIEWS);
const NAV_KEYS = ["view", "mode", "tab", "filter", "person", "staff", "company", "group"];

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeWorkspaceDestination(destination = {}) {
  const source = typeof destination === "string" ? { view: destination } : destination || {};
  const legacyCheckin = source.view === "checkin";
  const requestedView = legacyCheckin ? "registration" : clean(source.view);
  return {
    view: viewSet.has(requestedView) ? requestedView : "overview",
    mode: legacyCheckin ? "desk" : clean(source.mode),
    tab: clean(source.tab),
    filter: clean(source.filter),
    personId: clean(source.personId || source.person),
    staffId: clean(source.staffId || source.staff),
    companyId: clean(source.companyId || source.company),
    groupId: clean(source.groupId || source.group),
    legacyCheckin,
  };
}

export function readWorkspaceLocation() {
  if (typeof window === "undefined") return normalizeWorkspaceDestination({ view: "overview" });
  const params = new URLSearchParams(window.location.search);
  return normalizeWorkspaceDestination({
    view: params.get("view") || "overview",
    mode: params.get("mode") || "",
    tab: params.get("tab") || "",
    filter: params.get("filter") || "",
    person: params.get("person") || "",
    staff: params.get("staff") || "",
    company: params.get("company") || "",
    group: params.get("group") || "",
  });
}

export function writeWorkspaceLocation(destination, options = {}) {
  if (typeof window === "undefined") return;
  const next = normalizeWorkspaceDestination(
    typeof destination === "string" ? { view: destination, ...options } : { ...(destination || {}), ...options },
  );
  const url = new URL(window.location.href);
  NAV_KEYS.forEach((key) => url.searchParams.delete(key));
  if (next.view !== "overview") url.searchParams.set("view", next.view);
  if (next.mode) url.searchParams.set("mode", next.mode);
  if (next.tab) url.searchParams.set("tab", next.tab);
  if (next.filter) url.searchParams.set("filter", next.filter);
  if (next.view === "people" && next.personId) url.searchParams.set("person", next.personId);
  if (next.staffId) url.searchParams.set("staff", next.staffId);
  if (next.companyId) url.searchParams.set("company", next.companyId);
  if (next.groupId) url.searchParams.set("group", next.groupId);
  const href = `${url.pathname}${url.search}${url.hash}`;
  window.history[options.replace || next.replace ? "replaceState" : "pushState"](next, "", href);
}
''')

# AppShell: check-in-only users still enter the canonical Registration desk.
replace_once(
    "src/components/AppShell.jsx",
    'const registration = canRegistration ? ["registration","Registration & check-in",IdentificationCard] : canCheckin ? ["checkin","Check-in",CheckCircle] : null;',
    'const registration = canRegistration || canCheckin ? ["registration", canRegistration ? "Registration & check-in" : "Check-in", IdentificationCard] : null;'
)

# App state + navigation context.
replace_once(
    "src/App.jsx",
    'import { InviteClaimScreen, LoadingScreen, PasswordRecoveryScreen, SignInScreen } from "./components/AuthGate.jsx";',
    'import { InviteClaimScreen, LoadingScreen, PasswordRecoveryScreen, SignInScreen, WorkspaceRecoveryScreen } from "./components/AuthGate.jsx";'
)
replace_once("src/App.jsx", 'import { Checkin } from "./pages/Checkin.jsx";\n', '')
replace_once(
    "src/App.jsx",
    'const [active,setActive]=useState(initialWorkspace.view); const [selectedPersonId,setSelectedPersonId]=useState(initialWorkspace.personId);',
    'const [active,setActive]=useState(initialWorkspace.view); const [selectedPersonId,setSelectedPersonId]=useState(initialWorkspace.personId); const [workspaceContext,setWorkspaceContext]=useState(initialWorkspace);'
)
replace_once(
    "src/App.jsx",
    'const [runtimeStatus,setRuntimeStatus]=useState(isSupabaseConfigured?"loading":"demo"); const [runtimeError,setRuntimeError]=useState(""); const [lastUpdatedAt,setLastUpdatedAt]=useState("");',
    'const [runtimeStatus,setRuntimeStatus]=useState(isSupabaseConfigured?"loading":"demo"); const [runtimeError,setRuntimeError]=useState(""); const [lastUpdatedAt,setLastUpdatedAt]=useState(""); const [workspaceHydrating,setWorkspaceHydrating]=useState(Boolean(isSupabaseConfigured));'
)
replace_once(
    "src/App.jsx",
    'const navigate=useCallback((nextView,options={})=>{const view=nextView||"overview";const personId=view==="people"?(options.personId||""):"";setActive(view);setSelectedPersonId(personId);writeWorkspaceLocation(view,{personId,replace:Boolean(options.replace)});recordDiagnostic("NAVIGATE",{view});},[]);\n  useEffect(()=>{const onPopState=()=>{const next=readWorkspaceLocation();setActive(next.view);setSelectedPersonId(next.personId);recordDiagnostic("POPSTATE",{view:next.view});};window.addEventListener("popstate",onPopState);return()=>window.removeEventListener("popstate",onPopState);},[]);',
    '''const navigate=useCallback((nextView,options={})=>{const raw=typeof nextView==="object"&&nextView?{...nextView,...options}:{view:nextView||"overview",...options};const view=raw.view==="checkin"?"registration":raw.view||"overview";const next={...raw,view,mode:raw.view==="checkin"?"desk":raw.mode||""};const personId=view==="people"?(next.personId||next.person||""):"";setActive(view);setSelectedPersonId(personId);setWorkspaceContext({...next,personId});writeWorkspaceLocation({...next,personId},{replace:Boolean(options.replace)});recordDiagnostic("NAVIGATE",{view,mode:next.mode||"",tab:next.tab||"",filter:next.filter||""});},[]);
  useEffect(()=>{if(initialWorkspace.legacyCheckin)writeWorkspaceLocation(initialWorkspace,{replace:true});},[]);
  useEffect(()=>{const onPopState=()=>{const next=readWorkspaceLocation();setActive(next.view);setSelectedPersonId(next.personId);setWorkspaceContext(next);recordDiagnostic("POPSTATE",{view:next.view,mode:next.mode||"",tab:next.tab||"",filter:next.filter||""});};window.addEventListener("popstate",onPopState);return()=>window.removeEventListener("popstate",onPopState);},[]);'''
)

# ---------------------------------------------------------------------------
# B. Authentication and workspace hydration are separate concerns.
# ---------------------------------------------------------------------------
app = read("src/App.jsx")
start = app.index('  const loadFieldData=useCallback')
end = app.index('  useEffect(()=>{if(!isSupabaseConfigured', start)
new_hydration = r'''  const loadFieldData=useCallback(async(sessionId,capabilities=[])=>{
    if(!sessionId)return [];
    const jobs=[
      ["teams",()=>loadTeamCatalog(sessionId),(value)=>setTeamCatalog(value)],
      ["eligibility",()=>loadParticipantEligibility(sessionId),(value)=>setEligibilityMap(value)],
      ["identity",()=>(hasCapability(capabilities,"people_lookup")||hasCapability(capabilities,"registration_view")||hasCapability(capabilities,"reports_export"))?loadOperationalIdentityMap(sessionId):Promise.resolve(new Map()),(value)=>setIdentityMap(value)],
      ["staff birthdays",()=>loadStaffBirthdays(sessionId),(value)=>setStaffBirthdays(value)],
      ["housing",()=>hasCapability(capabilities,"housing_view")?loadHousingAssignments(sessionId):Promise.resolve([]),(value)=>setHousingAssignments(value)],
      ["food",()=>hasCapability(capabilities,"food_view")?loadFoodNeeds(sessionId):Promise.resolve([]),(value)=>setFoodNeeds(value)],
      ["wellness",()=>hasCapability(capabilities,"wellness_private")?loadWellnessEncounters(sessionId):hasCapability(capabilities,"wellness_status")?loadWellnessStatus(sessionId):Promise.resolve([]),(value)=>setWellnessEncounters(value)],
    ];
    const results=await Promise.allSettled(jobs.map(([,run])=>run()));
    const errors=[];
    results.forEach((result,index)=>{const[label,,apply]=jobs[index];if(result.status==="fulfilled")apply(result.value);else errors.push(`${label}: ${result.reason?.message||"could not refresh"}`);});
    return errors;
  },[]);

  const clearWorkspace=()=>{setProfile(null);setAccessState([]);setSessionInfo(null);setImported([]);setAccessRequests([]);setLeaderInvites([]);setAccessRoster([]);setTeamCatalog([]);setCompanies([]);setHeadcount({round:null,submissions:[]});setCheckedIds([]);setBirthdays([]);setStaffBirthdays([]);setEligibilityMap(new Map());setIdentityMap(new Map());setHousingAssignments([]);setFoodNeeds([]);setWellnessEncounters([]);setStructureSettings(DEFAULT_STRUCTURE_SETTINGS);setLastUpdatedAt("");};

  const hydrateLive=useCallback(async(sessionOverride,requestedSessionOverride="",options={})=>{
    if(!isSupabaseConfigured)return;
    const generation=++hydrateGeneration.current;const blocking=options.blocking!==false;
    recordDiagnostic("HYDRATE_START",{generation,reason:options.reason||"bootstrap"});setRuntimeError("");
    let session;
    try{session=sessionOverride===undefined?await getCurrentAuthSession():sessionOverride;}catch(error){if(generation!==hydrateGeneration.current)return;setRuntimeError(error.message||"Unable to verify your sign-in.");setRuntimeStatus("error");setWorkspaceHydrating(false);return;}
    if(generation!==hydrateGeneration.current)return;
    setAuthSession(session||null);
    if(!session){clearWorkspace();setWorkspaceHydrating(false);setRuntimeStatus("signed-out");recordDiagnostic("HYDRATE_DONE",{generation,status:"signed-out"});return;}
    if(blocking)setRuntimeStatus("loading");setWorkspaceHydrating(true);
    let nextProfile,nextAccessState;
    try{[nextProfile,nextAccessState]=await Promise.all([loadProfile(session.user.id),getMyAccessState()]);}
    catch(error){if(generation!==hydrateGeneration.current)return;setRuntimeError(error.message||"Your FSY workspace could not be prepared.");setRuntimeStatus("error");setWorkspaceHydrating(false);recordDiagnostic("HYDRATE_ERROR",{generation,status:"signed-in-error",reference:friendlyRuntimeError(error).supportReference});return;}
    if(generation!==hydrateGeneration.current)return;
    setProfile(nextProfile||{user_id:session.user.id,email:session.user.email,display_name:session.user.email});setAccessState(nextAccessState);
    const activeGrants=nextAccessState.filter((item)=>item.active&&item.role);const requestedSession=requestedSessionOverride||selectedSessionRef.current;const granted=activeGrants.find((item)=>item.session_id===requestedSession)||activeGrants.find((item)=>item.session_status!=="training")||activeGrants[0];
    if(!granted){setSessionInfo(null);setImported([]);setAccessRoster([]);setAccessRequests([]);setLeaderInvites([]);setTeamCatalog([]);setCompanies([]);setHeadcount({round:null,submissions:[]});setCheckedIds([]);setBirthdays([]);setStaffBirthdays([]);setEligibilityMap(new Map());setIdentityMap(new Map());setStructureSettings(DEFAULT_STRUCTURE_SETTINGS);setWorkspaceHydrating(false);setRuntimeStatus("awaiting-access");recordDiagnostic("HYDRATE_DONE",{generation,status:"awaiting-access"});return;}
    if(granted.session_id!==selectedSessionRef.current){selectedSessionRef.current=granted.session_id;setSelectedSessionId(granted.session_id);}
    const canManageAccess=canApproveAccess(granted.role,granted.capabilities||[]);
    let nextSession;
    try{nextSession=await loadSession(granted.session_id);}catch(error){if(generation!==hydrateGeneration.current)return;setRuntimeError(error.message||"The FSY session could not be loaded.");setRuntimeStatus("error");setWorkspaceHydrating(false);return;}
    if(generation!==hydrateGeneration.current)return;
    setSessionInfo(nextSession);setRuntimeStatus("ready");

    const jobs=[
      ["participants",()=>loadParticipants(granted.session_id),(value)=>setImported(value)],
      ["access requests",()=>canManageAccess?loadAccessRequests(granted.session_id):Promise.resolve([]),(value)=>setAccessRequests(value)],
      ["access roster",()=>canManageAccess?loadAccessRosterV2(granted.session_id):Promise.resolve([]),(value)=>setAccessRoster(value)],
      ["invites",()=>canManageAccess?loadLeaderInvites(granted.session_id):Promise.resolve([]),(value)=>setLeaderInvites(value)],
      ["grouping",()=>loadGroupingPlan(granted.session_id),(value)=>{setCompanies(value.companies||[]);setAssignment(value.published?value:null);}],
      ["check-in",()=>loadArrivedParticipantIds(granted.session_id),(value)=>setCheckedIds(value)],
      ["head count",()=>loadHeadcount(granted.session_id),(value)=>setHeadcount(value)],
      ["birthdays",()=>loadSessionBirthdays(granted.session_id),(value)=>setBirthdays(value)],
      ["structure settings",()=>loadStructureSettings(granted.session_id),(value)=>setStructureSettings(value)],
      ["field operations",()=>loadFieldData(granted.session_id,granted.capabilities||[]),()=>{}],
    ];
    const results=await Promise.allSettled(jobs.map(([,run])=>run()));
    if(generation!==hydrateGeneration.current)return;
    const failures=[];
    results.forEach((result,index)=>{const[label,,apply]=jobs[index];if(result.status==="fulfilled"){apply(result.value);if(label==="field operations"&&Array.isArray(result.value))failures.push(...result.value);}else failures.push(`${label}: ${result.reason?.message||"could not refresh"}`);});
    setWorkspaceHydrating(false);setLastUpdatedAt(new Date().toISOString());
    if(failures.length){setRuntimeError("Some live FSY information could not refresh. You can keep working with what loaded and retry.");recordDiagnostic("HYDRATE_PARTIAL",{generation,failures:failures.length});}
    else{setRuntimeError("");recordDiagnostic("HYDRATE_DONE",{generation,status:"ready"});}
  },[loadFieldData]);

'''
write("src/App.jsx", app[:start] + new_hydration + app[end:])

replace_once(
    "src/App.jsx",
    'if(runtimeStatus==="loading")return <LoadingScreen/>;',
    'if(runtimeStatus==="loading")return <LoadingScreen text={authSession?"Signed in. Preparing your FSY workspace…":"Connecting to FSY Kumasi…"}/>;'
)
old_error = 'if(runtimeStatus==="error"){const friendly=friendlyRuntimeError(runtimeError);return <main className="auth-page"><section className="auth-card runtime-recovery-card"><span className="kicker">Connection recovery</span><h1>{friendly.title}</h1><p>{friendly.message}</p><div className="runtime-recovery-actions"><button className="primary full" onClick={()=>hydrateLive(authSession,"",{reason:"retry"})}>Try again</button><button className="secondary full" onClick={returnToSignIn}>Return to sign in</button></div><small>Support reference: <b>{friendly.supportReference}</b></small></section></main>;}'
new_error = 'if(runtimeStatus==="error"){const friendly=friendlyRuntimeError(runtimeError);return authSession?<WorkspaceRecoveryScreen message={friendly.message} supportReference={friendly.supportReference} onRetry={()=>hydrateLive(authSession,"",{reason:"retry"})} onSignOut={returnToSignIn}/>:<main className="auth-page"><section className="auth-card runtime-recovery-card"><span className="kicker">Connection recovery</span><h1>{friendly.title}</h1><p>{friendly.message}</p><div className="runtime-recovery-actions"><button className="primary full" onClick={()=>hydrateLive(undefined,"",{reason:"retry"})}>Try again</button><button className="secondary full" onClick={returnToSignIn}>Return to sign in</button></div><small>Support reference: <b>{friendly.supportReference}</b></small></section></main>;}'
replace_once("src/App.jsx", old_error, new_error)
replace_once(
    "src/App.jsx",
    'onRefresh={()=>hydrateLive(authSession,sessionInfo?.id||"",{reason:"manual-refresh"})}',
    'onRefresh={()=>hydrateLive(authSession,sessionInfo?.id||"",{reason:"manual-refresh",blocking:false})}'
)

# AuthGate signed-in workspace recovery stays visually separate from sign-in failure.
replace_once(
    "src/components/AuthGate.jsx",
    'export function LoadingScreen({ text = "Connecting to FSY Kumasi…" }) {',
    '''export function WorkspaceRecoveryScreen({ message, supportReference, onRetry, onSignOut }) {
  return <main className="auth-page workspace-recovery-page"><section className="auth-card loading-card workspace-recovery-card"><BrandMark/><span className="kicker">Signed in</span><h2>Your FSY workspace needs another try</h2><p>{message || "Your account is signed in. Some workspace information did not load yet."}</p><div className="runtime-recovery-actions"><button className="primary full" onClick={onRetry}>Try loading workspace again</button><button className="secondary full" onClick={onSignOut}>Sign out</button></div>{supportReference?<small>Support reference: <b>{supportReference}</b></small>:null}</section></main>;
}

export function LoadingScreen({ text = "Connecting to FSY Kumasi…" }) {'''
)

# ---------------------------------------------------------------------------
# C/D. Truthful Registration loading + canonical desk mode.
# ---------------------------------------------------------------------------
replace_once(
    "src/pages/Registration.jsx",
    'export function Registration(props) {\n  const { imported = [], live = false, sessionId, sessionName, capabilities = [], onOperationalDataChanged } = props;\n  const [mode, setMode] = useState("desk");',
    '''export function Registration(props) {
  const { imported = [], live = false, sessionId, sessionName, capabilities = [], onOperationalDataChanged, initialMode = "desk", initialFilter = "", onNavigate } = props;
  const canUseRegistrationTools = capabilities.includes("registration_view") || capabilities.includes("registration_manage") || !live;
  const normalizedMode = canUseRegistrationTools && ["desk","roster","setup"].includes(initialMode) ? initialMode : "desk";
  const [mode, setMode] = useState(normalizedMode);'''
)
replace_once(
    "src/pages/Registration.jsx",
    '  const [structureSettings, setStructureSettings] = useState(DEFAULT_STRUCTURE_SETTINGS);',
    '  const [structureSettings, setStructureSettings] = useState(DEFAULT_STRUCTURE_SETTINGS);\n  useEffect(() => { setMode(normalizedMode); }, [normalizedMode]);\n  const chooseMode = (next) => { setMode(next); onNavigate?.({ view: "registration", mode: next, filter: "" }); };'
)
replace_once("src/pages/Registration.jsx", 'value={mode}\n          onChange={setMode}', 'value={mode}\n          onChange={chooseMode}')
replace_once(
    "src/pages/Registration.jsx",
    '<div className="registration-workspace-navigation registration-workspace-navigation-v5 registration-unified-navigation">\n        <SegmentedControl',
    '<div className="registration-workspace-navigation registration-workspace-navigation-v5 registration-unified-navigation">\n        {canUseRegistrationTools ? <SegmentedControl'
)
replace_once(
    "src/pages/Registration.jsx",
    '          ]}\n        />\n        <div className="registration-mode-cue-v5" role="status">',
    '          ]}\n        /> : null}\n        <div className="registration-mode-cue-v5" role="status">'
)
replace_once("src/pages/Registration.jsx", '<RegistrationJourney view="desk" sessionId={sessionId}', '<RegistrationJourney view="desk" initialFilter={initialFilter} sessionId={sessionId}')
replace_once("src/pages/Registration.jsx", '<RegistrationJourney view="roster" sessionId={sessionId}', '<RegistrationJourney view="roster" initialFilter={initialFilter} sessionId={sessionId}')

replace_once(
    "src/pages/RegistrationJourneyV5.jsx",
    'export function RegistrationJourney({ view = "desk", sessionId, setImported, capabilities = [], onOperationalDataChanged }) {',
    'export function RegistrationJourney({ view = "desk", initialFilter = "", sessionId, setImported, capabilities = [], onOperationalDataChanged }) {'
)
replace_once(
    "src/pages/RegistrationJourneyV5.jsx",
    'const [filter, setFilterState] = useState(view === "desk" ? "ready" : "all");',
    'const [filter, setFilterState] = useState(initialFilter || (view === "desk" ? "ready" : "all"));'
)
replace_once(
    "src/pages/RegistrationJourneyV5.jsx",
    '  const [message, setMessage] = useState(null);\n  const searchRef = useRef(null);',
    '  const [message, setMessage] = useState(null);\n  const [initialLoading, setInitialLoading] = useState(true);\n  const [refreshing, setRefreshing] = useState(false);\n  const [loadError, setLoadError] = useState("");\n  const searchRef = useRef(null);'
)
old_reload = '''  const reload = async () => {
    if (!sessionId) return;
    const [nextRows, nextEligibility, nextReadiness, nextVacancies, grouping, nextHousing, startsOn] = await Promise.all([
      loadArrivalRoster(sessionId),
      loadParticipantEligibility(sessionId),
      loadIdentityReadiness(sessionId),
      canManageRegistration ? loadArrivalVacancies(sessionId) : Promise.resolve([]),
      loadGroupingPlan(sessionId),
      loadRegistrationHousingStatus(sessionId),
      loadOnSiteReferenceDate(sessionId),
    ]);
    setRows(nextRows);
    setEligibilityMap(nextEligibility);
    setIdentityReadiness(nextReadiness);
    setVacancies(nextVacancies);
    setGroups(grouping.groups || []);
    setCompanies(grouping.companies || []);
    setHousingAssignments(nextHousing.filter((item) => item.personType === "participant"));
    setSessionStart(startsOn || "");
  };

  useEffect(() => { reload().catch((err) => setMessage({ tone: "error", text: err.message || "Registration workspace could not load." })); }, [sessionId, canManageRegistration]);
  useEffect(() => { setFilterState(view === "desk" ? "ready" : "all"); setShown(PAGE_SIZE); }, [view]);'''
new_reload = '''  const reload = async ({ initial = false } = {}) => {
    if (!sessionId) return;
    if (initial) setInitialLoading(true); else setRefreshing(true);
    setLoadError("");
    try {
      const [nextRows, nextEligibility, nextReadiness, nextVacancies, grouping, nextHousing, startsOn] = await Promise.all([
        loadArrivalRoster(sessionId), loadParticipantEligibility(sessionId), loadIdentityReadiness(sessionId),
        canManageRegistration ? loadArrivalVacancies(sessionId) : Promise.resolve([]), loadGroupingPlan(sessionId),
        loadRegistrationHousingStatus(sessionId), loadOnSiteReferenceDate(sessionId),
      ]);
      setRows(nextRows); setEligibilityMap(nextEligibility); setIdentityReadiness(nextReadiness); setVacancies(nextVacancies);
      setGroups(grouping.groups || []); setCompanies(grouping.companies || []);
      setHousingAssignments(nextHousing.filter((item) => item.personType === "participant")); setSessionStart(startsOn || "");
    } catch (err) { setLoadError(err.message || "Registration workspace could not load."); throw err; }
    finally { if (initial) setInitialLoading(false); setRefreshing(false); }
  };

  useEffect(() => { reload({ initial: true }).catch(() => {}); }, [sessionId, canManageRegistration]);
  useEffect(() => { setFilterState(initialFilter || (view === "desk" ? "ready" : "all")); setShown(PAGE_SIZE); }, [view, initialFilter]);'''
replace_once("src/pages/RegistrationJourneyV5.jsx", old_reload, new_reload)
replace_once(
    "src/pages/RegistrationJourneyV5.jsx",
    '    {message ? <MutationFeedback tone={message.tone}>{message.text}</MutationFeedback> : null}',
    '    {message ? <MutationFeedback tone={message.tone}>{message.text}</MutationFeedback> : null}\n    {loadError && rows.length ? <MutationFeedback tone="error">Roster refresh failed. Showing the last roster that loaded successfully. <button type="button" className="text-action" onClick={() => reload()}>Retry</button></MutationFeedback> : null}'
)
replace_once(
    "src/pages/RegistrationJourneyV5.jsx",
    '<article className="panel regjourney-worklist regjourney-worklist-v2 regjourney-worklist-v3">',
    '<article className="panel regjourney-worklist regjourney-worklist-v2 regjourney-worklist-v3" aria-busy={initialLoading || refreshing}>'
)
replace_once(
    "src/pages/RegistrationJourneyV5.jsx",
    '<span><b>{filtered.length.toLocaleString()}</b> {searching ? "matches" : activeFilterLabel.toLowerCase()}</span>',
    '<span><b>{initialLoading ? "—" : filtered.length.toLocaleString()}</b> {initialLoading ? "loading roster" : searching ? "matches" : activeFilterLabel.toLowerCase()}</span>{refreshing && !initialLoading ? <small className="regjourney-updating">Updating…</small> : null}'
)
replace_once(
    "src/pages/RegistrationJourneyV5.jsx",
    '      <div className="regjourney-list regjourney-list-v2">\n        {visible.map((row) => {',
    '''      <div className="regjourney-list regjourney-list-v2">
        {initialLoading ? <div className="ops-loading-list" role="status" aria-live="polite"><span className="sr-only">Loading roster</span>{Array.from({length:5},(_,index)=><div className="ops-skeleton-row" key={index}><i/><span><b/><small/></span><em/></div>)}</div> : null}
        {!initialLoading && loadError && !rows.length ? <Empty icon={WarningCircle} title="Roster did not load" text="Your sign-in is still active. Try loading the roster again." action={<button type="button" className="primary" onClick={() => reload({ initial: true })}>Retry roster</button>}/> : null}
        {!initialLoading && visible.map((row) => {'''
)
# WarningCircle import needed.
replace_once("src/pages/RegistrationJourneyV5.jsx", 'import { UserPlus } from "@phosphor-icons/react/UserPlus";', 'import { UserPlus } from "@phosphor-icons/react/UserPlus";\nimport { WarningCircle } from "@phosphor-icons/react/WarningCircle";')
replace_once("src/pages/RegistrationJourneyV5.jsx", '!visible.length && searching ?', '!initialLoading && !visible.length && searching ?')
replace_once("src/pages/RegistrationJourneyV5.jsx", '!visible.length && !searching ?', '!initialLoading && !loadError && !visible.length && !searching ?')

# ---------------------------------------------------------------------------
# E. Housing wayfinding + truthful loading.
# ---------------------------------------------------------------------------
replace_once(
    "src/pages/HousingDialogsV4.jsx",
    'export function roomLocation(room) { return [room.building, room.floor].filter(Boolean).join(" · ") || "Location not labelled"; }',
    'export function roomHasWayfinding(room) { return Boolean(String(room?.building || "").trim() || String(room?.floor || "").trim()); }\nexport function roomLocation(room) { return [room.building, room.floor].filter(Boolean).join(" · ") || "Add location before assigning"; }'
)
text = read("src/pages/HousingDialogsV4.jsx")
start = text.index('export function RoomEditor(')
end = text.index('\nfunction MoveReason', start)
room_editor = r'''export function RoomEditor({ sessionId, room = null, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({ name: room?.name || "", building: room?.building || "", floor: room?.floor || "", sex: room?.sex || "", capacity: room?.capacity || 4, notes: room?.notes || "" }));
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const editing = Boolean(room?.id);
  const locationReady = Boolean(form.building.trim() || form.floor.trim());
  const save = async (event) => { event.preventDefault(); if (!locationReady) { setError("Add a location people can use to find this room before it becomes assignable."); return; } setBusy(true); setError(""); try { await saveHousingRoom({ ...form, sessionId, roomId: room?.id || null, sex: form.sex || null }); await onSaved(); onClose(); } catch (err) { setError(err.message || "Unable to save this room."); } finally { setBusy(false); } };
  return <DismissibleLayer open onClose={onClose} title={editing ? `Edit ${room.name}` : "Add housing room"} sheet className="housing-v4-room-editor-layer"><form className="housing-v4-modal" onSubmit={save}><header className="housing-v4-modal-head"><div><span className="kicker">Housing setup</span><h2>{editing ? "Edit room" : "Add a room"}</h2><p>{editing ? "Keep the room identity and wayfinding clear for staff on the ground." : "Give the room a name, capacity and a location somebody unfamiliar with the venue can follow."}</p></div><button type="button" data-layer-close className="icon-button" onClick={onClose} aria-label="Close"><X /></button></header><div className="housing-v4-modal-body"><div className="housing-v4-form two"><label>Room name<input autoFocus required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Room 203" /></label><label>Spaces<input required type="number" min="1" max="50" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></label></div><div className="housing-wayfinding-fields"><label>Location / building<input value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })} placeholder="e.g. Unity Hostel · East Wing"/><small>Use wording a counselor could follow without knowing the venue.</small></label><label>Floor / area <span>Optional</span><input value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} placeholder="e.g. First floor"/></label></div>{!locationReady ? <div className="housing-location-warning"><WarningCircle/><span><b>Location needed</b><small>This room can be saved only when staff have enough information to find it.</small></span></div> : null}<label>Room use<select value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value })}><option value="">Unrestricted</option><option value="female">Female</option><option value="male">Male</option></select><small>Only restrict the room when it is meant for one sex.</small></label><details className="housing-v4-details" open={Boolean(form.notes)}><summary><span><b>Operational note</b><small>Optional</small></span><span>+</span></summary><div><label>Note<textarea rows="3" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label></div></details>{error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}</div><footer className="housing-v4-modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !locationReady}>{busy ? "Saving…" : editing ? "Save changes" : "Add room"}</button></footer></form></DismissibleLayer>;
}
'''
write("src/pages/HousingDialogsV4.jsx", text[:start] + room_editor + text[end:])
replace_once("src/pages/HousingDialogsV4.jsx", 'import { X } from "@phosphor-icons/react/X";', 'import { X } from "@phosphor-icons/react/X";\nimport { WarningCircle } from "@phosphor-icons/react/WarningCircle";')

replace_once("src/pages/HousingAssignmentV5.jsx", 'import { initials, roomLocation, sexLabel } from "./HousingDialogsV4.jsx";', 'import { initials, roomHasWayfinding, roomLocation, sexLabel } from "./HousingDialogsV4.jsx";')
replace_once(
    "src/pages/HousingAssignmentV5.jsx",
    '.filter((room) => (!room.sex || !person.sex || room.sex === person.sex) && (room.occupancy < room.capacity || room.id === currentAssignment?.roomId))',
    '.filter((room) => (!room.sex || !person.sex || room.sex === person.sex) && (room.occupancy < room.capacity || room.id === currentAssignment?.roomId) && (roomHasWayfinding(room) || room.id === currentAssignment?.roomId))'
)
replace_once(
    "src/pages/HousingAssignmentV5.jsx",
    'if (!newRoom.name.trim()) { setError("Enter a room name first."); return; }',
    'if (!newRoom.name.trim()) { setError("Enter a room name first."); return; }\n    if (!newRoom.building.trim() && !newRoom.floor.trim()) { setError("Add a location people can use to find this room."); return; }'
)
old_create_details = '''          <div className="housing-v4-form two"><label>Room name<input autoFocus required value={newRoom.name} onChange={(event) => setNewRoom({ ...newRoom, name: event.target.value })} placeholder="e.g. Block B · 105"/></label><label>Spaces<input type="number" min="1" max="50" value={newRoom.capacity} onChange={(event) => setNewRoom({ ...newRoom, capacity: event.target.value })}/></label></div>
          <div className="housing-v4-inferred"><Bed/><span><b>{person.sex ? `${sexLabel(person.sex)} room` : "Unrestricted room"}</b><small>Set automatically from the person being assigned.</small></span></div>
          <details className="housing-v4-details"><summary><span><b>Location & notes</b><small>Optional</small></span><span>+</span></summary><div><div className="housing-v4-form two"><label>Building<input value={newRoom.building} onChange={(event) => setNewRoom({ ...newRoom, building: event.target.value })}/></label><label>Floor<input value={newRoom.floor} onChange={(event) => setNewRoom({ ...newRoom, floor: event.target.value })}/></label></div><label>Note<textarea rows="2" value={newRoom.notes} onChange={(event) => setNewRoom({ ...newRoom, notes: event.target.value })}/></label></div></details>'''
new_create_details = '''          <div className="housing-v4-form two"><label>Room name<input autoFocus required value={newRoom.name} onChange={(event) => setNewRoom({ ...newRoom, name: event.target.value })} placeholder="e.g. Room 105"/></label><label>Spaces<input type="number" min="1" max="50" value={newRoom.capacity} onChange={(event) => setNewRoom({ ...newRoom, capacity: event.target.value })}/></label></div>
          <div className="housing-wayfinding-fields"><label>Location / building<input required value={newRoom.building} onChange={(event) => setNewRoom({ ...newRoom, building: event.target.value })} placeholder="e.g. Block B · East Wing"/></label><label>Floor / area <span>Optional</span><input value={newRoom.floor} onChange={(event) => setNewRoom({ ...newRoom, floor: event.target.value })} placeholder="e.g. First floor"/></label></div>
          <div className="housing-v4-inferred"><Bed/><span><b>{person.sex ? `${sexLabel(person.sex)} room` : "Unrestricted room"}</b><small>Set automatically from the person being assigned.</small></span></div>
          <details className="housing-v4-details"><summary><span><b>Operational note</b><small>Optional</small></span><span>+</span></summary><div><label>Note<textarea rows="2" value={newRoom.notes} onChange={(event) => setNewRoom({ ...newRoom, notes: event.target.value })}/></label></div></details>'''
replace_once("src/pages/HousingAssignmentV5.jsx", old_create_details, new_create_details)
replace_once("src/pages/HousingAssignmentV5.jsx", 'disabled={busy || !newRoom.name.trim()} onClick={createAndAssign}', 'disabled={busy || !newRoom.name.trim() || (!newRoom.building.trim() && !newRoom.floor.trim())} onClick={createAndAssign}')

replace_once("src/pages/HousingV5.jsx", 'import { RoomDetail, RoomEditor, humanizeRole, initials, roomLocation, sexLabel, waitLabel } from "./HousingDialogsV4.jsx";', 'import { RoomDetail, RoomEditor, humanizeRole, initials, roomHasWayfinding, roomLocation, sexLabel, waitLabel } from "./HousingDialogsV4.jsx";')
replace_once("src/pages/HousingV5.jsx", 'export function Housing({ sessionId, participants = [], capabilities = [], sessionName }) {', 'export function Housing({ sessionId, participants = [], capabilities = [], sessionName, initialArea = "", initialFilter = "" }) {')
replace_once("src/pages/HousingV5.jsx", 'const [roomFilter, setRoomFilter] = useState("all");', 'const [roomFilter, setRoomFilter] = useState(initialFilter === "needs-location" ? "incomplete" : "all");')
replace_once("src/pages/HousingV5.jsx", 'const [personStatus, setPersonStatus] = useState("arrivals");', 'const [personStatus, setPersonStatus] = useState(initialArea === "assigned" ? "assigned" : "arrivals");')
replace_once("src/pages/HousingV5.jsx", 'const [mobileArea, setMobileArea] = useState("queue");', 'const [mobileArea, setMobileArea] = useState(initialArea === "rooms" ? "rooms" : initialArea === "assigned" ? "assigned" : "queue");')
replace_once("src/pages/HousingV5.jsx", '  const [now, setNow] = useState(Date.now());', '  const [now, setNow] = useState(Date.now());\n  const [initialLoading, setInitialLoading] = useState(true);\n  const [refreshing, setRefreshing] = useState(false);')
old_housing_reload = '''  const reload = async () => {
    if (!sessionId || !canView) return;
    const [nextRooms, nextAssignments, nextStaff, nextQueue] = await Promise.all([
      loadHousingRooms(sessionId),
      loadHousingAssignmentsV2(sessionId),
      loadStaff(sessionId),
      loadHousingArrivalQueue(sessionId),
    ]);
    setRooms(nextRooms);
    setAssignments(nextAssignments);
    setStaff(nextStaff);
    setArrivalQueue(nextQueue);
  };

  useEffect(() => { reload().catch((err) => setError(err.message || "Unable to load Housing.")); }, [sessionId, canView]);'''
new_housing_reload = '''  const reload = async ({ initial = false } = {}) => {
    if (!sessionId || !canView) return;
    if (initial) setInitialLoading(true); else setRefreshing(true);
    try { const [nextRooms, nextAssignments, nextStaff, nextQueue] = await Promise.all([loadHousingRooms(sessionId), loadHousingAssignmentsV2(sessionId), loadStaff(sessionId), loadHousingArrivalQueue(sessionId)]); setRooms(nextRooms); setAssignments(nextAssignments); setStaff(nextStaff); setArrivalQueue(nextQueue); setError(""); }
    catch (err) { setError(err.message || "Unable to load Housing."); throw err; }
    finally { if (initial) setInitialLoading(false); setRefreshing(false); }
  };

  useEffect(() => { reload({ initial: true }).catch(() => {}); }, [sessionId, canView]);
  useEffect(() => { if (initialArea === "rooms") setMobileArea("rooms"); else if (initialArea === "assigned") { setMobileArea("assigned"); setPersonStatus("assigned"); } else if (initialArea === "arrivals") { setMobileArea("queue"); setPersonStatus("arrivals"); } if (initialFilter === "needs-location") setRoomFilter("incomplete"); }, [initialArea, initialFilter]);'''
replace_once("src/pages/HousingV5.jsx", old_housing_reload, new_housing_reload)
replace_once("src/pages/HousingV5.jsx", '  const fullRooms = rooms.length - openRooms;', '  const fullRooms = rooms.length - openRooms;\n  const incompleteRooms = rooms.filter((room) => !roomHasWayfinding(room)).length;')
old_filter = '.filter((room) => roomFilter === "all" || (roomFilter === "open" ? room.occupancy < room.capacity : room.occupancy >= room.capacity))'
new_filter = '.filter((room) => roomFilter === "all" || (roomFilter === "open" ? room.occupancy < room.capacity : roomFilter === "full" ? room.occupancy >= room.capacity : !roomHasWayfinding(room)))'
replace_once("src/pages/HousingV5.jsx", old_filter, new_filter)
replace_once(
    "src/pages/HousingV5.jsx",
    '<div className={`housing-v5-live${waitingPeople.length ? " attention" : ""}`} role="status" aria-live="polite">\n      <div><span className="kicker">Live from Registration</span><b>{waitingPeople.length ? `${waitingPeople.length} waiting for rooms` : "No arrivals waiting"}</b><small>{waitingPeople.length ? `${oldestWaiting} · oldest first` : "New checked-in arrivals appear here automatically."}</small></div>',
    '<div className={`housing-v5-live${waitingPeople.length ? " attention" : ""}`} role="status" aria-live="polite" aria-busy={initialLoading || refreshing}>\n      <div><span className="kicker">Live from Registration</span><b>{initialLoading ? "Loading Housing…" : waitingPeople.length ? `${waitingPeople.length} waiting for rooms` : "No arrivals waiting"}</b><small>{initialLoading ? "Checking arrivals, rooms and current assignments." : waitingPeople.length ? `${oldestWaiting} · oldest first` : refreshing ? "Updating…" : "New checked-in arrivals appear here automatically."}</small></div>'
)
replace_once(
    "src/pages/HousingV5.jsx",
    '    <div className="housing-v5-mobile-tabs" role="tablist" aria-label="Housing work">',
    '    {!initialLoading && incompleteRooms ? <div className="housing-location-banner"><WarningCircle/><span><b>{incompleteRooms} {incompleteRooms === 1 ? "room needs" : "rooms need"} a location</b><small>Add wayfinding before assigning anyone new to those rooms.</small></span><button type="button" className="secondary" onClick={() => { setMobileArea("rooms"); setRoomFilter("incomplete"); }}>Review rooms</button></div> : null}\n\n    <div className="housing-v5-mobile-tabs" role="tablist" aria-label="Housing work">'
)
replace_once("src/pages/HousingV5.jsx", 'import { UserPlus } from "@phosphor-icons/react/UserPlus";', 'import { UserPlus } from "@phosphor-icons/react/UserPlus";\nimport { WarningCircle } from "@phosphor-icons/react/WarningCircle";')
replace_once(
    "src/pages/HousingV5.jsx",
    '<option value="full">Full · {fullRooms}</option></select></label>',
    '<option value="full">Full · {fullRooms}</option><option value="incomplete">Needs location · {incompleteRooms}</option></select></label>'
)
replace_once(
    "src/pages/HousingV5.jsx",
    'className="housing-v5-room-card" onClick={() => setSelectedRoom(room)}',
    'className={`housing-v5-room-card${roomHasWayfinding(room) ? "" : " needs-location"}`} onClick={() => setSelectedRoom(room)}'
)

# ---------------------------------------------------------------------------
# F. Reporting scope: keep report UX, enforce server scope.
# ---------------------------------------------------------------------------
# Reports client: AC gets company-scoped operational reports; sensitive Wellness/audit remain capability-only.
replace_once("src/lib/reports.js", 'const general = (capabilities = []) => capabilities.includes("reports_export");', 'const general = (capabilities = [], role = "") => capabilities.includes("reports_export") || role === "assistant_coordinator";')
replace_once("src/lib/reports.js", 'available: (caps) => any(caps, ["housing_export", "reports_export"]),', 'available: (caps, role) => any(caps, ["housing_export", "reports_export"]) || role === "assistant_coordinator",')
replace_once("src/lib/reports.js", 'available: (caps) => caps.includes("food_export"),', 'available: (caps, role) => caps.includes("food_export") || role === "assistant_coordinator",')
replace_once("src/lib/reports.js", 'export function getAvailableReports(capabilities = []) {\n  return REPORT_DEFINITIONS.filter((report) => report.available(capabilities));\n}', 'export function getAvailableReports(capabilities = [], role = "") {\n  return REPORT_DEFINITIONS.filter((report) => report.available(capabilities, role));\n}')
replace_once("src/pages/Reports.jsx", 'export function Reports({ sessionId, sessionName, capabilities = [], live = false }) {\n  const available = useMemo(() => getAvailableReports(capabilities), [capabilities]);', 'export function Reports({ sessionId, sessionName, capabilities = [], currentRole = "", live = false }) {\n  const available = useMemo(() => getAvailableReports(capabilities, currentRole), [capabilities, currentRole]);')
replace_once(
    "src/pages/Reports.jsx",
    '<div className="report-freshness"><span><b>{rows.length.toLocaleString()}</b>',
    '<div className="report-scope-note"><ShieldCheck size={18}/><span><b>{dataset.scope || "Your current FSY scope"}</b><small>The server applies this scope before report rows reach this device.</small></span></div>\n            <div className="report-freshness"><span><b>{rows.length.toLocaleString()}</b>'
)

# ---------------------------------------------------------------------------
# G. Plain-language committee responsibilities in Access.
# ---------------------------------------------------------------------------
replace_once(
    "src/components/AccountSetup.jsx",
    'export function TeamChoices({ teams, selected, onChange, compact = false }) {\n  return <div',
    '''function teamSensitivity(team) {
  if (team.key === "wellness" || team.capabilities?.includes("wellness_private")) return "Sensitive · private health information";
  if (team.key === "financial" || team.capabilities?.includes("financial_view")) return "Sensitive · financial information";
  if (team.capabilities?.includes("access_admin")) return "High impact · account administration";
  return "";
}

export function TeamChoices({ teams, selected, onChange, compact = false }) {
  return <div'''
)
replace_once(
    "src/components/AccountSetup.jsx",
    '<span><b>{team.name}</b><small>{team.description}</small></span>',
    '<span><b>{team.name}</b><small>{team.description}</small>{teamSensitivity(team) ? <em className="account-responsibility-sensitivity">{teamSensitivity(team)}</em> : null}</span>'
)
replace_once(
    "src/components/AccountSetup.jsx",
    '<TeamChoices teams={teams} selected={selected} onChange={setSelected} />',
    '<div className="account-responsibility-summary"><b>{selected.length ? `${selected.length} additional ${selected.length === 1 ? "responsibility" : "responsibilities"}` : "No additional committee responsibilities"}</b><small>Primary FSY responsibility stays separate. Add only work this person genuinely needs.</small></div><TeamChoices teams={teams} selected={selected} onChange={setSelected} />'
)

# ---------------------------------------------------------------------------
# H/J. Birthday context and exact Overview destinations.
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/field-operations.js",
    'const { data, error } = await client().rpc("get_staff_birthdays", { p_session_id: sessionId });',
    'const { data, error } = await client().rpc("get_staff_birthdays_v2", { p_session_id: sessionId });'
)
replace_once(
    "src/lib/field-operations.js",
    'staffRole: row.staff_role || "counselor",\n    company: row.company_name || "",\n    acknowledged:',
    'staffRole: row.staff_role || "counselor",\n    company: row.company_name || "",\n    companyNames: row.company_names || (row.company_name ? [row.company_name] : []),\n    group: row.group_name || "",\n    acknowledged:'
)
replace_once("src/pages/Birthdays.jsx", 'function BirthdayPerson({ person, busy, onUpdate }) {', 'function BirthdayPerson({ person, busy, onUpdate, onOpenAssignment }) {')
replace_once(
    "src/pages/Birthdays.jsx",
    '      {person.acknowledged ? <>',
    '      {staff && onOpenAssignment ? <button type="button" className="birthday-open-assignment" onClick={() => onOpenAssignment(person.staffId)}>Open assignment</button> : null}\n      {person.acknowledged ? <>'
)
replace_once("src/pages/Birthdays.jsx", 'function BirthdayDay({ date, items, index, openState, onOpenChange, busyId, onUpdate }) {', 'function BirthdayDay({ date, items, index, openState, onOpenChange, busyId, onUpdate, onOpenAssignment }) {')
replace_once("src/pages/Birthdays.jsx", '        onUpdate={onUpdate}\n      />)}', '        onUpdate={onUpdate}\n        onOpenAssignment={onOpenAssignment}\n      />)}')
replace_once("src/pages/Birthdays.jsx", 'export function Birthdays({ birthdays = [], staffBirthdays = [], onSetAcknowledgement, onSetStaffAcknowledgement, sessionName }) {', 'export function Birthdays({ birthdays = [], staffBirthdays = [], onSetAcknowledgement, onSetStaffAcknowledgement, onOpenAssignment, loading = false, sessionName }) {')
replace_once("src/pages/Birthdays.jsx", '    {!people.length ? <article', '    {loading && !people.length ? <article className="panel birthday-empty-panel" aria-busy="true"><div className="ops-loading-list"><div className="ops-skeleton-row"><i/><span><b/><small/></span><em/></div><div className="ops-skeleton-row"><i/><span><b/><small/></span><em/></div></div></article> : !people.length ? <article')
replace_once("src/pages/Birthdays.jsx", '          onUpdate={update}\n        />)}', '          onUpdate={update}\n          onOpenAssignment={onOpenAssignment}\n        />)}')

# Overview tasks now carry structured destinations.
replace_once("src/lib/overview-inbox.js", 'function task(id, title, detail, action, priority, tone = "default") { return { id, title, detail, action, priority, tone }; }', 'function task(destination, title, detail, action, priority, tone = "default") { const normalized = typeof destination === "string" ? { view: destination } : destination; return { id: normalized.view, destination: normalized, title, detail, action, priority, tone }; }')
replace_once("src/lib/overview-inbox.js", 'task("registration", `${pendingId}', 'task({view:"registration",mode:"roster",filter:"needs_help"}, `${pendingId}')
replace_once("src/lib/overview-inbox.js", 'task("registration", `${otherRegistrationAttention}', 'task({view:"registration",mode:"roster",filter:"needs_help"}, `${otherRegistrationAttention}')
replace_once("src/lib/overview-inbox.js", 'task("housing", `${waitingRooms}', 'task({view:"housing",tab:"arrivals",filter:"waiting"}, `${waitingRooms}')
replace_once("src/lib/overview-inbox.js", 'task("registration", `${ready}', 'task({view:"registration",mode:"desk",filter:"ready"}, `${ready}')
replace_once("src/lib/overview-inbox.js", 'task("groups", `${uncovered}', 'task({view:"assignments",tab:"groups",filter:"needs"}, `${uncovered}')
replace_once("src/lib/overview-inbox.js", 'task("food", `${dietaryOpen}', 'task({view:"food",tab:"dietary",filter:"needs"}, `${dietaryOpen}')
replace_once("src/lib/overview-inbox.js", 'task("access", `${accessPending}', 'task({view:"access",filter:"needs"}, `${accessPending}')
replace_once("src/pages/Overview.jsx", 'onClick={() => setActive(inbox.primary.id)}', 'onClick={() => setActive(inbox.primary.destination || inbox.primary.id)}')
replace_once("src/pages/Overview.jsx", 'onClick={() => setActive(item.id)}', 'onClick={() => setActive(item.destination || item.id)}')

# App wiring for destinations and scoped reports.
replace_once("src/App.jsx", 'if(view==="checkin")return canRecordCheckin;', '')
replace_once("src/App.jsx", 'if(view==="registration")return WHOLE_SESSION.has(currentRole)||hasCapability(currentCapabilities,"registration_view")||hasCapability(currentCapabilities,"registration_manage");', 'if(view==="registration")return canRecordCheckin||WHOLE_SESSION.has(currentRole)||hasCapability(currentCapabilities,"registration_view")||hasCapability(currentCapabilities,"registration_manage");')
replace_once("src/App.jsx", 'if(view==="reports")return REPORT_CAPABILITIES.some((capability)=>hasCapability(currentCapabilities,capability));', 'if(view==="reports")return currentRole==="assistant_coordinator"||REPORT_CAPABILITIES.some((capability)=>hasCapability(currentCapabilities,capability));')
replace_once(
    "src/App.jsx",
    ':effectiveActive==="registration"?<Registration imported={participants}',
    ':effectiveActive==="registration"?<Registration initialMode={workspaceContext.mode||"desk"} initialFilter={workspaceContext.filter||""} onNavigate={navigate} imported={participants}'
)
replace_once(
    "src/App.jsx",
    ':effectiveActive==="assignments"?<Assignments sessionId={sessionInfo?.id} canManage={canManageAccess||hasCapability(currentCapabilities,"staff_manage")} sessionName={sessionName}/>',
    ':effectiveActive==="assignments"?<Assignments sessionId={sessionInfo?.id} canManage={canManageAccess||hasCapability(currentCapabilities,"staff_manage")} initialWorkspace={workspaceContext.tab||""} initialFilter={workspaceContext.filter||""} initialStaffId={workspaceContext.staffId||""} sessionName={sessionName}/>'
)
replace_once(
    "src/App.jsx",
    ':effectiveActive==="birthdays"?<Birthdays birthdays={birthdays} staffBirthdays={staffBirthdays} onSetAcknowledgement={handleBirthday} onSetStaffAcknowledgement={handleStaffBirthday} sessionName={sessionName}/>',
    ':effectiveActive==="birthdays"?<Birthdays birthdays={birthdays} staffBirthdays={staffBirthdays} loading={workspaceHydrating} onSetAcknowledgement={handleBirthday} onSetStaffAcknowledgement={handleStaffBirthday} onOpenAssignment={(staffId)=>navigate({view:"assignments",tab:"people",staffId})} sessionName={sessionName}/>'
)
# Remove old Checkin render branch.
app = read("src/App.jsx")
app = re.sub(r'\n  :effectiveActive==="checkin"\?<Checkin[^\n]+', '', app, count=1)
write("src/App.jsx", app)
replace_once(
    "src/App.jsx",
    ':effectiveActive==="housing"?<Housing sessionId={sessionInfo?.id} participants={participants} capabilities={currentCapabilities} sessionName={sessionName}/>',
    ':effectiveActive==="housing"?<Housing sessionId={sessionInfo?.id} participants={participants} capabilities={currentCapabilities} initialArea={workspaceContext.tab||""} initialFilter={workspaceContext.filter||""} sessionName={sessionName}/>'
)
replace_once(
    "src/App.jsx",
    ':effectiveActive==="reports"?<Reports sessionId={sessionInfo?.id} sessionName={sessionName} capabilities={currentCapabilities} live={live}/>',
    ':effectiveActive==="reports"?<Reports sessionId={sessionInfo?.id} sessionName={sessionName} capabilities={currentCapabilities} currentRole={currentRole} live={live}/>'
)
replace_once(
    "src/App.jsx",
    ':<Access sessionId={sessionInfo?.id}',
    ':<Access initialFilter={workspaceContext.filter||""} sessionId={sessionInfo?.id}'
)

# Assignments and Access honor deep-linked initial focus.
replace_once("src/pages/AssignmentsV3.jsx", 'export function Assignments({ sessionId, canManage = false, sessionName }) {', 'export function Assignments({ sessionId, canManage = false, initialWorkspace = "", initialFilter = "", initialStaffId = "", sessionName }) {')
replace_once("src/pages/AssignmentsV3.jsx", 'const [workspace, setWorkspace] = useState("people");', 'const [workspace, setWorkspace] = useState(["people","groups","companies"].includes(initialWorkspace) ? initialWorkspace : "people");')
replace_once("src/pages/AssignmentsV3.jsx", 'const [groupQuery, setGroupQuery] = useState(""); const [groupFilter, setGroupFilter] = useState("needs");', 'const [groupQuery, setGroupQuery] = useState(""); const [groupFilter, setGroupFilter] = useState(initialWorkspace === "groups" && initialFilter === "all" ? "all" : "needs");')
replace_once("src/pages/AssignmentsV3.jsx", '  useEffect(() => setVisibleStaff(30), [query, roleFilter]);', '  useEffect(() => { if (["people","groups","companies"].includes(initialWorkspace)) setWorkspace(initialWorkspace); if (initialWorkspace === "groups" && initialFilter) setGroupFilter(initialFilter === "all" ? "all" : "needs"); if (initialWorkspace === "companies" && initialFilter) setCompanyFilter(initialFilter === "all" ? "all" : "needs"); }, [initialWorkspace, initialFilter]);\n  useEffect(() => setVisibleStaff(30), [query, roleFilter]);')
# When staff data arrives, deep-linked staff opens setup flow in context.
replace_once("src/pages/AssignmentsV3.jsx", '  const personContext = (person) => {', '  useEffect(() => { if (!initialStaffId || !staff.length || setupTarget) return; const person = staff.find((item) => item.id === initialStaffId); if (person) { setWorkspace("people"); setQuery(person.name); } }, [initialStaffId, staff]);\n\n  const personContext = (person) => {')

replace_once("src/pages/AccessV4.jsx", 'export function Access({ requests = [],', 'export function Access({ initialFilter = "", requests = [],')
replace_once("src/pages/AccessV4.jsx", 'const [filter, setFilter] = useState("needs");', 'const [filter, setFilter] = useState(FILTERS.some(([key]) => key === initialFilter) ? initialFilter : "needs");')
replace_once("src/pages/AccessV4.jsx", '  const counts = useMemo', '  useEffect(() => { if (FILTERS.some(([key]) => key === initialFilter)) setFilter(initialFilter); }, [initialFilter]);\n\n  const counts = useMemo')

# ---------------------------------------------------------------------------
# Database migration: housing readiness, AC report scope, richer birthday context.
# It derives updated function definitions from already-versioned migrations so
# there is one authoritative implementation and no hand-copied drift.
# ---------------------------------------------------------------------------
report_old = read("supabase/migrations/20260904133000_phase3_reporting.sql")
participant_fn = extract_sql_function(report_old, "create or replace function private.participant_report_rows")
participant_fn = participant_fn.replace(
    "where p.session_id = target_session and p.is_current;",
    "where p.session_id = target_session and p.is_current\n    and (not private.is_assistant_coordinator(target_session) or c.id = any(private.current_user_company_ids(target_session)));"
)
report_fn = extract_sql_function(report_old, "create or replace function public.get_operational_report")
report_fn = report_fn.replace(
    "if not private.has_capability(p_session_id, 'reports_export') then raise exception 'Report export access required'; end if;",
    "if not (private.has_capability(p_session_id, 'reports_export') or private.is_assistant_coordinator(p_session_id)) then raise exception 'Report export access required'; end if;"
)
report_fn = report_fn.replace(
    "if not (private.has_capability(p_session_id, 'housing_export') or private.has_capability(p_session_id, 'reports_export')) then raise exception 'Housing export access required'; end if;",
    "if not (private.has_capability(p_session_id, 'housing_export') or private.has_capability(p_session_id, 'reports_export') or private.is_assistant_coordinator(p_session_id)) then raise exception 'Housing export access required'; end if;"
)
report_fn = report_fn.replace(
    "if not private.has_capability(p_session_id, 'food_export') then raise exception 'Food export access required'; end if;",
    "if not (private.has_capability(p_session_id, 'food_export') or private.is_assistant_coordinator(p_session_id)) then raise exception 'Food export access required'; end if;"
)
report_fn = report_fn.replace("where new_badge.session_id = p_session_id", "where new_badge.session_id = p_session_id\n        and (not private.is_assistant_coordinator(p_session_id) or old_badge.company_id = any(private.current_user_company_ids(p_session_id)))")
# Housing participant rows already inherit participant_report_rows scope; staff rows need explicit company scope.
needle = "where ha.session_id = p_session_id and ha.active and ha.staff_id is not null"
report_fn = report_fn.replace(needle, needle + "\n        and (not private.is_assistant_coordinator(p_session_id) or private.staff_in_current_company_scope(p_session_id,s.id))")
report_fn = report_fn.replace(
    "where ma.session_id = p_session_id",
    "where ma.session_id = p_session_id\n        and (not private.is_assistant_coordinator(p_session_id) or (ma.participant_id is not null and c.id = any(private.current_user_company_ids(p_session_id))) or (ma.staff_id is not null and private.staff_in_current_company_scope(p_session_id,s.id)))",
    1,
)
report_fn = report_fn.replace(
    "(select count(*)::integer from public.meal_attendance a where a.meal_service_id = ms.id) as served,",
    "(select count(*)::integer from public.meal_attendance a left join public.participants ap on ap.id=a.participant_id left join public.counselor_groups ag on ag.id=ap.group_id where a.meal_service_id=ms.id and (not private.is_assistant_coordinator(p_session_id) or (a.participant_id is not null and ag.company_id=any(private.current_user_company_ids(p_session_id))) or (a.staff_id is not null and private.staff_in_current_company_scope(p_session_id,a.staff_id)))) as served,"
)
report_fn = report_fn.replace(
    "and private.operational_participant_is_eligible(p_session_id, p2.id)",
    "and private.operational_participant_is_eligible(p_session_id, p2.id)\n            and (not private.is_assistant_coordinator(p_session_id) or g2.company_id = any(private.current_user_company_ids(p_session_id)))"
)
report_fn = report_fn.replace(
    "(select count(*)::integer from public.staff s2 where s2.session_id = p_session_id and s2.is_current and s2.registration_status = 'approved')",
    "(select count(*)::integer from public.staff s2 where s2.session_id = p_session_id and s2.is_current and s2.registration_status = 'approved' and (not private.is_assistant_coordinator(p_session_id) or private.staff_in_current_company_scope(p_session_id,s2.id)))"
)
report_fn = report_fn.replace("where r.session_id = p_session_id\n    ) q;", "where r.session_id = p_session_id\n        and (not private.is_assistant_coordinator(p_session_id) or c.id = any(private.current_user_company_ids(p_session_id)))\n    ) q;", 1)
report_fn = report_fn.replace(
    "where w.session_id = p_session_id\n    ) q;",
    "where w.session_id = p_session_id\n        and (not private.is_assistant_coordinator(p_session_id) or (w.participant_id is not null and exists(select 1 from public.counselor_groups wg join public.participants wp on wp.group_id=wg.id where wp.id=w.participant_id and wg.company_id=any(private.current_user_company_ids(p_session_id)))) or (w.staff_id is not null and private.staff_in_current_company_scope(p_session_id,w.staff_id)))\n    ) q;"
)
report_fn = report_fn.replace("'scope', 'FSY Kumasi session',", "'scope', private.current_report_scope_label(p_session_id),")

housing_old = read("supabase/migrations/20260904230500_housing_move_reason_and_assignment_v2.sql")
assign_fn = extract_sql_function(housing_old, "create or replace function public.assign_housing_person_v2")
assign_fn = assign_fn.replace(
    "if room_row.id is null then raise exception 'Housing room not found'; end if;",
    "if room_row.id is null then raise exception 'Housing room not found'; end if;\n  if nullif(trim(coalesce(room_row.building,'')),'') is null and nullif(trim(coalesce(room_row.floor,'')),'') is null then raise exception 'Add a location people can use to find this room before assigning anyone'; end if;"
)
create_assign_fn = extract_sql_function(housing_old, "create or replace function public.create_housing_room_and_assign_v2")
create_assign_fn = create_assign_fn.replace(
    "if not private.has_capability(p_session_id,'housing_manage') then\n    raise exception 'Your account cannot manage Housing';\n  end if;",
    "if not private.has_capability(p_session_id,'housing_manage') then\n    raise exception 'Your account cannot manage Housing';\n  end if;\n  if nullif(trim(coalesce(p_building,'')),'') is null and nullif(trim(coalesce(p_floor,'')),'') is null then raise exception 'Add a location people can use to find this room'; end if;",
    1,
)

helpers = r'''-- Operations reliability v12: truthful Housing readiness, company-scoped Assistant Coordinator reporting,
-- and role/committee-aware staff birthday context. Full-session leaders remain full-session administrators.

create or replace function private.is_assistant_coordinator(target_session uuid, target_user uuid default null::uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.access_assignments aa where aa.session_id=target_session and aa.user_id=coalesce(target_user,(select auth.uid())) and aa.active and aa.role='assistant_coordinator');
$$;
revoke all on function private.is_assistant_coordinator(uuid,uuid) from public;

create or replace function private.current_user_company_ids(target_session uuid)
returns uuid[] language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(distinct company_id order by company_id),'{}'::uuid[])
  from (
    select unnest(coalesce(aa.company_ids,'{}'::uuid[])) company_id from public.access_assignments aa
    where aa.session_id=target_session and aa.user_id=(select auth.uid()) and aa.active and aa.role='assistant_coordinator'
    union
    select sca.company_id from public.staff_account_links sal join public.staff_company_assignments sca on sca.session_id=sal.session_id and sca.staff_id=sal.staff_id
    where sal.session_id=target_session and sal.user_id=(select auth.uid()) and sal.access_enabled
  ) scoped;
$$;
revoke all on function private.current_user_company_ids(uuid) from public;

create or replace function private.staff_in_current_company_scope(target_session uuid,target_staff uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.staff s
    left join public.counselor_groups g on g.session_id=s.session_id and g.counselor_id=s.id
    where s.id=target_staff and s.session_id=target_session and (
      g.company_id=any(private.current_user_company_ids(target_session))
      or s.assigned_company_id=any(private.current_user_company_ids(target_session))
      or exists(select 1 from public.staff_company_assignments sca where sca.session_id=target_session and sca.staff_id=s.id and sca.company_id=any(private.current_user_company_ids(target_session)))
    )
  );
$$;
revoke all on function private.staff_in_current_company_scope(uuid,uuid) from public;

create or replace function private.current_report_scope_label(target_session uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare label text;
begin
  if private.has_session_role(target_session,array['coordinator','logistics_admin','session_director']::public.app_role[]) then return 'Entire session'; end if;
  if private.is_assistant_coordinator(target_session) then
    select string_agg(coalesce(nullif(c.custom_name,''),c.name),' · ' order by c.operational_number nulls last,c.name) into label
    from public.companies c where c.id=any(private.current_user_company_ids(target_session));
    return coalesce(label,'Assigned companies');
  end if;
  select string_agg(ot.display_name,' · ' order by ot.display_name) into label
  from public.team_memberships tm join public.operational_teams ot on ot.id=tm.team_id
  where tm.session_id=target_session and tm.user_id=(select auth.uid()) and tm.active and ot.active;
  return coalesce(label,'Your committee responsibilities');
end;
$$;
revoke all on function private.current_report_scope_label(uuid) from public;
'''

birthdays_sql = r'''
create or replace function public.get_staff_birthdays(p_session_id uuid)
returns table(staff_id uuid,display_name text,birthday_date date,staff_role text,company_name text,acknowledged boolean,acknowledged_at timestamptz)
language sql stable security definer set search_path='' as $$
 select s.id,s.full_name,private.birthday_in_year(d.date_of_birth,extract(year from se.starts_on)::int),s.operational_role,
   coalesce(scope.company_name,''),(ba.staff_id is not null),ba.acknowledged_at
 from public.sessions se join public.staff s on s.session_id=se.id join public.staff_private_details d on d.staff_id=s.id
 left join public.staff_birthday_acknowledgements ba on ba.session_id=se.id and ba.staff_id=s.id
 left join lateral (
   select coalesce(nullif(c.custom_name,''),c.name) company_name
   from public.companies c
   where c.id=coalesce((select g.company_id from public.counselor_groups g where g.session_id=se.id and g.counselor_id=s.id limit 1),s.assigned_company_id,(select sca.company_id from public.staff_company_assignments sca where sca.session_id=se.id and sca.staff_id=s.id order by sca.assigned_at limit 1))
   limit 1
 ) scope on true
 where se.id=p_session_id and private.has_session_access(se.id) and s.is_current and s.registration_status='approved'
   and private.birthday_in_year(d.date_of_birth,extract(year from se.starts_on)::int) between se.starts_on and se.ends_on
   and (private.has_session_role(se.id,array['coordinator','logistics_admin','session_director']::public.app_role[])
     or (private.is_assistant_coordinator(se.id) and private.staff_in_current_company_scope(se.id,s.id))
     or exists(select 1 from public.staff_account_links sal where sal.session_id=se.id and sal.staff_id=s.id and sal.user_id=(select auth.uid()))
     or exists(select 1 from public.staff_account_links sal join public.team_memberships target_tm on target_tm.session_id=se.id and target_tm.user_id=sal.user_id and target_tm.active join public.team_memberships caller_tm on caller_tm.session_id=se.id and caller_tm.user_id=(select auth.uid()) and caller_tm.active and caller_tm.team_id=target_tm.team_id where sal.session_id=se.id and sal.staff_id=s.id))
 order by 3,2;
$$;

create or replace function public.get_staff_birthdays_v2(p_session_id uuid)
returns table(staff_id uuid,display_name text,birthday_date date,staff_role text,company_name text,company_names text[],group_name text,acknowledged boolean,acknowledged_at timestamptz)
language sql stable security definer set search_path='' as $$
 select base.staff_id,base.display_name,base.birthday_date,base.staff_role,base.company_name,
   coalesce((select array_agg(distinct coalesce(nullif(c.custom_name,''),c.name) order by coalesce(nullif(c.custom_name,''),c.name)) from public.staff_company_assignments sca join public.companies c on c.id=sca.company_id where sca.session_id=p_session_id and sca.staff_id=base.staff_id),case when base.company_name<>'' then array[base.company_name] else '{}'::text[] end),
   coalesce((select coalesce(nullif(g.custom_name,''),g.name) from public.counselor_groups g where g.session_id=p_session_id and g.counselor_id=base.staff_id limit 1),''),
   base.acknowledged,base.acknowledged_at
 from public.get_staff_birthdays(p_session_id) base;
$$;
revoke all on function public.get_staff_birthdays_v2(uuid) from public,anon;
grant execute on function public.get_staff_birthdays_v2(uuid) to authenticated;
'''

migration = helpers + "\n\n" + participant_fn + "\n\n" + report_fn + "\n\n" + assign_fn + "\n\n" + create_assign_fn + "\n\n" + birthdays_sql
write("supabase/migrations/20260907120000_operations_reliability_v12.sql", migration + "\n")

# ---------------------------------------------------------------------------
# K. Final responsive/refinement layer.
# ---------------------------------------------------------------------------
write("src/operations-reliability-v12.css", r'''.ops-loading-list{display:grid;gap:10px;padding:6px 0}.ops-skeleton-row{min-height:72px;display:grid;grid-template-columns:42px 1fr minmax(80px,18%);align-items:center;gap:12px;padding:12px;border:1px solid var(--line);border-radius:14px}.ops-skeleton-row>i,.ops-skeleton-row b,.ops-skeleton-row small,.ops-skeleton-row>em{display:block;background:var(--surface-2,#f2f2f2);border-radius:999px;min-height:10px}.ops-skeleton-row>i{width:40px;height:40px}.ops-skeleton-row span{display:grid;gap:8px}.ops-skeleton-row b{width:min(260px,75%);height:14px}.ops-skeleton-row small{width:min(360px,90%)}.ops-skeleton-row>em{justify-self:end;width:76px;height:34px}.regjourney-updating{margin-left:auto;color:var(--muted);font-weight:600}.housing-location-banner,.housing-location-warning,.report-scope-note,.account-responsibility-summary{display:flex;align-items:center;gap:12px;border:1px solid var(--line);background:var(--surface);border-radius:14px;padding:12px 14px}.housing-location-banner>span,.housing-location-warning>span,.report-scope-note>span,.account-responsibility-summary{min-width:0}.housing-location-banner b,.housing-location-warning b,.report-scope-note b,.account-responsibility-summary b{display:block}.housing-location-banner small,.housing-location-warning small,.report-scope-note small,.account-responsibility-summary small{display:block;color:var(--muted);margin-top:2px}.housing-location-banner button{margin-left:auto;white-space:nowrap}.housing-wayfinding-fields{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,.8fr);gap:12px}.housing-wayfinding-fields label{display:grid;gap:6px}.housing-v5-room-card.needs-location{border-style:dashed}.housing-v5-room-card.needs-location .room-copy small,.housing-v5-room-card.needs-location>span>small{font-weight:700}.report-scope-note{margin:12px 0}.account-responsibility-sensitivity{display:block;margin-top:5px;font-size:12px;font-style:normal;font-weight:700}.account-responsibility-summary{display:block;margin-bottom:12px}.birthday-open-assignment{border:0;background:transparent;text-decoration:underline;text-underline-offset:3px;cursor:pointer;color:inherit;min-height:44px;padding:0 8px}.workspace-recovery-card p{max-width:44ch}.registration-workspace-navigation:not(:has(.registration-mode-switch)){grid-template-columns:1fr}.regjourney-result-line{min-height:34px}.housing-v5-live[aria-busy="true"]{opacity:.82}
@media (prefers-reduced-motion:no-preference){.ops-skeleton-row>i,.ops-skeleton-row b,.ops-skeleton-row small,.ops-skeleton-row>em{animation:ops-skeleton-pulse 1.35s ease-in-out infinite alternate}@keyframes ops-skeleton-pulse{from{opacity:.48}to{opacity:1}}}
@media(max-width:760px){.housing-location-banner{align-items:flex-start;flex-wrap:wrap}.housing-location-banner button{width:100%;margin-left:0;min-height:48px}.housing-wayfinding-fields{grid-template-columns:1fr}.ops-skeleton-row{grid-template-columns:40px 1fr}.ops-skeleton-row>em{display:none}.report-scope-note{align-items:flex-start}.birthday-open-assignment{min-height:48px}.account-responsibility-sensitivity{font-size:13px}.workspace-recovery-card .runtime-recovery-actions{display:grid;gap:10px}.housing-v5-room-card b{white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere}}
@media(max-width:430px){.housing-location-banner,.report-scope-note,.account-responsibility-summary{border-radius:12px;padding:11px 12px}.ops-skeleton-row{padding:10px;min-height:66px}.housing-v5-room-card{min-width:0}.housing-v5-room-card>span{min-width:0}}
@media(max-width:350px){.ops-skeleton-row{grid-template-columns:34px 1fr}.ops-skeleton-row>i{width:34px;height:34px}.housing-location-banner{font-size:14px}}
''')
replace_once("src/main.jsx", 'import "./access-assignments-v12-fix.css";', 'import "./access-assignments-v12-fix.css";\nimport "./operations-reliability-v12.css";')

# PWA shell release marker.
replace_once("public/sw.js", 'fsy-kumasi-shell-v33', 'fsy-kumasi-shell-v34')
replace_once("public/sw.js", '// Release marker: connected Access and Assignments leader setup', '// Release marker: truthful loading, canonical check-in, Housing wayfinding and scoped operations')

# ---------------------------------------------------------------------------
# L. Regression contract for this release.
# ---------------------------------------------------------------------------
write("tests/operations-reliability-v12.test.mjs", r'''import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

test("legacy check-in is canonicalized into Registration desk", () => {
  const nav=read("src/lib/navigation.js"); const shell=read("src/components/AppShell.jsx"); const app=read("src/App.jsx");
  assert.match(nav,/legacyCheckin \? "registration"/); assert.match(nav,/legacyCheckin \? "desk"/);
  assert.match(shell,/canRegistration \|\| canCheckin/); assert.doesNotMatch(app,/effectiveActive==="checkin"/);
});

test("registration never renders a confirmed empty state while loading", () => {
  const source=read("src/pages/RegistrationJourneyV5.jsx");
  assert.match(source,/initialLoading/); assert.match(source,/aria-busy=\{initialLoading \|\| refreshing\}/);
  assert.match(source,/!initialLoading && !loadError && !visible.length/);
});

test("signed-in workspace errors are distinct from sign-in errors", () => {
  const app=read("src/App.jsx"); const auth=read("src/components/AuthGate.jsx");
  assert.match(app,/authSession\?<WorkspaceRecoveryScreen/); assert.match(auth,/Signed in/); assert.match(app,/Promise\.allSettled/);
});

test("Housing rooms require usable wayfinding before new assignment", () => {
  const dialogs=read("src/pages/HousingDialogsV4.jsx"); const assignment=read("src/pages/HousingAssignmentV5.jsx"); const migration=read("supabase/migrations/20260907120000_operations_reliability_v12.sql");
  assert.match(dialogs,/roomHasWayfinding/); assert.match(dialogs,/Location \/ building/); assert.match(assignment,/roomHasWayfinding\(room\)/); assert.match(migration,/Add a location people can use to find this room/);
});

test("Assistant Coordinator reporting is server-scoped by company", () => {
  const reports=read("src/lib/reports.js"); const migration=read("supabase/migrations/20260907120000_operations_reliability_v12.sql");
  assert.match(reports,/role === "assistant_coordinator"/); assert.match(migration,/current_user_company_ids/); assert.match(migration,/staff_in_current_company_scope/); assert.match(migration,/current_report_scope_label/);
});

test("committee responsibilities expose sensitive labels in plain language", () => {
  const setup=read("src/components/AccountSetup.jsx");
  assert.match(setup,/Sensitive · private health information/); assert.match(setup,/Sensitive · financial information/);
});

test("birthdays derive richer assignment context and can deep-link to assignments", () => {
  const field=read("src/lib/field-operations.js"); const birthdays=read("src/pages/Birthdays.jsx"); const app=read("src/App.jsx");
  assert.match(field,/get_staff_birthdays_v2/); assert.match(field,/group: row\.group_name/); assert.match(birthdays,/Open assignment/); assert.match(app,/tab:"people",staffId/);
});

test("Overview actions carry exact destinations", () => {
  const inbox=read("src/lib/overview-inbox.js"); const overview=read("src/pages/Overview.jsx");
  assert.match(inbox,/view:"housing",tab:"arrivals",filter:"waiting"/); assert.match(inbox,/view:"registration",mode:"desk",filter:"ready"/); assert.match(inbox,/view:"assignments",tab:"groups",filter:"needs"/); assert.match(overview,/primary\.destination/);
});

test("v34 shell and final responsive reliability CSS are wired last", () => {
  assert.match(read("public/sw.js"),/fsy-kumasi-shell-v34/); assert.match(read("src/main.jsx"),/operations-reliability-v12\.css/);
});
''')

print("Operations reliability v12 patches applied")
