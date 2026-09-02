import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260902045523_real_registration_people_and_capabilities.sql", import.meta.url), "utf8");
const checkinMigration = readFileSync(new URL("../supabase/migrations/20260902053638_require_assignment_for_published_checkin.sql", import.meta.url), "utf8");
const scopedCheckinMigration = readFileSync(new URL("../supabase/migrations/20260902065000_scoped_assistant_coordinator_checkin.sql", import.meta.url), "utf8");
const planningRepublishMigration = readFileSync(new URL("../supabase/migrations/20260902071000_allow_structure_republish_while_planning.sql", import.meta.url), "utf8");
const mixedAgeMigration = readFileSync(new URL("../supabase/migrations/20260902080000_mixed_age_structure_default.sql", import.meta.url), "utf8");
const staffingMigration = readFileSync(new URL("../supabase/migrations/20260902080500_atomic_staff_assignment_plan.sql", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");

test("capability override is explicit, constrained, and cannot be delegated by an overridden coordinator", () => {
  assert.match(migration, /capabilities <@ array\['access_admin'\]/);
  assert.match(migration, /if not private\.is_top_access_admin\(target\.session_id\)/);
  assert.match(migration, /coordinator_admin_granted/);
  assert.match(migration, /revoke insert, update, delete on public\.access_assignments from authenticated/);
});

test("on-site participant must be verified before assignment or check-in", () => {
  assert.match(migration, /verification_status = 'verified'/);
  assert.match(migration, /Participant is not currently eligible for check-in/);
  assert.match(migration, /Only current, approved, verified participants can be assigned/);
  assert.match(checkinMigration, /p\.group_id is not null/);
  assert.match(checkinMigration, /g\.state = 'published'/);
});

test("private registration fields use separate RLS-protected tables", () => {
  assert.match(migration, /create table if not exists public\.participant_private_details/);
  assert.match(migration, /alter table public\.participant_private_details enable row level security/);
  assert.match(migration, /revoke all on public\.participant_private_details, public\.staff_private_details from anon, authenticated/);
});

test("assistant coordinators can record check-in only through their scoped companies", () => {
  assert.match(scopedCheckinMigration, /private\.can_access_company\(p_session_id, g\.company_id\)/);
  assert.match(app, /\["assistant_coordinator", "coordinator", "logistics_admin", "session_director"\]\.includes\(currentRole\)/);
});

test("planning sessions stay structurally editable while active operations remain protected", () => {
  assert.match(planningRepublishMigration, /session_status <> 'planning'/);
  assert.match(planningRepublishMigration, /Undo active check-ins before replacing the published structure/);
  assert.match(planningRepublishMigration, /A head-count submission exists, so the published structure can no longer be replaced/);
});

test("planning structure defaults to mixed ages rather than age-band separation", () => {
  assert.match(mixedAgeMigration, /alter column use_age_bands set default false/);
  assert.match(mixedAgeMigration, /session\.status = 'planning'/);
  assert.match(mixedAgeMigration, /set use_age_bands = false/);
});

test("bulk staffing validates the full plan and never silently overwrites existing assignments", () => {
  assert.match(staffingMigration, /private\.can_manage_access\(p_session_id\)/);
  assert.match(staffingMigration, /Bulk staffing will not overwrite an existing counselor assignment/);
  assert.match(staffingMigration, /Bulk staffing will not overwrite an existing company Assistant Coordinator assignment/);
  assert.match(staffingMigration, /A Counselor can only appear once in a bulk assignment plan/);
  assert.match(staffingMigration, /staff_assignment_plan_applied/);
});
