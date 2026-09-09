import { PersonName } from "../components/PersonPeek.jsx";
import { matchesPersonSearch } from "../lib/person-search.js";
import { useEffect, useMemo, useState } from "react";
import { Bed } from "@phosphor-icons/react/Bed";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Clock } from "@phosphor-icons/react/Clock";
import { Plus } from "@phosphor-icons/react/Plus";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { ActionToast, Empty, MutationFeedback, PageHead, SearchField, SegmentedControl } from "../components/UI.jsx";
import { loadStaff } from "../lib/operations.js";
import { hasCapability, loadHousingRooms, restoreHousingAssignment } from "../lib/field-operations.js";
import { loadHousingAssignmentsV2 } from "../lib/housing-context.js";
import { loadHousingArrivalQueue, subscribeToHousingHandoff } from "../lib/housing-handoff.js";
import { humanizeRole, initials, roomHasWayfinding, roomLocation, sexLabel, waitLabel } from "./HousingDialogsV4.jsx";
import { RoomEditorV7 } from "./HousingRoomEditorV7.jsx";
import { AssignmentEditorV5 } from "./HousingAssignmentV5.jsx";
import { RoomDetailV6 } from "./HousingRoomDetailV6.jsx";
import "./field-operations.css";
import "./housing-handoff.css";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const PERSON_BATCH = 60;
const ROOM_BATCH = 24;

function normalizeSex(value) {
  const text = String(value || "").trim().toLowerCase();
  if (["male", "m", "boy", "man"].includes(text)) return "male";
  if (["female", "f", "girl", "woman"].includes(text)) return "female";
  return "";
}

function roomHasType(room) {
  return room?.sex === "male" || room?.sex === "female";
}

function roomReady(room) {
  return roomHasType(room) && roomHasWayfinding(room);
}

function openSpace(room) {
  return Math.max(0, Number(room.capacity || 0) - Number(room.occupancy || 0));
}

export function Housing({ sessionId, participants = [], capabilities = [], sessionName, initialArea = "", initialFilter = "" }) {
  const canView = hasCapability(capabilities, "housing_view");
  const canManage = hasCapability(capabilities, "housing_manage");
  const [rooms, setRooms] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [staff, setStaff] = useState([]);
  const [arrivalQueue, setArrivalQueue] = useState([]);
  const [roomQuery, setRoomQuery] = useState("");
  const [roomFilter, setRoomFilter] = useState(initialFilter === "needs-location" ? "incomplete" : "all");
  const [roomUseFilter, setRoomUseFilter] = useState("all");
  const [roomLimit, setRoomLimit] = useState(ROOM_BATCH);
  const [personQuery, setPersonQuery] = useState("");
  const [personStatus, setPersonStatus] = useState(initialArea === "assigned" ? "assigned" : initialArea === "needs" ? "needs" : "arrivals");
  const [personType, setPersonType] = useState("all");
  const [personLimit, setPersonLimit] = useState(PERSON_BATCH);
  const [workspace, setWorkspace] = useState(initialArea === "rooms" ? "rooms" : "people");
  const [roomOpen, setRoomOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState(null);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [undoHousing, setUndoHousing] = useState(null);
  const [undoHousingBusy, setUndoHousingBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const reload = async ({ initial = false } = {}) => {
    if (!sessionId || !canView) return null;
    if (initial) setInitialLoading(true); else setRefreshing(true);
    try {
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
      setError("");
      return { rooms: nextRooms, assignments: nextAssignments, staff: nextStaff, arrivalQueue: nextQueue };
    } catch (err) {
      setError(err.message || "Unable to load Housing.");
      throw err;
    } finally {
      if (initial) setInitialLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!sessionId) {
      setInitialLoading(false);
      setRefreshing(false);
      return undefined;
    }
    reload({ initial: true }).catch(() => {});
    return undefined;
  }, [sessionId, canView]);
  useEffect(() => {
    if (initialArea === "rooms") setWorkspace("rooms");
    else if (initialArea === "assigned") { setWorkspace("people"); setPersonStatus("assigned"); }
    else if (initialArea === "needs") { setWorkspace("people"); setPersonStatus("needs"); }
    else if (initialArea === "arrivals") { setWorkspace("people"); setPersonStatus("arrivals"); }
    if (initialFilter === "needs-location") { setWorkspace("rooms"); setRoomFilter("incomplete"); }
  }, [initialArea, initialFilter]);
  useEffect(() => {
    if (!sessionId || !canView) return undefined;
    return subscribeToHousingHandoff(sessionId, () => reload().catch(() => {}));
  }, [sessionId, canView]);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 60000); return () => window.clearInterval(id); }, []);

  const assignedByPerson = useMemo(() => new Map(assignments.map((item) => [`${item.personType}:${item.personId}`, item])), [assignments]);
  const allPeople = useMemo(() => {
    const youth = participants
      .filter((person) => person.isCurrent !== false && person.serverEligibility?.eligible !== false && person.attendanceStatus !== "confirmed_not_attending")
      .map((person) => ({
        id: person.id,
        kind: "participant",
        name: person.fullName || "Participant",
        sex: normalizeSex(person.sex),
        unit: person.unit || "",
        company: person.companyName || "",
        group: person.groupName || "",
        context: `Participant · ${person.unit || "Unit not recorded"}`,
      }));
    const leaders = staff.filter((person) => person.isCurrent !== false).map((person) => ({
      id: person.id,
      kind: "staff",
      name: person.name,
      sex: normalizeSex(person.sex),
      unit: person.unit || "",
      company: person.companyName || "",
      group: person.groupName || "",
      context: `Staff · ${humanizeRole(person.operationalRole)} · ${person.unit || "Unit not recorded"}`,
    }));
    return [...youth, ...leaders].sort((a, b) => collator.compare(a.name, b.name));
  }, [participants, staff]);

  const waitingPeople = useMemo(() => arrivalQueue.map((item) => ({
    id: item.participantId,
    kind: "participant",
    name: item.name,
    sex: normalizeSex(item.sex),
    unit: item.unit || "",
    company: item.company || "",
    group: item.group || "",
    fsyId: item.fsyId || "",
    context: [item.fsyId, item.group, item.company, item.unit].filter(Boolean).join(" · ") || "Checked-in participant",
    queue: true,
    checkedInAt: item.checkedInAt,
    waitLabel: waitLabel(item.checkedInAt, now),
  })).sort((a, b) => new Date(a.checkedInAt || 0) - new Date(b.checkedInAt || 0)), [arrivalQueue, now]);

  const assignedPeople = allPeople.filter((person) => assignedByPerson.has(`${person.kind}:${person.id}`));
  const assignedCount = assignedPeople.length;
  const unassignedCount = Math.max(0, allPeople.length - assignedCount);
  const assignableRooms = rooms.filter((room) => roomReady(room) && openSpace(room) > 0);
  const assignableOpenSpaces = assignableRooms.reduce((sum, room) => sum + openSpace(room), 0);
  const openRooms = assignableRooms.length;
  const fullRooms = rooms.filter((room) => Number(room.occupancy || 0) >= Number(room.capacity || 0)).length;
  const incompleteRooms = rooms.filter((room) => !roomReady(room)).length;
  const oldestWaiting = waitingPeople[0]?.waitLabel || "No one waiting";

  const availabilityByUse = useMemo(() => {
    const result = {
      all: { spaces: 0, rooms: 0 },
      male: { spaces: 0, rooms: 0 },
      female: { spaces: 0, rooms: 0 },
    };
    rooms.forEach((room) => {
      const spaces = openSpace(room);
      if (!roomReady(room) || spaces < 1) return;
      result.all.spaces += spaces;
      result.all.rooms += 1;
      result[room.sex].spaces += spaces;
      result[room.sex].rooms += 1;
    });
    return result;
  }, [rooms]);

  const filteredRooms = useMemo(() => {
    const text = roomQuery.trim().toLowerCase();
    return rooms
      .filter((room) => {
        if (roomFilter === "open") return roomReady(room) && openSpace(room) > 0;
        if (roomFilter === "full") return Number(room.occupancy || 0) >= Number(room.capacity || 0);
        if (roomFilter === "incomplete") return !roomReady(room);
        return true;
      })
      .filter((room) => roomUseFilter === "all" || room.sex === roomUseFilter)
      .filter((room) => !text || `${room.name} ${room.building} ${room.floor} ${room.sex || "room type missing"}`.toLowerCase().includes(text))
      .sort((a, b) => collator.compare(a.name, b.name));
  }, [rooms, roomQuery, roomFilter, roomUseFilter]);

  const filteredPeople = useMemo(() => {
    const text = personQuery.trim().toLowerCase();
    let base;
    if (personStatus === "arrivals") base = waitingPeople;
    else if (personStatus === "assigned") base = allPeople.filter((person) => assignedByPerson.has(`${person.kind}:${person.id}`));
    else base = allPeople.filter((person) => !assignedByPerson.has(`${person.kind}:${person.id}`));
    return base
      .filter((person) => personStatus === "arrivals" || personType === "all" || person.kind === personType)
      .filter((person) => matchesPersonSearch(person,text,[person.context]));
  }, [personStatus, waitingPeople, allPeople, assignedByPerson, personType, personQuery]);

  const visibleRooms = filteredRooms.slice(0, roomLimit);
  const visiblePeople = filteredPeople.slice(0, personLimit);

  const chooseWorkspace = (next) => {
    setWorkspace(next);
    if (next === "rooms") setRoomLimit(ROOM_BATCH);
    else setPersonLimit(PERSON_BATCH);
  };

  const focusRoomAvailability = (use) => {
    setWorkspace("rooms");
    setRoomFilter("open");
    setRoomUseFilter(use);
    setRoomQuery("");
    setRoomLimit(ROOM_BATCH);
  };

  const undoUnassignment = async () => {
    if (!undoHousing?.assignment?.id) return;
    setUndoHousingBusy(true);
    setError("");
    try {
      await restoreHousingAssignment({ sessionId, assignmentId: undoHousing.assignment.id });
      await reload();
      setUndoHousing(null);
      setSaved(`${undoHousing.assignment.name || "Person"} is back in ${undoHousing.assignment.roomName || "the previous room"}.`);
    } catch (err) {
      setError(err.message || "The previous room assignment could not be restored. Check the current room and person state.");
      setUndoHousing(null);
      await reload().catch(() => {});
    } finally {
      setUndoHousingBusy(false);
    }
  };

  if (!canView) return <section className="page"><PageHead title="Housing" sessionName={sessionName} description="Housing access is assigned by an FSY administrator."/><article className="panel"><Empty icon={Bed} title="Housing is not in your access" text="Ask an administrator to add the Housing team to your account if this is part of your assignment."/></article></section>;

  return <section className="page housing-v5 housing-v6">
    <PageHead title="Housing" sessionName={sessionName} description="Plan rooms before the conference, then place checked-in arrivals quickly as they come in."/>
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
    {saved ? <MutationFeedback>{saved}</MutationFeedback> : null}

    <div className={`housing-v5-live${waitingPeople.length ? " attention" : ""}`} role="status" aria-live="polite" aria-busy={initialLoading || refreshing}>
      <div><span className="kicker">Live from Registration</span><b>{initialLoading ? "Loading Housing…" : waitingPeople.length ? `${waitingPeople.length} waiting for rooms` : "No arrivals waiting"}</b><small>{initialLoading ? "Checking arrivals, rooms and current assignments." : waitingPeople.length ? `${oldestWaiting} · oldest first` : refreshing ? "Updating…" : "New checked-in arrivals appear here automatically."}</small></div>
      <div className="housing-v5-live-stats"><span><b>{assignableOpenSpaces}</b><small>spaces ready</small></span><span><b>{openRooms}</b><small>rooms ready</small></span></div>
    </div>

    {!initialLoading && incompleteRooms ? <div className="housing-location-banner"><WarningCircle/><span><b>{incompleteRooms} {incompleteRooms === 1 ? "room needs" : "rooms need"} setup</b><small>A room needs a Male/Female type and a findable location before Housing can assign someone to it.</small></span><button type="button" className="secondary" onClick={() => { setWorkspace("rooms"); setRoomFilter("incomplete"); setRoomUseFilter("all"); }}>Review rooms</button></div> : null}

    <div className="housing-v5-mobile-tabs housing-v6-workspace-switch" role="tablist" aria-label="Housing workspace">
      <button type="button" role="tab" aria-selected={workspace === "people"} className={workspace === "people" ? "active" : ""} onClick={() => chooseWorkspace("people")}><span>People</span><b>{personStatus === "arrivals" ? waitingPeople.length : personStatus === "needs" ? unassignedCount : assignedCount}</b></button>
      <button type="button" role="tab" aria-selected={workspace === "rooms"} className={workspace === "rooms" ? "active" : ""} onClick={() => chooseWorkspace("rooms")}><span>Rooms</span><b>{assignableOpenSpaces}</b><small>spaces ready</small></button>
    </div>

    <div className="housing-v5-metrics" aria-label="Housing summary">
      <span><b>{initialLoading ? "—" : waitingPeople.length}</b><small>waiting</small></span>
      <button type="button" onClick={() => focusRoomAvailability("all")}><b>{initialLoading ? "—" : assignableOpenSpaces}</b><small>spaces ready</small></button>
      <button type="button" onClick={() => focusRoomAvailability("all")}><b>{initialLoading ? "—" : openRooms}</b><small>rooms with space</small></button>
      <span><b>{initialLoading ? "—" : assignedCount}</b><small>assigned</small></span>
    </div>

    <details className="housing-v4-coverage housing-v5-coverage"><summary><span><b>Overall housing coverage</b><small>{unassignedCount.toLocaleString()} people have no room across the full roster</small></span><span>+</span></summary><div><p>This includes people who have not arrived yet and staff. During live arrival, start with the checked-in queue.</p></div></details>

    <div className="housing-v5-layout housing-v6-layout">
      <article className={`panel housing-v5-panel housing-v5-people${workspace === "rooms" ? " mobile-hidden" : ""}`}>
        <div className="housing-v5-panel-head"><div><span className="kicker">People</span><h2>{personStatus === "arrivals" ? "Arrivals waiting" : personStatus === "needs" ? "People needing rooms" : "Assigned people"}</h2><p>{personStatus === "arrivals" ? "Oldest waiting participants appear first." : personStatus === "needs" ? "Search the full unassigned roster without losing quick access to Rooms." : "Review or change existing room assignments."}</p></div><UserPlus size={22}/></div>
        <div className="housing-v5-person-controls">
          <SearchField value={personQuery} onChange={(value) => { setPersonQuery(value); setPersonLimit(PERSON_BATCH); }} label="Find person" placeholder={personStatus === "arrivals" ? "Search waiting arrivals" : "Search name, group, company or unit"}/>
          <div className="housing-v5-desktop-status"><SegmentedControl label="People status" value={personStatus} onChange={(value) => { setPersonStatus(value); setPersonLimit(PERSON_BATCH); }} options={[{ value: "arrivals", label: "Arrivals waiting", count: waitingPeople.length }, { value: "needs", label: "Need room", count: unassignedCount }, { value: "assigned", label: "Assigned", count: assignedCount }]}/></div>
          {personStatus !== "arrivals" ? <label className="housing-v4-type"><span>People</span><select value={personType} onChange={(event) => { setPersonType(event.target.value); setPersonLimit(PERSON_BATCH); }}><option value="all">Everyone</option><option value="participant">Participants</option><option value="staff">Staff</option></select></label> : null}
        </div>

        <div className="housing-v5-person-list">
          {visiblePeople.map((person, index) => {
            const assignment = assignedByPerson.get(`${person.kind}:${person.id}`);
            return <div key={`${person.kind}:${person.id}`} className={`housing-person-identity-row ${person.queue && index === 0 ? "priority" : ""}`}>
              <span className="person-avatar">{initials(person.name)}</span>
              <span className="copy"><PersonName person={person} kind={person.kind} context={{label:"Housing",value:assignment?.roomName||"Room not assigned"}}/><small>{person.context}</small>{person.queue ? <em><Clock/>{person.waitLabel}</em> : null}</span>
              <button type="button" className="assignment person-name" disabled={!canManage} onClick={()=>setSelected({person,assignment})}>{assignment ? <><b>{assignment.roomName}</b><small>{assignment.bedLabel ? `Bed / key ${assignment.bedLabel}` : "Assigned"}</small></> : person.queue ? <><b>Assign room</b><small>{index === 0 ? "Next in queue" : "From Registration"}</small></> : <><b>Needs room</b><small>Not assigned</small></>}</button>
            </div>;
          })}
          {!filteredPeople.length ? <Empty icon={CheckCircle} title={personStatus === "arrivals" ? "No arrivals are waiting" : "No people match this view"} text={personStatus === "arrivals" ? "New checked-in arrivals will appear here automatically." : "Try another search or filter."}/> : null}
        </div>
        {filteredPeople.length > visiblePeople.length ? <button type="button" className="secondary housing-v5-more" onClick={() => setPersonLimit((value) => value + PERSON_BATCH)}>Show {Math.min(PERSON_BATCH, filteredPeople.length - personLimit)} more</button> : null}
        <details className="housing-v5-prearrival"><summary><span><b>Planning before arrival</b><small>Participants and staff who still need rooms</small></span><span>+</span></summary><div><button type="button" className="secondary" onClick={() => { setPersonStatus("needs"); setPersonQuery(""); }}>View {unassignedCount} people needing rooms</button></div></details>
      </article>

      <article className={`panel housing-v5-panel housing-v5-rooms housing-v6-rooms${workspace !== "rooms" ? " mobile-hidden" : ""}`}>
        <div className="housing-v5-panel-head housing-v5-room-panel-head"><div><span className="kicker">Rooms</span><h2>Rooms & availability</h2><p>{rooms.length ? `${rooms.length} rooms · ${assignableOpenSpaces} assignable spaces · ${fullRooms} full` : "Add rooms before assignments begin."}</p></div>{canManage ? <div className="housing-v5-room-panel-actions"><button type="button" className="primary housing-v5-add-room" onClick={() => setRoomOpen(true)}><Plus/>Add room</button></div> : <Buildings size={22}/>}</div>

        <div className="housing-v6-availability housing-v37-availability" aria-label="Assignable spaces by room type">
          {[{ value: "all", label: "All open" }, { value: "male", label: "Male" }, { value: "female", label: "Female" }].map((option) => {
            const data = availabilityByUse[option.value];
            const active = roomFilter === "open" && roomUseFilter === option.value;
            return <button type="button" key={option.value} className={active ? "active" : ""} aria-pressed={active} onClick={() => focusRoomAvailability(option.value)} disabled={!data.spaces && option.value !== "all"}><span>{option.label}</span><b>{data.spaces}</b><small>{data.rooms} {data.rooms === 1 ? "room" : "rooms"}</small></button>;
          })}
        </div>

        <div className="housing-v5-room-controls housing-v6-room-controls">
          <SearchField value={roomQuery} onChange={(value) => { setRoomQuery(value); setRoomLimit(ROOM_BATCH); }} label="Search rooms" placeholder="Room, building or floor"/>
          <label><span>Availability</span><select value={roomFilter} onChange={(event) => { setRoomFilter(event.target.value); setRoomLimit(ROOM_BATCH); }}><option value="all">All rooms · {rooms.length}</option><option value="open">Spaces available · {openRooms}</option><option value="full">Full · {fullRooms}</option><option value="incomplete">Needs setup · {incompleteRooms}</option></select></label>
        </div>

        {roomUseFilter !== "all" ? <div className="housing-v6-filter-note"><span>Showing {sexLabel(roomUseFilter).toLowerCase()} rooms</span><button type="button" onClick={() => { setRoomUseFilter("all"); setRoomLimit(ROOM_BATCH); }}>Clear room-type filter</button></div> : null}

        <div className="housing-v5-room-grid">
          {visibleRooms.map((room) => {
            const open = openSpace(room);
            const typeReady = roomHasType(room);
            const locationReady = roomHasWayfinding(room);
            const assignable = typeReady && locationReady && open > 0;
            const setupMessage = !typeReady ? "Male/Female needed" : !locationReady ? "Location needed" : "";
            return <button type="button" key={room.id} className={`housing-v5-room-card${roomReady(room) ? "" : " needs-location needs-setup"}${assignable ? " has-space" : ""}`} onClick={() => setSelectedRoom(room)}>
              <span><b>{room.name}</b><small>{roomLocation(room)}</small></span>
              <span className="capacity"><strong>{room.occupancy}/{room.capacity}</strong><small>{setupMessage || (open ? `${open} open` : "Full")}</small></span>
              <i><span style={{ width: `${Math.min(100, (Number(room.occupancy || 0) / Math.max(1, Number(room.capacity || 0))) * 100)}%` }}/></i>
              <em>{typeReady ? `${sexLabel(room.sex)} housing` : "Room type not set"}</em>
            </button>;
          })}
          {!filteredRooms.length ? <Empty icon={Bed} title={rooms.length ? "No rooms match" : "No rooms yet"} text={rooms.length ? "Try another search or availability filter." : "Add the first room here, then begin assigning people."} action={canManage && !rooms.length ? <button type="button" className="primary housing-v5-empty-add-room" onClick={() => setRoomOpen(true)}><Plus/>Add first room</button> : null}/> : null}
        </div>
        {filteredRooms.length > visibleRooms.length ? <button type="button" className="secondary housing-v5-more" onClick={() => setRoomLimit((value) => value + ROOM_BATCH)}>Show {Math.min(ROOM_BATCH, filteredRooms.length - roomLimit)} more rooms</button> : null}
      </article>
    </div>

    {roomOpen ? <RoomEditorV7 sessionId={sessionId} onClose={() => setRoomOpen(false)} onSaved={async () => { await reload(); setSaved("Room added."); }}/> : null}
    {editingRoom ? <RoomEditorV7 sessionId={sessionId} room={editingRoom} onClose={() => setEditingRoom(null)} onSaved={async () => { const next = await reload(); const updated = next?.rooms.find((item) => item.id === editingRoom.id); if (updated) setSelectedRoom(updated); setSaved("Room updated."); }}/> : null}
    {selectedRoom ? <RoomDetailV6
      sessionId={sessionId}
      room={selectedRoom}
      assignments={assignments}
      people={allPeople}
      waitingPeople={waitingPeople}
      canManage={canManage}
      onClose={() => setSelectedRoom(null)}
      onEdit={() => { setEditingRoom(selectedRoom); setSelectedRoom(null); }}
      onRefresh={async () => { const next = await reload(); const updated = next?.rooms.find((item) => item.id === selectedRoom.id); if (updated) setSelectedRoom(updated); }}
      onSaved={async (person) => { const next = await reload(); const updated = next?.rooms.find((item) => item.id === selectedRoom.id); if (updated) setSelectedRoom(updated); setSaved(`${person.name} assigned to ${selectedRoom.name}.`); }}
    /> : null}
    {selected ? <AssignmentEditorV5 sessionId={sessionId} person={selected.person} rooms={rooms} assignments={assignments} currentAssignment={selected.assignment} onClose={() => setSelected(null)} onSaved={async (result) => { await reload(); if (result?.type === "unassigned") { setUndoHousing({ assignment: result.assignment }); setSaved(`${selected.person.name} is no longer assigned to a room.`); } else setSaved(`${selected.person.name} housing updated.`); }}/> : null}
    <ActionToast message={undoHousing ? `${undoHousing.assignment.name || "Person"} unassigned from ${undoHousing.assignment.roomName || "their room"}.` : ""} actionLabel="Undo" onAction={undoUnassignment} onDismiss={() => setUndoHousing(null)} busy={undoHousingBusy}/>
  </section>;
}
