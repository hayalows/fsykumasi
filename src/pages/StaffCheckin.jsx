import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { UserCheck } from "@phosphor-icons/react/UserCheck";
import { ActionToast, Empty, MutationFeedback } from "../components/UI.jsx";
import { loadStaffArrivalRoster, recordStaffArrival, subscribeStaffArrivals } from "../lib/staff-checkin.js";
import "./staff-checkin.css";

const ROLE_LABELS = {
  counselor: "Counselor",
  assistant_coordinator: "Assistant coordinator",
  coordinator: "Coordinator",
  committee_member: "Committee member",
  logistics_admin: "Logistical administrator",
  session_director: "Session directing couple",
  area_advisory_couple: "FSY area advisory couple",
  other: "Staff",
};

function searchable(person) {
  return [person.name, person.preferredName, person.unit, person.stake, ROLE_LABELS[person.operationalRole], person.assignmentLabel, ...(person.committeeDuties || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function initials(name = "FSY") {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

export function StaffCheckin({ sessionId, live = false }) {
  const [staff, setStaff] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("expected");
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (!sessionId) return;
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const next = await loadStaffArrivalRoster(sessionId);
      setStaff(next);
      setError("");
    } catch (err) {
      setError(err.message || "Staff arrivals could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      setLoading(false);
      return undefined;
    }
    void refresh();
    const unsubscribe = subscribeStaffArrivals(sessionId, () => void refresh({ quiet: true }));
    return unsubscribe;
  }, [sessionId, refresh]);

  const counts = useMemo(() => {
    const current = staff.filter((person) => person.isCurrent !== false && person.registrationStatus !== "cancelled");
    return {
      all: current.length,
      arrived: current.filter((person) => person.arrivalState === "arrived").length,
      expected: current.filter((person) => person.arrivalState === "expected").length,
      confirmation: current.filter((person) => person.arrivalState === "arrived" && person.serviceClearance !== "cleared").length,
    };
  }, [staff]);

  const visible = useMemo(() => {
    const text = query.trim().toLowerCase();
    return staff
      .filter((person) => person.isCurrent !== false && person.registrationStatus !== "cancelled")
      .filter((person) => filter === "all" || person.arrivalState === filter)
      .filter((person) => !text || searchable(person).includes(text))
      .sort((a, b) => {
        const arrivalOrder = { expected: 0, arrived: 1, no_show: 2, left: 3 };
        const stateDiff = (arrivalOrder[a.arrivalState] ?? 9) - (arrivalOrder[b.arrivalState] ?? 9);
        return stateDiff || a.name.localeCompare(b.name);
      });
  }, [staff, query, filter]);

  const changeArrival = async (person, arrival) => {
    setBusyId(person.id);
    setError("");
    try {
      await recordStaffArrival(person, arrival);
      await refresh({ quiet: true });
      if (arrival === "arrived") {
        setNotice(`${person.name} is now marked present at the session.`);
      } else {
        setNotice(`${person.name}'s staff check-in was undone.`);
      }
    } catch (err) {
      const message = String(err?.message || "Staff check-in could not be saved.");
      if (/record_staff_arrival_v1|function .* does not exist/i.test(message)) {
        setError("Staff check-in is not active on the session database yet. Ask an administrator to finish the staff-arrival update before using this desk.");
      } else if (/changed\. refresh|revision/i.test(message)) {
        await refresh({ quiet: true });
        setError("This staff record changed on another device. The latest status is now shown.");
      } else {
        setError(message);
      }
    } finally {
      setBusyId("");
    }
  };

  return <section className="staff-checkin" aria-label="Staff check-in desk">
    <div className="staff-checkin-heading">
      <div>
        <span className="kicker">Staff arrival</span>
        <h2>Who is actually on site?</h2>
        <p>Search a staff member and mark them present. Registration records arrival only. Staff readiness and responsibilities stay with session leadership.</p>
      </div>
      {refreshing ? <small role="status">Updating…</small> : null}
    </div>

    <div className="staff-checkin-summary" aria-label="Staff arrival summary">
      <button type="button" className={filter === "arrived" ? "active" : ""} onClick={() => setFilter("arrived")}>
        <b>{counts.arrived}</b><span>On site</span>
      </button>
      <button type="button" className={filter === "expected" ? "active" : ""} onClick={() => setFilter("expected")}>
        <b>{counts.expected}</b><span>Still expected</span>
      </button>
      <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
        <b>{counts.all}</b><span>Total staff</span>
      </button>
      <div className={counts.confirmation ? "attention" : ""}>
        <b>{counts.confirmation}</b><span>Present, needs confirmation</span>
      </div>
    </div>

    <div className="staff-checkin-search">
      <MagnifyingGlass aria-hidden="true" />
      <label htmlFor="staff-checkin-query">Find staff member</label>
      <input id="staff-checkin-query" type="search" inputMode="search" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, ward, branch or responsibility" />
      {query ? <button type="button" onClick={() => setQuery("")}>Clear</button> : null}
    </div>

    {error ? <MutationFeedback tone="error" className="staff-checkin-error">{error}</MutationFeedback> : null}

    {loading ? <div className="staff-checkin-loading" role="status" aria-live="polite"><span aria-hidden="true" />Loading staff arrivals…</div> : visible.length ? <div className="staff-checkin-list" aria-live="polite">
      {visible.map((person) => {
        const present = person.arrivalState === "arrived";
        const blocked = ["no_show", "left"].includes(person.arrivalState);
        const role = ROLE_LABELS[person.operationalRole] || "Staff";
        const location = [person.unit, person.stake].filter(Boolean).join(" · ");
        const assignment = person.assignmentLabel || role;
        return <article className={`staff-checkin-row ${present ? "is-present" : ""}`} key={person.id}>
          <span className="staff-checkin-avatar" aria-hidden="true">{initials(person.name)}</span>
          <div className="staff-checkin-person">
            <div className="staff-checkin-name-line"><b>{person.name}</b>{present ? <span className="staff-checkin-present"><CheckCircle weight="fill" /> Present</span> : null}</div>
            <span>{assignment}</span>
            {location ? <small>{location}</small> : null}
            {present && person.serviceClearance !== "cleared" ? <small className="staff-checkin-confirmation">Needs leadership confirmation before active service</small> : null}
            {blocked ? <small className="staff-checkin-confirmation">{person.arrivalState === "no_show" ? "Recorded as did not arrive" : "Recorded as left the session"}</small> : null}
          </div>
          <div className="staff-checkin-action">
            {present ? <button type="button" className="staff-checkin-undo" disabled={busyId === person.id} onClick={() => changeArrival(person, "expected")}>{busyId === person.id ? "Saving…" : "Undo"}</button>
              : blocked ? <span className="staff-checkin-locked">Manage in Staff status</span>
                : <button type="button" className="primary" disabled={busyId === person.id} onClick={() => changeArrival(person, "arrived")}><UserCheck aria-hidden="true" />{busyId === person.id ? "Checking in…" : "Check in"}</button>}
          </div>
        </article>;
      })}
    </div> : <Empty title={query ? "No staff found" : filter === "expected" ? "Nobody is still expected" : filter === "arrived" ? "No staff checked in yet" : "No staff found"} text={query ? "Check the spelling or search by ward, branch, or responsibility." : filter === "expected" ? "Everyone in the current staff roster has an arrival status." : "Change the filter or refresh this desk."} />}

    {!live ? <p className="staff-checkin-demo-note">This desk is connected to the selected session when live data is available.</p> : null}
    <ActionToast message={notice} onDismiss={() => setNotice("")} />
  </section>;
}
