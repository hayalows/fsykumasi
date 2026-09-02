import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260902045523_real_registration_people_and_capabilities.sql", import.meta.url), "utf8");
const checkinMigration = readFileSync(new URL("../supabase/migrations/20260902053638_require_assignment_for_published_checkin.sql", import.meta.url), "utf8");

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
