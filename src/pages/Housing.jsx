import { useEffect, useMemo, useState } from "react";
import { Bed } from "@phosphor-icons/react/Bed";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { Plus } from "@phosphor-icons/react/Plus";
import { UserPlus } from "@phosphor-icons/react/UserPlus";
import { X } from "@phosphor-icons/react/X";
import { DismissibleLayer, Empty, MutationFeedback, PageHead, SearchField, Status } from "../components/UI.jsx";
import { loadStaff } from "../lib/operations.js";
import { assignHousingPerson, clearHousingAssignment, hasCapability, loadHousingAssignments, loadHousingRooms, saveHousingRoom } from "../lib/field-operations.js";
import "./field-operations.css";

function initials(name = "FSY") { return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase(); }

function RoomEditor({ sessionId, onClose, onSaved }) {
  const [form, setForm] = useState({ name: "", building: "", floor: "", sex: "", capacity: 4, notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await saveHousingRoom({ ...form, sessionId, sex: form.sex || null });
      await onSaved(); onClose();
    } catch (err) { setError(err.message || "Unable to save this room."); }
    finally { setBusy(false); }
  };
  return <DismissibleLayer open onClose={onClose} title="Add housing room" sheet>
    <form className="field-sheet" onSubmit={save}>
      <button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} aria-label="Close"><X /></button>
      <span className="kicker">Housing setup</span><h2>Add a room</h2><p>Set the operational capacity and, where needed, keep housing separated by sex.</p>
      <div className="field-form-grid"><label>Room name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Block A · 203" /></label><label>Capacity<input required min="1" max="50" type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></label><label>Building<input value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })} placeholder="Optional" /></label><label>Floor<input value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} placeholder="Optional" /></label><label>Room sex<select value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value })}><option value="">Not restricted</option><option value="female">Female</option><option value="male">Male</option></select></label></div>
      <label>Operational note<textarea rows="3" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional room or key note" /></label>
      {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      <div className="field-sheet-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save room"}</button></div>
    </form>
  </DismissibleLayer>;
}

function AssignmentEditor({ sessionId, person, rooms, currentAssignment, onClose, onSaved }) {
  const [roomId, setRoomId] = useState(currentAssignment?.roomId || "");
  const [bedLabel, setBedLabel] = useState(currentAssignment?.bedLabel || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true); setError("");
    try {
      if (roomId) await assignHousingPerson({ sessionId, personType: person.kind, personId: person.id, roomId, bedLabel });
      else if (currentAssignment) await clearHousingAssignment({ sessionId, personType: person.kind, personId: person.id });
      await onSaved(); onClose();
    } catch (err) { setError(err.message || "Unable to save this housing assignment."); }
    finally { setBusy(false); }
  };
  return <DismissibleLayer open onClose={onClose} title="Housing assignment" sheet>
    <div className="field-sheet">
      <button type="button" data-layer-close className="icon-button modal-close" onClick={onClose} aria-label="Close"><X /></button>
      <span className="kicker">Housing assignment</span><h2>{person.name}</h2><p>{person.context}</p>
      <label>Room<select value={roomId} onChange={(e) => setRoomId(e.target.value)}><option value="">Not assigned</option>{rooms.map((room) => <option key={room.id} value={room.id} disabled={room.occupancy >= room.capacity && room.id !== currentAssignment?.roomId}>{room.name} · {room.occupancy}/{room.capacity}{room.sex ? ` · ${room.sex}` : ""}</option>)}</select></label>
      <label>Bed / key label<input value={bedLabel} onChange={(e) => setBedLabel(e.target.value)} placeholder="Optional" /></label>
      {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      <div className="field-sheet-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="button" className="primary" onClick={save} disabled={busy || (!roomId && !currentAssignment)}>{busy ? "Saving…" : roomId ? currentAssignment ? "Move / update" : "Assign room" : "Remove assignment"}</button></div>
    </div>
  </DismissibleLayer>;
}

export function Housing({ sessionId, participants = [], capabilities = [], sessionName }) {
  const canView = hasCapability(capabilities, "housing_view");
  const canManage = hasCapability(capabilities, "housing_manage");
  const [rooms, setRooms] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [staff, setStaff] = useState([]);
  const [query, setQuery] = useState("");
  const [roomOpen, setRoomOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const reload = async () => {
    if (!sessionId || !canView) return;
    const [nextRooms, nextAssignments, nextStaff] = await Promise.all([loadHousingRooms(sessionId), loadHousingAssignments(sessionId), loadStaff(sessionId)]);
    setRooms(nextRooms); setAssignments(nextAssignments); setStaff(nextStaff);
  };
  useEffect(() => { reload().catch((err) => setError(err.message || "Unable to load Housing.")); }, [sessionId, canView]);

  const assignedByPerson = useMemo(() => new Map(assignments.map((item) => [`${item.personType}:${item.personId}`, item])), [assignments]);
  const people = useMemo(() => {
    const youth = participants
      .filter((person) => person.serverEligibility?.eligible !== false && person.attendanceStatus !== "confirmed_not_attending")
      .map((person) => ({ id: person.id, kind: "participant", name: person.fullName, sex: String(person.sex || "").toLowerCase(), context: `${person.unit || "Unit not recorded"}` }));
    const leaders = staff.map((person) => ({ id: person.id, kind: "staff", name: person.name, sex: String(person.sex || "").toLowerCase(), context: `${person.operationalRole || "Staff"} · ${person.unit || "Unit not recorded"}` }));
    const text = query.trim().toLowerCase();
    return [...youth, ...leaders].filter((person) => !text || `${person.name} ${person.context}`.toLowerCase().includes(text)).slice(0, 80);
  }, [participants, staff, query]);
  const unassigned = people.filter((person) => !assignedByPerson.has(`${person.kind}:${person.id}`)).length;
  const totalBeds = rooms.reduce((sum, room) => sum + room.capacity, 0);
  const occupied = assignments.length;

  if (!canView) return <section className="page"><PageHead title="Housing" sessionName={sessionName} description="Housing access is assigned by an FSY administrator." /><article className="panel"><Empty icon={Bed} title="Housing is not in your access" text="Ask an administrator to add the Housing team to your account if this is part of your assignment." /></article></section>;

  return <section className="page field-page">
    <PageHead title="Housing" sessionName={sessionName} description="Keep the current room list, occupancy and person assignments in one place." action={canManage ? <button className="primary" onClick={() => setRoomOpen(true)}><Plus />Add room</button> : null} />
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}{saved ? <MutationFeedback>{saved}</MutationFeedback> : null}
    <div className="field-metrics"><div><span>Rooms</span><strong>{rooms.length}</strong><small>{totalBeds} total spaces</small></div><div><span>Assigned</span><strong>{occupied}</strong><small>{Math.max(0, totalBeds - occupied)} spaces open</small></div><div><span>People in view</span><strong>{people.length}</strong><small>{unassigned} currently unassigned</small></div></div>
    <div className="field-layout">
      <article className="panel"><div className="panel-head"><div><span className="kicker">Current rooms</span><h2>Housing map</h2></div><Buildings size={22}/></div>
        <div className="room-grid">{rooms.map((room) => <div className="room-card" key={room.id}><div><b>{room.name}</b><small>{[room.building, room.floor].filter(Boolean).join(" · ") || "Location not labelled"}</small></div><Status tone={room.occupancy >= room.capacity ? "warn" : "good"}>{room.occupancy}/{room.capacity}</Status><div className="room-meter"><i style={{ width: `${Math.min(100, (room.occupancy / Math.max(1, room.capacity)) * 100)}%` }} /></div>{room.sex ? <small>{room.sex === "female" ? "Female" : "Male"} housing</small> : <small>Not sex-restricted</small>}</div>)}{!rooms.length ? <Empty icon={Bed} title="No rooms yet" text="Add the first room before assigning people." /> : null}</div>
      </article>
      <article className="panel"><div className="panel-head"><div><span className="kicker">Find person</span><h2>Room assignments</h2></div><UserPlus size={22}/></div><SearchField value={query} onChange={setQuery} label="Find person for Housing" placeholder="Search eligible youth or staff" />
        <div className="field-person-list">{people.map((person) => { const assignment = assignedByPerson.get(`${person.kind}:${person.id}`); return <button type="button" key={`${person.kind}:${person.id}`} disabled={!canManage} onClick={() => canManage && setSelected({ person, assignment })}><span className="person-avatar">{initials(person.name)}</span><span><b>{person.name}</b><small>{person.context}</small></span><span>{assignment ? <><b>{assignment.roomName}</b><small>{assignment.company || assignment.group || "Assigned"}</small></> : <Status tone="warn">Unassigned</Status>}</span></button>; })}</div>
      </article>
    </div>
    {roomOpen ? <RoomEditor sessionId={sessionId} onClose={() => setRoomOpen(false)} onSaved={async () => { await reload(); setSaved("Room saved."); }} /> : null}
    {selected ? <AssignmentEditor sessionId={sessionId} person={selected.person} rooms={rooms.filter((room) => !room.sex || room.sex === selected.person.sex)} currentAssignment={selected.assignment} onClose={() => setSelected(null)} onSaved={async () => { await reload(); setSaved("Housing assignment saved."); }} /> : null}
  </section>;
}
