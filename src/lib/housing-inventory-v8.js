import readExcelFile from "read-excel-file/browser";
import { isSupabaseConfigured, supabase } from "./supabase.js";

const STANDARD_AREAS = new Set([
  "Chapel Lane",
  "Bridge",
  "Republic Lane (Right)",
  "Republic Lane (Left)",
  "Annex Hall",
]);

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

function text(value) {
  return String(value ?? "").trim();
}

function norm(value) {
  return text(value).toLowerCase();
}

function normalizeSex(value) {
  const valueText = norm(value);
  if (["male", "m", "young men", "ym"].includes(valueText)) return "male";
  if (["female", "f", "young women", "yw"].includes(valueText)) return "female";
  return "";
}

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function findHeader(rows, required) {
  return rows.findIndex((row) => {
    const cells = (row || []).map(norm);
    return required.every((needle) => cells.some((cell) => cell === needle || cell.includes(needle)));
  });
}

function headerMap(row = []) {
  const map = new Map();
  row.forEach((value, index) => map.set(norm(value), index));
  return map;
}

function pickIndex(map, candidates) {
  for (const candidate of candidates) {
    if (map.has(candidate)) return map.get(candidate);
  }
  for (const [key, index] of map.entries()) {
    if (candidates.some((candidate) => key.includes(candidate))) return index;
  }
  return -1;
}

function makeKey(row) {
  return [row.hall, row.area, row.floor, row.room_name].map((value) => norm(value) || "-").join("|");
}

export async function parseHousingWorkbook(file, { defaultHall = "Republic Hall" } = {}) {
  if (!file) throw new Error("Choose an Excel workbook first.");
  const sheets = await readExcelFile(file);
  const rows = [];
  const warnings = [];
  const blockingIssues = [];
  const pendingAreas = [];
  let sortIndex = 0;

  for (const sheet of sheets) {
    const name = text(sheet.sheet);
    const data = Array.isArray(sheet.data) ? sheet.data : [];

    if (STANDARD_AREAS.has(name)) {
      const headerIndex = findHeader(data, ["floor", "room"]);
      if (headerIndex < 0) {
        warnings.push(`${name}: room header was not found.`);
        continue;
      }
      const map = headerMap(data[headerIndex]);
      const floorIndex = pickIndex(map, ["floor"]);
      const roomIndex = pickIndex(map, ["room number", "room"]);
      const sexIndex = pickIndex(map, ["gender", "sex"]);
      for (let index = headerIndex + 1; index < data.length; index += 1) {
        const source = data[index] || [];
        const roomName = text(source[roomIndex]);
        if (!roomName) continue;
        sortIndex += 1;
        rows.push({
          hall: defaultHall,
          area: name,
          floor: text(source[floorIndex]),
          room_name: roomName,
          space_type: "room",
          sex: normalizeSex(source[sexIndex]),
          capacity: 4,
          availability_status: "available",
          notes: "",
          source_sheet: name,
          source_row: index + 1,
          sort_index: sortIndex,
        });
      }
      continue;
    }

    if (name === "Flats & SRC Rooms") {
      let section = "";
      for (let index = 0; index < data.length; index += 1) {
        const first = text(data[index]?.[0]);
        const second = text(data[index]?.[1]);
        if (first.startsWith("SRC 1 — FLATS")) { section = "flat"; continue; }
        if (first.startsWith("SRC 1 — B ROOMS")) { section = "executive"; continue; }
        if (first.startsWith("SRC 2 — SRC 10")) { section = "pending"; continue; }
        if (section === "pending" && /^SRC\s+\d+$/i.test(first) && second) {
          pendingAreas.push({ area: first, detail: second });
          continue;
        }
        if ((section === "flat" || section === "executive") && first && Number.isFinite(Number(data[index]?.[1]))) {
          sortIndex += 1;
          rows.push({
            hall: defaultHall,
            area: "SRC 1",
            floor: "",
            room_name: first,
            space_type: section,
            sex: "",
            capacity: Number(data[index][1]),
            availability_status: "available",
            notes: section === "flat" ? "SRC 1 flat · use to be decided" : "SRC 1 executive room · use to be decided",
            source_sheet: name,
            source_row: index + 1,
            sort_index: sortIndex,
          });
        }
      }
      continue;
    }

    // Generic future workbook support. A sheet with a room header can be imported without code changes.
    const genericHeader = findHeader(data, ["room"]);
    if (genericHeader < 0) continue;
    const map = headerMap(data[genericHeader]);
    const roomIndex = pickIndex(map, ["room number", "room name", "room"]);
    const hallIndex = pickIndex(map, ["hall", "building"]);
    const areaIndex = pickIndex(map, ["area", "block", "wing"]);
    const floorIndex = pickIndex(map, ["floor"]);
    const capacityIndex = pickIndex(map, ["capacity", "spaces", "occupancy"]);
    const sexIndex = pickIndex(map, ["gender", "sex"]);
    const typeIndex = pickIndex(map, ["space type", "type"]);
    const statusIndex = pickIndex(map, ["status", "availability"]);
    const notesIndex = pickIndex(map, ["notes", "note"]);

    for (let index = genericHeader + 1; index < data.length; index += 1) {
      const source = data[index] || [];
      const roomName = text(source[roomIndex]);
      if (!roomName) continue;
      const hall = text(source[hallIndex]) || defaultHall;
      if (!hall) {
        warnings.push(`${name} row ${index + 1}: hall is missing.`);
        continue;
      }
      sortIndex += 1;
      rows.push({
        hall,
        area: text(source[areaIndex]) || name,
        floor: text(source[floorIndex]),
        room_name: roomName,
        space_type: ["room", "flat", "executive", "other"].includes(norm(source[typeIndex])) ? norm(source[typeIndex]) : "room",
        sex: normalizeSex(source[sexIndex]),
        capacity: Math.max(1, Math.min(50, numberOr(source[capacityIndex], 4))),
        availability_status: ["available", "reserved", "out_of_service", "pending"].includes(norm(source[statusIndex])) ? norm(source[statusIndex]) : "available",
        notes: text(source[notesIndex]),
        source_sheet: name,
        source_row: index + 1,
        sort_index: sortIndex,
      });
    }
  }

  const keyCounts = new Map();
  const labelLocations = new Map();
  rows.forEach((row) => {
    const key = makeKey(row);
    keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
    const label = norm(row.room_name);
    const locations = labelLocations.get(label) || new Set();
    locations.add(`${row.hall} · ${row.area} · ${row.floor}`);
    labelLocations.set(label, locations);
  });
  const exactDuplicates = [...keyCounts.entries()].filter(([, count]) => count > 1);
  exactDuplicates.forEach(([key, count]) => blockingIssues.push(`${key}: appears ${count} times at the same physical location. Remove the duplicate before importing.`));
  [...labelLocations.entries()].filter(([, locations]) => locations.size > 1).forEach(([label, locations]) => {
    warnings.push(`${label.toUpperCase()} appears in ${locations.size} different areas. Location keeps these as separate rooms.`);
  });

  const standard = rows.filter((row) => row.space_type === "room");
  const special = rows.filter((row) => row.space_type !== "room");
  const capacity = rows.reduce((sum, row) => sum + Number(row.capacity || 0), 0);
  const maleRooms = standard.filter((row) => row.sex === "male");
  const femaleRooms = standard.filter((row) => row.sex === "female");

  return {
    fileName: file.name || "Housing workbook",
    rows,
    warnings,
    blockingIssues,
    pendingAreas,
    summary: {
      sheets: sheets.length,
      rows: rows.length,
      standardRooms: standard.length,
      specialSpaces: special.length,
      capacity,
      standardCapacity: standard.reduce((sum, row) => sum + Number(row.capacity || 0), 0),
      specialCapacity: special.reduce((sum, row) => sum + Number(row.capacity || 0), 0),
      maleRooms: maleRooms.length,
      maleCapacity: maleRooms.reduce((sum, row) => sum + Number(row.capacity || 0), 0),
      femaleRooms: femaleRooms.length,
      femaleCapacity: femaleRooms.reduce((sum, row) => sum + Number(row.capacity || 0), 0),
      pendingAreas: pendingAreas.length,
    },
  };
}

export async function importHousingInventoryV8({ sessionId, sourceName, rows }) {
  const { data, error } = await client().rpc("import_housing_inventory_v1", {
    p_session_id: sessionId,
    p_source_name: sourceName || null,
    p_rows: rows,
  });
  if (error) throw error;
  return data;
}

export async function saveHousingInventoryRoomV8({
  sessionId,
  roomId = null,
  hall,
  area = "",
  floor = "",
  name,
  spaceType = "room",
  availabilityStatus = "available",
  sex = "",
  capacity = 1,
  notes = "",
}) {
  const { data, error } = await client().rpc("save_housing_inventory_room_v1", {
    p_session_id: sessionId,
    p_room_id: roomId || null,
    p_hall: hall || null,
    p_area: area || null,
    p_floor: floor || null,
    p_room_name: name || null,
    p_space_type: spaceType || "room",
    p_availability_status: availabilityStatus || "available",
    p_sex: sex || null,
    p_capacity: Number(capacity),
    p_notes: notes || null,
  });
  if (error) throw error;
  return data;
}

export async function loadHousingRoomsV8(sessionId) {
  const { data, error } = await client().rpc("get_housing_rooms_v8", { p_session_id: sessionId });
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id,
    name: row.room_name,
    building: row.building || "",
    hall: row.hall || "",
    area: row.area || "",
    floor: row.floor || "",
    sex: row.sex || "",
    capacity: Number(row.capacity || 0),
    occupancy: Number(row.occupancy || 0),
    notes: row.notes || "",
    active: row.active !== false,
    spaceType: row.space_type || "room",
    availabilityStatus: row.availability_status || "available",
    inventoryKey: row.inventory_key || "",
    sourceName: row.source_name || "",
    sourceSheet: row.source_sheet || "",
    sourceRow: row.source_row,
    sortIndex: row.sort_index,
    planKind: row.plan_kind || "",
    planCompanyId: row.plan_company_id || "",
    planCompanyName: row.plan_company_name || "",
    planLabel: row.plan_label || "",
    planOrder: row.plan_order,
    planAttendancePct: row.plan_attendance_pct,
  }));
}

export async function loadHousingRoomPlanMapV8(sessionId) {
  const rooms = await loadHousingRoomsV8(sessionId);
  return new Map(rooms.map((room) => [room.id, room]));
}

export async function previewHousingCompanyPlanV8(sessionId, attendancePct) {
  const { data, error } = await client().rpc("preview_housing_company_plan_v1", {
    p_session_id: sessionId,
    p_attendance_pct: Number(attendancePct),
  });
  if (error) throw error;
  return data;
}

export async function applyHousingCompanyPlanV8(sessionId, attendancePct) {
  const { data, error } = await client().rpc("apply_housing_company_plan_v1", {
    p_session_id: sessionId,
    p_attendance_pct: Number(attendancePct),
  });
  if (error) throw error;
  return data;
}

export async function clearHousingCompanyPlanV8(sessionId) {
  const { data, error } = await client().rpc("clear_housing_company_plan_v1", { p_session_id: sessionId });
  if (error) throw error;
  return data;
}

export function subscribeToHousingInventoryV8(sessionId, onChange) {
  if (!isSupabaseConfigured || !supabase || !sessionId) return () => {};
  const channel = supabase.channel(`housing-inventory-v8-${sessionId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "housing_rooms", filter: `session_id=eq.${sessionId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "housing_room_plans", filter: `session_id=eq.${sessionId}` }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
