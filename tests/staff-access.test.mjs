import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260904194500_staff_linked_access_and_coordinator_admin.sql");
const accessUxMigration = read("supabase/migrations/20260904214500_access_experience_presence_and_ac_company_management.sql");
const roleTransitionMigration = read("supabase/migrations/20260905121000_guided_staff_role_transitions.sql");
const accessPage = read("src/pages/AccessV4.jsx");
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
  assert.match(accessWrapper, /AccessV4/);
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
  assert.match(accessPage, /ConfirmActionSheet/);
  assert.match(accessPage, /ActionToast/);
  assert.match(accessPage, /Cancel invite/);
  assert.match(accessPage, /Invite cancelled for/);
});

test("Access still shows optional sign-in recency and authenticated private presence", () => {
  assert.match(accessPage, /Online now/);
  assert.match(accessPage, /Last signed in/);
  assert.match(presenceClient, /realtime\.setAuth\(\)/);
  assert.match(presenceClient, /private:\s*true/);
  assert.match(appShell, /trackSessionPresence\(sessionInfo\.id, userId\)/);
});

test("committee website access is part of the main directory instead of a separate primary flow", () => {
  assert.match(accessPage, /committeeActive/);
  assert.match(accessPage, /committeePending/);
  assert.match(accessPage, /allowCommittee=\{canInviteCommittee\}/);
  assert.match(accessPage, /Edit committees/);
  assert.doesNotMatch(accessPage, /Committee & older accounts/);
  assert.match(accessPage, /Older & unmatched access/);
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

test("v15 loads after the established mobile setup layer and keeps safe responsive actions", () => {
  const v11 = mainEntry.indexOf('import "./access-assignments-v11.css";');
  const v12 = mainEntry.indexOf('import "./access-assignments-v12.css";');
  const v15 = mainEntry.indexOf('import "./access-assignments-v15.css";');
  assert.ok(v12 > v11);
  assert.ok(v15 > v12);
  assert.match(v12Styles, /@media\(max-width:760px\)/);
  assert.match(v12Styles, /height:calc\(100dvh - max\(8px,env\(safe-area-inset-top\)\)\)/);
  assert.match(v12Styles, /env\(safe-area-inset-bottom\)/);
  assert.match(v12Styles, /font-size:16px/);
  assert.match(v12Styles, /min-height:48px/);
  assert.match(v12Styles, /leader-setup-footer/);
  assert.match(v12Styles, /overflow:auto/);
  assert.match(v15Styles, /leader-setup-role-options/);
  assert.match(v15Styles, /assignments-v15-quick/);
  assert.match(v15Styles, /@media\(max-width:760px\)/);
});