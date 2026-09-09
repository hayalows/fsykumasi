import { useMemo, useState } from "react";
import { Bed } from "@phosphor-icons/react/Bed";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Plus } from "@phosphor-icons/react/Plus";
import { X } from "@phosphor-icons/react/X";
import { ConfirmActionSheet, DismissibleLayer, Empty, MutationFeedback, SearchField } from "../components/UI.jsx";
import { clearHousingAssignment } from "../lib/field-operations.js";
import { createHousingRoomAndAssignV2, saveHousingAssignment } from "../lib/housing-actions.js";
import { initials, roomHasWayfinding, roomLocation, sexLabel } from "./HousingDialogsV4.jsx";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function roomRecommendation(room, person, assignments, currentAssignment) {
  const occupants = assignments.filter((item) => item.roomId === room.id && !(item.personType === person.kind && item.personId === person.id));
  const personGroup = person.group || currentAssignment?.group || "";
  const personCompany = person.company || currentAssignment?.company || "";
  const sameGroup = personGroup ? occupants.filter((item) => item.group === personGroup).length : 0;
  const sameCompany = personCompany ? occupants.filter((item) => item.company === personCompany).length : 0;
  const open = Math.max(0, Number(room.capacity || 0) - Number(room.occupancy || 0));
  const tier = sameGroup > 0 ? 3 : sameCompany > 0 ? 2 : 1;
  const score = tier * 10000 + sameGroup * 1000 + sameCompany * 100 + open;
  let reason = `${open} space${open === 1 ? "" : "s"} open`;
  let label = "";
  if (sameGroup > 0) {
    reason = `${sameGroup} from ${personGroup} already here · ${reason}`;
    label = "Keeps group together";
  } else if (sameCompany > 0) {
    reason = `${sameCompany} from ${personCompany} already here · ${reason}`;
    label = "Same company";
  }
  return { sameGroup, sameCompany, open, score, reason, label };
}

function MoveReason({ value, onChange }) {
  return <label className="housing-v5-move-reason"><span className="housing-field-label"><b>Reason for room change</b><em>Optional · recommended</em></span><textarea rows="2" maxLength="240" value={value} onChange={(event) => onChange(event.target.value)} placeholder="e.g. Accessibility need, room issue, closer to company"/><small>Saved with the Housing audit history.</small></label>;
}

export function AssignmentEditorV5({ sessionId, person, rooms, assignments = [], currentAssignment, onClose, onSaved }) {
  const [roomId, setRoomId] = useState(currentAssignment?.roomId || "");
  const [bedLabel, setBedLabel] = useState(currentAssignment?.bedLabel || "");
  const [moveReason, setMoveReason] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("choose");
  const [newRoom, setNewRoom] = useState({ name: "", capacity: 4, building: "", floor: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  const ranked = useMemo(() => rooms
    .filter((room) => (!room.sex || !person.sex || room.sex === person.sex) && (room.occupancy < room.capacity || room.id === currentAssignment?.roomId) && (roomHasWayfinding(room) || room.id === currentAssignment?.roomId))
    .map((room) => ({ room, recommendation: roomRecommendation(room, person, assignments, currentAssignment) }))
    .sort((a, b) => b.recommendation.score - a.recommendation.score || collator.compare(a.room.name, b.room.name)), [rooms, person, assignments, currentAssignment]);

  const visible = useMemo(() => {
    const text = query.trim().toLowerCase();
    return ranked.filter(({ room }) => !text || `${room.name} ${room.building} ${room.floor}`.toLowerCase().includes(text));
  }, [ranked, query]);

  const selectedRoom = rooms.find((room) => room.id === roomId) || null;
  const selectedRecommendation = selectedRoom ? roomRecommendation(selectedRoom, person, assignments, currentAssignment) : null;
  const roomChanged = Boolean(currentAssignment && roomId && roomId !== currentAssignment.roomId);
  const bedChanged = (bedLabel || "").trim() !== (currentAssignment?.bedLabel || "").trim();
  const hasChanges = currentAssignment ? roomChanged || bedChanged : Boolean(roomId);

  const save = async () => {
    if (!roomId) return;
    setBusy(true);
    setError("");
    try {
      await saveHousingAssignment({ sessionId, personType: person.kind, personId: person.id, roomId, bedLabel, moveReason: roomChanged ? moveReason : "" });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message || "Unable to save this housing assignment.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await clearHousingAssignment({ sessionId, personType: person.kind, personId: person.id, assignmentId: currentAssignment.id });
      await onSaved({ type: "unassigned", assignment: { ...currentAssignment, ...result } });
      setConfirmRemove(false);
      onClose();
    } catch (err) {
      setError(err.message || "Unable to remove this assignment.");
      setConfirmRemove(false);
    } finally {
      setBusy(false);
    }
  };

  const createAndAssign = async () => {
    if (!newRoom.name.trim()) { setError("Enter a room name first."); return; }
    if (!newRoom.building.trim() && !newRoom.floor.trim()) { setError("Add a location people can use to find this room."); return; }
    setBusy(true);
    setError("");
    try {
      await createHousingRoomAndAssignV2({ sessionId, personType: person.kind, personId: person.id, roomName: newRoom.name, building: newRoom.building, floor: newRoom.floor, capacity: newRoom.capacity, notes: newRoom.notes, bedLabel, moveReason: currentAssignment ? moveReason : "" });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message || "Unable to create and assign this room.");
    } finally {
      setBusy(false);
    }
  };

  return <DismissibleLayer open onClose={onClose} title={`Housing for ${person.name}`} sheet className="housing-v5-assignment-layer">
    <div className="housing-v5-assignment-modal">
      <header className="housing-v5-assignment-head"><div className="housing-v5-person"><span className="person-avatar">{initials(person.name)}</span><span><span className="kicker">Housing assignment</span><h2>{person.name}</h2><p>{person.group ? `${person.group}${person.company ? ` · ${person.company}` : ""}` : person.context}</p></span></div><button type="button" data-layer-close className="icon-button" onClick={onClose} aria-label="Close"><X/></button></header>
      <div className="housing-v5-assignment-body">
        <div className="housing-v5-current"><span><small>Current room</small><b>{currentAssignment?.roomName || "Not assigned"}</b></span>{selectedRoom && roomId !== currentAssignment?.roomId ? <span className="next"><small>{currentAssignment ? "Moving to" : "Selected room"}</small><b>{selectedRoom.name}</b></span> : null}</div>
        {mode === "choose" ? <>
          <div className="housing-v5-picker-head"><div><h3>{currentAssignment ? "Choose another room" : "Choose a room"}</h3><p>Compatible rooms are ranked using the participant&apos;s counselor group, company and available space.</p></div><button type="button" className="secondary" onClick={() => { setMode("create"); setError(""); }}><Plus/>Create room</button></div>
          <SearchField value={query} onChange={setQuery} label="Find a room" placeholder="Search room, building or floor" autoFocus/>
          <div className="housing-v5-room-choices">{visible.map(({ room, recommendation }, index) => { const selected = room.id === roomId; return <button type="button" key={room.id} className={`housing-v5-room-choice${selected ? " selected" : ""}`} onClick={() => setRoomId(room.id)} aria-pressed={selected}><span className="room-copy"><b>{room.name}</b><small>{roomLocation(room)}</small><em>{recommendation.reason}</em></span><span className="room-meta"><strong>{room.occupancy}/{room.capacity}</strong><small>{room.sex ? `${sexLabel(room.sex)} room` : "Unrestricted"}</small></span><span className="room-choice-end">{index === 0 && recommendation.label ? <i>{recommendation.label}</i> : null}<CheckCircle size={23} weight={selected ? "fill" : "regular"}/></span></button>; })}{!visible.length ? <Empty icon={Bed} title="No compatible rooms with space" text="Create a room for this person without leaving the assignment." action={<button type="button" className="primary" onClick={() => setMode("create")}><Plus/>Create room</button>}/> : null}</div>
          {roomChanged ? <MoveReason value={moveReason} onChange={setMoveReason}/> : null}
          <details className="housing-v4-details" open={Boolean(bedLabel)}><summary><span><b>Assignment details</b><small>{bedLabel ? `Bed / key ${bedLabel}` : "Bed or key label, if needed"}</small></span><span>+</span></summary><div><label><span className="housing-field-label"><b>Bed / key label</b><em>Optional</em></span><input value={bedLabel} onChange={(event) => setBedLabel(event.target.value)} placeholder="e.g. Bed B or Key 203-2"/></label>{currentAssignment ? <button type="button" className="housing-v4-remove" disabled={busy} onClick={() => setConfirmRemove(true)}>Unassign from this room</button> : null}</div></details>
        </> : <>
          <div className="housing-v5-picker-head"><div><span className="kicker">Create & assign</span><h3>New room for {person.name.split(" ")[0]}</h3><p>{person.sex ? `Room use will be set to ${sexLabel(person.sex).toLowerCase()} automatically.` : "The room will remain unrestricted."}</p></div><button type="button" className="secondary" onClick={() => setMode("choose")}>Back</button></div>
          <div className="housing-v4-form two"><label>Room name<input autoFocus required value={newRoom.name} onChange={(event) => setNewRoom({ ...newRoom, name: event.target.value })} placeholder="e.g. Room 105"/></label><label>Spaces<input type="number" min="1" max="50" value={newRoom.capacity} onChange={(event) => setNewRoom({ ...newRoom, capacity: event.target.value })}/></label></div>
          <div className="housing-wayfinding-fields"><label><span className="housing-field-label"><b>Location / building</b><em>Required</em></span><input required value={newRoom.building} onChange={(event) => setNewRoom({ ...newRoom, building: event.target.value })} placeholder="e.g. Block B · East Wing"/></label><label><span className="housing-field-label"><b>Floor / area</b><em>Optional</em></span><input value={newRoom.floor} onChange={(event) => setNewRoom({ ...newRoom, floor: event.target.value })} placeholder="e.g. First floor"/></label></div>
          <div className="housing-v4-inferred"><Bed/><span><b>{person.sex ? `${sexLabel(person.sex)} room` : "Unrestricted room"}</b><small>Set automatically from the person being assigned.</small></span></div>
          <details className="housing-v4-details"><summary><span><b>Operational note</b><small>Optional</small></span><span>+</span></summary><div><label>Note<textarea rows="2" value={newRoom.notes} onChange={(event) => setNewRoom({ ...newRoom, notes: event.target.value })}/></label></div></details>
          {currentAssignment ? <MoveReason value={moveReason} onChange={setMoveReason}/> : null}
        </>}
        {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      </div>
      <footer className="housing-v5-assignment-actions"><div>{mode === "choose" && selectedRoom ? <><b>{selectedRoom.name}</b><small>{selectedRecommendation?.reason}</small></> : mode === "create" ? <><b>Create new room</b><small>Nothing is saved until you confirm.</small></> : <><b>Select a room</b><small>Nothing is saved until you confirm.</small></>}</div>{mode === "choose" ? <button type="button" className="primary" disabled={busy || !hasChanges} onClick={save}>{busy ? "Saving…" : roomChanged && selectedRoom ? `Move to ${selectedRoom.name}` : currentAssignment ? "Save assignment" : selectedRoom ? `Assign ${selectedRoom.name}` : "Choose a room"}</button> : <button type="button" className="primary" disabled={busy || !newRoom.name.trim() || (!newRoom.building.trim() && !newRoom.floor.trim())} onClick={createAndAssign}>{busy ? "Creating…" : "Create room & assign"}</button>}</footer>
      {confirmRemove ? <ConfirmActionSheet open title={`Unassign ${person.name} from ${currentAssignment?.roomName || "this room"}?`} description="Their current room assignment will end." impact="They will need to be placed again. Existing Housing history remains available for continuity." confirmLabel="Unassign room" cancelLabel="Keep room" busy={busy} onClose={() => setConfirmRemove(false)} onConfirm={remove}/> : null}
    </div>
  </DismissibleLayer>;
}
