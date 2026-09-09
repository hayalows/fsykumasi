import { useState } from "react";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { DismissibleLayer, MutationFeedback } from "../components/UI.jsx";
import { saveHousingRoom } from "../lib/field-operations.js";

export function RoomEditorV7({ sessionId, room = null, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    name: room?.name || "",
    building: room?.building || "",
    floor: room?.floor || "",
    sex: room?.sex === "male" || room?.sex === "female" ? room.sex : "",
    capacity: room?.capacity || 4,
    notes: room?.notes || "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editing = Boolean(room?.id);
  const locationReady = Boolean(form.building.trim() || form.floor.trim());
  const typeReady = form.sex === "male" || form.sex === "female";

  const save = async (event) => {
    event.preventDefault();
    if (!typeReady) { setError("Choose whether this is a male or female room."); return; }
    if (!locationReady) { setError("Add a location people can use to find this room before it becomes assignable."); return; }
    setBusy(true);
    setError("");
    try {
      await saveHousingRoom({ ...form, sessionId, roomId: room?.id || null, sex: form.sex });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message || "Unable to save this room.");
    } finally {
      setBusy(false);
    }
  };

  return <DismissibleLayer open onClose={onClose} title={editing ? `Edit ${room.name}` : "Add housing room"} sheet className="housing-v4-room-editor-layer housing-v37-room-editor-layer">
    <form className="housing-v4-modal housing-v37-room-editor" onSubmit={save}>
      <header className="housing-v4-modal-head"><div><span className="kicker">Housing setup</span><h2>{editing ? "Edit room" : "Add a room"}</h2><p>Every Housing room is male or female. Add enough location detail for staff to find it.</p></div><button type="button" data-layer-close className="icon-button" onClick={onClose} disabled={busy} aria-label="Close"><X /></button></header>
      <div className="housing-v4-modal-body housing-v37-room-editor-body">
        <div className="housing-v4-form two"><label>Room name<input autoFocus required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Room 203" /></label><label>Spaces<input required type="number" min="1" max="50" value={form.capacity} onChange={(event) => setForm({ ...form, capacity: event.target.value })} /></label></div>
        <label>Room for<select required value={form.sex} onChange={(event) => setForm({ ...form, sex: event.target.value })}><option value="">Choose male or female</option><option value="male">Male</option><option value="female">Female</option></select><small>This controls who can be assigned to the room.</small></label>
        <div className="housing-wayfinding-fields"><label><span className="housing-field-label"><b>Location / building</b><em>Required</em></span><input value={form.building} onChange={(event) => setForm({ ...form, building: event.target.value })} placeholder="e.g. Unity Hostel · East Wing"/><small>Use wording a counselor can follow without knowing the venue.</small></label><label><span className="housing-field-label"><b>Floor / area</b><em>Optional</em></span><input value={form.floor} onChange={(event) => setForm({ ...form, floor: event.target.value })} placeholder="e.g. First floor"/></label></div>
        {!typeReady || !locationReady ? <div className="housing-location-warning"><WarningCircle/><span><b>{!typeReady ? "Room type needed" : "Location needed"}</b><small>{!typeReady ? "Choose Male or Female before this room can be used." : "Add building or floor information before this room can be used."}</small></span></div> : null}
        <details className="housing-v4-details" open={Boolean(form.notes)}><summary><span><b>Operational note</b><small>Optional</small></span><span>+</span></summary><div><label>Note<textarea rows="3" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label></div></details>
        {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      </div>
      <footer className="housing-v4-modal-actions field-sheet-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="primary" disabled={busy || !typeReady || !locationReady}>{busy ? "Saving…" : editing ? "Save changes" : "Add room"}</button></footer>
    </form>
  </DismissibleLayer>;
}
