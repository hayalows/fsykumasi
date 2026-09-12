import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const migration = read("supabase/migrations/20260912093000_housing_inventory_planning_v8.sql") + "\n" + read("supabase/migrations/20260912102000_housing_inventory_safety_v9.sql");
const inventory = read("src/lib/housing-inventory-v8.js");
const housingEntry = read("src/pages/Housing.jsx");
const housingV8 = read("src/pages/HousingV8.jsx");
const plan = read("src/pages/HousingPlanningV8.jsx");
const inventoryUi = read("src/pages/HousingInventoryV8.jsx");
const assignment = read("src/pages/HousingAssignmentV5.jsx");
const roomEditor = read("src/pages/HousingInventoryRoomEditorV8.jsx");

test("housing inventory uses physical identity instead of a session-wide room label", () => {
  assert.match(migration, /drop constraint if exists housing_rooms_session_id_room_name_key/);
  assert.match(migration, /housing_inventory_key_v1/);
  assert.match(migration, /create unique index if not exists housing_rooms_session_inventory_key_idx/);
  assert.match(migration, /add column if not exists hall text/);
  assert.match(migration, /add column if not exists area text/);
});

test("bulk import is additive, pre-live only, and preserves omitted rooms", () => {
  assert.match(migration, /create or replace function public\.import_housing_inventory_v1/);
  assert.match(migration, /omitted_rooms_changed',false/);
  assert.match(migration, /Housing inventory import is locked after live room assignments begin/);
  assert.match(migration, /delete from public\.housing_room_plans/);
  assert.doesNotMatch(migration, /delete from public\.housing_rooms/i);
  assert.match(inventoryUi, /never removes a room simply because it is missing from a later file/i);
});

test("legacy manual rooms are preserved but kept out of official planning until reviewed", () => {
  assert.match(migration, /Legacy\/manual room · review before use/);
  assert.match(migration, /where r\.inventory_key like 'legacy:%'/);
  assert.match(migration, /else 'pending'/);
  assert.match(inventoryUi, /Needs review/);
});

test("single-room inventory review is audited and does not move people", () => {
  assert.match(migration, /create or replace function public\.save_housing_inventory_room_v1/);
  assert.match(migration, /housing_inventory_room_updated/);
  assert.match(migration, /Move current occupants before making this room unavailable/);
  assert.match(migration, /saved company plan/);
  assert.doesNotMatch(roomEditor, /assign_housing_person_v2/);
  assert.match(roomEditor, /Flexible \/ not decided/);
  assert.match(roomEditor, /Ready for live Housing/);
  assert.match(inventoryUi, /HousingInventoryRoomEditorV8/);
});

test("workbook parser handles Republic room sheets, SRC special spaces, and future generic sheets", () => {
  assert.match(inventory, /STANDARD_AREAS/);
  assert.match(inventory, /Flats & SRC Rooms/);
  assert.match(inventory, /SRC 1/);
  assert.match(inventory, /Generic future workbook support/);
  assert.match(inventory, /capacity: 4/);
  assert.match(inventory, /pendingAreas/);
  assert.match(inventory, /blockingIssues/);
});

test("company block planner supports attendance scenarios and keeps special spaces flexible", () => {
  assert.match(migration, /preview_housing_company_plan_v1/);
  assert.match(migration, /p_attendance_pct integer default 100/);
  assert.match(migration, /r\.space_type='room'/);
  assert.match(migration, /flex_capacity/);
  assert.match(migration, /counselor_spaces/);
  assert.match(plan, /SCENARIOS = \[50, 60, 70, 80, 90, 100\]/);
});

test("automatic planning never moves people and locks after live assignments begin", () => {
  assert.match(migration, /Automatic company planning is locked after live room assignments begin/);
  assert.doesNotMatch(migration, /update public\.housing_assignments[\s\S]*housing_company_plan_applied/);
  assert.match(plan, /does not assign any person to a room/i);
});

test("live room recommendations prefer a participant's saved company block", () => {
  assert.match(assignment, /loadHousingRoomPlanMapV8/);
  assert.match(assignment, /plannedForCompany/);
  assert.match(assignment, /Planned block/);
  assert.match(assignment, /score \+= 50000/);
  assert.match(assignment, /plannedForOtherCompany/);
});

test("Housing exposes Live, Plan, and Inventory workspaces", () => {
  assert.match(housingEntry, /HousingV8/);
  assert.match(housingV8, /Live Housing/);
  assert.match(housingV8, /Company blocks/);
  assert.match(housingV8, /Rooms & imports/);
  assert.match(inventoryUi, /Review before import/);
});
