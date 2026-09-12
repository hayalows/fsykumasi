import { useMemo, useState } from "react";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { DismissibleLayer, MutationFeedback } from "../components/UI.jsx";
import { saveHousingInventoryRoomV8 } from "../lib/housing-inventory-room-v8.js";

const SPACE_TYPES = [
  { value: "room", label: "Standard room" },
  { value: "flat", label: "Flat" },
  { value: "executive", label: "Executive room" },
  { value: "other", label: "Other space" },
];

const AVAILABILITY = [
  { value: "available", label: "Available", help: "Can appear in Housing when its Male/Female use is set." },
  { value: "pending", label: "Pending details", help: "Keep it in inventory but out of live assignment until reviewed." },
  { value: "reserved", label: "Reserved", help: "Known space, intentionally held back from normal assignment." },
  { value: "out_of_service", label: "Out of service", help: "Known space that should not be assigned." },
];

export function HousingInventoryRoomEditorV8({ sessionId, room = null, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    hall: room?.hall || room?.building?.split(" · ")?.[0] || "",
    area: room?.area || "",
    floor: room?.floor || "",
    name: room?.name || "",
    spaceType: room?.spaceType || "room",
    availabilityStatus: room?.availabilityStatus || "available",
    sex: room?.sex === "male" || room?.sex === "female" ? room.sex : "",
    capacity: room?.capacity || 4,
    notes: room?.notes || "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editing = Boolean(room?.id);

  const availability = AVAILABILITY.find((item) => item.value === form.availabilityStatus) || AVAILABILITY[0];
  const standardNeedsUse = form.spaceType === "room" && form.availabilityStatus === "available" && !form.sex;
  const capacityValid = Number(form.capacity) >= 1 && Number(form.capacity) <= 50;
  const canSave = Boolean(form.hall.trim() && form.name.trim() && capacityValid && !standardNeedsUse);
  const assignmentReady = form.availabilityStatus === "available" && Boolean(form.sex);

  const locationPreview = useMemo(() => [form.hall, form.area, form.floor, form.name].map((value) => String(value || "").trim()).filter(Boolean).join(" → "), [form.hall, form.area, form.floor, form.name]);

  const save = async (event) => {
    event.preventDefault();
    if (!canSave || busy) return;
    setBusy(true);
    setError("");
    try {
      await saveHousingInventoryRoomV8({
        sessionId,
        roomId: room?.id || null,
        ...form,
      });
      await onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message || "Unable to save this Housing space.");
    } finally {
      setBusy(false);
    }
  };

  return <DismissibleLayer open onClose={onClose} title={editing ? `Review ${room.name}` : "Add Housing space"} sheet className="housing-v8-room-editor-layer">
    <form className="housing-v8-room-editor" onSubmit={save}>
      <header className="housing-v8-room-editor-head">
        <div><span className="kicker">Physical inventory</span><h2>{editing ? "Review housing space" : "Add housing space"}</h2><p>Record the physical location first. Live Housing will only offer spaces that are available and set to Male or Female.</p></div>
        <button type="button" data-layer-close className="icon-button" onClick={onClose} disabled={busy} aria-label="Close"><X/></button>
      </header>

      <div className="housing-v8-room-editor-body">
        <section className="housing-v8-editor-section">
          <div className="housing-v8-editor-section-head"><div><b>Location</b><small>Use wording staff can follow at the venue.</small></div>{locationPreview ? <span>{locationPreview}</span> : null}</div>
          <div className="housing-v8-editor-grid two">
            <label><span>Hall / main location</span><input autoFocus required value={form.hall} onChange={(event) => setForm({ ...form, hall: event.target.value })} placeholder="e.g. Republic Hall"/></label>
            <label><span>Area / block / lane</span><input value={form.area} onChange={(event) => setForm({ ...form, area: event.target.value })} placeholder="e.g. Chapel Lane"/></label>
          </div>
          <div className="housing-v8-editor-grid two">
            <label><span>Floor</span><input value={form.floor} onChange={(event) => setForm({ ...form, floor: event.target.value })} placeholder="e.g. First floor"/></label>
            <label><span>Room / space name</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. 135M"/></label>
          </div>
        </section>

        <section className="housing-v8-editor-section">
          <div className="housing-v8-editor-section-head"><div><b>Use & capacity</b><small>Capacity is physical bed space, not expected attendance.</small></div></div>
          <div className="housing-v8-editor-grid two">
            <label><span>Space type</span><select value={form.spaceType} onChange={(event) => setForm({ ...form, spaceType: event.target.value })}>{SPACE_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label><span>Spaces</span><input required type="number" min="1" max="50" value={form.capacity} onChange={(event) => setForm({ ...form, capacity: event.target.value })}/></label>
          </div>
          <div className="housing-v8-editor-grid two">
            <label><span>Room use</span><select value={form.sex} onChange={(event) => setForm({ ...form, sex: event.target.value })}><option value="">Flexible / not decided</option><option value="male">Male</option><option value="female">Female</option></select><small>Standard available rooms need Male or Female. Flats and special spaces may stay flexible until needed.</small></label>
            <label><span>Availability</span><select value={form.availabilityStatus} onChange={(event) => setForm({ ...form, availabilityStatus: event.target.value })}>{AVAILABILITY.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><small>{availability.help}</small></label>
          </div>
          {standardNeedsUse ? <div className="housing-v8-editor-callout warning"><WarningCircle/><span><b>Choose Male or Female</b><small>An available standard room needs a room use before it can enter live Housing.</small></span></div> : assignmentReady ? <div className="housing-v8-editor-callout ready"><CheckCircle weight="fill"/><span><b>Ready for live Housing</b><small>This space can appear as an assignment choice when it has capacity.</small></span></div> : <div className="housing-v8-editor-callout"><WarningCircle/><span><b>Kept out of live assignment</b><small>This is safe for planning or review, but Housing will not assign people here yet.</small></span></div>}
        </section>

        <details className="housing-v8-editor-notes" open={Boolean(form.notes)}><summary><span><b>Operational note</b><small>Optional</small></span><span>+</span></summary><div><textarea rows="3" maxLength="500" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Key issue, access note, facility instruction…"/></div></details>

        {!editing ? <p className="housing-v8-plan-reset-note">Before live assignments begin, adding or changing inventory resets the saved company-room plan so it can be recalculated against the latest rooms.</p> : <p className="housing-v8-plan-reset-note">Before live assignments begin, inventory changes reset the saved company-room plan. After live assignments begin, occupied and planned rooms have extra safety checks.</p>}
        {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
      </div>

      <footer className="housing-v8-room-editor-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="primary" disabled={busy || !canSave}>{busy ? "Saving…" : editing ? "Save reviewed space" : "Add housing space"}</button></footer>
    </form>
  </DismissibleLayer>;
}
