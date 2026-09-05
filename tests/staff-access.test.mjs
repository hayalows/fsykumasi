import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260904194500_staff_linked_access_and_coordinator_admin.sql", import.meta.url), "utf8");
const triggerFix = readFileSync(new URL("../supabase/migrations/20260904194600_staff_access_trigger_fix.sql", import.meta.url), "utf8");
const accessUxMigration = readFileSync(new URL("../supabase/migrations/20260904214500_access_experience_presence_and_ac_company_management.sql", import.meta.url), "utf8");
const accessPage = readFileSync(new URL("../src/pages/Access.jsx", import.meta.url), "utf8");
const assignmentsPage = readFileSync(new URL("../src/pages/Assignments.jsx", import.meta.url), "utf8");
const staffClient = readFileSync(new URL("../src/lib/staff-access.js", import.meta.url), "utf8");
const presenceClient = readFileSync(new URL("../src/lib/presence.js", import.meta.url), "utf8");
const companySheet = readFileSync(new URL("../src/components/AssistantCompanySheet.jsx", import.meta.url), "utf8");
const appShell = readFileSync(new URL("../src/components/AppShell.jsx", import.meta.url), "utf8");
const uiComponents = readFileSync(new URL("../src/components/UI.jsx", import.meta.url), "utf8");
const modalSystem = readFileSync(new URL("../src/modal-system.css", import.meta.url), "utf8");
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

test("Access is a guided login lifecycle rather than a second Assignments screen", () => {
  assert.match(accessPage, /Manage website accounts and committee responsibilities/i);
  assert.match(accessPage, /Needs access/);
  assert.match(accessPage, /Set companies/);
  assert.match(accessPage, /People & accounts/);
  assert.match(staffClient, /invited:\s*"Invite sent"/);
  assert.match(staffClient, /active:\s*"Access active"/);
  assert.match(staffClient, /disabled:\s*"Access disabled"/);
  assert.match(staffClient, /not_enabled:\s*"No website access"/);
  assert.match(staffClient, /get_staff_access_directory/);
});

test("Access can render its initial empty live directory before data arrives", () => {
  assert.match(accessPage, /live \? \[\] : demoDirectory\(\)/);
  assert.match(accessPage, /<Empty title=/);
  assert.match(uiComponents, /\{Icon \? <span className="empty-icon"><Icon size=\{25\} \/><\/span> : null\}/);
});

test("Assistant Coordinators can resolve missing company scope without a disabled dead end", () => {
  assert.match(accessPage, /openCompanies\(person, person\.accessState === "not_enabled"\)/);
  assert.match(companySheet, /Save & continue/);
  assert.match(companySheet, /Suggest companies/);
  assert.match(companySheet, /All companies/);
  assert.match(companySheet, /assistant-company-picker/);
  assert.match(staffClient, /suggest_assistant_coordinator_companies/);
  assert.match(staffClient, /set_assistant_coordinator_companies/);
  assert.match(accessUxMigration, /create or replace function public\.suggest_assistant_coordinator_companies/);
  assert.match(accessUxMigration, /create or replace function public\.set_assistant_coordinator_companies/);
});

test("company picker uses natural ordering and keeps manual selection directly visible", () => {
  assert.match(companySheet, /localeCompare\(companyLabel\(b\).*numeric: true/);
  assert.match(companySheet, /className="assistant-company-list"/);
  assert.doesNotMatch(companySheet, /assistant-company-manual/);
});

test("company transfers are explicit, capacity-limited and protect active Assistant Coordinator scope", () => {
  assert.match(accessUxMigration, /cardinality\(desired\) > max_load/i);
  assert.match(accessUxMigration, /donor_without_scope/i);
  assert.match(accessUxMigration, /would leave % with active website access but no company/i);
  assert.match(accessUxMigration, /assistant_coordinator_companies_set/i);
  assert.match(companySheet, /currently assigned to another Assistant Coordinator/i);
  assert.match(companySheet, /Nothing changes until you save/i);
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

test("secondary Access actions use progressive disclosure without hiding the primary company picker", () => {
  assert.match(accessPage, /className="staff-access-more"/);
  assert.match(accessPage, /className="panel staff-access-help"/);
  assert.match(accessPage, /Website accounts & committee members/);
  assert.match(companySheet, /className="assistant-company-picker"/);
});

test("shared dialogs use responsive desktop proportions and mobile bottom sheets", () => {
  assert.match(mainEntry, /\.\/modal-system\.css/);
  assert.match(modalSystem, /\.dismissible-layer \.layer-panel/);
  assert.match(modalSystem, /\.assistant-company-sheet\.app-modal-wide/);
  assert.match(modalSystem, /grid-template-columns: minmax\(250px, 290px\) minmax\(0, 1fr\)/);
  assert.match(modalSystem, /@media \(max-width: 760px\)/);
  assert.match(modalSystem, /place-items: end center/);
  assert.match(modalSystem, /env\(safe-area-inset-bottom\)/);
  assert.match(modalSystem, /\.dismissible-layer \.field-sheet-actions/);
});

test("Assignments offers optional website access without forcing it", () => {
  assert.match(assignmentsPage, /Assignment and website access are separate/i);
  assert.match(assignmentsPage, /Give access/);
  assert.match(assignmentsPage, /Add without access/);
  assert.match(assignmentsPage, /Add & give access/);
});

test("Assignments presents a clear three-step staffing workflow", () => {
  assert.match(assignmentsPage, /Assignment setup/);
  assert.match(assignmentsPage, /assignment-flow-step/);
  assert.match(assignmentsPage, /id="assignment-staff-roles"/);
  assert.match(assignmentsPage, /id="assignment-counselor-groups"/);
  assert.match(assignmentsPage, /id="assignment-company-supervision"/);
  assert.match(assignmentsPage, /Role changes save automatically/);
  assert.match(assignmentsPage, /All counselor groups are assigned/);
  assert.match(assignmentsPage, /All companies have supervision/);
});
