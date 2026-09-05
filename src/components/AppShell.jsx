import { useEffect, useMemo, useRef, useState } from "react";
import { Bell } from "@phosphor-icons/react/Bell";
import { Bed } from "@phosphor-icons/react/Bed";
import { Cake } from "@phosphor-icons/react/Cake";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { ChartBar } from "@phosphor-icons/react/ChartBar";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { ClipboardText } from "@phosphor-icons/react/ClipboardText";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { DotsThree } from "@phosphor-icons/react/DotsThree";
import { DownloadSimple } from "@phosphor-icons/react/DownloadSimple";
import { FirstAidKit } from "@phosphor-icons/react/FirstAidKit";
import { ForkKnife } from "@phosphor-icons/react/ForkKnife";
import { IdentificationCard } from "@phosphor-icons/react/IdentificationCard";
import { List } from "@phosphor-icons/react/List";
import { SignOut } from "@phosphor-icons/react/SignOut";
import { SquaresFour } from "@phosphor-icons/react/SquaresFour";
import { Users } from "@phosphor-icons/react/Users";
import { UsersThree } from "@phosphor-icons/react/UsersThree";
import { X } from "@phosphor-icons/react/X";
import { AccountAvatar } from "./Avatar.jsx";
import { BrandMark } from "./BrandMark.jsx";
import { demoSession } from "../data/session.js";
import { isSupabaseConfigured, supabaseEnvironment } from "../lib/supabase.js";
import { roleLabel } from "../lib/access.js";
import { trackSessionPresence } from "../lib/presence.js";
import "./session-switcher.css";

const BASE_OPERATIONAL = new Set(["assistant_coordinator","coordinator","logistics_admin","session_director"]);
const WHOLE_SESSION = new Set(["coordinator","logistics_admin","session_director"]);
const REPORT_CAPABILITIES = ["reports_export","housing_export","food_export","wellness_export","access_admin"];
function has(caps, value) { return Array.isArray(caps) && caps.includes(value); }
function focusableElements(container) { return [...container.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')]; }
function isStandaloneDisplay() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator?.standalone === true;
}

export function AppShell({ active, setActive, attentionCount = 0, currentUser, currentRole = "logistics_admin", currentCapabilities = [], sessionInfo, sessions = [], selectedSessionId = "", onSessionChange, onSignOut, syncError = "", onRefresh, children }) {
  const [menu, setMenu] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installed, setInstalled] = useState(isStandaloneDisplay);
  const menuButtonRef = useRef(null);
  const sidebarRef = useRef(null);

  const nav = useMemo(() => {
    const canPeople = BASE_OPERATIONAL.has(currentRole) || has(currentCapabilities,"people_lookup");
    const canGroups = BASE_OPERATIONAL.has(currentRole) || has(currentCapabilities,"groups_view");
    const canCheckin = BASE_OPERATIONAL.has(currentRole) || has(currentCapabilities,"checkin_record");
    const canRegistration = WHOLE_SESSION.has(currentRole) || has(currentCapabilities,"registration_view") || has(currentCapabilities,"registration_manage");
    const canHeadcount = BASE_OPERATIONAL.has(currentRole) || has(currentCapabilities,"headcount_view") || has(currentCapabilities,"headcount_record");
    const canReports = REPORT_CAPABILITIES.some((capability) => has(currentCapabilities, capability));
    const today = [["overview","Overview",SquaresFour]];
    if (canRegistration) today.push(["registration","Registration & check-in",IdentificationCard]);
    else if (canCheckin) today.push(["checkin","Check-in",CheckCircle]);
    if (canHeadcount) today.push(["headcount","Head count",ClipboardText]);
    if (canGroups) today.push(["groups","Groups & companies",Buildings]);

    const peopleAndSetup = [];
    if (canPeople) peopleAndSetup.push(["people","People",UsersThree]);
    if (WHOLE_SESSION.has(currentRole) || has(currentCapabilities,"staff_manage")) peopleAndSetup.push(["assignments","Assignments",Users]);

    const teamTools = [];
    if (has(currentCapabilities,"housing_view")) teamTools.push(["housing","Housing",Bed]);
    if (has(currentCapabilities,"wellness_private") || has(currentCapabilities,"wellness_status")) teamTools.push(["wellness","Wellness",FirstAidKit]);
    if (has(currentCapabilities,"food_view") || has(currentCapabilities,"meal_attendance_view")) teamTools.push(["food","Food",ForkKnife]);
    if (canReports) teamTools.push(["reports","Reports",ChartBar]);

    const adminAndUtilities = [];
    if (currentRole === "coordinator" || ["logistics_admin","session_director"].includes(currentRole) || has(currentCapabilities,"access_admin")) adminAndUtilities.push(["access","Access",Users]);
    adminAndUtilities.push(["birthdays","Birthdays",Cake]);

    const more = [
      ["People & setup", peopleAndSetup],
      ["Team tools", teamTools],
      ["Admin & utilities", adminAndUtilities],
    ].filter(([, items]) => items.length);
    const moreItems = more.flatMap(([, items]) => items);
    return { today, more, moreItems, moreIds: new Set(moreItems.map(([id]) => id)), mobile: today.slice(0,4) };
  }, [currentRole,currentCapabilities]);

  useEffect(() => { const update=()=>setOnline(navigator.onLine); window.addEventListener("online",update); window.addEventListener("offline",update); return()=>{window.removeEventListener("online",update);window.removeEventListener("offline",update);}; }, []);
  useEffect(() => {
    const userId = currentUser?.user_id || currentUser?.id;
    if (!isSupabaseConfigured || !sessionInfo?.id || !userId) return undefined;
    return trackSessionPresence(sessionInfo.id, userId);
  }, [sessionInfo?.id, currentUser?.user_id, currentUser?.id]);
  useEffect(() => {
    const onBeforeInstallPrompt = (event) => { event.preventDefault(); setInstallPrompt(event); };
    const onInstalled = () => { setInstalled(true); setInstallPrompt(null); };
    const displayQuery = window.matchMedia?.("(display-mode: standalone)");
    const onDisplayChange = () => setInstalled(isStandaloneDisplay());
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    displayQuery?.addEventListener?.("change", onDisplayChange);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      displayQuery?.removeEventListener?.("change", onDisplayChange);
    };
  }, []);
  useEffect(() => {
    if (!menu) return undefined;
    const previousActive=document.activeElement; const previousOverflow=document.body.style.overflow; document.body.style.overflow="hidden";
    const frame=window.requestAnimationFrame(()=>sidebarRef.current?.querySelector("[data-drawer-close]")?.focus());
    const onKeyDown=(event)=>{ if(event.key==="Escape"){event.preventDefault();setMenu(false);return;} if(event.key!=="Tab"||!sidebarRef.current)return; const items=focusableElements(sidebarRef.current); if(!items.length)return; const first=items[0],last=items[items.length-1]; if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();} };
    const onPopState=()=>setMenu(false); document.addEventListener("keydown",onKeyDown); window.addEventListener("popstate",onPopState);
    return()=>{window.cancelAnimationFrame(frame);document.removeEventListener("keydown",onKeyDown);window.removeEventListener("popstate",onPopState);document.body.style.overflow=previousOverflow;const restore=sidebarRef.current?.contains(previousActive)?menuButtonRef.current:previousActive;(restore||menuButtonRef.current)?.focus?.();};
  }, [menu]);
  useEffect(() => { setMenu(false); setMoreOpen(nav.moreIds.has(active)); }, [active, nav.moreIds]);

  const navigate=(id)=>{setActive(id);setMenu(false);window.scrollTo({top:0,behavior:"auto"});};
  const openMenu=()=>{setMoreOpen(true);setMenu(true);};
  const installApp=async()=>{if(!installPrompt)return;try{await installPrompt.prompt();await installPrompt.userChoice;}finally{setInstallPrompt(null);}};
  const displayName=currentUser?.display_name||"FSY Leader"; const displayRole=roleLabel(currentRole);
  const selectedSession=sessions.find((item)=>item.session_id===selectedSessionId); const isTraining=sessionInfo?.status==="training"||selectedSession?.session_status==="training";
  const sessionTitle=sessionInfo?.name||selectedSession?.session_name||demoSession.name;
  const hasSecondaryActive=nav.moreIds.has(active);
  const connectionLabel=!online?"Offline":isTraining?"Training data":isSupabaseConfigured?`${supabaseEnvironment==="production"?"Production":"Development"} data`:"Demo data";
  const connectionShort=!online?"Offline":isTraining?"Training":isSupabaseConfigured?(supabaseEnvironment==="production"?"Live":"Dev"):"Demo";
  const navItem=([id,label,Icon])=><button key={id} type="button" className={active===id?"active":""} onClick={()=>navigate(id)} aria-current={active===id?"page":undefined}><Icon size={20} weight={active===id?"fill":"regular"}/><span>{label}</span>{id==="access"&&attentionCount>0?<em>{attentionCount}</em>:null}</button>;
  const allMain=nav.today;

  return <div className="app-shell">
    {menu?<button className="sidebar-scrim" onClick={()=>setMenu(false)} aria-label="Close menu" tabIndex={-1}/>:null}
    <aside ref={sidebarRef} className={menu?"sidebar open":"sidebar"} aria-label="FSY navigation">
      <div className="brand"><BrandMark compact/><div><b>FSY Kumasi</b><small>Operations</small></div><button data-drawer-close className="icon-button sidebar-close" onClick={()=>setMenu(false)} aria-label="Close menu"><X/></button></div>
      <div className={isTraining?"session-badge training":"session-badge"}><span>{isTraining?"Training":sessionInfo?.year||demoSession.year}</span><small>{isTraining?"Synthetic rehearsal workspace":demoSession.theme}</small></div>
      <nav className="sidebar-nav">
        <div className="nav-group"><span className="nav-group-label">Today</span>{nav.today.map(navItem)}</div>
        {nav.more.length?<div className="nav-group nav-group-more"><button type="button" className={hasSecondaryActive?"sidebar-more-trigger active":"sidebar-more-trigger"} onClick={()=>setMoreOpen((v)=>!v)} aria-expanded={moreOpen} aria-controls="sidebar-more-tools"><DotsThree size={22}/><span>More</span><CaretDown size={17} className={moreOpen?"more-chevron open":"more-chevron"}/></button>{moreOpen?<div id="sidebar-more-tools" className="sidebar-more-items">{nav.more.map(([label,items])=><div className="sidebar-more-group" key={label}><span className="sidebar-more-label">{label}</span>{items.map(navItem)}</div>)}</div>:null}</div>:null}
      </nav>
      {installPrompt&&!installed?<button type="button" className="sidebar-install" onClick={installApp}><DownloadSimple size={21}/><span><b>Install FSY Ops</b><small>Open it like an app on this device</small></span></button>:null}
      <div className="sidebar-foot"><button className={active==="profile"?"sidebar-profile active":"sidebar-profile"} onClick={()=>navigate("profile")} aria-label="Open your profile" aria-current={active==="profile"?"page":undefined}><AccountAvatar seed={currentUser?.user_id||currentUser?.id} label={`${displayName} profile`} size={38}/><span className="sidebar-account-copy"><b>{displayName}</b><small>{displayRole}</small></span></button>{onSignOut?<button className="sidebar-signout" onClick={onSignOut} aria-label="Sign out" title="Sign out"><SignOut size={18}/></button>:null}</div>
    </aside>
    <main className="workspace"><header className="topbar"><button ref={menuButtonRef} className="icon-button menu-button" onClick={openMenu} aria-label="Open menu" aria-expanded={menu}><List/></button><div className="session">{sessions.length>1&&onSessionChange?<select className="session-select" value={selectedSessionId} onChange={(e)=>onSessionChange(e.target.value)} aria-label="Choose FSY workspace">{sessions.map((item)=><option key={item.session_id} value={item.session_id}>{item.session_status==="training"?`Training · ${item.session_name}`:item.session_name}</option>)}</select>:<span>{sessionTitle}</span>}<small>{isTraining?"Safe sandbox · synthetic people only":"Planning workspace"}</small></div><div className="top-actions"><span className={`connection ${isTraining?"demo":isSupabaseConfigured&&online?"live":"demo"}`} data-backend-environment={supabaseEnvironment}><span className="connection-label-full">{connectionLabel}</span><span className="connection-label-short">{connectionShort}</span></span><button className="icon-button notification-button" onClick={()=>attentionCount&&nav.moreIds.has("access")?navigate("access"):undefined} aria-label={attentionCount?`${attentionCount} access notifications`:"Notifications"}><Bell/>{attentionCount>0?<i>{attentionCount}</i>:null}</button><button className="top-profile-button" onClick={()=>navigate("profile")} aria-label="Open your profile" title="Profile"><AccountAvatar seed={currentUser?.user_id||currentUser?.id} label={`${displayName} profile`} size={34}/></button></div></header>
      {isTraining?<div className="training-banner" role="status"><b>Training sandbox</b><span>Everything in this workspace is synthetic. Test operations without touching the real FSY session.</span></div>:null}
      {syncError?<div className="sync-warning" role="alert"><span>Live updates paused: {syncError}</span><button onClick={onRefresh}>Reconnect</button></div>:null}
      {children}
      <nav className="mobile-nav" aria-label="Primary mobile navigation">{allMain.filter(([id])=>nav.mobile.some(([mobileId])=>mobileId===id)).map(([id,label,Icon])=><button type="button" key={id} className={active===id?"active":""} onClick={()=>navigate(id)} aria-current={active===id?"page":undefined}><Icon size={21} weight={active===id?"fill":"regular"}/><span>{label.replace("Registration & check-in","Check-in").replace(" & companies","")}</span></button>)}<button type="button" className={hasSecondaryActive?"active":""} onClick={openMenu} aria-label="Open more navigation" aria-expanded={menu}><List size={21} weight={hasSecondaryActive?"fill":"regular"}/><span>More</span></button></nav>
    </main>
  </div>;
}
