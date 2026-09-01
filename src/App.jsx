import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "./components/AppShell.jsx";
import { AccessRequestScreen, LoadingScreen, SignInScreen } from "./components/AuthGate.jsx";
import { createDemoParticipants } from "./data/demo.js";
import { isSupabaseConfigured } from "./lib/supabase.js";
import {
  bootstrapSessionAdmin,
  decideAccessRequest,
  getCurrentAuthSession,
  getMyAccessState,
  importParticipants,
  loadAccessRequests,
  loadAccessRoster,
  loadGroupingPlan,
  loadHeadcount,
  loadParticipants,
  loadProfile,
  loadSession,
  loadSessionAccessCode,
  onAuthChange,
  openHeadcountRound,
  publishGroupingPlan,
  recordCheckin,
  requestSessionAccess,
  rotateSessionAccessCode,
  sendMagicLink,
  signOut,
  subscribeToAccessRequests,
  subscribeToHeadcount,
  submitCompanyHeadcount,
  updateMyProfile,
} from "./lib/backend.js";
import { loadArrivedParticipantIds, subscribeToCheckins } from "./lib/checkins.js";
import { Overview } from "./pages/Overview.jsx";
import { Registration } from "./pages/Registration.jsx";
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
  const [accessRoster, setAccessRoster] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [headcount, setHeadcount] = useState({ round: null, submissions: [] });
  const [checkedIds, setCheckedIds] = useState([]);
  const [authSession, setAuthSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [accessState, setAccessState] = useState([]);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [sessionAccessCode, setSessionAccessCode] = useState("");
  const [runtimeStatus, setRuntimeStatus] = useState(isSupabaseConfigured ? "loading" : "demo");
  const [runtimeError, setRuntimeError] = useState("");
  const demoParticipants = useMemo(() => createDemoParticipants(), []);

  const hydrateLive = useCallback(async (sessionOverride) => {
    if (!isSupabaseConfigured) return;
    setRuntimeError("");
    const session = sessionOverride === undefined ? await getCurrentAuthSession() : sessionOverride;
    setAuthSession(session || null);

    if (!session) {
      setProfile(null);
      setAccessState([]);
      setSessionInfo(null);
      setSessionAccessCode("");
      setImported([]);
      setAccessRequests([]);
      setAccessRoster([]);
      setCompanies([]);
      setHeadcount({ round: null, submissions: [] });
      setCheckedIds([]);
      setRuntimeStatus("signed-out");
      return;
    }

    setRuntimeStatus("loading");
    try {
      const [nextProfile, nextAccessState] = await Promise.all([
        loadProfile(session.user.id),
        getMyAccessState(),
      ]);
      setProfile(nextProfile || { user_id: session.user.id, email: session.user.email, display_name: session.user.email });
      setAccessState(nextAccessState);

      const granted = nextAccessState.find((item) => item.active && item.role);
      if (!granted) {
        setSessionInfo(null);
        setSessionAccessCode("");
        setImported([]);
        setAccessRoster([]);
        setAccessRequests([]);
        setCompanies([]);
        setHeadcount({ round: null, submissions: [] });
        setCheckedIds([]);
        setRuntimeStatus("awaiting-access");
        return;
      }

      const canApprove = ["logistics_admin", "session_director"].includes(granted.role);
      const [nextSession, nextParticipants, nextRequests, nextRoster, nextGrouping, nextChecked, nextAccessCode, nextHeadcount] = await Promise.all([
        loadSession(granted.session_id),
        loadParticipants(granted.session_id),
        loadAccessRequests(granted.session_id),
        loadAccessRoster(granted.session_id),
        loadGroupingPlan(granted.session_id),
        loadArrivedParticipantIds(granted.session_id),
        canApprove ? loadSessionAccessCode(granted.session_id) : Promise.resolve(""),
        loadHeadcount(granted.session_id),
      ]);

      setSessionInfo(nextSession);
      setSessionAccessCode(nextAccessCode || "");
      setImported(nextParticipants);
      setAccessRequests(nextRequests);
      setAccessRoster(nextRoster);
      setCompanies(nextGrouping.companies);
      setAssignment(nextGrouping.published ? nextGrouping : null);
      setCheckedIds(nextChecked);
      setHeadcount(nextHeadcount);
      setRuntimeStatus("ready");
    } catch (error) {
      setRuntimeError(error.message || "Unable to load FSY operations data.");
      setRuntimeStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let activeSubscription = true;
    hydrateLive().catch((error) => {
      if (!activeSubscription) return;
      setRuntimeError(error.message || "Unable to connect to Supabase.");
      setRuntimeStatus("error");
    });
    const unsubscribe = onAuthChange((session) => {
      if (activeSubscription) hydrateLive(session);
    });
    return () => {
      activeSubscription = false;
      unsubscribe();
    };
  }, [hydrateLive]);

  useEffect(() => {
    if (!isSupabaseConfigured || runtimeStatus !== "ready" || !sessionInfo?.id) return undefined;
    const reloadRequests = async () => {
      try {
        const [nextRequests, nextRoster] = await Promise.all([
          loadAccessRequests(sessionInfo.id),
          loadAccessRoster(sessionInfo.id),
        ]);
        setAccessRequests(nextRequests);
        setAccessRoster(nextRoster);
      } catch (error) {
        setRuntimeError(error.message || "Access updates could not be refreshed.");
      }
    };
    const reloadCheckins = async () => {
      try { setCheckedIds(await loadArrivedParticipantIds(sessionInfo.id)); }
      catch (error) { setRuntimeError(error.message || "Check-in updates could not be refreshed."); }
    };
    const reloadHeadcount = async () => {
      try { setHeadcount(await loadHeadcount(sessionInfo.id)); }
      catch (error) { setRuntimeError(error.message || "Head-count updates could not be refreshed."); }
    };
    const unsubscribeAccess = subscribeToAccessRequests(sessionInfo.id, reloadRequests);
    const unsubscribeCheckins = subscribeToCheckins(sessionInfo.id, reloadCheckins);
    const unsubscribeHeadcount = subscribeToHeadcount(sessionInfo.id, reloadHeadcount);
    return () => {
      unsubscribeAccess();
      unsubscribeCheckins();
      unsubscribeHeadcount();
    };
  }, [runtimeStatus, sessionInfo?.id]);

  const saveProfile = async (displayName) => {
    const updated = await updateMyProfile(displayName);
    setProfile((current) => ({ ...current, display_name: updated?.display_name || displayName }));
    return updated;
  };

  const handleSignOut = async () => {
    setRuntimeError("");
    try {
      await signOut();
      setActive("overview");
      await hydrateLive(null);
    } catch (error) {
      setRuntimeError(error.message || "Unable to sign out. Please try again.");
      throw error;
    }
  };

  if (isSupabaseConfigured) {
    if (runtimeStatus === "loading") return <LoadingScreen />;
    if (runtimeStatus === "signed-out") return <SignInScreen onSendLink={sendMagicLink} />;
    if (runtimeStatus === "error") return <main className="auth-page"><section className="auth-card"><h1>Connection problem</h1><p>{runtimeError}</p><button className="primary full" onClick={() => hydrateLive(authSession)}>Try again</button></section></main>;
    if (runtimeStatus === "awaiting-access") {
      const pending = accessState.find((item) => item.request_status === "pending");
      return <AccessRequestScreen profile={profile} request={pending} onRequest={async (form) => { if (form.displayName?.trim()) await saveProfile(form.displayName); await requestSessionAccess(form); await hydrateLive(authSession); }} onBootstrap={async (form) => { if (form.displayName?.trim()) await saveProfile(form.displayName); await bootstrapSessionAdmin(form); await hydrateLive(authSession); }} onSignOut={handleSignOut} />;
    }
  }

  const live = isSupabaseConfigured && runtimeStatus === "ready";
  const grantedAccess = live ? accessState.find((item) => item.active && item.role) : null;
  const currentRole = grantedAccess?.role || "logistics_admin";
  const participants = live ? imported : imported.length ? imported : demoParticipants;
  const pendingAccess = accessRequests.filter((request) => request.status === "pending").length;
  const importLocked = live && Boolean(assignment?.published);
  const canImport = (!live || ["logistics_admin", "session_director"].includes(currentRole)) && !importLocked;
  const canRecordCheckin = !live || ["coordinator", "logistics_admin", "session_director"].includes(currentRole);
  const companyOptions = live
    ? companies
    : (assignment?.companies || []).map((company, index) => ({
        id: company.id || `demo-company-${index + 1}`,
        name: company.name || `Company ${String(index + 1).padStart(2, "0")}`,
      }));

  const applyImport = live ? async ({ participants: nextParticipants, sourceFilename }) => {
    await importParticipants({
      sessionId: sessionInfo.id,
      sourceFilename,
      participants: nextParticipants,
    });
    setImported(await loadParticipants(sessionInfo.id));
  } : null;

  const handleAccessDecision = live ? async (id, status, options) => {
    await decideAccessRequest(id, status, options);
    const [nextRequests, nextRoster] = await Promise.all([
      loadAccessRequests(sessionInfo.id),
      loadAccessRoster(sessionInfo.id),
    ]);
    setAccessRequests(nextRequests);
    setAccessRoster(nextRoster);
  } : null;

  const handleCheckin = live && canRecordCheckin ? async (participantId, status) => {
    await recordCheckin({
      sessionId: sessionInfo.id,
      participantId,
      status,
    });
  } : null;

  const handlePublishGrouping = live ? async (nextAssignment) => {
    await publishGroupingPlan(sessionInfo.id, nextAssignment);
    const [nextParticipants, nextGrouping] = await Promise.all([
      loadParticipants(sessionInfo.id),
      loadGroupingPlan(sessionInfo.id),
    ]);
    setImported(nextParticipants);
    setCompanies(nextGrouping.companies);
    setAssignment(nextGrouping);
  } : null;

  const handleOpenHeadcount = live ? async (label) => {
    await openHeadcountRound(sessionInfo.id, label);
    setHeadcount(await loadHeadcount(sessionInfo.id));
  } : null;

  const handleHeadcountSubmit = live ? async (values) => {
    await submitCompanyHeadcount(values);
    setHeadcount(await loadHeadcount(sessionInfo.id));
  } : null;

  const handleRotateAccessCode = live ? async () => {
    const nextCode = await rotateSessionAccessCode(sessionInfo.id);
    setSessionAccessCode(nextCode || "");
  } : null;

  const content = active === "overview"
    ? <Overview setActive={setActive} imported={imported} assignment={assignment} pendingAccess={pendingAccess} live={live} companies={companies} checkedCount={checkedIds.length} />
    : active === "registration"
      ? <Registration imported={imported} setImported={setImported} onApply={applyImport} live={live} canManage={canImport} lockedReason={importLocked ? "Participant imports are locked because the grouping plan is already published. This protects company totals and head-count accuracy." : ""} />
      : active === "groups"
        ? <Groups participants={participants} assignment={assignment} setAssignment={setAssignment} onPublish={handlePublishGrouping} live={live} canPublish={["coordinator", "logistics_admin", "session_director"].includes(currentRole)} />
        : active === "checkin"
          ? <Checkin participants={participants} checkedIds={checkedIds} onRecord={handleCheckin} live={live} canRecord={canRecordCheckin} />
          : active === "headcount"
            ? <Headcount live={live} companies={companies} headcount={headcount} currentRole={currentRole} onOpen={handleOpenHeadcount} onSubmit={handleHeadcountSubmit} />
            : active === "profile"
              ? <Profile currentUser={live ? profile : { display_name: "FSY Leader", email: "demo@example.org" }} currentRole={currentRole} grantedAccess={grantedAccess} companies={companyOptions} sessionInfo={sessionInfo} live={live} onSave={saveProfile} onSignOut={handleSignOut} />
              : <Access requests={accessRequests} setRequests={setAccessRequests} currentRole={currentRole} onDecision={handleAccessDecision} onRotateCode={handleRotateAccessCode} roster={live ? accessRoster : undefined} companies={companyOptions} sessionAccessCode={sessionAccessCode} live={live} />;

  return <AppShell active={active} setActive={setActive} attentionCount={pendingAccess} currentUser={live ? profile : undefined} currentRole={currentRole} onSignOut={live ? handleSignOut : undefined} syncError={live ? runtimeError : ""} onRefresh={() => hydrateLive(authSession)}>{content}</AppShell>;
}
