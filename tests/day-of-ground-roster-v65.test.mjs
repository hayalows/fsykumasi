import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("staff service readiness no longer depends on source approval status", async () => {
  const source = await read("src/lib/staff-state.js");
  assert.doesNotMatch(source, /registrationStatus\s*!==\s*['"]cancelled['"]/);
  assert.doesNotMatch(source, /registrationStatus\s*===\s*['"]approved['"]/);
  assert.match(source, /state\.clearance === 'cleared'/);
  assert.match(source, /staffState\(person\)\.arrival === 'arrived'/);
});

test("database staff planning uses operational readiness rather than source approval", async () => {
  const source = await read("supabase/migrations/20260914103000_day_of_ground_roster_v65.sql");
  assert.match(source, /create or replace function private\.staff_can_plan/);
  assert.match(source, /o\.planning_state <> 'excluded'/);
  assert.match(source, /o\.service_clearance <> 'not_cleared'/);
  assert.doesNotMatch(source, /staff_can_plan[\s\S]{0,500}registration_status\s*<>\s*'cancelled'/i);
});

test("staff arrival desk treats on-ground staff as ready instead of awaiting approval", async () => {
  const source = await read("src/pages/StaffCheckin.jsx");
  assert.doesNotMatch(source, /registrationStatus !== "cancelled"/);
  assert.doesNotMatch(source, /Leadership confirmation is still required/);
  assert.doesNotMatch(source, /Needs leadership confirmation before active service/);
  assert.match(source, /become approved and present in one action/i);
  assert.match(source, /Present, needs placement/);
});

test("ground roster migration uses operational state and preserves source approval history", async () => {
  const source = await read("supabase/migrations/20260914103000_day_of_ground_roster_v65.sql");
  assert.match(source, /apply_day_of_staff_roster_v1/);
  assert.match(source, /planning_state = 'primary'/);
  assert.match(source, /arrival_state = 'arrived'/);
  assert.match(source, /service_clearance = 'cleared'/);
  assert.doesNotMatch(source, /set registration_status\s*=\s*'approved'/i);
  assert.match(source, /group_max_size = 15/);
  assert.match(source, /groups_per_company = 3/);
  assert.match(source, /companies_per_assistant_coordinator = 1/);
});

test("participant arrival is serialized and placed only into staffed capacity", async () => {
  const source = await read("supabase/migrations/20260914103000_day_of_ground_roster_v65.sql");
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /assign_arriving_participant_to_ready_group_v1/);
  assert.match(source, /o\.arrival_state = 'arrived'/);
  assert.match(source, /ao\.arrival_state = 'arrived'/);
  assert.match(source, /No staffed counselor group has space/);
  assert.match(source, /participant_rebalanced_at_arrival/);
});

test("arrival placement keeps badges and ID history atomic", async () => {
  const source = await read("supabase/migrations/20260914103000_day_of_ground_roster_v65.sql");
  assert.match(source, /preserve_identity_group_change/);
  assert.match(source, /private\.ensure_on_site_fsy_id\(p_participant_id, auth\.uid\(\)\)/);
  assert.match(source, /participant_badge_assignments/);
  assert.match(source, /Participant identity did not follow the arrival placement/);
});

test("assistant coordinator arrivals cannot bypass staffed capacity", async () => {
  const source = await read("supabase/migrations/20260914103000_day_of_ground_roster_v65.sql");
  assert.match(source, /caller_role public\.app_role/);
  assert.match(source, /if p_status='arrived'::public\.check_in_status then\s+perform private\.assign_arriving_participant_to_ready_group_v1/);
  assert.match(source, /This participant needs a staffed counselor group with space before check-in/);
  assert.match(source, /private\.can_access_company\(p_session_id, g\.company_id\)/);
});

test("late staff are immediately usable and can be auto placed", async () => {
  const source = await read("supabase/migrations/20260914103000_day_of_ground_roster_v65.sql");
  assert.match(source, /place_ready_staff_if_open_v1/);
  assert.match(source, /record_staff_arrival_v1/);
  assert.match(source, /add_on_site_staff_from_checkin_v1/);
  assert.match(source, /'primary'\s*,\s*'arrived'\s*,\s*'cleared'/);
  assert.match(source, /staff_auto_placed_day_of/);
  assert.match(source, /fsy-staff-placement:/);
});
