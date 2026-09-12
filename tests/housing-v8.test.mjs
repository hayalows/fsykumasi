import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const migration = [
  "supabase/migrations/20260912093000_housing_inventory_planning_v8.sql",
  "supabase/migrations/20260912102000_housing_inventory_safety_v9.sql",
  "supabase/migrations/20260912114500_housing_youth_staff_separation_v10.sql",
].map(read).join("\n");
const v10 = read("supabase/migrations/20260912114500_housing_youth_staff_separation_v10.sql");
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
  assert.match(plan, /SCENARIOS = \[50, 60, 70, 80, 90, 100\]/);
});

test("v10 plans youth only and reports staff beds separately", () => {
  assert.match(v10, /0::integer as counselor_spaces/);
  assert.match(v10, /as target_spaces/);
  assert.match(v10, /'youth_only',true/);
  assert.match(v10, /'male_staff_spaces'/);
  assert.match(v10, /'female_staff_spaces'/);
  assert.match(v10, /'unknown_staff_spaces'/);
  assert.match(plan, /Staff housing is separate/);
  assert.match(plan, /These beds are not included in the youth company blocks/);
  assert.doesNotMatch(plan, /one counselor space for every published counselor group/);
});

test("assignment RPC blocks youth and staff from sharing rooms", () => {
  assert.match(v10, /a\.staff_id is not null/);
  assert.match(v10, /a\.participant_id is not null/);
  assert.match(v10, /FSY staff cannot share a room with youth/);
  assert.match(v10, /plan_kind='staff'/);
  assert.match(v10, /plan_kind='company'/);
  assert.match(v10, /restore_housing_assignment_v1/);
});

test("live room picker removes opposite-person-type rooms and respects youth/staff plans", () => {
  assert.match(assignment, /roomCanReceivePerson/);
  assert.match(assignment, /occupants\.some\(\(item\) => item\.personType !== person\.kind\)/);
  assert.match(assignment, /person\.kind === "staff" && room\.planKind === "company"/);
  assert.match(assignment, /person\.kind === "participant" && room\.planKind === "staff"/);
  assert.match(assignment, /Youth rooms and saved youth company blocks stay out of this list/);
});

test("automatic planning never moves people and locks after live assignments begin", () => {
  assert.match(migration, /Automatic company planning is locked after live room assignments begin/);
  assert.doesNotMatch(migration, /update public\.housing_assignments[\s\S]*housing_company_plan_applied/);
  assert.match(plan, /no person has been assigned/i);
});

test("live participant room recommendations prefer a saved company block", () => {
  assert.match(assignment, /loadHousingRoomPlanMapV8/);
  assert.match(assignment, /person\.kind === "participant"/);
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
