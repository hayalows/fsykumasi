import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "./components/AppShell.jsx";
import { InviteClaimScreen, LoadingScreen, PasswordRecoveryScreen, SignInScreen } from "./components/AuthGate.jsx";
import { createDemoParticipants } from "./data/demo.js";
import { isSupabaseConfigured } from "./lib/supabase.js";
import {
  decideAccessRequest,
  addOnSiteParticipant,
  assignParticipantToGroup,
  applyRegistrationSnapshot,
  getCurrentAuthSession,
  getMyAccessState,
  loadAccessRequests,
  loadAccessRoster,
  loadGroupingPlan,
  loadHeadcount,
  loadParticipants,
  loadProfile,
  loadSession,
  loadSessionBirthdays,
  openHeadcountRound,
  publishGroupingPlan,
  recordCheckin,
  setCoordinatorAdminOverride,
  subscribeToAccessRequests,
  subscribeToHeadcount,
  submitCompanyHeadcount,
  updateMyProfile,
  verifyOnSiteParticipant,
} from "./lib/backend.js";
import { canApproveAccess } from "./lib/access.js";
import { isOperationalParticipant } from "./lib/registration.js";
import { setBirthdayAcknowledgement } from "./lib/operations.js";
import {
  activateLeaderAccount,
  changePassword,
  requestPasswordReset,
  signInWithPassword,
  signOutAccount,
  subscribeToAuth,
  updateRecoveredPassword,
} from "./lib/auth.js";
import {
  claimInviteWhileSignedIn,
  createLeaderInvite,
  createLeaderRecoveryCode,
  loadLeaderInvites,
  revokeLeaderInvite,
  subscribeToLeaderInvites,
} from "./lib/invites.js";
import { loadArrivedParticipantIds, subscribeToCheckins } from "./lib/checkins.js";
import { Overview } from "./pages/Overview.jsx";
import { Birthdays } from "./pages/Birthdays.jsx";
import { Registration } from "./pages/Registration.jsx";
import { People } from "./pages/People.jsx";
import { Groups } from "./pages/Groups.jsx";
import { Checkin } from "./pages/Checkin.jsx";
import { Headcount } from "./pages/Headcount.jsx";
import { Access, createInitialAccessRequests } from "./pages/Access.jsx";
import { Profile } from "./pages/Profile.jsx";

export function App() {
  const [active, setActive] = useState("overview");
  const [imported, setImported] = useState([]);
  const [assignment, setAssignment] = useState(null);
  const [accessRequests, setAccessRequests] = useState(createInitialAccessRequests);
  const [leaderInvites, setLeaderInvites] = useState([]);
  const [accessRoster, setAccessRoster] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [headcount, setHeadcount] = useState({ round: null, submissions: [] });
  const [checkedIds, setCheckedIds] = useState([]);
  const [birthdays, setBirthdays] = useState([]);
  const [authSession, setAuthSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [accessState, setAccessState] = useState([]);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [selectedSessionId, setSelectedSessionId] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("session") || "";
  });
  const [runtimeStatus, setRuntimeStatus] = useState(isSupabaseConfigured ? "loading" : "demo");
  const [runtimeError, setRuntimeError] = useState("");
  const demoParticipants = useMemo(() => createDemoParticipants(), []);
  const initialInvite = useMemo(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("invite") || "", []);

  const hydrateLive = useCallback(async (sessionOverride, requestedSessionOverride = "") => {
    if (!isSupabaseConfigured) return;
    setRuntimeError("");
    const session = sessionOverride === undefined ? await getCurrentAuthSession() : sessionOverride;
    setAuthSession(session || null);

    if (!session) {
      setProfile(null); setAccessState([]); setSessionInfo(null); setImported([]); setAccessRequests([]);
      setLeaderInvites([]); setAccessRoster([]); setCompanies([]); setHeadcount({ round: null, submissions: [] });
      setCheckedIds([]); setBirthdays([]); setRuntimeStatus("signed-out");
      return;
    }

    setRuntimeStatus("loading");
    try {
      const [nextProfile, nextAccessState] = await Promise.all([loadProfile(session.user.id), getMyAccessState()]);
      setProfile(nextProfile || { user_id: session.user.id, email: session.user.email, display_name: session.user.email });
      setAccessState(nextAccessState);

      const activeGrants = nextAccessState.filter((item) => item.active && item.role);
      const requestedSession = requestedSessionOverride || selectedSessionId;
      const granted = activeGrants.find((item) => item.session_id === requestedSession)
        || activeGrants.find((item) => item.session_status !== "training")
        || activeGrants[0];

      if (!granted) {
        setSessionInfo(null); setImported([]); setAccessRoster([]); setAccessRequests([]); setLeaderInvites([]);
        setCompanies([]); setHeadcount({ round: null, submissions: [] }); setCheckedIds([]); setBirthdays([]);
        setRuntimeStatus("awaiting-access");
        return;
      }

      if (granted.session_id !== selectedSessionId) setSelectedSessionId(granted.session_id);
      const canManageAccess = canApproveAccess(granted.role, granted.capabilities || []);
      const [nextSession, nextParticipants, nextRequests, nextRoster, nextInvites, nextGrouping, nextChecked, nextHeadcount, nextBirthdays] = await Promise.all([
        loadSession(granted.session_id),
        loadParticipants(granted.session_id),
        loadAccessRequests(granted.session_id),
        loadAccessRoster(granted.session_id),
        canManageAccess ? loadLeaderInvites(granted.session_id) : Promise.resolve([]),
        loadGroupingPlan(granted.session_id),
        loadArrivedParticipantIds(granted.session_id),
        loadHeadcount(granted.session_id),
        loadSessionBirthdays(granted.session_id),
      ]);

      setSessionInfo(nextSession); setImported(nextParticipants); setAccessRequests(nextRequests); setAccessRoster(nextRoster);
      setLeaderInvites(nextInvites); setCompanies(nextGrouping.companies); setAssignment(nextGrouping.published ? nextGrouping : null);
      setCheckedIds(nextChecked); setHeadcount(nextHeadcount); setBirthdays(nextBirthdays); setRuntimeStatus("ready");
    } catch (error) {
      setRuntimeError(error.message || "Unable to load FSY operations data.");
      setRuntimeStatus("error");
    }
  }, [selectedSessionId]);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let activeSubscription = true;
    hydrateLive().catch((error) => { if (activeSubscription) { setRuntimeError(error.message || "Unable to connect to Supabase."); setRuntimeStatus("error"); } });
    const unsubscribe = subscribeToAuth((event, session) => {
      if (!activeSubscription) return;
      if (event === "PASSWORD_RECOVERY") { setAuthSession(session); setRuntimeStatus("password-recovery"); return; }
      hydrateLive(session);
    });
    return () => { activeSubscription = false; unsubscribe(); };
  }, [hydrateLive]);

  useEffect(() => {
    if (!isSupabaseConfigured || runtimeStatus !== "ready" || !sessionInfo?.id) return undefined;
    const currentGrant = accessState.find((item) => item.session_id === sessionInfo.id && item.active && item.role);
    const canManageAccess = canApproveAccess(currentGrant?.role, currentGrant?.capabilities || []);
    const reloadRequests = async () => {
      try {
        const [nextRequests, nextRoster, nextInvites] = await Promise.all([
          loadAccessRequests(sessionInfo.id), loadAccessRoster(sessionInfo.id), canManageAccess ? loadLeaderInvites(sessionInfo.id) : Promise.resolve([]),
        ]);
        setAccessRequests(nextRequests); setAccessRoster(nextRoster); setLeaderInvites(nextInvites);
      } catch (error) { setRuntimeError(error.message || "Access updates could not be refreshed."); }
    };
    const reloadCheckins = async () => { try { setCheckedIds(await loadArrivedParticipantIds(sessionInfo.id)); } catch (error) { setRuntimeError(error.message || "Check-in updates could not be refreshed."); } };
    const reloadHeadcount = async () => { try { setHeadcount(await loadHeadcount(sessionInfo.id)); } catch (error) { setRuntimeError(error.message || "Head-count updates could not be refreshed."); } };
    const unsubscribeAccess = subscribeToAccessRequests(sessionInfo.id, reloadRequests);
    const unsubscribeInvites = canManageAccess ? subscribeToLeaderInvites(sessionInfo.id, reloadRequests) : () => {};
    const unsubscribeCheckins = subscribeToCheckins(sessionInfo.id, reloadCheckins);
    const unsubscribeHeadcount = subscribeToHeadcount(sessionInfo.id, reloadHeadcount);
    return () => { unsubscribeAccess(); unsubscribeInvites(); unsubscribeCheckins(); unsubscribeHeadcount(); };
  }, [runtimeStatus, sessionInfo?.id, accessState]);

  const saveProfile = async (displayName) => {
    const updated = await updateMyProfile(displayName);
    setProfile((current) => ({ ...current, display_name: updated?.display_name || displayName }));
    return updated;
  };
  const handleSignOut = async () => {
    setRuntimeError("");
    try { await signOutAccount(); setActive("overview"); await hydrateLive(null); }
    catch (error) { setRuntimeError(error.message || "Unable to sign out. Please try again."); throw error; }
  };
  const handleSessionChange = async (sessionId) => {
    const next = accessState.find((item) => item.session_id === sessionId && item.active && item.role);
    if (!next || sessionId === sessionInfo?.id) return;
    setSelectedSessionId(sessionId); setActive("overview");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (next.session_status === "training") url.searchParams.set("session", sessionId); else url.searchParams.delete("session");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
    await hydrateLive(authSession, sessionId);
  };
  const clearRecoveryUrl = () => { if (typeof window !== "undefined") window.history.replaceState({}, "", window.location.pathname); };

  if (isSupabaseConfigured) {
    if (runtimeStatus === "loading") return <LoadingScreen />;
    if (runtimeStatus === "signed-out") return <SignInScreen initialInvite={initialInvite} onSignIn={async (email,password) => hydrateLive(await signInWithPassword(email,password))} onActivate={async (values) => hydrateLive(await activateLeaderAccount(values))} onForgot={requestPasswordReset}/>;
    if (runtimeStatus === "password-recovery") return <PasswordRecoveryScreen onUpdate={updateRecoveredPassword} onCancel={async () => { clearRecoveryUrl(); await hydrateLive(authSession); }}/>;
    if (runtimeStatus === "error") return <main className="auth-page"><section className="auth-card"><h1>Connection problem</h1><p>{runtimeError}</p><button className="primary full" onClick={() => hydrateLive(authSession)}>Try again</button></section></main>;
    if (runtimeStatus === "awaiting-access") return <InviteClaimScreen profile={profile} onClaim={async (code) => { await claimInviteWhileSignedIn(code); await hydrateLive(authSession); }} onSignOut={handleSignOut}/>;
  }

  const live = isSupabaseConfigured && runtimeStatus === "ready";
  const grantedAccess = live ? accessState.find((item) => item.session_id === sessionInfo?.id && item.active && item.role) : null;
  const currentRole = grantedAccess?.role || "logistics_admin";
  const currentCapabilities = grantedAccess?.capabilities || [];
  const participants = live ? imported : imported.length ? imported : demoParticipants;
  const operationalParticipants = participants.filter(isOperationalParticipant);
  const operationalParticipantIds = new Set(operationalParticipants.map((person) => person.id));
  const operationalCheckedIds = checkedIds.filter((id) => operationalParticipantIds.has(id));
  const pendingAccess = accessRequests.filter((request) => request.status === "pending").length + leaderInvites.filter((invite) => invite.status === "pending").length;
  const canManageAccess = !live || canApproveAccess(currentRole, currentCapabilities);
  const canImport = canManageAccess;
  const canRecordCheckin = !live || ["assistant_coordinator", "coordinator", "logistics_admin", "session_director"].includes(currentRole);
  const activeSessions = live ? accessState.filter((item) => item.active && item.role) : [];
  const companyOptions = live ? companies : (assignment?.companies || []).map((company,index) => ({ id: company.id || `demo-company-${index+1}`, name: company.name || `Company ${String(index+1).padStart(2,"0")}` }));

  const applyImport = live ? async ({ records, sourceFilename, sourceSha256 }) => {
    const summary = await applyRegistrationSnapshot({ sessionId: sessionInfo.id, sourceFilename, sourceSha256, records });
    setImported(await loadParticipants(sessionInfo.id)); setBirthdays(await loadSessionBirthdays(sessionInfo.id)); return summary;
  } : null;
  const handleAddOnSite = live ? async (values) => { await addOnSiteParticipant({ sessionId: sessionInfo.id, ...values }); setImported(await loadParticipants(sessionInfo.id)); } : null;
  const handleVerifyOnSite = live ? async (participantId, approved) => { await verifyOnSiteParticipant(participantId, approved); setImported(await loadParticipants(sessionInfo.id)); setBirthdays(await loadSessionBirthdays(sessionInfo.id)); } : null;
  const handleAssignParticipant = live ? async (participantId, groupId) => { await assignParticipantToGroup(participantId, groupId); setImported(await loadParticipants(sessionInfo.id)); setBirthdays(await loadSessionBirthdays(sessionInfo.id)); } : null;
  const handleSetAdminOverride = live ? async (assignmentId, enabled) => { await setCoordinatorAdminOverride(assignmentId, enabled); setAccessRoster(await loadAccessRoster(sessionInfo.id)); } : null;
  const handleBirthday = live ? async (participantId, acknowledged) => { await setBirthdayAcknowledgement(sessionInfo.id, participantId, acknowledged); setBirthdays(await loadSessionBirthdays(sessionInfo.id)); } : null;
  const handleAccessDecision = live ? async (id, status, options) => { await decideAccessRequest(id,status,options); const [nextRequests,nextRoster] = await Promise.all([loadAccessRequests(sessionInfo.id),loadAccessRoster(sessionInfo.id)]); setAccessRequests(nextRequests); setAccessRoster(nextRoster); } : null;
  const handleCreateInvite = live ? async (values) => { const created = await createLeaderInvite({ sessionId: sessionInfo.id, ...values }); setLeaderInvites(await loadLeaderInvites(sessionInfo.id)); return created; } : null;
  const handleRevokeInvite = live ? async (inviteId) => { await revokeLeaderInvite(inviteId); setLeaderInvites(await loadLeaderInvites(sessionInfo.id)); } : null;
  const handleRecoveryCode = live ? async (userId) => createLeaderRecoveryCode(sessionInfo.id, userId) : null;
  const handleCheckin = live && canRecordCheckin ? async (participantId,status) => { await recordCheckin({ sessionId: sessionInfo.id, participantId, status }); } : null;
  const handlePublishGrouping = live ? async (nextAssignment) => {
    await publishGroupingPlan(sessionInfo.id, nextAssignment);
    const [nextParticipants,nextGrouping] = await Promise.all([loadParticipants(sessionInfo.id),loadGroupingPlan(sessionInfo.id)]);
    setImported(nextParticipants); setCompanies(nextGrouping.companies); setAssignment(nextGrouping); setBirthdays(await loadSessionBirthdays(sessionInfo.id));
  } : null;
  const handleOpenHeadcount = live ? async (label) => { await openHeadcountRound(sessionInfo.id,label); setHeadcount(await loadHeadcount(sessionInfo.id)); } : null;
  const handleHeadcountSubmit = live ? async (values) => { await submitCompanyHeadcount(values); setHeadcount(await loadHeadcount(sessionInfo.id)); } : null;

  const content = active === "overview"
    ? <Overview setActive={setActive} imported={imported} assignment={assignment} pendingAccess={pendingAccess} birthdays={birthdays} live={live} companies={companies} checkedCount={operationalCheckedIds.length}/>
    : active === "registration"
      ? <Registration imported={imported} setImported={setImported} groups={assignment?.groups || []} onApply={applyImport} onAdd={handleAddOnSite} onVerify={handleVerifyOnSite} onAssign={handleAssignParticipant} live={live} canManage={canImport} canAdd={!live || ["coordinator","logistics_admin","session_director"].includes(currentRole)} canVerify={canManageAccess} sessionId={sessionInfo?.id}/>
      : active === "people"
        ? <People sessionId={sessionInfo?.id} participants={participants} canManage={canManageAccess}/>
        : active === "birthdays"
          ? <Birthdays birthdays={birthdays} onSetAcknowledgement={handleBirthday}/>
          : active === "groups"
            ? <Groups participants={operationalParticipants} assignment={assignment} onPublish={handlePublishGrouping} live={live} canManage={canManageAccess} sessionId={sessionInfo?.id} onNavigatePeople={() => setActive("people")}/>
            : active === "checkin"
              ? <Checkin participants={participants} checkedIds={operationalCheckedIds} onRecord={handleCheckin} onAddMissing={() => setActive("registration")} live={live} canRecord={canRecordCheckin} groupsPublished={Boolean(assignment?.published)}/>
              : active === "headcount"
                ? <Headcount live={live} companies={companies} headcount={headcount} currentRole={currentRole} onOpen={handleOpenHeadcount} onSubmit={handleHeadcountSubmit}/>
                : active === "profile"
                  ? <Profile currentUser={live ? profile : { display_name: "FSY Leader", email: "demo@example.org" }} currentRole={currentRole} grantedAccess={grantedAccess} companies={companyOptions} sessionInfo={sessionInfo} live={live} onSave={saveProfile} onChangePassword={changePassword} onSignOut={handleSignOut}/>
                  : <Access requests={accessRequests} setRequests={setAccessRequests} invites={leaderInvites} currentRole={currentRole} currentCapabilities={currentCapabilities} onDecision={handleAccessDecision} onCreateInvite={handleCreateInvite} onRevokeInvite={handleRevokeInvite} onCreateRecovery={handleRecoveryCode} onSetAdminOverride={handleSetAdminOverride} roster={live ? accessRoster : undefined} companies={companyOptions} live={live}/>;

  return <AppShell active={active} setActive={setActive} attentionCount={pendingAccess} currentUser={live ? profile : undefined} currentRole={currentRole} sessionInfo={sessionInfo} sessions={activeSessions} selectedSessionId={sessionInfo?.id || selectedSessionId} onSessionChange={live ? handleSessionChange : undefined} onSignOut={live ? handleSignOut : undefined} syncError={live ? runtimeError : ""} onRefresh={() => hydrateLive(authSession, sessionInfo?.id)}>{content}</AppShell>;
}
