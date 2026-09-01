import { useMemo, useState } from "react";
import { AppShell } from "./components/AppShell.jsx";
import { createDemoParticipants } from "./data/demo.js";
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
  const demoParticipants = useMemo(() => createDemoParticipants(), []);
  const participants = imported.length ? imported : demoParticipants;
  const pendingAccess = accessRequests.filter((request) => request.status === "pending").length;

  const content = active === "overview"
    ? <Overview setActive={setActive} imported={imported} assignment={assignment} pendingAccess={pendingAccess} />
    : active === "registration"
      ? <Registration imported={imported} setImported={setImported} />
      : active === "groups"
        ? <Groups participants={participants} assignment={assignment} setAssignment={setAssignment} />
        : active === "checkin"
          ? <Checkin participants={participants} />
          : active === "headcount"
            ? <Headcount />
            : <Access requests={accessRequests} setRequests={setAccessRequests} />;

  return <AppShell active={active} setActive={setActive} attentionCount={pendingAccess}>{content}</AppShell>;
}
