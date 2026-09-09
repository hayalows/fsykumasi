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
  return <label className="housing-v5-move-reason"><span className="housing-field-label"><b>Reason for room change</b><em>Optional · recommended</em></span><textarea rows="2" maxLength="240" value={value} onChange={(event) => onChange(event.target.value)} placeholder="e.g. Accessibility need, room issue, closer to company"/><small>Saved with the Housing history so the next team member can understand the change.</small></label>;
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
    .filter((room) => Boolean(person.sex) && room.sex === person.sex && (room.occupancy < room.capacity || room.id === currentAssignment?.roomId) && (roomHasWayfinding(room) || room.id === currentAssignment?.roomId))
    .map((room) => ({ room, recommendation: roomRecommendation(room, person, assignments, currentAssignment) }))
    .sort((a, b) => b.recommendation.score - a.recommendation.score || collator.compare(a.room.name, b.room.name)), [rooms, person, assignments, currentAssignment]);

  const visible = useMemo(() => {
    const text = query.trim().toLowerCase();
    return ranked.filter(({ room }) => !text || `${room.name} ${room.building} ${room.floor}`.toLowerCase().includes(text));
  }, [ranked, query]);

  const currentRoom = rooms.find((room) => room.id === currentAssignment?.roomId) || null;
  const selectedRoom = rooms.find((room) => room.id === roomId) || null;
  const selectedRecommendation = selectedRoom ? roomRecommendation(selectedRoom, person, assignments, currentAssignment) : null;
  const roomChanged = Boolean(currentAssignment && roomId && roomId !== currentAssignment.roomId);
  const bedChanged = (bedLabel || "").trim() !== (currentAssignment?.bedLabel || "").trim();
  const hasChanges = currentAssignment ? roomChanged || bedChanged : Boolean(roomId);

  const toggleRoom = (nextRoomId) => {
    setError("");
    setMoveReason("");
    setRoomId((current) => {
      if (currentAssignment) {
        if (nextRoomId === currentAssignment.roomId) return currentAssignment.roomId;
        return current === nextRoomId ? currentAssignment.roomId : nextRoomId;
      }
      return current === nextRoomId ? "" : nextRoomId;
    });
  };

  const clearSelection = () => {
    setRoomId(currentAssignment?.roomId || "");
    setMoveReason("");
    setError("");
  };

  const save = async () => {
    if (!roomId || busy) return;
    setBusy(true);
    setError("");
    try {
      await saveHousingAssignment({ sessionId, personType: person.kind, personId: person.id, roomId, bedLabel, moveReason: roomChanged ? moveReason : "" });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message || "Unable to save this housing assignment. Refresh Housing and review the person before trying again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!currentAssignment?.id || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await clearHousingAssignment({ sessionId, personType: person.kind, personId: person.id, assignmentId: currentAssignment.id });
      await onSaved({ type: "unassigned", assignment: { ...currentAssignment, ...(result && !Array.isArray(result) ? result : {}) } });
      setConfirmRemove(false);
      onClose();
    } catch (err) {
      setError(err.message || "This room assignment could not be removed. It may have changed elsewhere. Refresh Housing and review the current room.");
      setConfirmRemove(false);
    } finally {
      setBusy(false);
    }
  };

  const createAndAssign = async () => {
    if (!person.sex) { setError("This person's sex must be recorded before a male or female room can be assigned."); return; }
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

  return <DismissibleLayer open onClose={onClose} title={`Housing for ${person.name}`} sheet className="housing-v5-assignment-layer housing-v36-assignment-layer">
    <div className="housing-v5-assignment-modal housing-v36-assignment-modal">
      <header className="housing-v5-assignment-head"><div className="housing-v5-person"><span className="person-avatar">{initials(person.name)}</span><span><span className="kicker">Housing</span><h2>{person.name}</h2><p>{person.group ? `${person.group}${person.company ? ` · ${person.company}` : ""}` : person.context}</p></span></div><button type="button" data-layer-close className="icon-button" onClick={onClose} disabled={busy} aria-label="Close"><X/></button></header>
      <div className="housing-v5-assignment-body">
        {currentAssignment ? <section className="housing-v36-current-room" aria-label="Current room assignment">
          <div><small>Current room</small><b>{currentAssignment.roomName}</b><span>{currentRoom ? roomLocation(currentRoom) : currentAssignment.bedLabel ? `Bed / key ${currentAssignment.bedLabel}` : "Currently assigned"}</span></div>
          <button type="button" className="secondary danger-text housing-v36-unassign" disabled={busy} onClick={() => setConfirmRemove(true)}>Unassign room</button>
        </section> : <div className="housing-v37-assignment-state" role="status"><Bed size={18}/><span><b>Needs a room</b><small>{person.sex ? `Choose a ${sexLabel(person.sex).toLowerCase()} room below.` : "Sex is missing, so a room cannot be assigned yet."}</small></span></div>}

        {selectedRoom && roomId !== currentAssignment?.roomId ? <div className="housing-v36-next-room"><small>{currentAssignment ? "New room" : "Selected room"}</small><b>{selectedRoom.name}</b><span>{roomLocation(selectedRoom)}</span></div> : null}

        {mode === "choose" ? <>
          <div className="housing-v5-picker-head housing-v36-picker-head"><div><h3>{currentAssignment ? "Move to another room" : "Choose a room"}</h3><p>{person.sex ? `${sexLabel(person.sex)} rooms with the same counselor group or company are shown first when they have space.` : "Add the person's sex before assigning a room."}</p></div><button type="button" className="secondary" disabled={!person.sex} onClick={() => { setMode("create"); setError(""); }}><Plus/>Create room</button></div>
          <SearchField value={query} onChange={setQuery} label="Find a room" placeholder="Search room, building or floor" autoFocus={!currentAssignment} disabled={!person.sex}/>
          <div className="housing-v5-room-choices">{visible.map(({ room, recommendation }, index) => { const selected = room.id === roomId; const isCurrent = room.id === currentAssignment?.roomId; return <button type="button" key={room.id} className={`housing-v5-room-choice${selected ? " selected" : ""}${isCurrent ? " current" : ""}`} onClick={() => toggleRoom(room.id)} aria-pressed={selected}><span className="room-copy"><b>{room.name}{isCurrent ? " · Current" : ""}</b><small>{roomLocation(room)}</small><em>{isCurrent ? "Keep this room" : recommendation.reason}</em></span><span className="room-meta"><strong>{room.occupancy}/{room.capacity}</strong><small>{sexLabel(room.sex)} room</small></span><span className="room-choice-end">{!isCurrent && index === 0 && recommendation.label ? <i>{recommendation.label}</i> : null}<CheckCircle size={23} weight={selected ? "fill" : "regular"}/></span></button>; })}{!visible.length ? <Empty icon={Bed} title={person.sex ? `No ${sexLabel(person.sex).toLowerCase()} rooms with space` : "Room assignment is blocked"} text={person.sex ? "Create a room for this person without leaving the assignment." : "Record the person's sex first so Housing can show only compatible rooms."} action={person.sex ? <button type="button" className="primary" onClick={() => setMode("create")}><Plus/>Create room</button> : null}/> : null}</div>
          {roomChanged ? <MoveReason value={moveReason} onChange={setMoveReason}/> : null}
          <details className="housing-v4-details"><summary><span><b>Bed / key</b><small>{bedLabel ? bedLabel : "Optional"}</small></span><span>+</span></summary><div><label><span className="housing-field-label"><b>Bed / key label</b><em>Optional</em></span><input value={bedLabel} onChange={(event) => setBedLabel(event.target.value)} placeholder="e.g. Bed B or Key 203-2"/></label></div></details>
        </> : <>
          <div className="housing-v5-picker-head"><div><span className="kicker">Create & assign</span><h3>New room for {person.name.split(" ")[0]}</h3><p>Room use will be set to {person.sex ? sexLabel(person.sex).toLowerCase() : "the person's recorded sex"} automatically.</p></div><button type="button" className="secondary" onClick={() => setMode("choose")}>Back</button></div>
          <div className="housing-v4-form two"><label>Room name<input autoFocus required value={newRoom.name} onChange={(event) => setNewRoom({ ...newRoom, name: event.target.value })} placeholder="e.g. Room 105"/></label><label>Spaces<input type="number" min="1" max="50" value={newRoom.capacity} onChange={(event) => setNewRoom({ ...newRoom, capacity: event.target.value })}/></label></div>
          <div className="housing-wayfinding-fields"><label><span className="housing-field-label"><b>Location / building</b><em>Required</em></span><input required value={newRoom.building} onChange={(event) => setNewRoom({ ...newRoom, building: event.target.value })} placeholder="e.g. Block B · East Wing"/></label><label><span className="housing-field-label"><b>Floor / area</b><em>Optional</em></span><input value={newRoom.floor} onChange={(event) => setNewRoom({ ...newRoom, floor: event.target.value })} placeholder="e.g. First floor"/></label></div>
          <div className="housing-v4-inferred"><Bed/><span><b>{person.sex ? `${sexLabel(person.sex)} room` : "Room type pending"}</b><small>Set from the person being assigned.</small></span></div>
          <details className="housing-v4-details"><summary><span><b>Operational note</b><small>Optional</small></span><span>+</span></summary><div><label>Note<textarea rows="2" value={newRoom.notes} onChange={(event) => setNewRoom({ ...newRoom, notes: event.target.value })}/></label></div></details>
          {currentAssignment ? <MoveReason value={moveReason} onChange={setMoveReason}/> : null}
        </>}
        {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      </div>
      <footer className="housing-v5-assignment-actions housing-v36-assignment-actions housing-v37-assignment-actions"><div>{mode === "choose" && selectedRoom && roomId !== currentAssignment?.roomId ? <><b>{selectedRoom.name}</b><small>{currentAssignment ? "Ready to move" : selectedRecommendation?.reason}</small></> : mode === "create" ? <><b>Create new room</b><small>Nothing is saved until you confirm.</small></> : currentAssignment ? <><b>{currentAssignment.roomName}</b><small>{bedChanged ? "Bed / key will be updated" : "Current room remains unchanged"}</small></> : <><b>No room selected</b><small>Choose a room above to continue.</small></>}</div>{mode === "choose" ? <div className="housing-v37-footer-buttons">{(roomChanged || (!currentAssignment && roomId)) ? <button type="button" className="secondary" disabled={busy} onClick={clearSelection}>{currentAssignment ? "Cancel move" : "Clear selection"}</button> : <button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button>}<button type="button" className="primary" disabled={busy || !hasChanges || !roomId} onClick={save}>{busy ? "Saving…" : roomChanged && selectedRoom ? `Move to ${selectedRoom.name}` : currentAssignment ? bedChanged ? "Save bed / key" : "No changes" : selectedRoom ? `Assign ${selectedRoom.name}` : "Select a room"}</button></div> : <button type="button" className="primary" disabled={busy || !person.sex || !newRoom.name.trim() || (!newRoom.building.trim() && !newRoom.floor.trim())} onClick={createAndAssign}>{busy ? "Creating…" : "Create room & assign"}</button>}</footer>
      {confirmRemove ? <ConfirmActionSheet open title={`Unassign ${person.name} from ${currentAssignment?.roomName || "this room"}?`} description="This ends the current room assignment without deleting the person or their Housing history." impact="They will move back to the Needs room list. You can undo immediately if this was a mistake, provided the previous room is still available." confirmLabel="Unassign room" cancelLabel="Keep room" busy={busy} onClose={() => setConfirmRemove(false)} onConfirm={remove}/> : null}
    </div>
  </DismissibleLayer>;
}
