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
  assert.match(housing,/onClick=\{save\}[\s\S]*Move \/ update/);
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
