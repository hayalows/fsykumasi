import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Housing exposes reversible unassign actions instead of hiding them in advanced details", async () => {
  const [editor, room, housing] = await Promise.all([
    read("src/pages/HousingAssignmentV5.jsx"),
    read("src/pages/HousingRoomDetailV6.jsx"),
    read("src/pages/HousingV6.jsx"),
  ]);
  assert.match(editor, /housing-v36-current-room/);
  assert.match(editor, />Unassign room<\/button>/);
  assert.match(editor, /clearHousingAssignment\(\{ sessionId, personType: person\.kind, personId: person\.id, assignmentId: currentAssignment\.id \}\)/);
  assert.match(editor, /They will move back to the Needs room list/);
  assert.match(room, /housing-v36-room-unassign/);
  assert.match(room, /clearHousingAssignment/);
  assert.match(room, /restoreHousingAssignment/);
  assert.match(room, /actionLabel="Undo"/);
  assert.match(housing, /restoreHousingAssignment/);
});

test("Assignments uses plain staff status language and explains the three separate concepts", async () => {
  const [page, sheet] = await Promise.all([
    read("src/pages/AssignmentsV3.jsx"),
    read("src/components/StaffOperationsSheet.jsx"),
  ]);
  assert.match(page, />Staff status<\/button>/);
  assert.doesNotMatch(page, />Arrival & service<\/button>/);
  assert.match(page, /plan, presence, and service readiness/);
  assert.match(sheet, /<small>Plan<\/small>/);
  assert.match(sheet, /<small>Presence<\/small>/);
  assert.match(sheet, /<small>Ready to serve<\/small>/);
  assert.match(sheet, /physically at the FSY session/);
  assert.match(sheet, /Session Directing Couple has confirmed they may actively serve/);
  assert.doesNotMatch(sheet, /Staff arrival & service/);
});

test("Housing and staff sheets own one scroll region and keep their actions reachable on small screens", async () => {
  const css = await read("src/operations-product-v36.css");
  assert.match(css, /\.housing-v5-assignment-body,\.housing-v6-room-detail-body\{[\s\S]*overflow-y:auto/);
  assert.match(css, /\.housing-v36-assignment-actions,\.housing-v6-room-assign-footer\{[\s\S]*bottom:0/);
  assert.match(css, /\.staff-status-v36\{[\s\S]*overflow-y:auto!important/);
  assert.match(css, /\.staff-status-v36-actions\{[\s\S]*bottom:0/);
  assert.match(css, /height:100dvh/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /env\(safe-area-inset-bottom,0px\)/);
});

test("Food keeps live serving primary while secondary controls and dietary review remain separate", async () => {
  const [page, css] = await Promise.all([
    read("src/pages/FoodV3.jsx"),
    read("src/operations-product-v36.css"),
  ]);
  assert.match(page, /Serving now/);
  assert.match(page, /Find participant/);
  assert.match(page, /Tap the row when food is handed over\. You can undo the last change\./);
  assert.match(page, /Meal details & controls/);
  assert.match(page, /Dietary accommodations/);
  assert.match(css, /\.food-v3-service\.live/);
  assert.match(css, /\.food-meal-row\{/);
  assert.match(css, /\.food-v3-secondary/);
  assert.match(css, /\.food-dietary-row/);
});

test("operations product layer loads after previous release styles", async () => {
  const main = await read("src/main.jsx");
  const previous = main.indexOf('import "./pages/wellness-v35.css";');
  const current = main.indexOf('import "./operations-product-v36.css";');
  assert.ok(previous >= 0 && current > previous);
});
