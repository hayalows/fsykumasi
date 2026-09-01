import { useState } from "react";
import { Bell } from "@phosphor-icons/react/Bell";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { ClipboardText } from "@phosphor-icons/react/ClipboardText";
import { IdentificationCard } from "@phosphor-icons/react/IdentificationCard";
import { List } from "@phosphor-icons/react/List";
import { SignOut } from "@phosphor-icons/react/SignOut";
import { SquaresFour } from "@phosphor-icons/react/SquaresFour";
import { Users } from "@phosphor-icons/react/Users";
import { X } from "@phosphor-icons/react/X";
import { BrandMark } from "./BrandMark.jsx";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { roleLabel } from "../lib/access.js";

const nav = [
  ["overview", "Overview", SquaresFour],
  ["registration", "Registration", IdentificationCard],
  ["groups", "Groups & companies", Buildings],
  ["checkin", "Check-in", CheckCircle],
  ["headcount", "Head count", ClipboardText],
  ["access", "Access", Users],
];

const mobileNav = ["overview", "checkin", "headcount", "groups", "access"];

function initials(name = "FSY") {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

export function AppShell({ active, setActive, attentionCount = 0, currentUser, currentRole = "logistics_admin", onSignOut, children }) {
  const [menu, setMenu] = useState(false);
  const navigate = (id) => {
    setActive(id);
    setMenu(false);
  };
  const displayName = currentUser?.display_name || "Esi Owusu";
  const displayRole = roleLabel(currentRole);
  const avatar = initials(displayName);

  return (
    <div className="app-shell">
      <aside className={menu ? "sidebar open" : "sidebar"}>
        <div className="brand">
          <BrandMark compact />
          <div><b>FSY Kumasi</b><small>Operations</small></div>
          <button className="icon-button sidebar-close" onClick={() => setMenu(false)} aria-label="Close menu"><X /></button>
        </div>
        <div className="session-badge"><span>2026</span><small>Walk With Me · Moses 6:34</small></div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button key={id} className={active === id ? "active" : ""} onClick={() => navigate(id)}>
              <Icon size={20} weight={active === id ? "fill" : "regular"} />
              <span>{label}</span>
              {id === "access" && attentionCount > 0 ? <em>{attentionCount}</em> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="avatar">{avatar}</span>
          <div><b>{displayName}</b><small>{displayRole}</small></div>
          <button className="sidebar-signout" onClick={onSignOut} aria-label="Sign out"><SignOut size={18} /></button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setMenu(true)} aria-label="Open menu"><List /></button>
          <div className="session"><span>FSY Kumasi 2026</span><small>Planning workspace</small></div>
          <div className="top-actions">
            <span className={`connection ${isSupabaseConfigured ? "live" : "demo"}`}>{isSupabaseConfigured ? "Connected" : "Demo data"}</span>
            <button className="icon-button notification-button" aria-label="Notifications"><Bell />{attentionCount > 0 ? <i>{attentionCount}</i> : null}</button>
            <span className="avatar small">{avatar}</span>
          </div>
        </header>
        {children}
        <nav className="mobile-nav">
          {nav.filter(([id]) => mobileNav.includes(id)).map(([id, label, Icon]) => (
            <button key={id} className={active === id ? "active" : ""} onClick={() => navigate(id)}>
              <Icon size={21} weight={active === id ? "fill" : "regular"} />
              <span>{label.replace(" & companies", "")}</span>
              {id === "access" && attentionCount > 0 ? <em>{attentionCount}</em> : null}
            </button>
          ))}
        </nav>
      </main>
    </div>
  );
}
