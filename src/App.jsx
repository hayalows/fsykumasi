import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "./components/AppShell.jsx";
import { AccessRequestScreen, LoadingScreen, SignInScreen } from "./components/AuthGate.jsx";
import { createDemoParticipants } from "./data/demo.js";
import { isSupabaseConfigured } from "./lib/supabase.js";
import {
  decideAccessRequest,
  getCurrentAuthSession,
  getMyAccessState,
  importParticipants,
  loadAccessRequests,
  loadAccessRoster,
  loadParticipants,
  loadProfile,
  loadSession,
  loadSessionAccessCode,
  onAuthChange,
  recordCheckin,
  requestSessionAccess,
  sendMagicLink,
  signOut,
  subscribeToAccessRequests,
} from "./lib/backend.js";
import { loadArrivedParticipantIds, subscribeToCheckins } from "./lib/checkins.js";
import { Overview } from "./pages/Overview.jsx";
import { Registration } from "./pages/Registration.jsx";
import { Groups } from "./pages/Groups.jsx";
import { Checkin } from "./pages/Checkin.jsx";
import { Headcount } from "./pages/Headcount.jsx";
import { Access, createInitialAccessRequests } from "./pages/Access.jsx";

export function App() {
  const [active, setActive] = useState("overview");
  const [imported, setImported] = useState([]);
  const [assignment, setAssignment] = useState(null);
  const [accessRequests, setAccessRequests] = useState(createInitialAccessRequests);
  const [accessRoster, setAccessRoster] = useState([]);
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
        setCheckedIds([]);
        setRuntimeStatus("awaiting-access");
        return;
      }

      const canApprove = ["logistics_admin", "session_director"].includes(granted.role);
      const [nextSession, nextParticipants, nextRequests, nextRoster, nextChecked, nextAccessCode] = await Promise.all([
        loadSession(granted.session_id),
        loadParticipants(granted.session_id),
        loadAccessRequests(granted.session_id),
        loadAccessRoster(granted.session_id),
        loadArrivedParticipantIds(granted.session_id),
        canApprove ? loadSessionAccessCode(granted.session_id) : Promise.resolve(""),
      ]);

      setSessionInfo(nextSession);
      setSessionAccessCode(nextAccessCode || "");
      setImported(nextParticipants);
      setAccessRequests(nextRequests);
      setAccessRoster(nextRoster);
      setCheckedIds(nextChecked);
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
      const [nextRequests, nextRoster] = await Promise.all([
        loadAccessRequests(sessionInfo.id),
        loadAccessRoster(sessionInfo.id),
      ]);
      setAccessRequests(nextRequests);
      setAccessRoster(nextRoster);
    };
    const reloadCheckins = async () => setCheckedIds(await loadArrivedParticipantIds(sessionInfo.id));
    const unsubscribeAccess = subscribeToAccessRequests(sessionInfo.id, reloadRequests);
    const unsubscribeCheckins = subscribeToCheckins(sessionInfo.id, reloadCheckins);
    return () => {
      unsubscribeAccess();
      unsubscribeCheckins();
    };
  }, [runtimeStatus, sessionInfo?.id]);

  if (isSupabaseConfigured) {
    if (runtimeStatus === "loading") return <LoadingScreen />;
    if (runtimeStatus === "signed-out") return <SignInScreen onSendLink={sendMagicLink} />;
    if (runtimeStatus === "error") return <main className="auth-page"><section className="auth-card"><h1>Connection problem</h1><p>{runtimeError}</p><button className="primary full" onClick={() => hydrateLive(authSession)}>Try again</button></section></main>;
    if (runtimeStatus === "awaiting-access") {
      const pending = accessState.find((item) => item.request_status === "pending");
      return <AccessRequestScreen profile={profile} request={pending} onRequest={async (form) => { await requestSessionAccess(form); await hydrateLive(authSession); }} onSignOut={signOut} />;
    }
  }

  const live = isSupabaseConfigured && runtimeStatus === "ready";
  const grantedAccess = live ? accessState.find((item) => item.active && item.role) : null;
  const currentRole = grantedAccess?.role || "logistics_admin";
  const participants = live ? imported : imported.length ? imported : demoParticipants;
  const pendingAccess = accessRequests.filter((request) => request.status === "pending").length;
  const canImport = !live || ["logistics_admin", "session_director"].includes(currentRole);
  const canRecordCheckin = !live || ["coordinator", "logistics_admin", "session_director"].includes(currentRole);

  const applyImport = live ? async ({ participants: nextParticipants, sourceFilename }) => {
    await importParticipants({
      sessionId: sessionInfo.id,
      userId: authSession.user.id,
      sourceFilename,
      participants: nextParticipants,
    });
    setImported(await loadParticipants(sessionInfo.id));
  } : null;

  const handleAccessDecision = live ? async (id, status) => {
    await decideAccessRequest(id, status);
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
      userId: authSession.user.id,
    });
  } : null;

  const content = active === "overview"
    ? <Overview setActive={setActive} imported={imported} assignment={assignment} pendingAccess={pendingAccess} />
    : active === "registration"
      ? <Registration imported={imported} setImported={setImported} onApply={applyImport} live={live} canManage={canImport} />
      : active === "groups"
        ? <Groups participants={participants} assignment={assignment} setAssignment={setAssignment} />
        : active === "checkin"
          ? <Checkin participants={participants} checkedIds={checkedIds} onRecord={handleCheckin} live={live} canRecord={canRecordCheckin} />
          : active === "headcount"
            ? <Headcount />
            : <Access requests={accessRequests} setRequests={setAccessRequests} currentRole={currentRole} onDecision={handleAccessDecision} roster={live ? accessRoster : undefined} sessionAccessCode={sessionAccessCode} live={live} />;

  return <AppShell active={active} setActive={setActive} attentionCount={pendingAccess} currentUser={live ? profile : undefined} currentRole={currentRole} onSignOut={live ? signOut : undefined}>{content}</AppShell>;
}
