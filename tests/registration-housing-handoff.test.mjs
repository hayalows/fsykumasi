import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Housing starts with checked-in arrivals instead of the whole unassigned roster", async () => {
  const housing = await read("src/pages/HousingV4.jsx");
  assert.match(housing, /personStatus,setPersonStatus\]=useState\("arrivals"\)/);
  assert.match(housing, /Live handoff from Registration/);
  assert.match(housing, /Arrivals waiting/);
  assert.match(housing, /loadHousingArrivalQueue/);
  assert.match(housing, /subscribeToHousingHandoff/);
  assert.match(housing, /Oldest waiting participants appear first/);
  assert.match(housing, /Overall housing coverage/);
});

test("the handoff is derived from check-in and disappears after Housing assignment", async () => {
  const [migration, lib] = await Promise.all([
    read("supabase/migrations/20260905012000_registration_housing_handoff.sql"),
    read("src/lib/housing-handoff.js"),
  ]);
  assert.match(migration, /join public\.check_ins ci/);
  assert.match(migration, /ci\.status='arrived'/);
  assert.match(migration, /not exists \([\s\S]*public\.housing_assignments ha/);
  assert.match(lib, /table: "check_ins"/);
  assert.match(lib, /table: "housing_assignments"/);
});

test("Housing room work remains complete and adaptive", async () => {
  const [housing, dialogs, css] = await Promise.all([
    read("src/pages/HousingV4.jsx"),
    read("src/pages/HousingDialogsV4.jsx"),
    read("src/pages/housing-handoff.css"),
  ]);
  assert.match(housing, /Availability/);
  assert.match(housing, /Spaces available/);
  assert.match(dialogs, /Create room & assign/);
  assert.match(dialogs, /Reason for room change/);
  assert.match(dialogs, /Bed \/ key label/);
  assert.match(css, /@media \(max-width:700px\)/);
  assert.match(css, /housing-v4-room-choices\{max-height:none;overflow:visible\}/);
  assert.match(css, /min-height:50px/);
  assert.match(css, /prefers-reduced-motion/);
});
