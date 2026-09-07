import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Housing uses a fast People and Rooms workspace on constrained screens", async () => {
  const [wrapper, housing, css] = await Promise.all([
    read("src/pages/Housing.jsx"),
    read("src/pages/HousingV6.jsx"),
    read("src/housing-ux-v14.css"),
  ]);
  assert.match(wrapper, /HousingV6/);
  assert.match(housing, /housing-v6-workspace-switch/);
  assert.match(housing, /setWorkspace\("rooms"\)/);
  assert.match(housing, /setWorkspace\("people"\)/);
  assert.match(css, /@media \(max-width: 1380px\)/);
  assert.match(css, /position:\s*sticky/);
  assert.match(css, /housing-v6-layout > \.mobile-hidden[\s\S]*display:\s*none/);
});

test("Rooms expose assignable availability by room use before a user opens a room", async () => {
  const housing = await read("src/pages/HousingV6.jsx");
  assert.match(housing, /availabilityByUse/);
  assert.match(housing, /male:\s*\{ spaces: 0, rooms: 0 \}/);
  assert.match(housing, /female:\s*\{ spaces: 0, rooms: 0 \}/);
  assert.match(housing, /unrestricted:\s*\{ spaces: 0, rooms: 0 \}/);
  assert.match(housing, /roomHasWayfinding\(room\) && openSpace\(room\) > 0/);
  assert.match(housing, /Assignable spaces by room use/);
});

test("room-first assignment only shows unassigned people compatible with a restricted room", async () => {
  const detail = await read("src/pages/HousingRoomDetailV6.jsx");
  assert.match(detail, /!assignedKeys\.has\(personKey\(person\)\)/);
  assert.match(detail, /!room\.sex \|\| person\.sex === room\.sex/);
  assert.match(detail, /Checked-in arrivals are ranked first/);
  assert.match(detail, /saveHousingAssignment/);
  assert.match(detail, /Assign to \{room\.name\}/);
});

test("room-first assignment revalidates stale room and person state before writing", async () => {
  const detail = await read("src/pages/HousingRoomDetailV6.jsx");
  assert.match(detail, /loadHousingAssignmentsV2\(sessionId\)/);
  assert.match(detail, /loadHousingRooms\(sessionId\)/);
  assert.match(detail, /alreadyAssigned/);
  assert.match(detail, /This room is no longer available/);
  assert.match(detail, /await onRefresh\?\.\(\)/);
});

test("room search and filters adapt to the pane width rather than viewport width alone", async () => {
  const css = await read("src/housing-ux-v14.css");
  assert.match(css, /container-name:\s*housing-room-panel/);
  assert.match(css, /@container housing-room-panel \(max-width: 590px\)/);
  assert.match(css, /housing-v6-room-controls[\s\S]*grid-template-columns:\s*1fr !important/);
  assert.match(css, /housing-v6-room-controls \.search input[\s\S]*min-width:\s*0/);
});

test("Housing workflow v14 is the final style layer and ships PWA shell v36", async () => {
  const [main, sw] = await Promise.all([read("src/main.jsx"), read("public/sw.js")]);
  assert.ok(main.indexOf('import "./housing-ux-v14.css";') > main.indexOf('import "./housing-ux-v13.css";'));
  assert.match(sw, /fsy-kumasi-shell-v36/);
  assert.match(sw, /Housing workflow v14/);
});
