import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Access keeps assigned staff visible when operational status needs review", async () => {
  const [migration, access] = await Promise.all([
    read("supabase/migrations/20260915143000_access_directory_and_assignment_reliability_v85.sql"),
    read("src/pages/AccessV19.jsx"),
  ]);
  assert.match(migration, /left join public\.staff_operations o on o\.staff_id = s\.id/);
  assert.match(migration, /s\.is_current[\s\S]*s\.registration_status <> 'cancelled'[\s\S]*private\.staff_role_to_app_role\(s\.operational_role\) is not null/);
  assert.match(migration, /not private\.staff_can_plan\(s\.id\) then 'not_ready'/);
  assert.match(access, /\["not_ready", "Staff status needs review"\]/);
  assert.match(access, /Review staff status/);
  assert.match(access, /openStaffStatus\(person\.staffId\)/);
});

test("Staff readiness changes synchronize website access and missing operation rows get a safe state", async () => {
  const migration = await read("supabase/migrations/20260915143000_access_directory_and_assignment_reliability_v85.sql");
  assert.match(migration, /insert into public\.staff_operations/);
  assert.match(migration, /create trigger staff_operations_sync_login_access/);
  assert.match(migration, /perform private\.sync_staff_login_access\(new\.staff_id\)/);
  assert.match(migration, /desired_access := link_row\.access_enabled/);
  assert.match(migration, /desired_role <> 'assistant_coordinator' or cardinality\(desired_companies\) > 0/);
});

test("Access assignment helpers use current availability instead of the old approval label", async () => {
  const migration = await read("supabase/migrations/20260915143000_access_directory_and_assignment_reliability_v85.sql");
  assert.match(migration, /p_assigned and not private\.staff_can_plan\(target_staff\.id\)/);
  assert.match(migration, /Only current available Counselors can be assigned/);
  assert.match(migration, /Only current available Assistant Coordinators can be assigned/);
  assert.doesNotMatch(migration, /The staff role transition guard could not be updated/);
});

test("Access renders the directory before the background account reconciliation finishes", async () => {
  const access = await read("src/pages/AccessV19.jsx");
  assert.match(access, /Loading the access directory/);
  assert.match(access, /Syncing access/);
  assert.match(access, /setSyncError/);
  assert.match(access, /Retry check/);
  assert.match(access, /await refresh\(resolved\)/);
  assert.match(access, /reconcileNow\(resolved\)/);
});

test("The Access and assignments surfaces explain and route staff blockers", async () => {
  const [access, assignments, directory] = await Promise.all([
    read("src/pages/AccessV19.jsx"),
    read("src/pages/AssignmentsV3.jsx"),
    read("src/pages/AssignmentsAccessV81.jsx"),
  ]);
  assert.match(access, /hasMissingCompanyScope/);
  assert.match(access, /Choose companies/);
  assert.match(assignments, /access\?\.accessState === "not_ready"/);
  assert.match(assignments, /Review staff status/);
  assert.match(directory, /state === "not_ready"/);
});

test("Assistant Coordinator balancing includes current people awaiting confirmation", async () => {
  const setup = await read("src/components/LeaderSetupFlow.jsx");
  assert.match(setup, /registrationStatus !== "cancelled"/);
});
