import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260904194500_staff_linked_access_and_coordinator_admin.sql", import.meta.url), "utf8");
const triggerFix = readFileSync(new URL("../supabase/migrations/20260904194600_staff_access_trigger_fix.sql", import.meta.url), "utf8");
const accessPage = readFileSync(new URL("../src/pages/Access.jsx", import.meta.url), "utf8");
const assignmentsPage = readFileSync(new URL("../src/pages/Assignments.jsx", import.meta.url), "utf8");
const staffClient = readFileSync(new URL("../src/lib/staff-access.js", import.meta.url), "utf8");

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

test("Access is a login lifecycle rather than a second Assignments screen", () => {
  assert.match(accessPage, /Assignments decides each person's FSY role and company scope/i);
  assert.match(accessPage, /Needs access/);
  assert.match(staffClient, /invited:\s*"Invite sent"/);
  assert.match(staffClient, /active:\s*"Access active"/);
  assert.match(staffClient, /disabled:\s*"Access disabled"/);
  assert.match(staffClient, /not_enabled:\s*"No website access"/);
  assert.match(staffClient, /get_staff_access_directory/);
});

test("Assignments offers optional website access without forcing it", () => {
  assert.match(assignmentsPage, /Assignment and website access are separate/i);
  assert.match(assignmentsPage, /Give access/);
  assert.match(assignmentsPage, /Add without access/);
  assert.match(assignmentsPage, /Add & give access/);
});
