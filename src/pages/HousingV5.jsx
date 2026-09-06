import { useEffect, useMemo, useState } from "react";
import { Bed } from "@phosphor-icons/react/Bed";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Clock } from "@phosphor-icons/react/Clock";
import { Plus } from "@phosphor-icons/react/Plus";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { Empty, MutationFeedback, PageHead, SearchField, SegmentedControl } from "../components/UI.jsx";
import { loadStaff } from "../lib/operations.js";
import { hasCapability, loadHousingRooms } from "../lib/field-operations.js";
import { loadHousingAssignmentsV2 } from "../lib/housing-context.js";
import { loadHousingArrivalQueue, subscribeToHousingHandoff } from "../lib/housing-handoff.js";
import { RoomDetail, RoomEditor, humanizeRole, initials, roomLocation, sexLabel, waitLabel } from "./HousingDialogsV4.jsx";
import { AssignmentEditorV5 } from "./HousingAssignmentV5.jsx";
import "./field-operations.css";
import "./housing-handoff.css";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const PERSON_BATCH = 60;
const ROOM_BATCH = 24;

export function Housing({ sessionId, participants = [], capabilities = [], sessionName }) {
  const canView = hasCapability(capabilities, "housing_view");
  const canManage = hasCapability(capabilities, "housing_manage");
  const [rooms, setRooms] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [staff, setStaff] = useState([]);
  const [arrivalQueue, setArrivalQueue] = useState([]);
  const [roomQuery, setRoomQuery] = useState("");
  const [roomFilter, setRoomFilter] = useState("all");
  const [roomLimit, setRoomLimit] = useState(ROOM_BATCH);
  const [personQuery, setPersonQuery] = useState("");
  const [personStatus, setPersonStatus] = useState("arrivals");
  const [personType, setPersonType] = useState("all");
  const [personLimit, setPersonLimit] = useState(PERSON_BATCH);
  const [mobileArea, setMobileArea] = useState("queue");
  const [roomOpen, setRoomOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState(null);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [now, setNow] = useState(Date.now());

  const reload = async () => {
    if (!sessionId || !canView) return;
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
  };

  useEffect(() => { reload().catch((err) => setError(err.message || "Unable to load Housing.")); }, [sessionId, canView]);
  useEffect(() => {
    if (!sessionId || !canView) return undefined;
    return subscribeToHousingHandoff(sessionId, () => reload().catch(() => {}));
  }, [sessionId, canView]);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 60000); return () => window.clearInterval(id); }, []);

  const assignedByPerson = useMemo(() => new Map(assignments.map((item) => [`${item.personType}:${item.personId}`, item])), [assignments]);
  const allPeople = useMemo(() => {
    const youth = participants
      .filter((p) => p.isCurrent !== false && p.serverEligibility?.eligible !== false && p.attendanceStatus !== "confirmed_not_attending")
      .map((p) => ({
        id: p.id,
        kind: "participant",
        name: p.fullName || "Participant",
        sex: String(p.sex || "").toLowerCase(),
        unit: p.unit || "",
        company: p.companyName || "",
        group: p.groupName || "",
        context: `Participant · ${p.unit || "Unit not recorded"}`,
      }));
    const leaders = staff.filter((p) => p.isCurrent !== false).map((p) => ({
      id: p.id,
      kind: "staff",
      name: p.name,
      sex: String(p.sex || "").toLowerCase(),
      unit: p.unit || "",
      company: p.companyName || "",
      group: p.groupName || "",
      context: `Staff · ${humanizeRole(p.operationalRole)} · ${p.unit || "Unit not recorded"}`,
    }));
    return [...youth, ...leaders].sort((a, b) => collator.compare(a.name, b.name));
  }, [participants, staff]);

  const waitingPeople = useMemo(() => arrivalQueue.map((q) => ({
    id: q.participantId,
    kind: "participant",
    name: q.name,
    sex: String(q.sex || "").toLowerCase(),
    unit: q.unit || "",
    company: q.company || "",
    group: q.group || "",
    fsyId: q.fsyId || "",
    context: [q.fsyId, q.group, q.company, q.unit].filter(Boolean).join(" · ") || "Checked-in participant",
    queue: true,
    checkedInAt: q.checkedInAt,
    waitLabel: waitLabel(q.checkedInAt, now),
  })).sort((a, b) => new Date(a.checkedInAt || 0) - new Date(b.checkedInAt || 0)), [arrivalQueue, now]);

  const assignedPeople = allPeople.filter((p) => assignedByPerson.has(`${p.kind}:${p.id}`));
  const assignedCount = assignedPeople.length;
  const unassignedCount = Math.max(0, allPeople.length - assignedCount);
  const totalBeds = rooms.reduce((sum, room) => sum + room.capacity, 0);
  const occupied = rooms.reduce((sum, room) => sum + room.occupancy, 0);
  const openSpaces = Math.max(0, totalBeds - occupied);
  const openRooms = rooms.filter((room) => room.occupancy < room.capacity).length;
  const fullRooms = rooms.length - openRooms;
  const oldestWaiting = waitingPeople[0]?.waitLabel || "No one waiting";

  const filteredRooms = useMemo(() => {
    const text = roomQuery.trim().toLowerCase();
    return rooms
      .filter((room) => roomFilter === "all" || (roomFilter === "open" ? room.occupancy < room.capacity : room.occupancy >= room.capacity))
      .filter((room) => !text || `${room.name} ${room.building} ${room.floor}`.toLowerCase().includes(text))
      .sort((a, b) => collator.compare(a.name, b.name));
  }, [rooms, roomQuery, roomFilter]);

  const filteredPeople = useMemo(() => {
    const text = personQuery.trim().toLowerCase();
    let base;
    if (personStatus === "arrivals") base = waitingPeople;
    else if (personStatus === "assigned") base = allPeople.filter((person) => assignedByPerson.has(`${person.kind}:${person.id}`));
    else base = allPeople.filter((person) => !assignedByPerson.has(`${person.kind}:${person.id}`));
    return base
      .filter((person) => personStatus === "arrivals" || personType === "all" || person.kind === personType)
      .filter((person) => !text || `${person.name} ${person.context}`.toLowerCase().includes(text));
  }, [personStatus, waitingPeople, allPeople, assignedByPerson, personType, personQuery]);

  const visibleRooms = filteredRooms.slice(0, roomLimit);
  const visiblePeople = filteredPeople.slice(0, personLimit);

  const chooseMobileArea = (next) => {
    setMobileArea(next);
    setPersonQuery("");
    setPersonLimit(PERSON_BATCH);
    if (next === "queue") setPersonStatus("arrivals");
    if (next === "assigned") setPersonStatus("assigned");
  };

  if (!canView) return <section className="page"><PageHead title="Housing" sessionName={sessionName} description="Housing access is assigned by an FSY administrator."/><article className="panel"><Empty icon={Bed} title="Housing is not in your access" text="Ask an administrator to add the Housing team to your account if this is part of your assignment."/></article></section>;

  return <section className="page housing-v5">
    <PageHead title="Housing" sessionName={sessionName} description="Assign rooms to checked-in arrivals. The queue updates automatically from Registration." action={canManage ? <button className="primary" onClick={() => setRoomOpen(true)}><Plus/>Add room</button> : null}/>
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
    {saved ? <MutationFeedback>{saved}</MutationFeedback> : null}

    <div className={`housing-v5-live${waitingPeople.length ? " attention" : ""}`} role="status" aria-live="polite">
      <div><span className="kicker">Live from Registration</span><b>{waitingPeople.length ? `${waitingPeople.length} waiting for rooms` : "No arrivals waiting"}</b><small>{waitingPeople.length ? `${oldestWaiting} · oldest first` : "New checked-in arrivals appear here automatically."}</small></div>
      <div className="housing-v5-live-stats"><span><b>{openSpaces}</b><small>spaces open</small></span><span><b>{openRooms}</b><small>rooms open</small></span></div>
    </div>

    <div className="housing-v5-mobile-tabs" role="tablist" aria-label="Housing work">
      <button type="button" role="tab" aria-selected={mobileArea === "queue"} className={mobileArea === "queue" ? "active" : ""} onClick={() => chooseMobileArea("queue")}><span>Arrivals</span><b>{waitingPeople.length}</b></button>
      <button type="button" role="tab" aria-selected={mobileArea === "rooms"} className={mobileArea === "rooms" ? "active" : ""} onClick={() => chooseMobileArea("rooms")}><span>Rooms</span><b>{openRooms}</b></button>
      <button type="button" role="tab" aria-selected={mobileArea === "assigned"} className={mobileArea === "assigned" ? "active" : ""} onClick={() => chooseMobileArea("assigned")}><span>Assigned</span><b>{assignedCount}</b></button>
    </div>

    <div className="housing-v5-metrics" aria-label="Housing summary">
      <span><b>{waitingPeople.length}</b><small>waiting</small></span>
      <span><b>{openSpaces}</b><small>spaces open</small></span>
      <span><b>{openRooms}</b><small>rooms open</small></span>
      <span><b>{assignedCount}</b><small>assigned</small></span>
    </div>

    <details className="housing-v4-coverage housing-v5-coverage"><summary><span><b>Overall housing coverage</b><small>{unassignedCount.toLocaleString()} people have no room across the full roster</small></span><span>+</span></summary><div><p>This includes people who have not arrived yet and staff. During live arrival, start with the checked-in queue.</p></div></details>

    <div className="housing-v5-layout">
      <article className={`panel housing-v5-panel housing-v5-people${mobileArea === "rooms" ? " mobile-hidden" : ""}`}>
        <div className="housing-v5-panel-head"><div><span className="kicker">Assignments</span><h2>{personStatus === "arrivals" ? "Arrivals waiting" : personStatus === "needs" ? "People needing rooms" : "Assigned people"}</h2><p>{personStatus === "arrivals" ? "Oldest waiting participants appear first." : personStatus === "needs" ? "Use this broader list for pre-arrival planning and staff housing." : "Review or change existing room assignments."}</p></div><UserPlus size={22}/></div>
        <div className="housing-v5-person-controls">
          <SearchField value={personQuery} onChange={(value) => { setPersonQuery(value); setPersonLimit(PERSON_BATCH); }} label="Find person" placeholder={personStatus === "arrivals" ? "Search waiting arrivals" : "Search name or assignment"}/>
          <div className="housing-v5-desktop-status"><SegmentedControl label="Housing work" value={personStatus} onChange={(value) => { setPersonStatus(value); setPersonLimit(PERSON_BATCH); }} options={[{ value: "arrivals", label: "Arrivals waiting", count: waitingPeople.length }, { value: "needs", label: "Need room", count: unassignedCount }, { value: "assigned", label: "Assigned", count: assignedCount }]}/></div>
          {personStatus !== "arrivals" ? <label className="housing-v4-type"><span>People</span><select value={personType} onChange={(event) => { setPersonType(event.target.value); setPersonLimit(PERSON_BATCH); }}><option value="all">Everyone</option><option value="participant">Participants</option><option value="staff">Staff</option></select></label> : null}
        </div>

        <div className="housing-v5-person-list">
          {visiblePeople.map((person, index) => {
            const assignment = assignedByPerson.get(`${person.kind}:${person.id}`);
            return <button type="button" key={`${person.kind}:${person.id}`} className={person.queue && index === 0 ? "priority" : ""} disabled={!canManage} onClick={() => canManage && setSelected({ person, assignment })}>
              <span className="person-avatar">{initials(person.name)}</span>
              <span className="copy"><b>{person.name}</b><small>{person.context}</small>{person.queue ? <em><Clock/>{person.waitLabel}</em> : null}</span>
              <span className="assignment">{assignment ? <><b>{assignment.roomName}</b><small>{assignment.bedLabel ? `Bed / key ${assignment.bedLabel}` : "Assigned"}</small></> : person.queue ? <><b>Assign room</b><small>{index === 0 ? "Next in queue" : "From Registration"}</small></> : <><b>Needs room</b><small>Not assigned</small></>}</span>
            </button>;
          })}
          {!filteredPeople.length ? <Empty icon={CheckCircle} title={personStatus === "arrivals" ? "No arrivals are waiting" : "No people match this view"} text={personStatus === "arrivals" ? "New checked-in arrivals will appear here automatically." : "Try another search or filter."}/> : null}
        </div>
        {filteredPeople.length > visiblePeople.length ? <button type="button" className="secondary housing-v5-more" onClick={() => setPersonLimit((value) => value + PERSON_BATCH)}>Show {Math.min(PERSON_BATCH, filteredPeople.length - personLimit)} more</button> : null}
        <details className="housing-v5-prearrival"><summary><span><b>Planning before arrival</b><small>Participants and staff who still need rooms</small></span><span>+</span></summary><div><button type="button" className="secondary" onClick={() => { setPersonStatus("needs"); setPersonQuery(""); }}>View {unassignedCount} people needing rooms</button></div></details>
      </article>

      <article className={`panel housing-v5-panel housing-v5-rooms${mobileArea !== "rooms" ? " mobile-hidden" : ""}`}>
        <div className="housing-v5-panel-head"><div><span className="kicker">Rooms</span><h2>Room map</h2><p>{rooms.length ? `${rooms.length} rooms · ${openRooms} with space · ${fullRooms} full` : "Add rooms before assignments begin."}</p></div><Buildings size={22}/></div>
        <div className="housing-v5-room-controls"><SearchField value={roomQuery} onChange={(value) => { setRoomQuery(value); setRoomLimit(ROOM_BATCH); }} label="Search rooms" placeholder="Room, building or floor"/><label><span>Availability</span><select value={roomFilter} onChange={(event) => { setRoomFilter(event.target.value); setRoomLimit(ROOM_BATCH); }}><option value="all">All rooms · {rooms.length}</option><option value="open">Spaces available · {openRooms}</option><option value="full">Full · {fullRooms}</option></select></label></div>
        <div className="housing-v5-room-grid">
          {visibleRooms.map((room) => { const open = Math.max(0, room.capacity - room.occupancy); return <button type="button" key={room.id} className="housing-v5-room-card" onClick={() => setSelectedRoom(room)}><span><b>{room.name}</b><small>{roomLocation(room)}</small></span><span className="capacity"><strong>{room.occupancy}/{room.capacity}</strong><small>{open ? `${open} open` : "Full"}</small></span><i><span style={{ width: `${Math.min(100, (room.occupancy / Math.max(1, room.capacity)) * 100)}%` }}/></i><em>{room.sex ? `${sexLabel(room.sex)} housing` : "Unrestricted"}</em></button>; })}
          {!filteredRooms.length ? <Empty icon={Bed} title={rooms.length ? "No rooms match" : "No rooms yet"} text={rooms.length ? "Try another search or availability filter." : "Add the first room before assigning people."}/> : null}
        </div>
        {filteredRooms.length > visibleRooms.length ? <button type="button" className="secondary housing-v5-more" onClick={() => setRoomLimit((value) => value + ROOM_BATCH)}>Show {Math.min(ROOM_BATCH, filteredRooms.length - roomLimit)} more rooms</button> : null}
      </article>
    </div>

    {roomOpen ? <RoomEditor sessionId={sessionId} onClose={() => setRoomOpen(false)} onSaved={async () => { await reload(); setSaved("Room added."); }}/> : null}
    {editingRoom ? <RoomEditor sessionId={sessionId} room={editingRoom} onClose={() => setEditingRoom(null)} onSaved={async () => { await reload(); setSaved("Room updated."); }}/> : null}
    {selectedRoom ? <RoomDetail room={selectedRoom} assignments={assignments} canManage={canManage} onClose={() => setSelectedRoom(null)} onEdit={() => { setEditingRoom(selectedRoom); setSelectedRoom(null); }}/> : null}
    {selected ? <AssignmentEditorV5 sessionId={sessionId} person={selected.person} rooms={rooms} assignments={assignments} currentAssignment={selected.assignment} onClose={() => setSelected(null)} onSaved={async () => { await reload(); setSaved(`${selected.person.name} housing updated.`); }}/> : null}
  </section>;
}
