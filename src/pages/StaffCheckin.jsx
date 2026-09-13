import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { UserCheck } from "@phosphor-icons/react/UserCheck";
import { OnSiteStaffSheet } from "../components/OnSiteStaffSheet.jsx";
import { ActionToast, Empty, MutationFeedback, SearchField } from "../components/UI.jsx";
import { addStaffFromCheckin, loadStaffArrivalRoster, recordStaffArrival, subscribeStaffArrivals } from "../lib/staff-checkin.js";
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

function isActiveRosterRecord(person) {
  return person.isCurrent !== false && person.registrationStatus !== "cancelled";
}

function inactiveReason(person) {
  if (person.registrationStatus === "cancelled") return "Cancelled registration";
  if (person.isCurrent === false) return "Older or non-current staff record";
  return "Not in the current staff roster";
}

export function StaffCheckin({ sessionId, live = false, capabilities = [] }) {
  const [staff, setStaff] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("expected");
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [undoTarget, setUndoTarget] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const searchRef = useRef(null);

  const canAddOnSite = live && (capabilities.includes("registration_manage") || capabilities.includes("staff_manage"));

  const focusSearch = useCallback(() => {
    window.requestAnimationFrame(() => searchRef.current?.focus?.());
  }, []);

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (!sessionId) return [];
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const next = await loadStaffArrivalRoster(sessionId);
      setStaff(next);
      setError("");
      return next;
    } catch (err) {
      setError(err.message || "Staff arrivals could not be loaded.");
      return null;
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
    const current = staff.filter(isActiveRosterRecord);
    return {
      all: current.length,
      arrived: current.filter((person) => person.arrivalState === "arrived").length,
      expected: current.filter((person) => person.arrivalState === "expected").length,
      confirmation: current.filter((person) => person.arrivalState === "arrived" && person.serviceClearance !== "cleared").length,
    };
  }, [staff]);

  const searching = Boolean(query.trim());
  const searchMatches = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return [];
    return staff.filter((person) => searchable(person).includes(text));
  }, [staff, query]);

  const inactiveMatches = useMemo(() => searchMatches.filter((person) => !isActiveRosterRecord(person)), [searchMatches]);

  const visible = useMemo(() => {
    const text = query.trim().toLowerCase();
    return staff
      .filter(isActiveRosterRecord)
      .filter((person) => text || filter === "all" || person.arrivalState === filter)
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
      const next = await refresh({ quiet: true });
      if (arrival === "arrived") {
        const current = next?.find((item) => item.id === person.id) || { ...person, arrivalState: "arrived", operationsRevision: Number(person.operationsRevision || 0) + 1 };
        setUndoTarget(current);
        setNotice(`${person.name} checked in.`);
        setQuery("");
        setFilter("expected");
        focusSearch();
      } else {
        setUndoTarget(null);
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

  const handleOnSiteSaved = async (staffId) => {
    const roster = await refresh({ quiet: true });
    const person = roster?.find((item) => item.id === staffId);
    if (!person) {
      setError("The staff record was added, but this desk could not reload it. Search the name again and tap Check in.");
      return;
    }

    try {
      await recordStaffArrival(person, "arrived");
      const next = await refresh({ quiet: true });
      const current = next?.find((item) => item.id === staffId) || { ...person, arrivalState: "arrived", operationsRevision: Number(person.operationsRevision || 0) + 1 };
      setUndoTarget(current);
      setNotice(`${person.name} was added and checked in. Leadership confirmation is still required.`);
      setQuery("");
      setFilter("expected");
      focusSearch();
    } catch (err) {
      await refresh({ quiet: true });
      setError(`The staff record was added, but check-in did not finish. Search the name and tap Check in. ${err?.message || ""}`.trim());
    }
  };

  const dismissNotice = () => {
    setNotice("");
    setUndoTarget(null);
  };

  const undoLastCheckin = async () => {
    if (!undoTarget) return;
    await changeArrival(undoTarget, "expected");
    focusSearch();
  };

  const missingRosterMatch = searching && visible.length === 0 && inactiveMatches.length === 0;

  return <section className="staff-checkin" aria-label="Staff check-in desk">
    <div className="staff-checkin-heading">
      <div>
        <span className="kicker">Staff arrival</span>
        <h2>Who is actually on site?</h2>
        <p>Search, confirm the person, and check them in. Registration records arrival only. Staff readiness and responsibilities stay with session leadership.</p>
      </div>
      {refreshing ? <small role="status">Updating…</small> : null}
    </div>

    <div className="staff-checkin-summary" aria-label="Staff arrival summary">
      <button type="button" className={filter === "expected" && !searching ? "active" : ""} aria-pressed={filter === "expected" && !searching} onClick={() => { setQuery(""); setFilter("expected"); }}>
        <b>{counts.expected}</b><span>Still expected</span>
      </button>
      <button type="button" className={filter === "arrived" && !searching ? "active" : ""} aria-pressed={filter === "arrived" && !searching} onClick={() => { setQuery(""); setFilter("arrived"); }}>
        <b>{counts.arrived}</b><span>Checked in</span>
      </button>
      <button type="button" className={filter === "all" && !searching ? "active" : ""} aria-pressed={filter === "all" && !searching} onClick={() => { setQuery(""); setFilter("all"); }}>
        <b>{counts.all}</b><span>Total staff</span>
      </button>
      <div className={counts.confirmation ? "attention" : ""}>
        <b>{counts.confirmation}</b><span>Present, needs confirmation</span>
      </div>
    </div>

    <div className="staff-checkin-search">
      <div className="staff-checkin-search-copy"><b>Find staff member</b><span>Search by name, ward, branch or responsibility.</span></div>
      <SearchField inputRef={searchRef} value={query} onChange={setQuery} label="Find staff member" placeholder="Name, ward, branch or responsibility" className="staff-checkin-search-field" />
    </div>
    {searching ? <div className="staff-checkin-search-scope" role="status"><span><b>Searching every staff record</b><small>Current and inactive records are checked so the same person is not added twice.</small></span><button type="button" className="text-action" onClick={() => { setQuery(""); focusSearch(); }}>Clear</button></div> : null}

    {error ? <MutationFeedback tone="error" className="staff-checkin-error">{error}</MutationFeedback> : null}

    {loading ? <div className="staff-checkin-loading" role="status" aria-live="polite"><span aria-hidden="true" />Loading staff arrivals…</div> : <>
      {visible.length ? <div className="staff-checkin-list" aria-live="polite">
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
              {present ? <button type="button" className="staff-checkin-undo" disabled={busyId === person.id} onClick={() => changeArrival(person, "expected")}>{busyId === person.id ? "Saving…" : "Undo check-in"}</button>
                : blocked ? <span className="staff-checkin-locked">Manage in Staff status</span>
                  : <button type="button" className="primary" disabled={busyId === person.id} onClick={() => changeArrival(person, "arrived")}><UserCheck aria-hidden="true" />{busyId === person.id ? "Checking in…" : "Check in"}</button>}
            </div>
          </article>;
        })}
      </div> : null}

      {searching && inactiveMatches.length ? <section className="staff-checkin-inactive" aria-label="Matching inactive staff records">
        <div className="staff-checkin-inactive-heading">
          <b>Existing record needs review</b>
          <span>Do not add this person again. A coordinator or staff administrator should correct the roster status first.</span>
        </div>
        {inactiveMatches.map((person) => <div className="staff-checkin-inactive-row" key={person.id}>
          <span className="staff-checkin-avatar" aria-hidden="true">{initials(person.name)}</span>
          <span><b>{person.name}</b><small>{inactiveReason(person)}{person.unit ? ` · ${person.unit}` : ""}</small></span>
        </div>)}
      </section> : null}

      {missingRosterMatch ? <div className="staff-checkin-missing">
        <b>This person is not on the staff roster.</b>
        <span>Check the spelling first. If they are physically here and should serve, add a provisional staff record and check them in from this desk.</span>
        {canAddOnSite && query.trim().length >= 3 ? <button type="button" className="primary" onClick={() => setAddOpen(true)}>Add staff on site</button> : null}
        {!canAddOnSite ? <small>Ask a coordinator or staff administrator to add the staff record.</small> : null}
      </div> : null}

      {!searching && !visible.length ? <Empty title={filter === "expected" ? "Nobody is still expected" : filter === "arrived" ? "No staff checked in yet" : "No staff found"} text={filter === "expected" ? "Everyone in the current staff roster has an arrival status." : "Change the filter or refresh this desk."} /> : null}
    </>}

    {!live ? <p className="staff-checkin-demo-note">This desk is connected to the selected session when live data is available.</p> : null}
    {addOpen ? <OnSiteStaffSheet
      staff={staff}
      sessionId={sessionId}
      initialQuery={query}
      createStaff={addStaffFromCheckin}
      title="Add staff on site"
      submitLabel="Add & check in"
      helperText="This creates a provisional staff record and records the person as present. Leadership confirmation is still required before active service."
      onSaved={handleOnSiteSaved}
      onClose={() => setAddOpen(false)}
    /> : null}
    <ActionToast message={notice} actionLabel="Undo" onAction={undoTarget ? undoLastCheckin : undefined} onDismiss={dismissNotice} busy={Boolean(undoTarget && busyId === undoTarget.id)} />
  </section>;
}
