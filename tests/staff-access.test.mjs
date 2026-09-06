import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260904194500_staff_linked_access_and_coordinator_admin.sql", import.meta.url), "utf8");
const triggerFix = readFileSync(new URL("../supabase/migrations/20260904194600_staff_access_trigger_fix.sql", import.meta.url), "utf8");
const accessUxMigration = readFileSync(new URL("../supabase/migrations/20260904214500_access_experience_presence_and_ac_company_management.sql", import.meta.url), "utf8");
const roleTransitionMigration = readFileSync(new URL("../supabase/migrations/20260905121000_guided_staff_role_transitions.sql", import.meta.url), "utf8");
const accessPage = readFileSync(new URL("../src/pages/AccessV3.jsx", import.meta.url), "utf8");
const accessWrapper = readFileSync(new URL("../src/pages/Access.jsx", import.meta.url), "utf8");
const assignmentsPage = readFileSync(new URL("../src/pages/AssignmentsV2.jsx", import.meta.url), "utf8");
const assignmentsWrapper = readFileSync(new URL("../src/pages/Assignments.jsx", import.meta.url), "utf8");
const committeeSetup = readFileSync(new URL("../src/components/CommitteeAccessSetup.jsx", import.meta.url), "utf8");
const roleTransitionSheet = readFileSync(new URL("../src/components/StaffRoleTransitionSheet.jsx", import.meta.url), "utf8");
const transitionStyles = readFileSync(new URL("../src/components/staff-role-transition.css", import.meta.url), "utf8");
const operationsClient = readFileSync(new URL("../src/lib/operations.js", import.meta.url), "utf8");
const staffClient = readFileSync(new URL("../src/lib/staff-access.js", import.meta.url), "utf8");
const presenceClient = readFileSync(new URL("../src/lib/presence.js", import.meta.url), "utf8");
const companySheet = readFileSync(new URL("../src/components/AssistantCompanySheet.jsx", import.meta.url), "utf8");
const appShell = readFileSync(new URL("../src/components/AppShell.jsx", import.meta.url), "utf8");
const uiComponents = readFileSync(new URL("../src/components/UI.jsx", import.meta.url), "utf8");
const modalSystem = readFileSync(new URL("../src/modal-system.css", import.meta.url), "utf8");
const v11Styles = readFileSync(new URL("../src/access-assignments-v11.css", import.meta.url), "utf8");
const mainEntry = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");

test("staff and login identity are linked explicitly", () => {
  assert.match(migration, /create table if not exists public\.staff_account_links/i);
  assert.match(migration, /add column if not exists staff_id uuid references public\.staff/i);
  assert.match(migration, /unique \(session_id, user_id\)/i);
});

test("coordinator is a full session access administrator", () => {
  assert.match(migration, /aa\.role in \('coordinator','logistics_admin','session_director'\)/i);
  assert.match(migration, /'reports_export','access_admin'/i);
  assert.doesNotMatch(migration, /Only a logistical administrator or session directing couple can change elevated access/i);
});

test("staff-linked invitations use current Assignments at activation", () => {
  assert.match(migration, /create or replace function private\.sync_staff_login_access/i);
  assert.match(migration, /create or replace function public\.create_staff_leader_invite/i);
  assert.match(migration, /invite_row\.staff_id is not null/i);
  assert.match(migration, /perform private\.sync_staff_login_access\(invite_row\.staff_id\)/i);
});

test("role and company changes automatically synchronize linked accounts", () => {
  assert.match(migration, /after update of operational_role, registration_status, is_current on public\.staff/i);
  assert.match(migration, /staff_company_sync_login_access/i);
  assert.match(triggerFix, /if tg_op='DELETE'/i);
});

test("the last full session administrator is protected", () => {
  assert.match(migration, /You cannot remove the only Full Session Administrator\. Give another leader full access first\./i);
});

test("active Access routes to the focused sign-in lifecycle", () => {
  assert.match(accessWrapper, /AccessV3/);
  assert.match(accessPage, /Control who can sign in\. FSY roles and company assignments are managed in Assignments\./);
  assert.match(accessPage, /Assignments decides responsibility/);
  assert.match(accessPage, /Give access/);
  assert.match(accessPage, /Needs access/);
  assert.match(accessPage, /Committee & older accounts/);
  assert.match(staffClient, /invited:\s*"Invite sent"/);
  assert.match(staffClient, /active:\s*"Access active"/);
  assert.match(staffClient, /disabled:\s*"Access disabled"/);
  assert.match(staffClient, /not_enabled:\s*"No website access"/);
  assert.match(staffClient, /get_staff_access_directory/);
});

test("Access reads assignment context instead of becoming another assignment editor", () => {
  assert.match(accessPage, /Finish assignment/);
  assert.match(accessPage, /Open Assignments/);
  assert.match(accessPage, /person\.companyNames\.join\(" · "\)/);
  assert.doesNotMatch(accessPage, /AssistantCompanySheet/);
  assert.doesNotMatch(accessPage, /setAssistantCoordinatorCompanies/);
  assert.doesNotMatch(accessPage, /Set companies/);
  assert.doesNotMatch(accessPage, /Primary responsibility/);
});

test("Access can render its initial empty live directory before data arrives", () => {
  assert.match(accessPage, /live\s*\?\s*\[\]\s*:\s*demoDirectory\(\)/);
  assert.match(accessPage, /<Empty/);
  assert.match(uiComponents, /\{Icon \? <span className="empty-icon"><Icon size=\{25\} \/><\/span> : null\}/);
});

test("Assistant Coordinator company scope remains server-protected even though it is edited in Assignments", () => {
  assert.match(staffClient, /suggest_assistant_coordinator_companies/);
  assert.match(staffClient, /set_assistant_coordinator_companies/);
  assert.match(accessUxMigration, /create or replace function public\.suggest_assistant_coordinator_companies/);
  assert.match(accessUxMigration, /create or replace function public\.set_assistant_coordinator_companies/);
  assert.match(accessUxMigration, /cardinality\(desired\) > max_load/i);
  assert.match(accessUxMigration, /donor_without_scope/i);
  assert.match(accessUxMigration, /would leave % with active website access but no company/i);
  assert.match(accessUxMigration, /assistant_coordinator_companies_set/i);
});

test("legacy company picker remains safe for older flows without being part of Access v3", () => {
  assert.match(companySheet, /localeCompare\(companyLabel\(b\).*numeric: true/);
  assert.match(companySheet, /className="assistant-company-list"/);
  assert.match(companySheet, /currently assigned to another Assistant Coordinator/i);
  assert.match(companySheet, /Nothing changes until you save/i);
  assert.doesNotMatch(accessPage, /AssistantCompanySheet/);
});

test("Access shows admin-only sign-in recency and authenticated private live presence", () => {
  assert.match(accessUxMigration, /get_session_account_activity/);
  assert.match(accessUxMigration, /auth\.users au/);
  assert.match(accessUxMigration, /au\.last_sign_in_at/);
  assert.match(accessPage, /Online now/);
  assert.match(accessPage, /Last signed in/);
  assert.match(presenceClient, /realtime\.setAuth\(\)/);
  assert.match(presenceClient, /private:\s*true/);
  assert.match(presenceClient, /presence:\s*\{ key: userId \}/);
  assert.match(appShell, /trackSessionPresence\(sessionInfo\.id, userId\)/);
  assert.match(accessUxMigration, /on realtime\.messages/);
  assert.match(accessUxMigration, /extension = 'presence'/);
  assert.match(accessUxMigration, /private\.has_session_access/);
});

test("optional account activity cannot block the Access directory", () => {
  assert.match(staffClient, /Account activity is secondary metadata/);
  assert.match(staffClient, /return new Map\(\);/);
});

test("secondary Access actions stay progressive and consequential actions are protected", () => {
  assert.match(accessPage, /className="staff-access-more"/);
  assert.match(accessPage, /Committee tools/);
  assert.match(accessPage, /Recovery/);
  assert.match(accessPage, /Disable sign-in/);
  assert.match(accessPage, /ConfirmActionSheet/);
  assert.match(accessPage, /ActionToast/);
  assert.match(accessPage, /Revoke invite/);
});

test("committee-only access is a separate narrow flow rather than a duplicate role picker", () => {
  assert.match(committeeSetup, /Website-only access/);
  assert.match(committeeSetup, /role: "committee_viewer"/);
  assert.match(committeeSetup, /Committee tools/);
  assert.match(committeeSetup, /does not create or change an FSY staff assignment/);
  assert.doesNotMatch(committeeSetup, /Assistant coordinator/);
  assert.doesNotMatch(committeeSetup, /Company scope/);
});

test("shared dialogs use responsive desktop proportions and mobile bottom sheets", () => {
  assert.match(mainEntry, /\.\/modal-system\.css/);
  assert.match(modalSystem, /\.dismissible-layer \.layer-panel/);
  assert.match(modalSystem, /@media \(max-width: 760px\)/);
  assert.match(modalSystem, /place-items: end center/);
  assert.match(modalSystem, /env\(safe-area-inset-bottom\)/);
  assert.match(modalSystem, /\.dismissible-layer \.field-sheet-actions/);
  assert.match(transitionStyles, /@media \(max-width: 640px\)/);
});

test("active Assignments owns FSY responsibility and keeps website access separate", () => {
  assert.match(assignmentsWrapper, /AssignmentsV2/);
  assert.match(assignmentsPage, /Set who serves where\. Website sign-in is managed separately in Access\./);
  assert.match(assignmentsPage, /Open Access/);
  assert.match(assignmentsPage, /Add leader/);
  assert.doesNotMatch(assignmentsPage, /StaffAccessInvite/);
  assert.doesNotMatch(assignmentsPage, /Add & give access/);
  assert.doesNotMatch(assignmentsPage, /Give access/);
  assert.doesNotMatch(assignmentsPage, /accessStateLabel/);
});

test("Assignments presents three focused workspaces instead of one long staffing page", () => {
  assert.match(assignmentsPage, /value: "people", label: "People"/);
  assert.match(assignmentsPage, /value: "groups", label: "Counselor groups"/);
  assert.match(assignmentsPage, /value: "companies", label: "Companies"/);
  assert.match(assignmentsPage, /workspace === "people"/);
  assert.match(assignmentsPage, /workspace === "groups"/);
  assert.match(assignmentsPage, /workspace === "companies"/);
  assert.match(assignmentsPage, /Search counselor groups/);
  assert.match(assignmentsPage, /Search companies/);
});

test("Assignments is gap-first for counselor groups and companies", () => {
  assert.match(assignmentsPage, /useState\("needs"\)/);
  assert.match(assignmentsPage, /Needs Counselor/);
  assert.match(assignmentsPage, /Needs AC/);
  assert.match(assignmentsPage, /Suggest coverage/);
  assert.match(assignmentsPage, /Nothing changes until you apply it/);
  assert.match(assignmentsPage, /Assign Counselor/);
  assert.match(assignmentsPage, /Assign AC/);
});

test("role changes use one atomic guided transition instead of surfacing dependency errors", () => {
  assert.match(roleTransitionMigration, /create or replace function public\.transition_staff_operational_role/i);
  assert.match(roleTransitionMigration, /perform public\.unassign_counselor_from_group\(current_group\.id\)/i);
  assert.match(roleTransitionMigration, /perform public\.assign_counselor_to_group\(p_replacement_counselor_id, current_group\.id\)/i);
  assert.match(roleTransitionMigration, /perform public\.set_assistant_coordinator_companies\(target\.id, desired_company_ids\)/i);
  assert.match(roleTransitionMigration, /staff_operational_role_transitioned/i);
  assert.match(roleTransitionMigration, /grant execute on function public\.transition_staff_operational_role/i);
  assert.match(operationsClient, /transition_staff_operational_role/);
  assert.match(assignmentsPage, /StaffRoleTransitionSheet/);
  assert.match(assignmentsPage, /setTransitionTarget\(\{ person, targetRole \}\)/);
});

test("guided role change explains consequences and supports the common Counselor to AC handoff", () => {
  assert.match(roleTransitionSheet, /Keep .* covered/);
  assert.match(roleTransitionSheet, /Replace the Counselor now/);
  assert.match(roleTransitionSheet, /Leave the group open/);
  assert.match(roleTransitionSheet, /Assistant Coordinator scope/);
  assert.match(roleTransitionSheet, /Use balanced suggestion/);
  assert.match(roleTransitionSheet, /Website access follows the assignment/);
  assert.match(roleTransitionSheet, /Confirm responsibility change/);
});

test("large assignment lists are searchable and progressively revealed", () => {
  assert.match(assignmentsPage, /filteredStaff\.slice\(0, visibleStaff\)/);
  assert.match(assignmentsPage, /filteredGroups\.slice\(0, visibleGroups\)/);
  assert.match(assignmentsPage, /filteredCompanies\.slice\(0, visibleCompanies\)/);
  assert.match(assignmentsPage, /Show 30 more/);
  assert.match(assignmentsPage, /Show 24 more groups/);
  assert.match(assignmentsPage, /Show 24 more companies/);
});

test("Access and Assignments v11 is adaptive and loaded after the earlier operational layer", () => {
  const v10 = mainEntry.indexOf('import "./operations-ux-v10.css";');
  const v11 = mainEntry.indexOf('import "./access-assignments-v11.css";');
  assert.ok(v11 > v10);
  assert.match(v11Styles, /@media \(max-width:760px\)/);
  assert.match(v11Styles, /@media \(max-width:390px\)/);
  assert.match(v11Styles, /min-height:48px/);
  assert.match(v11Styles, /font-size:16px/);
  assert.match(v11Styles, /env\(safe-area-inset-bottom\)/);
  assert.match(v11Styles, /prefers-reduced-motion:reduce/);
});
