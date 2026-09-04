import { useEffect, useMemo, useState } from "react";
import { Bed } from "@phosphor-icons/react/Bed";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { PencilSimple } from "@phosphor-icons/react/PencilSimple";
import { Plus } from "@phosphor-icons/react/Plus";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { X } from "@phosphor-icons/react/X";
import { DismissibleLayer, Empty, MutationFeedback, PageHead, SearchField, SegmentedControl, Status } from "../components/UI.jsx";
import { loadStaff } from "../lib/operations.js";
import {
  assignHousingPerson,
  clearHousingAssignment,
  createHousingRoomAndAssign,
  hasCapability,
  loadHousingRooms,
  saveHousingRoom,
} from "../lib/field-operations.js";
import { loadHousingAssignmentsV2 } from "../lib/housing-context.js";
import "./field-operations.css";
import "./housing-ux.css";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const PERSON_BATCH = 60;
const ROOM_BATCH = 24;

function initials(name = "FSY") {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function humanizeRole(value = "Staff") {
  return String(value || "Staff").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sexLabel(value) {
  if (value === "female") return "Female";
  if (value === "male") return "Male";
  return "Unrestricted";
}

function checkedInLabel(assignment) {
  if (assignment.personType === "staff") return { tone: "muted", text: "Staff" };
  return assignment.checkinStatus === "arrived" ? { tone: "good", text: "Checked in" } : { tone: "warn", text: "Not checked in" };
}

function roomLocation(room) {
  return [room.building, room.floor].filter(Boolean).join(" · ") || "Location not labelled";
}

function RoomEditor({ sessionId, room = null, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    name: room?.name || "",
    building: room?.building || "",
    floor: room?.floor || "",
    sex: room?.sex || "",
    capacity: room?.capacity || 4,
    notes: room?.notes || "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editing = Boolean(room?.id);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await saveHousingRoom({ ...form, sessionId, roomId: room?.id || null, sex: form.sex || null });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message || "Unable to save this room.");
    } finally {
      setBusy(false);
    }
  };

  return <DismissibleLayer open onClose={onClose} title={editing ? `Edit ${room.name}` : "Add housing room"} sheet className="housing-room-editor-modal">
    <form className="housing-room-editor" onSubmit={save}>
      <header className="housing-modal-header">
        <div><span className="kicker">Housing setup</span><h2>{editing ? "Edit room" : "Add a room"}</h2><p>{editing ? "Update the room without changing who is assigned to it." : "Start with the room name and number of spaces. Add location details only when you need them."}</p></div>
        <button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} aria-label="Close"><X /></button>
      </header>

      <div className="housing-modal-content housing-room-editor-content">
        <div className="housing-primary-fields">
          <label>Room name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Block A · 203" autoFocus /></label>
          <label>Spaces<input required min="1" max="50" type="number" inputMode="numeric" value={form.capacity} onChange={(event) => setForm({ ...form, capacity: event.target.value })} /></label>
        </div>
        <label>Room use<select value={form.sex} onChange={(event) => setForm({ ...form, sex: event.target.value })}><option value="">Unrestricted</option><option value="female">Female</option><option value="male">Male</option></select><small>Use a sex restriction when this room should only house one sex.</small></label>

        <details className="housing-optional-details" open={Boolean(form.building || form.floor || form.notes)}>
          <summary><span><b>Location & notes</b><small>Optional details for finding the room and managing keys.</small></span><span aria-hidden="true">+</span></summary>
          <div>
            <div className="housing-primary-fields"><label>Building<input value={form.building} onChange={(event) => setForm({ ...form, building: event.target.value })} placeholder="Optional" /></label><label>Floor<input value={form.floor} onChange={(event) => setForm({ ...form, floor: event.target.value })} placeholder="Optional" /></label></div>
            <label>Operational note<textarea rows="3" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Optional room, key or location note" /></label>
          </div>
        </details>
        {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      </div>

      <footer className="housing-modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add room"}</button></footer>
    </form>
  </DismissibleLayer>;
}

function AssignmentEditor({ sessionId, person, rooms, currentAssignment, onClose, onSaved }) {
  const [roomId, setRoomId] = useState(currentAssignment?.roomId || "");
  const [bedLabel, setBedLabel] = useState(currentAssignment?.bedLabel || "");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("choose");
  const [newRoom, setNewRoom] = useState({ name: "", capacity: 4, building: "", floor: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const compatibleRooms = useMemo(() => rooms
    .filter((room) => (!room.sex || (person.sex && room.sex === person.sex)) && (room.occupancy < room.capacity || room.id === currentAssignment?.roomId))
    .sort((a, b) => collator.compare(a.name, b.name)), [rooms, person.sex, currentAssignment?.roomId]);

  const visibleRooms = useMemo(() => {
    const text = query.trim().toLowerCase();
    return compatibleRooms.filter((room) => !text || `${room.name} ${room.building} ${room.floor}`.toLowerCase().includes(text));
  }, [compatibleRooms, query]);

  const selectedRoom = rooms.find((room) => room.id === roomId);
  const inferredSex = person.sex || "";

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      if (roomId) await assignHousingPerson({ sessionId, personType: person.kind, personId: person.id, roomId, bedLabel });
      else if (currentAssignment) await clearHousingAssignment({ sessionId, personType: person.kind, personId: person.id });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message || "Unable to save this housing assignment.");
    } finally {
      setBusy(false);
    }
  };

  const createAndAssign = async () => {
    if (!newRoom.name.trim()) {
      setError("Enter a room name first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await createHousingRoomAndAssign({
        sessionId,
        personType: person.kind,
        personId: person.id,
        roomName: newRoom.name,
        building: newRoom.building,
        floor: newRoom.floor,
        capacity: newRoom.capacity,
        notes: newRoom.notes,
        bedLabel,
      });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message || "Unable to create and assign this room.");
    } finally {
      setBusy(false);
    }
  };

  return <DismissibleLayer open onClose={onClose} title={`Housing for ${person.name}`} sheet className="housing-assignment-modal">
    <div className="housing-assignment-shell">
      <header className="housing-modal-header housing-person-header">
        <div className="housing-person-identity"><span className="person-avatar">{initials(person.name)}</span><span><span className="kicker">Housing assignment</span><h2>{person.name}</h2><p>{person.context}</p></span></div>
        <button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} aria-label="Close"><X /></button>
      </header>

      <div className="housing-modal-content housing-assignment-content">
        <aside className="housing-assignment-summary">
          <div className="housing-context-card"><span>Person</span><b>{person.kind === "staff" ? "Staff" : "Participant"}</b><small>{inferredSex ? `${sexLabel(inferredSex)} housing` : "Sex not recorded"}</small></div>
          <div className="housing-context-card"><span>Current room</span><b>{currentAssignment?.roomName || "Not assigned"}</b><small>{currentAssignment?.bedLabel ? `Bed / key ${currentAssignment.bedLabel}` : currentAssignment ? "No bed / key label" : "Needs a room"}</small></div>
          {mode === "choose" && selectedRoom ? <div className="housing-context-card selected-room"><span>Selected</span><b>{selectedRoom.name}</b><small>{roomLocation(selectedRoom)} · {Math.max(0, selectedRoom.capacity - selectedRoom.occupancy)} space{Math.max(0, selectedRoom.capacity - selectedRoom.occupancy) === 1 ? "" : "s"} open</small></div> : null}
          <details className="housing-optional-details compact" open={Boolean(bedLabel)}><summary><span><b>Bed / key label</b><small>Optional</small></span><span aria-hidden="true">+</span></summary><div><label>Bed / key label<input value={bedLabel} onChange={(event) => setBedLabel(event.target.value)} placeholder="e.g. Bed B or Key 203-2" /></label></div></details>
        </aside>

        <section className="housing-room-picker">
          {mode === "choose" ? <>
            <div className="housing-room-picker-head"><div><h3>Choose a room</h3><p>Only rooms that match this person and still have space are shown.</p></div><button type="button" className="secondary housing-create-inline" onClick={() => { setMode("create"); setError(""); }}><Plus />Create new room</button></div>
            <SearchField value={query} onChange={setQuery} label="Search available rooms" placeholder="Search room, building or floor" autoFocus />
            <div className="housing-room-choice-list">
              {visibleRooms.map((room) => {
                const selected = room.id === roomId;
                const open = Math.max(0, room.capacity - room.occupancy);
                return <button type="button" key={room.id} className={selected ? "housing-room-choice selected" : "housing-room-choice"} onClick={() => setRoomId(selected ? "" : room.id)} aria-pressed={selected}>
                  <span><b>{room.name}</b><small>{roomLocation(room)}</small></span>
                  <span><strong>{room.occupancy}/{room.capacity}</strong><small>{open} open</small></span>
                  <span className="housing-room-use">{room.sex ? sexLabel(room.sex) : "Unrestricted"}</span>
                </button>;
              })}
              {!visibleRooms.length ? <div className="housing-no-room-result"><Bed size={28}/><b>{compatibleRooms.length ? "No rooms match that search" : "No available compatible rooms"}</b><p>{compatibleRooms.length ? "Try another room name or clear the search." : `Create a new ${inferredSex ? sexLabel(inferredSex).toLowerCase() : ""} room and assign ${person.name} in one step.`}</p><button type="button" className="primary" onClick={() => setMode("create")}><Plus />Create room for {person.name.split(" ")[0]}</button></div> : null}
            </div>
          </> : <>
            <div className="housing-room-picker-head"><div><span className="kicker">Create & assign</span><h3>New room for {person.name.split(" ")[0]}</h3><p>{inferredSex ? `This room will automatically be ${sexLabel(inferredSex).toLowerCase()} housing because ${person.name.split(" ")[0]} is ${sexLabel(inferredSex).toLowerCase()}.` : "This person's sex is not recorded, so the room will remain unrestricted."}</p></div><button type="button" className="secondary" onClick={() => { setMode("choose"); setError(""); }}>Back to rooms</button></div>
            <div className="housing-create-room-form">
              <div className="housing-primary-fields"><label>Room name<input required value={newRoom.name} onChange={(event) => setNewRoom({ ...newRoom, name: event.target.value })} placeholder="e.g. Block B · 105" autoFocus /></label><label>Spaces<input required min="1" max="50" type="number" inputMode="numeric" value={newRoom.capacity} onChange={(event) => setNewRoom({ ...newRoom, capacity: event.target.value })} /></label></div>
              <div className="housing-inferred-room"><Bed /><span><b>{inferredSex ? `${sexLabel(inferredSex)} room` : "Unrestricted room"}</b><small>Set automatically from the person you are assigning.</small></span></div>
              <details className="housing-optional-details"><summary><span><b>Location & room note</b><small>Optional</small></span><span aria-hidden="true">+</span></summary><div><div className="housing-primary-fields"><label>Building<input value={newRoom.building} onChange={(event) => setNewRoom({ ...newRoom, building: event.target.value })} placeholder="Optional" /></label><label>Floor<input value={newRoom.floor} onChange={(event) => setNewRoom({ ...newRoom, floor: event.target.value })} placeholder="Optional" /></label></div><label>Room note<textarea rows="3" value={newRoom.notes} onChange={(event) => setNewRoom({ ...newRoom, notes: event.target.value })} placeholder="Optional room or key note" /></label></div></details>
            </div>
          </>}
          {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
        </section>
      </div>

      <footer className="housing-modal-actions">
        <button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button>
        {mode === "choose" ? <button type="button" className="primary" onClick={save} disabled={busy || (!roomId && !currentAssignment)}>{busy ? "Saving…" : roomId ? currentAssignment ? "Save room change" : "Assign room" : "Remove assignment"}</button> : <button type="button" className="primary" onClick={createAndAssign} disabled={busy || !newRoom.name.trim()}>{busy ? "Creating…" : "Create room & assign"}</button>}
      </footer>
    </div>
  </DismissibleLayer>;
}

function RoomDetail({ room, assignments, canManage, onClose, onEdit }) {
  const occupants = assignments.filter((assignment) => assignment.roomId === room.id).sort((a, b) => collator.compare(a.name, b.name));
  const openSpaces = Math.max(0, room.capacity - occupants.length);
  const percent = Math.min(100, (occupants.length / Math.max(1, room.capacity)) * 100);

  return <DismissibleLayer open onClose={onClose} title={`${room.name} occupants`} sheet className="housing-room-detail-modal">
    <div className="housing-room-detail-shell">
      <header className="housing-modal-header housing-room-detail-header">
        <div><span className="kicker">Current room</span><h2>{room.name}</h2><p>{roomLocation(room)}</p></div>
        <button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} aria-label="Close"><X /></button>
      </header>

      <div className="housing-modal-content housing-room-detail-content">
        <div className="housing-room-glance">
          <div><span>Occupancy</span><strong>{occupants.length}/{room.capacity}</strong><small>{openSpaces ? `${openSpaces} space${openSpaces === 1 ? "" : "s"} open` : "Room is full"}</small></div>
          <div><span>Room use</span><strong>{room.sex ? sexLabel(room.sex) : "Any"}</strong><small>{room.sex ? `${sexLabel(room.sex)} housing` : "No sex restriction"}</small></div>
          <div className="housing-room-glance-meter"><span style={{ width: `${percent}%` }} /></div>
        </div>
        {room.notes ? <div className="notice compact-notice"><div><b>Room note</b><p>{room.notes}</p></div></div> : null}

        <section className="housing-occupants-section"><div className="housing-section-heading"><div><h3>People in this room</h3><p>{occupants.length ? `${occupants.length} of ${room.capacity} spaces are currently assigned.` : "No one has been assigned to this room yet."}</p></div>{canManage ? <button type="button" className="secondary" onClick={onEdit}><PencilSimple />Edit room</button> : null}</div>
          <div className="room-occupant-list">{occupants.map((assignment) => {
            const state = checkedInLabel(assignment);
            return <div className="room-occupant-row" key={assignment.id}>
              <span className="person-avatar">{initials(assignment.name)}</span>
              <span className="room-occupant-copy"><b>{assignment.name}</b><small>{assignment.personType === "staff" ? `Staff${assignment.company ? ` · ${assignment.company}` : ""}` : [assignment.fsyId, assignment.company, assignment.group].filter(Boolean).join(" · ") || "Participant"}</small>{assignment.bedLabel ? <small>Bed / key: {assignment.bedLabel}</small> : null}</span>
              <span className="room-occupant-state"><Status tone={state.tone}>{state.text}</Status>{assignment.personType !== "staff" && assignment.checkinStatus === "arrived" && assignment.checkedInAt ? <small>Arrival recorded</small> : null}</span>
            </div>;
          })}{!occupants.length ? <div className="room-occupant-empty"><Bed size={28}/><b>No one assigned yet</b><p>This room has {room.capacity} available space{room.capacity === 1 ? "" : "s"}.</p></div> : null}</div>
        </section>
      </div>
    </div>
  </DismissibleLayer>;
}

export function Housing({ sessionId, participants = [], capabilities = [], sessionName }) {
  const canView = hasCapability(capabilities, "housing_view");
  const canManage = hasCapability(capabilities, "housing_manage");
  const [rooms, setRooms] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [staff, setStaff] = useState([]);
  const [roomQuery, setRoomQuery] = useState("");
  const [roomFilter, setRoomFilter] = useState("all");
  const [roomLimit, setRoomLimit] = useState(ROOM_BATCH);
  const [personQuery, setPersonQuery] = useState("");
  const [personStatus, setPersonStatus] = useState("needs");
  const [personType, setPersonType] = useState("all");
  const [personLimit, setPersonLimit] = useState(PERSON_BATCH);
  const [roomOpen, setRoomOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState(null);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const reload = async () => {
    if (!sessionId || !canView) return;
    const [nextRooms, nextAssignments, nextStaff] = await Promise.all([loadHousingRooms(sessionId), loadHousingAssignmentsV2(sessionId), loadStaff(sessionId)]);
    setRooms(nextRooms);
    setAssignments(nextAssignments);
    setStaff(nextStaff);
  };

  useEffect(() => { reload().catch((err) => setError(err.message || "Unable to load Housing.")); }, [sessionId, canView]);

  const assignedByPerson = useMemo(() => new Map(assignments.map((item) => [`${item.personType}:${item.personId}`, item])), [assignments]);
  const allPeople = useMemo(() => {
    const youth = participants
      .filter((person) => person.serverEligibility?.eligible !== false && person.attendanceStatus !== "confirmed_not_attending")
      .map((person) => ({ id: person.id, kind: "participant", name: person.fullName || "Participant", sex: String(person.sex || "").toLowerCase(), context: `Participant · ${person.unit || "Unit not recorded"}` }));
    const leaders = staff
      .filter((person) => person.isCurrent !== false)
      .map((person) => ({ id: person.id, kind: "staff", name: person.name, sex: String(person.sex || "").toLowerCase(), context: `Staff · ${humanizeRole(person.operationalRole)} · ${person.unit || "Unit not recorded"}` }));
    return [...youth, ...leaders].sort((a, b) => collator.compare(a.name, b.name));
  }, [participants, staff]);

  const participantCount = allPeople.filter((person) => person.kind === "participant").length;
  const staffCount = allPeople.length - participantCount;
  const assignedPeople = allPeople.filter((person) => assignedByPerson.has(`${person.kind}:${person.id}`));
  const assignedCount = assignedPeople.length;
  const assignedStaff = assignedPeople.filter((person) => person.kind === "staff").length;
  const unassignedCount = Math.max(0, allPeople.length - assignedCount);
  const totalBeds = rooms.reduce((sum, room) => sum + room.capacity, 0);
  const occupied = rooms.reduce((sum, room) => sum + room.occupancy, 0);
  const openSpaces = Math.max(0, totalBeds - occupied);
  const openRooms = rooms.filter((room) => room.occupancy < room.capacity).length;
  const fullRooms = rooms.length - openRooms;

  const filteredRooms = useMemo(() => {
    const text = roomQuery.trim().toLowerCase();
    return rooms
      .filter((room) => roomFilter === "all" || (roomFilter === "open" ? room.occupancy < room.capacity : room.occupancy >= room.capacity))
      .filter((room) => !text || `${room.name} ${room.building} ${room.floor}`.toLowerCase().includes(text))
      .sort((a, b) => collator.compare(a.name, b.name));
  }, [rooms, roomQuery, roomFilter]);

  const filteredPeople = useMemo(() => {
    const text = personQuery.trim().toLowerCase();
    return allPeople
      .filter((person) => personType === "all" || person.kind === personType)
      .filter((person) => {
        const assigned = assignedByPerson.has(`${person.kind}:${person.id}`);
        return personStatus === "all" || (personStatus === "assigned" ? assigned : !assigned);
      })
      .filter((person) => !text || `${person.name} ${person.context}`.toLowerCase().includes(text));
  }, [allPeople, assignedByPerson, personQuery, personStatus, personType]);

  const visibleRooms = filteredRooms.slice(0, roomLimit);
  const visiblePeople = filteredPeople.slice(0, personLimit);

  const setRoomSearch = (value) => { setRoomQuery(value); setRoomLimit(ROOM_BATCH); };
  const setRoomState = (value) => { setRoomFilter(value); setRoomLimit(ROOM_BATCH); };
  const setPeopleSearch = (value) => { setPersonQuery(value); setPersonLimit(PERSON_BATCH); };
  const setPeopleState = (value) => { setPersonStatus(value); setPersonLimit(PERSON_BATCH); };
  const setPeopleTypeFilter = (value) => { setPersonType(value); setPersonLimit(PERSON_BATCH); };

  const closeRoomDetailForEdit = () => {
    setEditingRoom(selectedRoom);
    setSelectedRoom(null);
  };

  if (!canView) return <section className="page"><PageHead title="Housing" sessionName={sessionName} description="Housing access is assigned by an FSY administrator." /><article className="panel"><Empty icon={Bed} title="Housing is not in your access" text="Ask an administrator to add the Housing team to your account if this is part of your assignment." /></article></section>;

  return <section className="page field-page housing-page">
    <PageHead title="Housing" sessionName={sessionName} description="See every person who needs housing, current room capacity and assignments in one operational view." action={canManage ? <button className="primary" onClick={() => setRoomOpen(true)}><Plus />Add room</button> : null} />
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}{saved ? <MutationFeedback>{saved}</MutationFeedback> : null}

    <div className="housing-metrics" aria-label="Housing coverage">
      <article><span>People to house</span><strong>{allPeople.length.toLocaleString()}</strong><small>{participantCount.toLocaleString()} participants · {staffCount.toLocaleString()} staff</small></article>
      <article><span>Assigned</span><strong>{assignedCount.toLocaleString()}</strong><small>{(assignedCount - assignedStaff).toLocaleString()} participants · {assignedStaff.toLocaleString()} staff</small></article>
      <article className={unassignedCount ? "attention" : "complete"}><span>Need a room</span><strong>{unassignedCount.toLocaleString()}</strong><small>{unassignedCount ? "People still waiting for housing" : "Everyone has a room"}</small></article>
      <article><span>Open spaces</span><strong>{openSpaces.toLocaleString()}</strong><small>{openRooms} open room{openRooms === 1 ? "" : "s"} · {totalBeds.toLocaleString()} total spaces</small></article>
    </div>

    <div className="housing-layout">
      <article className="panel housing-panel housing-rooms-panel">
        <div className="housing-panel-head"><div><span className="kicker">Rooms</span><h2>Room map</h2><p>{rooms.length ? `${rooms.length} rooms · ${openRooms} with space · ${fullRooms} full` : "Add rooms before you start assigning people."}</p></div><Buildings size={22}/></div>
        {canManage ? <button className="secondary housing-mobile-add" onClick={() => setRoomOpen(true)}><Plus />Add room</button> : null}
        <div className="housing-toolbar housing-room-toolbar"><SearchField value={roomQuery} onChange={setRoomSearch} label="Search housing rooms" placeholder="Search rooms" /><SegmentedControl label="Room status" value={roomFilter} onChange={setRoomState} options={[{ value: "all", label: "All", count: rooms.length }, { value: "open", label: "Open", count: openRooms }, { value: "full", label: "Full", count: fullRooms }]} /></div>

        <div className="room-grid housing-room-grid">{visibleRooms.map((room) => {
          const open = Math.max(0, room.capacity - room.occupancy);
          return <button type="button" className={`room-card room-card-button housing-room-card ${open ? "open" : "full"}`} key={room.id} onClick={() => setSelectedRoom(room)} aria-label={`Open ${room.name} occupants`}>
            <div className="housing-room-card-title"><b>{room.name}</b><small>{roomLocation(room)}</small></div>
            <Status tone={open ? "good" : "warn"}>{room.occupancy}/{room.capacity}</Status>
            <div className="room-meter"><i style={{ width: `${Math.min(100, (room.occupancy / Math.max(1, room.capacity)) * 100)}%` }} /></div>
            <div className="housing-room-card-foot"><span>{room.sex ? `${sexLabel(room.sex)} housing` : "Unrestricted"}</span><b>{open ? `${open} open` : "Full"}</b></div>
          </button>;
        })}{!filteredRooms.length ? <Empty icon={Bed} title={rooms.length ? "No rooms match" : "No rooms yet"} text={rooms.length ? "Try another search or room status." : "Add the first room before assigning people."} /> : null}</div>
        {filteredRooms.length > visibleRooms.length ? <button type="button" className="secondary housing-show-more" onClick={() => setRoomLimit((value) => value + ROOM_BATCH)}>Show {Math.min(ROOM_BATCH, filteredRooms.length - visibleRooms.length)} more rooms</button> : null}
      </article>

      <article className="panel housing-panel housing-people-panel">
        <div className="housing-panel-head"><div><span className="kicker">People</span><h2>Room assignments</h2><p>{personStatus === "needs" ? `${unassignedCount.toLocaleString()} people still need a room.` : `${filteredPeople.length.toLocaleString()} people match this view.`}</p></div><UserPlus size={22}/></div>
        <div className="housing-toolbar housing-person-toolbar"><SearchField value={personQuery} onChange={setPeopleSearch} label="Find person for Housing" placeholder="Search participant or staff" /><SegmentedControl label="Assignment status" value={personStatus} onChange={setPeopleState} options={[{ value: "needs", label: "Needs room", count: unassignedCount }, { value: "assigned", label: "Assigned", count: assignedCount }, { value: "all", label: "All", count: allPeople.length }]} /><SegmentedControl label="Person type" value={personType} onChange={setPeopleTypeFilter} className="housing-type-filter" options={[{ value: "all", label: "Everyone" }, { value: "participant", label: "Participants" }, { value: "staff", label: "Staff" }]} /></div>

        <div className="field-person-list housing-person-list">{visiblePeople.map((person) => {
          const assignment = assignedByPerson.get(`${person.kind}:${person.id}`);
          return <button type="button" key={`${person.kind}:${person.id}`} disabled={!canManage} onClick={() => canManage && setSelected({ person, assignment })}>
            <span className="person-avatar">{initials(person.name)}</span>
            <span className="housing-person-copy"><b>{person.name}</b><small>{person.context}</small></span>
            <span className="housing-person-assignment">{assignment ? <><b>{assignment.roomName}</b><small>{assignment.bedLabel ? `Bed / key ${assignment.bedLabel}` : "Assigned"}</small></> : <Status tone="warn">Needs room</Status>}</span>
          </button>;
        })}{!filteredPeople.length ? <div className="housing-person-empty"><UserPlus size={28}/><b>No people match this view</b><p>Try another search or filter.</p></div> : null}</div>
        {filteredPeople.length > visiblePeople.length ? <button type="button" className="secondary housing-show-more" onClick={() => setPersonLimit((value) => value + PERSON_BATCH)}>Show {Math.min(PERSON_BATCH, filteredPeople.length - visiblePeople.length)} more people</button> : null}
      </article>
    </div>

    {roomOpen ? <RoomEditor sessionId={sessionId} onClose={() => setRoomOpen(false)} onSaved={async () => { await reload(); setSaved("Room added."); }} /> : null}
    {editingRoom ? <RoomEditor sessionId={sessionId} room={editingRoom} onClose={() => setEditingRoom(null)} onSaved={async () => { await reload(); setSaved("Room updated."); }} /> : null}
    {selectedRoom ? <RoomDetail room={selectedRoom} assignments={assignments} canManage={canManage} onClose={() => setSelectedRoom(null)} onEdit={closeRoomDetailForEdit} /> : null}
    {selected ? <AssignmentEditor sessionId={sessionId} person={selected.person} rooms={rooms} currentAssignment={selected.assignment} onClose={() => setSelected(null)} onSaved={async () => { await reload(); setSaved("Housing assignment saved."); }} /> : null}
  </section>;
}
