import { useEffect, useMemo, useRef, useState } from "react";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { FileArrowUp } from "@phosphor-icons/react/FileArrowUp";
import { Plus } from "@phosphor-icons/react/Plus";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { Empty, MutationFeedback, SearchField } from "../components/UI.jsx";
import { HousingInventoryRoomEditorV8 } from "./HousingInventoryRoomEditorV8.jsx";
import {
  importHousingInventoryV8,
  loadHousingRoomsV8,
  parseHousingWorkbook,
  subscribeToHousingInventoryV8,
} from "../lib/housing-inventory-v8.js";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function sexLabel(value) {
  if (value === "male") return "Male";
  if (value === "female") return "Female";
  return "Flexible";
}

function groupInventory(rooms) {
  const groups = new Map();
  rooms.forEach((room) => {
    const hall = room.hall || room.building || "Location not set";
    const area = room.area || "Other rooms";
    const key = `${hall}|||${area}`;
    if (!groups.has(key)) groups.set(key, { key, hall, area, rooms: [], capacity: 0, male: 0, female: 0, flexible: 0 });
    const group = groups.get(key);
    group.rooms.push(room);
    group.capacity += Number(room.capacity || 0);
    if (room.sex === "male") group.male += Number(room.capacity || 0);
    else if (room.sex === "female") group.female += Number(room.capacity || 0);
    else group.flexible += Number(room.capacity || 0);
  });
  return [...groups.values()].sort((a, b) => collator.compare(`${a.hall} ${a.area}`, `${b.hall} ${b.area}`));
}

export function HousingInventoryV8({ sessionId, canManage }) {
  const fileRef = useRef(null);
  const [rooms, setRooms] = useState([]);
  const [query, setQuery] = useState("");
  const [defaultHall, setDefaultHall] = useState("Republic Hall");
  const [preview, setPreview] = useState(null);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [roomOpen, setRoomOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const reload = async () => {
    const next = await loadHousingRoomsV8(sessionId);
    setRooms(next);
    return next;
  };

  useEffect(() => {
    if (!sessionId) return undefined;
    reload().catch((err) => setError(err.message || "Unable to load Housing inventory."));
    return subscribeToHousingInventoryV8(sessionId, () => reload().catch(() => {}));
  }, [sessionId]);

  const summary = useMemo(() => {
    const active = rooms.filter((room) => room.active !== false);
    const available = active.filter((room) => room.availabilityStatus === "available");
    const standard = available.filter((room) => room.spaceType === "room");
    const special = available.filter((room) => room.spaceType !== "room");
    return {
      records: active.length,
      rooms: available.length,
      standard: standard.length,
      special: special.length,
      capacity: available.reduce((sum, room) => sum + room.capacity, 0),
      maleCapacity: standard.filter((room) => room.sex === "male").reduce((sum, room) => sum + room.capacity, 0),
      femaleCapacity: standard.filter((room) => room.sex === "female").reduce((sum, room) => sum + room.capacity, 0),
      flexibleCapacity: special.filter((room) => !room.sex).reduce((sum, room) => sum + room.capacity, 0),
      unavailable: active.filter((room) => room.availabilityStatus !== "available").length,
      pending: active.filter((room) => room.availabilityStatus === "pending").length,
    };
  }, [rooms]);

  const grouped = useMemo(() => {
    const text = query.trim().toLowerCase();
    const filtered = rooms.filter((room) => !text || `${room.name} ${room.hall} ${room.area} ${room.floor} ${room.sex} ${room.spaceType}`.toLowerCase().includes(text));
    return groupInventory(filtered);
  }, [rooms, query]);

  const selectFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setReading(true);
    setError("");
    setSaved("");
    try {
      const result = await parseHousingWorkbook(file, { defaultHall: defaultHall.trim() || "Republic Hall" });
      setPreview(result);
    } catch (err) {
      setError(err.message || "That workbook could not be read. Use an .xlsx file and try again.");
      setPreview(null);
    } finally {
      setReading(false);
    }
  };

  const runImport = async () => {
    if (!preview?.rows?.length || importing) return;
    setImporting(true);
    setError("");
    setSaved("");
    try {
      const result = await importHousingInventoryV8({ sessionId, sourceName: preview.fileName, rows: preview.rows });
      await reload();
      const planNote = Number(result?.plans_cleared || 0) ? ` ${Number(result.plans_cleared)} saved company-room blocks were cleared so Plan can be recalculated.` : "";
      setSaved(`${Number(result?.inserted || 0)} rooms added and ${Number(result?.updated || 0)} updated. Rooms omitted from the workbook were left unchanged.${planNote}`);
      setPreview(null);
    } catch (err) {
      setError(err.message || "Housing inventory was not imported. Nothing was removed; review the workbook and try again.");
    } finally {
      setImporting(false);
    }
  };

  return <div className="housing-v8-inventory">
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
    {saved ? <MutationFeedback>{saved}</MutationFeedback> : null}

    <div className="housing-v8-kpis" aria-label="Housing inventory summary">
      <span><b>{summary.rooms.toLocaleString()}</b><small>available inventory units</small></span>
      <span><b>{summary.capacity.toLocaleString()}</b><small>recorded spaces</small></span>
      <span><b>{summary.maleCapacity.toLocaleString()}</b><small>male standard spaces</small></span>
      <span><b>{summary.femaleCapacity.toLocaleString()}</b><small>female standard spaces</small></span>
      <span><b>{summary.flexibleCapacity.toLocaleString()}</b><small>flexible special spaces</small></span>
    </div>

    <div className="housing-v8-grid">
      <article className="panel housing-v8-import-card">
        <div className="housing-v8-card-head"><div><span className="kicker">Bulk setup</span><h2>Import rooms from Excel</h2><p>Use this before live room assignments begin. The import adds new rooms and updates matching physical rooms. It never removes a room simply because it is missing from a later file.</p></div><FileArrowUp size={25}/></div>
        <label className="housing-v8-hall-field"><span>Hall for this workbook</span><input value={defaultHall} onChange={(event) => setDefaultHall(event.target.value)} placeholder="e.g. Republic Hall" disabled={!canManage || reading || importing}/><small>Sheets without a Hall column will use this value. This makes the same importer usable for Unity later.</small></label>
        <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={selectFile}/>
        <div className="housing-v8-import-actions">
          <button type="button" className="primary" disabled={!canManage || reading || importing} onClick={() => fileRef.current?.click()}><FileArrowUp/>{reading ? "Reading workbook…" : "Choose Excel workbook"}</button>
          {canManage ? <button type="button" className="secondary" onClick={() => setRoomOpen(true)} disabled={importing}><Plus/>Add one room</button> : null}
        </div>
        {!canManage ? <p className="housing-v8-muted">You can review inventory, but your access does not include Housing changes.</p> : null}
      </article>

      <article className="panel housing-v8-inventory-status">
        <div className="housing-v8-card-head"><div><span className="kicker">Current inventory</span><h2>{summary.standard.toLocaleString()} standard rooms</h2><p>{summary.special.toLocaleString()} special flats / executive rooms are kept as flexible capacity until a Male/Female use is deliberately set.</p></div><Buildings size={25}/></div>
        <div className="housing-v8-sex-balance">
          <div><span>Male standard capacity</span><b>{summary.maleCapacity.toLocaleString()}</b></div>
          <div><span>Female standard capacity</span><b>{summary.femaleCapacity.toLocaleString()}</b></div>
        </div>
        {summary.unavailable ? <div className="housing-v8-inline-warning"><WarningCircle/><span><b>{summary.unavailable} inventory units need review or are held back</b><small>{summary.pending ? `${summary.pending} are pending details. ` : ""}They remain visible here but stay out of normal assignment choices.</small></span></div> : null}
      </article>
    </div>

    {preview ? <article className="panel housing-v8-import-preview" aria-live="polite">
      <div className="housing-v8-card-head"><div><span className="kicker">Review before import</span><h2>{preview.fileName}</h2><p>Nothing has been written yet. Check the totals below, then import when they look right.</p></div><CheckCircle size={25}/></div>
      <div className="housing-v8-preview-metrics">
        <span><b>{preview.summary.standardRooms}</b><small>standard rooms</small></span>
        <span><b>{preview.summary.specialSpaces}</b><small>special spaces</small></span>
        <span><b>{preview.summary.capacity.toLocaleString()}</b><small>recorded capacity</small></span>
        <span><b>{preview.summary.maleCapacity.toLocaleString()}</b><small>male capacity</small></span>
        <span><b>{preview.summary.femaleCapacity.toLocaleString()}</b><small>female capacity</small></span>
      </div>
      {preview.pendingAreas.length ? <div className="housing-v8-inline-warning"><WarningCircle/><span><b>{preview.pendingAreas.length} SRC blocks still need room details</b><small>{preview.pendingAreas.map((item) => item.area).join(", ")} are shown in the workbook without room numbers or capacity, so they will not be counted or imported yet.</small></span></div> : null}
      {preview.blockingIssues?.length ? <div className="housing-v8-blocking"><WarningCircle/><span><b>Fix {preview.blockingIssues.length} duplicate physical room {preview.blockingIssues.length === 1 ? "entry" : "entries"} before import</b><small>{preview.blockingIssues[0]}</small></span></div> : null}
      {preview.warnings.length ? <details className="housing-v8-warnings"><summary>{preview.warnings.length} data note{preview.warnings.length === 1 ? "" : "s"}</summary><div>{preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div></details> : null}
      <p className="housing-v8-preview-note">Importing updated inventory clears any saved company-room plan so it can be recalculated. It does not assign or move anyone.</p>
      <div className="housing-v8-preview-actions"><button type="button" className="secondary" onClick={() => setPreview(null)} disabled={importing}>Cancel</button><button type="button" className="primary" onClick={runImport} disabled={!canManage || importing || Boolean(preview.blockingIssues?.length)}>{importing ? "Importing…" : preview.blockingIssues?.length ? "Fix duplicates first" : `Import ${preview.rows.length} housing units`}</button></div>
    </article> : null}

    <article className="panel housing-v8-inventory-list">
      <div className="housing-v8-list-head"><div><span className="kicker">Physical layout</span><h2>Hall → area → floor → room</h2><p>Rooms with the same label can safely exist in different physical areas.</p></div><SearchField value={query} onChange={setQuery} label="Find inventory" placeholder="Room, area, floor, type or sex"/></div>
      <div className="housing-v8-area-list">
        {grouped.map((group) => <details key={group.key} className="housing-v8-area-card">
          <summary><span><b>{group.area}</b><small>{group.hall} · {group.rooms.length} units · {group.capacity} spaces</small></span><span className="housing-v8-area-badges"><i>{group.male} M</i><i>{group.female} F</i>{group.flexible ? <i>{group.flexible} flex</i> : null}</span></summary>
          <div className="housing-v8-room-table" role="table" aria-label={`${group.area} rooms`}>
            {group.rooms.sort((a,b) => Number(a.sortIndex || 99999) - Number(b.sortIndex || 99999) || collator.compare(a.name,b.name)).map((room) => <div key={room.id} role="row" className="housing-v8-room-row">
              <span><b>{room.name}</b><small>{[room.floor, room.spaceType !== "room" ? room.spaceType : ""].filter(Boolean).join(" · ") || "Room"}</small></span>
              <span><b>{room.capacity}</b><small>spaces</small></span>
              <span><b>{sexLabel(room.sex)}</b><small>{room.availabilityStatus.replaceAll("_", " ")}</small></span>
              <span>{room.availabilityStatus !== "available" ? <><b>{room.availabilityStatus === "pending" ? "Needs review" : room.availabilityStatus.replaceAll("_", " ")}</b><small>not in live assignment</small></> : room.planLabel ? <><b>{room.planLabel}</b><small>planned block</small></> : <><b>Unplanned</b><small>{room.sex ? "available for planning" : "set room use when needed"}</small></>}</span>
              {canManage ? <button type="button" className="secondary housing-v8-review-room" onClick={() => setEditingRoom(room)}>Review</button> : null}
            </div>)}
          </div>
        </details>)}
        {!grouped.length ? <Empty icon={Buildings} title={rooms.length ? "No inventory matches" : "No Housing inventory yet"} text={rooms.length ? "Try another search." : "Import the hall workbook or add one room."}/> : null}
      </div>
    </article>

    {roomOpen ? <HousingInventoryRoomEditorV8 sessionId={sessionId} onClose={() => setRoomOpen(false)} onSaved={async () => { await reload(); setSaved("Housing space added. Review Plan again before live assignments."); }}/> : null}
    {editingRoom ? <HousingInventoryRoomEditorV8 sessionId={sessionId} room={editingRoom} onClose={() => setEditingRoom(null)} onSaved={async () => { await reload(); setSaved(`${editingRoom.name} updated. Review Plan again if live assignments have not started.`); }}/> : null}
  </div>;
}
