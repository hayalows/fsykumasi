import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("reversible operations migration exposes additive lifecycle fields and guarded RPCs", async () => {
  const sql = await read("supabase/migrations/20260908211057_reversible_operations_v1.sql");
  for (const token of [
    "operational_status",
    "operational_revision",
    "set_participant_operational_status",
    "undo_participant_checkin",
    "clear_housing_assignment_v2",
    "restore_housing_assignment_v1",
    "set_staff_operational_status_v1",
    "cancel_meal_service_v1",
    "cancel_headcount_round_v1",
    "audit_events",
  ]) assert.match(sql, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(sql, /add column if not exists operational_status/);
  assert.match(sql, /status in \('planned','open','closed','void'\)/);
  assert.match(sql, /voided_at timestamptz/);
  assert.match(sql, /revoke all on function public\.set_participant_operational_status/);
  assert.match(sql, /grant execute on function public\.set_participant_operational_status[^\n]+authenticated/);
});

test("room capacity updates lock the room before counting occupancy", async () => {
  const sql = await read("supabase/migrations/20260908211057_reversible_operations_v1.sql");
  assert.match(sql, /select r\.capacity into old_capacity[\s\S]*?for update;[\s\S]*?select count\(\*\)::integer into occupied/);
  assert.doesNotMatch(sql, /group by r\.id, r\.capacity[\s\S]*?for update/);
  assert.match(sql, /Capacity cannot be lower than/);
});

test("live clients send revision and exact-record guards for consequential undo actions", async () => {
  const backend = await read("src/lib/backend.js");
  const housing = await read("src/pages/HousingAssignmentV5.jsx");
  const people = await read("src/pages/PeopleV2.jsx");
  assert.match(backend, /p_expected_recorded_at: expectedRecordedAt/);
  assert.match(housing, /p_expected_assignment_id|assignmentId: currentAssignment\.id/);
  assert.match(people, /operationalRevision/);
  assert.match(people, /Withdraw from session/);
});

test("field pages surface the new authorized correction flows with history-preserving copy", async () => {
  const food = await read("src/pages/FoodV3.jsx");
  const headcount = await read("src/pages/HeadcountRoster.jsx");
  const staff = await read("src/components/StaffOperationsSheet.jsx");
  assert.match(food, /cancelMealService/);
  assert.match(food, /Void this service/);
  assert.match(food, /attendance history/);
  assert.match(headcount, /cancelHeadcountRound/);
  assert.match(headcount, /Void this round/);
  assert.match(headcount, /history/);
  assert.match(staff, /setStaffOperationalStatus/);
  assert.match(staff, /Clear assignments & record status/);
});

test("operational pages keep explicit date and void/read-only states", async () => {
  const food = await read("src/pages/FoodV3.jsx");
  const headcount = await read("src/pages/HeadcountRoster.jsx");
  assert.match(food, /food-date-nav/);
  assert.match(food, /loadMealServicesV2\(sessionId, serviceDate\)/);
  assert.match(food, /selectedService\.status === "void"/);
  assert.match(headcount, /roundStatus=round\?\.status/);
  assert.match(headcount, /const closed=roundStatus!==\x27open\x27/);
  assert.match(headcount, /voided\?<div/);
});
