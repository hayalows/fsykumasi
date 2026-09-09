import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("runtime failures are translated and recovery offers retry plus sign-in", async () => {
  const [app, errors] = await Promise.all([read("src/App.jsx"), read("src/lib/ux-errors.js")]);
  assert.match(app, /friendlyRuntimeError\(runtimeError\)/);
  assert.match(app, /Try again/);
  assert.match(app, /Return to sign in/);
  assert.match(app, /Support reference/);
  assert.match(errors, /issued at future/);
  assert.doesNotMatch(app, /<p>\{runtimeError\}<\/p>/);
});

test("shared action language supports undo and consequence confirmations", async () => {
  const ui = await read("src/components/UI.jsx");
  assert.match(ui, /export function ActionToast/);
  assert.match(ui, /actionLabel = "Undo"/);
  assert.match(ui, /export function ConfirmActionSheet/);
  assert.match(ui, /confirm-action-impact/);
});

test("head count is exception-first and protects bulk and close actions", async () => {
  const source = await read("src/pages/HeadcountRoster.jsx");
  assert.match(source, /Needs attention/);
  assert.match(source, /STATUS_ORDER = \{ missing:0, known_elsewhere:1, unresolved:2/);
  assert.match(source, /groupRows\(scoped\)/);
  assert.match(source, /undoPerson/);
  assert.match(source, /Confirm remaining present/);
  assert.match(source, /Close head count/);
});

test("Food live service puts finding a participant before meal management and supports undo", async () => {
  const source = await read("src/pages/FoodV3.jsx");
  assert.ok(source.indexOf("Find participant") < source.indexOf("Meal details & controls"));
  assert.match(source, /ActionToast/);
  assert.match(source, /undoLast/);
  assert.match(source, /ConfirmActionSheet/);
  assert.match(source, /Close \{selectedService\.label\}/);
});

test("People is search-first and normal records do not receive a Ready badge", async () => {
  const source = await read("src/pages/PeopleV2.jsx");
  assert.match(source, /if\(!query\.trim\(\)\)return \[\]/);
  assert.match(source, /Start with a name or FSY ID/);
  assert.match(source, /participant&&!eligibility\.ok/);
  assert.doesNotMatch(source, /<Status[^>]*>Ready<\/Status>/);
});

test("mobile navigation is stable by responsibility and global person search is available", async () => {
  const shell = await read("src/components/AppShell.jsx");
  assert.match(shell, /currentRole === "assistant_coordinator"/);
  assert.match(shell, /currentRole === "committee_viewer"/);
  assert.match(shell, /Find a participant or staff member/);
  assert.doesNotMatch(shell, /activeSecondary.*mobileItems/s);
});

test("Access is person-first with a protected disable action", async () => {
  const source = await read("src/pages/AccessV2.jsx");
  assert.match(source, /Invite person/);
  assert.match(source, /Start with the person/);
  assert.match(source, /Disable .*sign-in/);
  assert.match(source, /ActionToast/);
  assert.match(source, /ConfirmActionSheet/);
});

test("Registration separates live arrivals, one Final roster queue and supporting Readiness", async () => {
  const [source, readiness, journey] = await Promise.all([
    read("src/pages/Registration.jsx"),
    read("src/pages/RegistrationReadinessV30.jsx"),
    read("src/pages/RegistrationJourneyV29.jsx"),
  ]);
  assert.match(source, /Live check-in/);
  assert.match(source, /Final roster/);
  assert.match(source, /Readiness/);
  assert.match(source, /RegistrationReadinessV30/);
  assert.doesNotMatch(source, /Preflight review|Final roster table|Before session|Prepare/);
  assert.match(journey, /One final participant queue/);
  assert.match(readiness, /One final participant queue/);
});

test("Housing unassign explains the consequence before changing the assignment", async () => {
  const source = await read("src/pages/HousingAssignmentV5.jsx");
  assert.match(source, />Unassign room<\/button>/);
  assert.match(source, /They will move back to the Needs room list/);
  assert.match(source, /without deleting the person or their Housing history/);
  assert.match(source, /ConfirmActionSheet/);
});

test("Groups separates live structure from planning controls", async () => {
  const source = await read("src/pages/GroupsV2.jsx");
  assert.match(source, /Live structure/);
  assert.match(source, /Planning/);
  assert.match(source, /Edit structure/);
  assert.match(source, /My company/);
});

test("Wellness leads with the current queue before new-visit search", async () => {
  const source = await read("src/pages/WellnessV2.jsx");
  assert.ok(source.indexOf("Current priority") < source.indexOf("New visit"));
  assert.match(source, /Oldest active visit appears first/);
  assert.doesNotMatch(source, /SearchField[^>]*autoFocus/);
});

test("operational UX overrides load last", async () => {
  const main = await read("src/main.jsx");
  const account = main.indexOf('import "./account-page-v9.css";');
  const operational = main.indexOf('import "./operations-ux-v10.css";');
  assert.ok(operational > account);
});
