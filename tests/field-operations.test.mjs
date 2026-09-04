import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { operationalEligibility } from "../src/lib/registration.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("server eligibility overrides the broad planning-age fallback", () => {
  const person = { isCurrent:true, registrationStatus:"approved", verificationStatus:"verified", age:18, serverEligibility:{ eligible:false, reason:"Turns 19 before or on the end of this session" } };
  assert.deepEqual(operationalEligibility(person,{ participantMinAge:13, participantMaxAge:20 }), { ok:false, reason:"Turns 19 before or on the end of this session" });
});

test("confirmed non-attendance stays out of operations", () => {
  const person = { isCurrent:true, registrationStatus:"approved", verificationStatus:"verified", age:17, attendanceStatus:"confirmed_not_attending" };
  assert.equal(operationalEligibility(person).ok,false);
});

test("field modules are capability-driven and website access follows Assignments", async () => {
  const [shell,access,fieldLib] = await Promise.all([read("src/components/AppShell.jsx"),read("src/pages/Access.jsx"),read("src/lib/field-operations.js")]);
  assert.match(shell,/housing_view/); assert.match(shell,/wellness_private/); assert.match(shell,/food_view/);
  assert.match(access,/Their FSY role and company responsibility stay connected to Assignments automatically/);
  assert.match(access,/Full Session Administrators/);
  assert.match(access,/Older \/ exception access/);
  assert.match(access,/onManageLeaderAccess/);
  assert.match(fieldLib,/manage_leader_access/); assert.match(fieldLib,/get_session_team_catalog/);
});

test("field mutation controls are wired to their save actions", async () => {
  const [housing,access,invite] = await Promise.all([read("src/pages/Housing.jsx"),read("src/pages/Access.jsx"),read("src/components/StaffAccessInvite.jsx")]);
  assert.match(housing,/onClick=\{save\}/);
  assert.match(housing,/const primaryLabel[\s\S]*Save assignment/);
  assert.match(housing,/onClick=\{createAndAssign\}[\s\S]*Create room & assign/);
  assert.match(access,/onClick=\{save\}[\s\S]*Save exception account/);
  assert.match(invite,/onSubmit=\{submit\}[\s\S]*Create setup link/);
});

test("sensitive modules call guarded server RPCs", async () => {
  const [housing,wellness,food] = await Promise.all([read("src/pages/Housing.jsx"),read("src/pages/Wellness.jsx"),read("src/pages/Food.jsx")]);
  assert.match(housing,/housing_manage/); assert.match(wellness,/wellness_private/); assert.match(food,/food_view/);
  assert.doesNotMatch(food,/medicalInformation/);
});

test("migration source keeps canonical teams and narrow capability boundaries", async () => {
  const migration = await read("supabase/migrations/20260902211229_team_access_foundation.sql");
  for (const team of ["housing","wellness","food","registration","staff","inclusion","facilities","materials","financial","publicity","logistics"]) assert.match(migration,new RegExp(`'${team}'`));
  assert.match(migration,/effective_capabilities/); assert.match(migration,/manage_leader_access/); assert.match(migration,/team_memberships/);
  assert.match(migration,/target_session,'housing','Housing',[\s\S]*'people_lookup','groups_view','housing_view','housing_manage','housing_export','reports_export'/);
  const wellness = await read("supabase/migrations/20260902211317_wellness_and_food_operations.sql");
  assert.match(wellness,/wellness_private/); assert.match(wellness,/get_food_needs/); assert.match(wellness,/dietary_information/);
});

test("team company visibility and Housing eligibility are enforced server-side", async () => {
  const [companyVisibility,housingEligibility] = await Promise.all([
    read("supabase/migrations/20260902214156_team_group_company_visibility.sql"),
    read("supabase/migrations/20260902214207_housing_requires_operational_participant.sql"),
  ]);
  assert.match(companyVisibility,/has_team_capability\(session_id, 'groups_view'\)/);
  assert.match(housingEligibility,/operational_participant_is_eligible\(p_session_id,p_person_id\)/);
  assert.match(housingEligibility,/revoke all on function public\.assign_housing_person[\s\S]*from public,anon/);
});

test("Housing shows the complete people universe instead of silently truncating the roster", async () => {
  const housing = await read("src/pages/Housing.jsx");
  assert.match(housing,/People to house/);
  assert.match(housing,/participants ·/);
  assert.match(housing,/staff/);
  assert.match(housing,/personStatus, setPersonStatus.*needs/);
  assert.match(housing,/Everyone/);
  assert.match(housing,/Participants/);
  assert.match(housing,/Staff/);
  assert.doesNotMatch(housing,/slice\(0,\s*80\)/);
  assert.match(housing,/PERSON_BATCH = 60/);
  assert.match(housing,/Show \{Math\.min\(PERSON_BATCH/);
});

test("Housing room browsing scales and uses a clear availability disclosure", async () => {
  const [housing,styles] = await Promise.all([read("src/pages/Housing.jsx"),read("src/pages/housing-polish.css")]);
  assert.match(housing,/ROOM_BATCH = 24/);
  assert.match(housing,/Search housing rooms/);
  assert.match(housing,/Availability/);
  assert.match(housing,/All rooms ·/);
  assert.match(housing,/Spaces available ·/);
  assert.match(housing,/Full rooms ·/);
  assert.match(housing,/Open spaces/);
  assert.match(housing,/room\.occupancy/);
  assert.match(housing,/Show \{Math\.min\(ROOM_BATCH/);
  assert.match(styles,/\.housing-room-filter/);
  assert.match(styles,/\.housing-room-capacity/);
  assert.match(styles,/@media \(max-width: 760px\)/);
});

test("Housing person-first assignment can create a compatible room in one transaction", async () => {
  const [housing,client,migration] = await Promise.all([
    read("src/pages/Housing.jsx"),
    read("src/lib/housing-actions.js"),
    read("supabase/migrations/20260904230500_housing_move_reason_and_assignment_v2.sql"),
  ]);
  assert.match(housing,/Create new room/);
  assert.match(housing,/Create room & assign/);
  assert.match(housing,/automatically use/);
  assert.match(client,/create_housing_room_and_assign_v2/);
  assert.match(migration,/create or replace function public\.create_housing_room_and_assign_v2/);
  assert.match(migration,/person_sex/);
  assert.match(migration,/public\.save_housing_room/);
  assert.match(migration,/public\.assign_housing_person_v2/);
  assert.match(migration,/grant execute[\s\S]*to authenticated/);
});

test("Housing room moves expose an optional recommended reason and preserve it in audit history", async () => {
  const [housing,client,migration] = await Promise.all([
    read("src/pages/Housing.jsx"),
    read("src/lib/housing-actions.js"),
    read("supabase/migrations/20260904230500_housing_move_reason_and_assignment_v2.sql"),
  ]);
  assert.match(housing,/Reason for room change/);
  assert.match(housing,/Optional · recommended/);
  assert.match(housing,/roomChanged/);
  assert.match(client,/p_move_reason/);
  assert.match(migration,/housing_assignment_updated/);
  assert.match(migration,/housing_moved/);
  assert.match(migration,/'move_reason'/);
  assert.match(migration,/previous_row\.room_id=p_room_id/);
});

test("Housing room detail uses passive arrival metadata rather than button-like status pills", async () => {
  const [housing,styles] = await Promise.all([read("src/pages/Housing.jsx"),read("src/pages/housing-polish.css")]);
  assert.match(housing,/Awaiting check-in/);
  assert.match(housing,/housing-arrival-state/);
  assert.match(housing,/room-occupant-row-v3/);
  assert.doesNotMatch(housing,/room-occupant-state[^\n]*<Status/);
  assert.match(styles,/\.housing-arrival-state\.waiting/);
  assert.match(styles,/\.room-occupant-row-v3/);
});

test("Housing modals use responsive task-focused surfaces", async () => {
  const [housing,styles,polish] = await Promise.all([read("src/pages/Housing.jsx"),read("src/pages/housing-ux.css"),read("src/pages/housing-polish.css")]);
  assert.match(housing,/housing-room-detail-modal/);
  assert.match(housing,/housing-assignment-modal/);
  assert.match(housing,/housing-room-editor-modal/);
  assert.match(housing,/Location & notes/);
  assert.match(housing,/Assignment details/);
  assert.match(polish,/width: min\(900px/);
  assert.match(styles,/border-radius: 22px 22px 0 0/);
  assert.match(styles,/env\(safe-area-inset-bottom\)/);
});
