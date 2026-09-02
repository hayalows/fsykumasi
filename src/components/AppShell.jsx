import { useEffect, useRef, useState } from "react";
import { Bell } from "@phosphor-icons/react/Bell";
import { Cake } from "@phosphor-icons/react/Cake";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { ClipboardText } from "@phosphor-icons/react/ClipboardText";
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
import "./session-switcher.css";

const primaryNav = [
  ["overview", "Overview", SquaresFour],
  ["checkin", "Check-in", CheckCircle],
  ["headcount", "Head count", ClipboardText],
  ["groups", "Groups & companies", Buildings],
];

const secondaryNav = [
  ["registration", "Registration", IdentificationCard],
  ["people", "People", UsersThree],
  ["assignments", "Assignments", Users],
  ["birthdays", "Birthdays", Cake],
  ["access", "Access", Users],
];

const nav = [...primaryNav, ...secondaryNav];
const mobileNav = ["overview", "people", "checkin", "headcount"];

function focusableElements(container) {
  return [...container.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
  )];
}

export function AppShell({ active, setActive, attentionCount = 0, currentUser, currentRole = "logistics_admin", sessionInfo, sessions = [], selectedSessionId = "", onSessionChange, onSignOut, syncError = "", onRefresh, children }) {
  const [menu, setMenu] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const menuButtonRef = useRef(null);
  const sidebarRef = useRef(null);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  useEffect(() => {
    if (!menu) return undefined;
    const previousActive = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => sidebarRef.current?.querySelector("[data-drawer-close]")?.focus());
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenu(false);
        return;
      }
      if (event.key !== "Tab" || !sidebarRef.current) return;
      const items = focusableElements(sidebarRef.current);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      const restoreTarget = sidebarRef.current?.contains(previousActive) ? menuButtonRef.current : previousActive;
      (restoreTarget || menuButtonRef.current)?.focus?.();
    };
  }, [menu]);

  useEffect(() => {
    setMenu(false);
  }, [active]);

  const navigate = (id) => {
    setActive(id);
    setMenu(false);
    window.scrollTo({ top: 0, behavior: "auto" });
  };
  const displayName = currentUser?.display_name || "FSY Leader";
  const displayRole = roleLabel(currentRole);
  const selectedSession = sessions.find((item) => item.session_id === selectedSessionId);
  const isTraining = sessionInfo?.status === "training" || selectedSession?.session_status === "training";
  const sessionTitle = sessionInfo?.name || selectedSession?.session_name || demoSession.name;
  const hasSecondaryActive = secondaryNav.some(([id]) => id === active);

  const navItem = ([id, label, Icon]) => (
    <button
      key={id}
      className={active === id ? "active" : ""}
      onClick={() => navigate(id)}
      aria-current={active === id ? "page" : undefined}
    >
      <Icon size={20} weight={active === id ? "fill" : "regular"} />
      <span>{label}</span>
      {id === "access" && attentionCount > 0 ? <em>{attentionCount}</em> : null}
    </button>
  );

  return <div className="app-shell">
    {menu ? <button className="sidebar-scrim" onClick={() => setMenu(false)} aria-label="Close menu" tabIndex={-1} /> : null}
    <aside ref={sidebarRef} className={menu ? "sidebar open" : "sidebar"} aria-label="FSY navigation">
      <div className="brand"><BrandMark compact /><div><b>FSY Kumasi</b><small>Operations</small></div><button data-drawer-close className="icon-button sidebar-close" onClick={() => setMenu(false)} aria-label="Close menu"><X /></button></div>
      <div className={isTraining ? "session-badge training" : "session-badge"}><span>{isTraining ? "Training" : sessionInfo?.year || demoSession.year}</span><small>{isTraining ? "Synthetic rehearsal workspace" : demoSession.theme}</small></div>
      <nav className="sidebar-nav">
        <div className="nav-group"><span className="nav-group-label">Daily work</span>{primaryNav.map(navItem)}</div>
        <div className="nav-group"><span className="nav-group-label">People & setup</span>{secondaryNav.map(navItem)}</div>
      </nav>
      <div className="sidebar-foot">
        <button className={active === "profile" ? "sidebar-profile active" : "sidebar-profile"} onClick={() => navigate("profile")} aria-label="Open your profile" aria-current={active === "profile" ? "page" : undefined}>
          <AccountAvatar seed={currentUser?.user_id || currentUser?.id} label={`${displayName} profile`} size={38} />
          <span className="sidebar-account-copy"><b>{displayName}</b><small>{displayRole}</small></span>
        </button>
        {onSignOut ? <button className="sidebar-signout" onClick={onSignOut} aria-label="Sign out" title="Sign out"><SignOut size={18} /></button> : null}
      </div>
    </aside>

    <main className="workspace">
      <header className="topbar">
        <button ref={menuButtonRef} className="icon-button menu-button" onClick={() => setMenu(true)} aria-label="Open menu" aria-expanded={menu}><List /></button>
        <div className="session">{sessions.length > 1 && onSessionChange ? <select className="session-select" value={selectedSessionId} onChange={(event) => onSessionChange(event.target.value)} aria-label="Choose FSY workspace">{sessions.map((item) => <option key={item.session_id} value={item.session_id}>{item.session_status === "training" ? `Training · ${item.session_name}` : item.session_name}</option>)}</select> : <span>{sessionTitle}</span>}<small>{isTraining ? "Safe sandbox · synthetic people only" : "Planning workspace"}</small></div>
        <div className="top-actions">
          <span className={`connection ${isTraining ? "demo" : isSupabaseConfigured && online ? "live" : "demo"}`} data-backend-environment={supabaseEnvironment}>{!online ? "Offline" : isTraining ? "Training data" : isSupabaseConfigured ? `${supabaseEnvironment === "production" ? "Production" : "Development"} data` : "Demo data"}</span>
          <button className="icon-button notification-button" onClick={() => attentionCount ? navigate("access") : undefined} aria-label={attentionCount ? `Open ${attentionCount} access notifications` : "Notifications"}><Bell />{attentionCount > 0 ? <i>{attentionCount}</i> : null}</button>
          <button className="top-profile-button" onClick={() => navigate("profile")} aria-label="Open your profile" title="Profile"><AccountAvatar seed={currentUser?.user_id || currentUser?.id} label={`${displayName} profile`} size={34} /></button>
        </div>
      </header>
      {isTraining ? <div className="training-banner" role="status"><b>Training sandbox</b><span>Everything in this workspace is synthetic. Test grouping, birthdays, check-in, head counts, on-site additions and access without touching the real FSY session.</span></div> : null}
      {syncError ? <div className="sync-warning" role="alert"><span>Live updates paused: {syncError}</span><button onClick={onRefresh}>Reconnect</button></div> : null}
      {children}
      <nav className="mobile-nav" aria-label="Primary mobile navigation">
        {nav.filter(([id]) => mobileNav.includes(id)).map(([id, label, Icon]) => <button key={id} className={active === id ? "active" : ""} onClick={() => navigate(id)} aria-current={active === id ? "page" : undefined}><Icon size={21} weight={active === id ? "fill" : "regular"} /><span>{label.replace(" & companies", "")}</span></button>)}
        <button className={hasSecondaryActive ? "active" : ""} onClick={() => setMenu(true)} aria-label="Open more navigation" aria-expanded={menu}><List size={21} weight={hasSecondaryActive ? "fill" : "regular"} /><span>More</span></button>
      </nav>
    </main>
  </div>;
}

