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

test("meal voiding is leadership-only in both the UI and the guarded RPC", async () => {
  const food = await read("src/pages/FoodV3.jsx");
  const sql = await read("supabase/migrations/20260908211057_reversible_operations_v1.sql");
  assert.match(food, /const canVoid = \["coordinator", "logistics_admin", "session_director"\]/);
  assert.match(food, /canVoid&&selectedService\.status!==['"]void['"]/);
  assert.match(food, /!selectedService \|\| !canVoid \|\| voidReason\.trim\(\)\.length < 5/);
  assert.match(sql, /cancel_meal_service_v1[\s\S]*?has_session_role\(target\.session_id, array\['coordinator','logistics_admin','session_director'\]/);
  assert.doesNotMatch(sql, /cancel_meal_service_v1[\s\S]*?has_capability\(target\.session_id, 'food_manage'\)/);
});

test("check-in keeps the existing eligibility and published-group guards", async () => {
  const sql = await read("supabase/migrations/20260908211057_reversible_operations_v1.sql");
  const checkin = sql.slice(sql.indexOf("create or replace function public.record_participant_checkin"), sql.indexOf("create or replace function public.set_participant_operational_status"));
  assert.match(checkin, /private\.operational_participant_is_eligible\(p_session_id, p_participant_id\)/);
  assert.match(checkin, /g\.state = 'published'/);
  assert.match(checkin, /Participant still needs a counselor group assignment/);
});

test("participant lifecycle releases only open head-count work and fails fast on baseline drift", async () => {
  const sql = await read("supabase/migrations/20260908211057_reversible_operations_v1.sql");
  const lifecycle = sql.slice(sql.indexOf("create or replace function public.set_participant_operational_status"), sql.indexOf("-- Undo is safe only"));
  assert.match(lifecycle, /update public\.headcount_round_people hp[\s\S]*?status = 'not_expected'/);
  assert.match(lifecycle, /hr\.closes_at is null/);
  assert.match(lifecycle, /headcount_released_count/);
  assert.match(sql, /participant_eligibility_projection\(uuid\)'\) is null[\s\S]*?raise exception 'Expected private\.participant_eligibility_projection/);
  assert.match(sql, /body = original[\s\S]*?Eligibility projection baseline drifted/);
  assert.match(sql, /get_operational_report\(uuid,text\)'\) is null[\s\S]*?raise exception 'Expected public\.get_operational_report/);
  assert.match(sql, /Operational report baseline drifted/);
  assert.match(sql, /get_my_operational_overview\(uuid\)'\) is null[\s\S]*?raise exception 'Expected public\.get_my_operational_overview/);
  for (const action of ["housing_room_created", "housing_room_updated", "housing_unassigned_for_participant_status", "housing_assignment_restored"]) {
    assert.match(sql, new RegExp(`''${action}''`));
  }
});

test("registration capability holders receive lifecycle reads while assistant scope stays narrow", async () => {
  const sql = await read("supabase/migrations/20260908211057_reversible_operations_v1.sql");
  const reads = sql.slice(sql.indexOf("create or replace function public.get_participant_operational_states"), sql.indexOf("-- Keep the server permission boundary aligned"));
  for (const capability of ["people_lookup", "registration_view", "registration_manage", "reports_export"]) {
    assert.match(reads, new RegExp(`has_capability\\(p_session_id, '${capability}'\\)`));
  }
  assert.match(reads, /assistant_coordinator/);
  const checkin = sql.slice(sql.indexOf("-- Keep the server permission boundary aligned"), sql.indexOf("create or replace function public.set_participant_operational_status"));
  assert.match(checkin, /checkin_record/);
  assert.match(checkin, /not private\.has_session_role\(p_session_id, array\['assistant_coordinator'\]/);
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

test("Wellness keeps date navigation coherent without widening private access", async () => {
  const wellness = await read("src/pages/WellnessV3.jsx");
  const styles = await read("src/pages/wellness-v3.css");
  assert.match(wellness, /wellness-date-nav/);
  assert.match(wellness, /Previous day/);
  assert.match(wellness, /Next day/);
  assert.match(wellness, /Return to Today/);
  assert.match(wellness, /const\[activityDate,setActivityDate\]/);
  assert.match(wellness, /canViewPrivate\?encounters:statusRows/);
  assert.match(wellness, /statusOnly=\{!canViewPrivate\}/);
  assert.match(wellness, /const openLabel=historical\?"Open after this date":"At Wellness now"/);
  assert.match(wellness, /historical=\{!isToday\}/);
  assert.match(wellness, /loadWellnessStatus/);
  assert.match(styles, /@media \(max-width: 520px\)/);
});

test("demo readiness and assignments do not masquerade as live empty states", async () => {
  const readiness = await read("src/pages/RegistrationReadinessV30.jsx");
  const assignments = await read("src/pages/AssignmentsV3.jsx");
  assert.match(readiness, /const demoMode = !live \|\| !sessionId/);
  assert.match(readiness, /DemoReadinessTool/);
  assert.match(readiness, /FSY IDs are not issued in demo mode/);
  assert.match(readiness, /Staff readiness is not simulated in demo mode/);
  assert.match(assignments, /const demoMode = !sessionId/);
  assert.match(assignments, /Assignments are not simulated in demo mode/);
  assert.match(assignments, /Live structure required/);
  assert.match(assignments, /Staff is not seeded in demo mode/);
  assert.match(assignments, /Live assignment planning is unavailable in rehearsal mode/);
  const registrationParts = await read("src/pages/RegistrationJourneyPartsV4.jsx");
  const registration = await read("src/pages/RegistrationJourneyV29.jsx");
  assert.match(registrationParts, /Mark did not arrive/);
  assert.match(registrationParts, /restoring the participant requires a fresh placement review/);
  assert.match(registration, /did_not_arrive/);
});
