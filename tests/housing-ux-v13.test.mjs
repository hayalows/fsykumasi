import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

test("Housing uses a two-object mobile information architecture", () => {
  const page = read("src/pages/HousingV5.jsx");
  const css = read("src/housing-ux-v13.css");
  assert.match(page, /<span>People<\/span>/);
  assert.match(page, /<span>Rooms<\/span>/);
  assert.doesNotMatch(page, /<span>Assigned<\/span><b>\{assignedCount\}<\/b><\/button>/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important/);
  assert.match(css, /housing-v5-desktop-status[\s\S]*display: block !important/);
});

test("Housing never presents loading counts as confirmed zeroes", () => {
  const page = read("src/pages/HousingV5.jsx");
  assert.match(page, /initialLoading \? "—" : waitingPeople\.length/);
  assert.match(page, /initialLoading \? "—" : openSpaces/);
  assert.match(page, /initialLoading \? "—" : openRooms/);
  assert.match(page, /initialLoading \? "—" : assignedCount/);
});

test("Housing field optional markers share one stable label row", () => {
  const room = read("src/pages/HousingDialogsV4.jsx");
  const assignment = read("src/pages/HousingAssignmentV5.jsx");
  const css = read("src/housing-ux-v13.css");
  assert.match(room, /housing-field-label/);
  assert.match(room, /<b>Floor \/ area<\/b><em>Optional<\/em>/);
  assert.match(assignment, /<b>Reason for room change<\/b><em>Optional · recommended<\/em>/);
  assert.match(assignment, /<b>Bed \/ key label<\/b><em>Optional<\/em>/);
  assert.match(css, /\.housing-field-label[\s\S]*display: flex !important/);
});

test("Housing room identity wraps instead of disappearing behind ellipsis", () => {
  const css = read("src/housing-ux-v13.css");
  assert.match(css, /housing-v5-room-card > span:first-child b[\s\S]*white-space: normal !important/);
  assert.match(css, /text-overflow: clip !important/);
  assert.match(css, /overflow-wrap: anywhere/);
});

test("Housing sheets use a single bounded scrolling body", () => {
  const css = read("src/housing-ux-v13.css");
  assert.match(css, /housing-v5-assignment-layer\.layer-panel[\s\S]*overflow: hidden !important/);
  assert.match(css, /housing-v5-assignment-body[\s\S]*overflow-y: auto !important/);
  assert.match(css, /housing-v4-room-editor-layer[\s\S]*housing-v4-modal-body[\s\S]*overflow-y: auto !important/);
  assert.match(css, /height: calc\(100dvh - max\(6px, env\(safe-area-inset-top\)\)\) !important/);
});

test("Housing keeps wayfinding protection and room recommendation logic", () => {
  const assignment = read("src/pages/HousingAssignmentV5.jsx");
  const dialogs = read("src/pages/HousingDialogsV4.jsx");
  assert.match(assignment, /roomHasWayfinding\(room\)/);
  assert.match(assignment, /sameGroup > 0/);
  assert.match(assignment, /sameCompany > 0/);
  assert.match(dialogs, /locationReady/);
});

test("Housing v13 safeguards remain loaded before later workflow layers", () => {
  const main = read("src/main.jsx");
  const sw = read("public/sw.js");
  const v13 = main.indexOf('import "./housing-ux-v13.css";');
  const v14 = main.indexOf('import "./housing-ux-v14.css";');
  assert.ok(v13 > main.indexOf('import "./operations-reliability-v12.css";'));
  assert.ok(v14 > v13, "Housing workflow v14 should refine rather than bypass the v13 safeguards");
  assert.match(sw, /fsy-kumasi-shell-v38/);
  assert.match(sw, /Housing workflow v14/);
});
