import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Assignments opens the live Assistant Coordinator reassignment desk", async () => {
  const [entry, desk] = await Promise.all([
    read("src/pages/Assignments.jsx"),
    read("src/pages/AssignmentsLiveV79.jsx"),
  ]);
  assert.match(entry, /AssignmentsLiveV79/);
  assert.match(desk, /Assign or change Assistant Coordinators/);
  assert.match(desk, /Change AC/);
  assert.match(desk, /Assign AC/);
  assert.match(desk, /Make AC & assign/);
  assert.match(desk, /transitionStaffOperationalRole/);
  assert.match(desk, /setAssistantCoordinatorCompanies/);
});

test("company reassignment protects linked access and handles counselor replacement", async () => {
  const desk = await read("src/pages/AssignmentsLiveV79.jsx");
  assert.match(desk, /transferWouldOrphanActiveOwner/);
  assert.match(desk, /Assign their correct next company first/);
  assert.match(desk, /Replace the Counselor now/);
  assert.match(desk, /Leave the group open/);
  assert.match(desk, /replacementCounselorId/);
});

test("website access can be prepared immediately or left for later", async () => {
  const desk = await read("src/pages/AssignmentsLiveV79.jsx");
  assert.match(desk, /Set up website access now/);
  assert.match(desk, /Done for now/);
  assert.match(desk, /LeaderSetupFlow/);
  assert.match(desk, /Website access was already active/);
});

test("live staffing scope preserves source registration status while allowing awaiting records", async () => {
  const migration = await read("supabase/migrations/20260915082000_live_ac_reassignment_v79.sql");
  assert.match(migration, /source_registration_status_preserved/);
  assert.match(migration, /private\.staff_can_plan\(target\.id\)/);
  assert.match(migration, /target\.registration_status = 'cancelled'/);
  assert.doesNotMatch(migration, /target\.registration_status <> 'approved'/);
  assert.doesNotMatch(migration, /set registration_status = 'approved'/i);
});
