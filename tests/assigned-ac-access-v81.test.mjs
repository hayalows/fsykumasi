import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260915111500_staff_access_operational_roster_v80.sql");
const assignmentsWrapper = read("src/pages/Assignments.jsx");
const accessDesk = read("src/pages/AssignmentsAccessV81.jsx");

test("Access directory follows the live operational Staff roster instead of source approval", () => {
  assert.match(migration, /registration_status\s*<>\s*'cancelled'/i);
  assert.match(migration, /private\.staff_can_plan\(s\.id\)/i);
  assert.match(migration, /private\.staff_can_plan\(target\.id\)/i);
  assert.doesNotMatch(migration, /registration_status\s*=\s*'approved'/i);
});

test("assigned Assistant Coordinators can finish website access later from Assignments", () => {
  assert.match(assignmentsWrapper, /AssignmentsAccessV81/);
  assert.match(accessDesk, /loadStaffAccessDirectory/);
  assert.match(accessDesk, /Finish Assistant Coordinator access/);
  assert.match(accessDesk, /Needs setup/);
  assert.match(accessDesk, /All assigned/);
  assert.match(accessDesk, /Name, company or counselor group/);
  assert.match(accessDesk, /Set up access/);
  assert.match(accessDesk, /LeaderSetupFlow/);
});

test("Assignments also provides a minimal add-leader path without requiring registration re-entry", () => {
  assert.match(accessDesk, /Add leader/);
  assert.match(accessDesk, /addingLeader/);
  assert.match(accessDesk, /requireEmail allowStaffRoles/);
});
