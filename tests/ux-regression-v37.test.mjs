import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("shared drawers lock the root document and use one modal action grammar", () => {
  const ui = read("src/components/UI.jsx");
  const overlays = read("src/design-system/overlays.css");
  assert.match(ui, /document\.documentElement/);
  assert.match(ui, /root\.style\.overflow = "hidden"/);
  assert.match(ui, /document\.body\.style\.overflow = "hidden"/);
  assert.match(ui, /primary danger confirm-action-primary/);
  assert.match(overlays, /\.dismissible-layer[\s\S]*position: fixed !important/);
  assert.match(overlays, /overscroll-behavior: none/);
  assert.match(overlays, /\.layer-panel[\s\S]*overscroll-behavior-y: contain/);
});

test("housing room selection is reversible and no unrestricted room workflow remains", () => {
  const assignment = read("src/pages/HousingAssignmentV5.jsx");
  const housing = read("src/pages/HousingV6.jsx");
  const editor = read("src/pages/HousingRoomEditorV7.jsx");
  assert.match(assignment, /current === nextRoomId \? currentAssignment\.roomId : nextRoomId/);
  assert.match(assignment, /current === nextRoomId \? "" : nextRoomId/);
  assert.match(assignment, /Clear selection/);
  assert.match(assignment, /Cancel move/);
  assert.match(assignment, /housing-v37-assignment-state/);
  assert.doesNotMatch(assignment, />Room status</i);
  assert.doesNotMatch(housing, /label: "Unrestricted"/);
  assert.doesNotMatch(housing, /roomUseFilter === "unrestricted"/);
  assert.match(housing, /Room type not set/);
  assert.match(editor, /Choose male or female/);
  assert.match(editor, /value="male">Male/);
  assert.match(editor, /value="female">Female/);
});

test("wellness date controls fit their own narrow column", () => {
  const css = read("src/design-system/operations.css");
  assert.match(css, /\.wellness-date-nav[\s\S]*grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.wellness-date-nav > label[\s\S]*grid-column: 1 \/ -1/);
  assert.match(css, /\.wellness-date-nav > button:last-of-type[\s\S]*grid-column: 2/);
});

test("assignments can filter counselor groups by YW or YM and hides optional meeting spot", () => {
  const assignments = read("src/pages/AssignmentsV3.jsx");
  assert.match(assignments, /groupSexFilter/);
  assert.match(assignments, />Young Women</);
  assert.match(assignments, />Young Men</);
  assert.match(assignments, /groupSexKey\(group\) === groupSexFilter/);
  assert.doesNotMatch(assignments, /company\.meetingSpot/);
});

test("groups make Assistant Coordinator and Counselor the primary live structure", () => {
  const groups = read("src/pages/GroupsV2.jsx");
  assert.match(groups, /groups-v37-company-lead/);
  assert.match(groups, /Assistant Coordinator/);
  assert.match(groups, /groups-v37-planning-flow/);
  assert.doesNotMatch(groups, /Meeting spot not set/);
  assert.doesNotMatch(groups, /Meeting locations/);
  assert.doesNotMatch(groups, /meeting spot/i);
});

test("assistant coordinator overview does not surface unscoped registration totals", () => {
  const overview = read("src/lib/overview-inbox.js");
  assert.match(overview, /registrationOverviewAccess = registrationAccess && role !== "assistant_coordinator"/);
  assert.match(overview, /if \(registrationOverviewAccess && pendingId\)/);
  assert.match(overview, /if \(registrationOverviewAccess && otherRegistrationAttention\)/);
  assert.match(overview, /if \(registrationOverviewAccess && ready\)/);
});
