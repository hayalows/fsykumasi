import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260904194500_staff_linked_access_and_coordinator_admin.sql");
const accessUxMigration = read("supabase/migrations/20260904214500_access_experience_presence_and_ac_company_management.sql");
const roleTransitionMigration = read("supabase/migrations/20260905121000_guided_staff_role_transitions.sql");
const legacyMigration = read("supabase/migrations/20260907103000_access_v16_legacy_reconciliation.sql");
const accessPage = read("src/pages/AccessV5.jsx");
const accessWrapper = read("src/pages/Access.jsx");
const assignmentsPage = read("src/pages/AssignmentsV3.jsx");
const assignmentsWrapper = read("src/pages/Assignments.jsx");
const leaderSetup = read("src/components/LeaderSetupFlow.jsx");
const roleTransitionSheet = read("src/components/StaffRoleTransitionSheet.jsx");
const staffClient = read("src/lib/staff-access.js");
const operationsClient = read("src/lib/operations.js");
const presenceClient = read("src/lib/presence.js");
const appShell = read("src/components/AppShell.jsx");
const v12Styles = read("src/access-assignments-v12.css");
const v15Styles = read("src/access-assignments-v15.css");
const v16Styles = read("src/access-operations-v16.css");
const mainEntry = read("src/main.jsx");

 test("staff assignment remains authoritative while website identity is explicitly linked", () => {
  assert.match(migration, /create table if not exists public\.staff_account_links/i);
  assert.match(migration, /create or replace function private\.sync_staff_login_access/i);
  assert.match(migration, /after update of operational_role, registration_status, is_current on public\.staff/i);
  assert.match(migration, /staff_company_sync_login_access/i);
  assert.match(migration, /create or replace function public\.create_staff_leader_invite/i);
});

test("full session admins can create account-enabled leaders and the RPC returns the staff id", () => {
  assert.match(migration, /create or replace function public\.create_manual_staff_leader/i);
  assert.match(migration, /p_role not in \('assistant_coordinator','coordinator','logistics_admin','session_director'\)/i);
  assert.match(migration, /return new_id/i);
  assert.match(staffClient, /create_manual_staff_leader/);
});

test("area advisory couples are accepted by staff role validation and account synchronization", async () => {
  const areaMigration = await read("supabase/migrations/20260909193000_area_advisory_staff_access.sql");
  assert.match(areaMigration, /area_advisory_couple/);
  assert.match(areaMigration, /staff_operational_role_check/);
  assert.match(areaMigration, /sync_staff_login_access/);
  assert.match(areaMigration, /create_manual_staff_leader/);
});

test("Assistant Coordinator company scope is server protected and synchronized", () => {
  assert.match(accessUxMigration, /create or replace function public\.set_assistant_coordinator_companies/);
  assert.match(accessUxMigration, /cardinality\(desired\) > max_load/i);
  assert.match(accessUxMigration, /donor_without_scope/i);
  assert.match(accessUxMigration, /would leave % with active website access but no company/i);
  assert.match(accessUxMigration, /assistant_coordinator_companies_set/i);
  assert.match(staffClient, /set_assistant_coordinator_companies/);
});

test("one invitation flow covers leaders and committee members without changing the assignment/access boundary", () => {
  assert.match(leaderSetup, /STAFF_ROLE_OPTIONS/);
  assert.match(leaderSetup, /committee_viewer/);
  assert.match(leaderSetup, /createManualStaffLeader/);
  assert.match(leaderSetup, /setAssistantCoordinatorCompanies/);
  assert.match(leaderSetup, /createStaffLeaderInvite/);
  assert.match(leaderSetup, /onCreateCommitteeInvite/);
  assert.match(leaderSetup, /Access follows responsibility/);
  assert.match(leaderSetup, /Use balanced suggestion/);
  assert.match(leaderSetup, /Nothing else is needed on another page/);
});

test("active Access uses one invitation entry point and keeps responsibility visible", () => {
  assert.match(accessWrapper, /AccessV5/);
  assert.match(accessPage, /LeaderSetupFlow/);
  assert.match(accessPage, /Invite someone/);
  assert.match(accessPage, /Committee member/);
  assert.match(accessPage, /committeeNames/);
  assert.match(accessPage, /Name, email, role, company or committee/);
  assert.match(accessPage, /Needs action/);
  assert.doesNotMatch(accessPage, /goToAssignments/);
  assert.doesNotMatch(accessPage, /Open Assignments/);
  assert.doesNotMatch(accessPage, /StaffAccessInvite/);
});

test("Access keeps secondary and destructive account actions progressive", () => {
  assert.match(accessPage, /className="staff-access-more"/);
  assert.match(accessPage, /Edit committees/);
  assert.match(accessPage, /Committee tools/);
  assert.match(accessPage, /Recovery/);
  assert.match(accessPage, /Disable sign-in/);
  assert.match(accessPage, /Retire old access/);
  assert.match(accessPage, /ConfirmActionSheet/);
  assert.match(accessPage, /ActionToast/);
  assert.match(accessPage, /Cancel invite/);
  assert.match(accessPage, /Invite cancelled for/);
});

test("Access shows real-time presence plus recent sign-in metadata", () => {
  assert.match(accessPage, /Online now/);
  assert.match(accessPage, /Last signed in/);
  assert.match(accessPage, /loadSessionAccountActivity/);
  assert.match(accessPage, /window\.setInterval/);
  assert.match(presenceClient, /realtime\.setAuth\(\)/);
  assert.match(presenceClient, /private:\s*true/);
  assert.match(appShell, /trackSessionPresence\(sessionInfo\.id, userId\)/);
});

test("legacy staff-level access joins the main directory and has a guided move path", () => {
  assert.match(accessPage, /legacyAccounts/);
  assert.match(accessPage, /legacyInvites/);
  assert.match(accessPage, /legacyRequests/);
  assert.match(accessPage, /Move to new system/);
  assert.match(accessPage, /LegacyAccessMigration/);
  assert.doesNotMatch(accessPage, /Older & unmatched access/);
  assert.match(legacyMigration, /create or replace function public\.adopt_legacy_access_account/i);
  assert.match(legacyMigration, /perform private\.sync_staff_login_access\(target\.id\)/i);
  assert.match(legacyMigration, /create or replace function public\.retire_legacy_access_account/i);
  assert.match(staffClient, /adopt_legacy_access_account/);
  assert.match(staffClient, /retire_legacy_access_account/);
});

test("committee website access remains part of the main directory", () => {
  assert.match(accessPage, /committeeActive/);
  assert.match(accessPage, /committeePending/);
  assert.match(accessPage, /allowCommittee=\{canInviteCommittee/);
  assert.match(accessPage, /Edit committees/);
  assert.doesNotMatch(accessPage, /Committee & older accounts/);
});

test("active Assignments keeps three workspaces and links unfinished website work to Access", () => {
  assert.match(assignmentsWrapper, /AssignmentsV3/);
  assert.match(assignmentsPage, /value: "people", label: "People"/);
  assert.match(assignmentsPage, /value: "groups", label: "Counselor groups"/);
  assert.match(assignmentsPage, /value: "companies", label: "Companies"/);
  assert.match(assignmentsPage, /LeaderSetupFlow/);
  assert.match(assignmentsPage, /Add & set up leader/);
  assert.match(assignmentsPage, /Website access/);
  assert.match(assignmentsPage, /goToAccess/);
  assert.match(assignmentsPage, /Open Access/);
  assert.match(assignmentsPage, /Committee access is managed in Access/);
  assert.match(assignmentsPage, /accessStateLabel/);
});

test("Assignments remains gap-first and deterministic for suggested coverage", () => {
  assert.match(assignmentsPage, /useState\("needs"\)/);
  assert.match(assignmentsPage, /Needs Counselor/);
  assert.match(assignmentsPage, /Assistant Coordinator/);
  assert.match(assignmentsPage, /Suggest coverage/);
  assert.match(assignmentsPage, /Review before applying/);
  assert.match(assignmentsPage, /Nothing changes until you apply it/);
  assert.match(assignmentsPage, /suggestionRows/);
  assert.doesNotMatch(assignmentsPage, /Math\.random/);
});

test("role changes remain one atomic guided transition", () => {
  assert.match(roleTransitionMigration, /create or replace function public\.transition_staff_operational_role/i);
  assert.match(roleTransitionMigration, /perform public\.set_assistant_coordinator_companies\(target\.id, desired_company_ids\)/i);
  assert.match(operationsClient, /transition_staff_operational_role/);
  assert.match(assignmentsPage, /StaffRoleTransitionSheet/);
  assert.match(roleTransitionSheet, /Website access follows the assignment/);
});

test("v16 loads last and preserves established responsive access layers", () => {
  const v11 = mainEntry.indexOf('import "./access-assignments-v11.css";');
  const v12 = mainEntry.indexOf('import "./access-assignments-v12.css";');
  const v15 = mainEntry.indexOf('import "./access-assignments-v15.css";');
  const v16 = mainEntry.indexOf('import "./access-operations-v16.css";');
  assert.ok(v12 > v11);
  assert.ok(v15 > v12);
  assert.ok(v16 > v15);
  assert.match(v12Styles, /leader-setup-footer/);
  assert.match(v12Styles, /overflow:auto/);
  assert.match(v15Styles, /leader-setup-role-options/);
  assert.match(v15Styles, /assignments-v15-quick/);
  assert.match(v16Styles, /access-v4-directory\{overflow:visible!important\}/);
  assert.match(v16Styles, /leader-setup-flow:has\(\.leader-setup-success\)/);
  assert.match(v16Styles, /account-choice-list-v2\{max-height:none!important;overflow:visible!important/);
});
