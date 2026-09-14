import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("live participant capacity is based on arrived people instead of paper assignments", async () => {
  const migration = await read("supabase/migrations/20260914132500_participant_ground_roster_v72.sql");
  const allocatorStart = migration.indexOf("create or replace function private.assign_arriving_participant_to_ready_group_v1");
  const rosterStart = migration.indexOf("create or replace function public.get_participant_ground_roster_v1");
  const allocator = migration.slice(allocatorStart, rosterStart);
  assert.ok(allocatorStart >= 0 && rosterStart > allocatorStart);
  assert.match(allocator, /ci\.status = 'arrived'/);
  assert.match(allocator, /current_has_space/);
  assert.match(allocator, /current_company is not null/);
  assert.match(allocator, /fsy-participant-ground/);
  assert.doesNotMatch(allocator, /staff_operations/);
  assert.doesNotMatch(allocator, /counselor_id/);
});

test("ground check-in finishes local verification and records membership as not sure when missing", async () => {
  const migration = await read("supabase/migrations/20260914132500_participant_ground_roster_v72.sql");
  const start = migration.indexOf("create or replace function public.check_in_participant_on_ground_v1");
  const end = migration.indexOf("create or replace function public.add_on_site_ground_participant_v1");
  const body = migration.slice(start, end);
  assert.match(body, /verification_status = 'verified'/);
  assert.match(body, /membership_status[\s\S]*'not_sure'/);
  assert.match(body, /registration_status_preserved/);
  assert.match(body, /paperwork_follow_up/);
  assert.match(body, /'arrived'::public\.check_in_status/);
});

test("on-site ground add is one atomic add-place-id-checkin flow without pretending approval is complete", async () => {
  const migration = await read("supabase/migrations/20260914132500_participant_ground_roster_v72.sql");
  const start = migration.indexOf("create or replace function public.add_on_site_ground_participant_v1");
  const end = migration.indexOf("create or replace function public.move_ground_participant_v1");
  const body = migration.slice(start, end);
  assert.match(body, /'on_site',[\s\S]*'awaiting',[\s\S]*'verified'/);
  assert.match(body, /parent or guardian phone number/i);
  assert.match(body, /assign_arriving_participant_to_ready_group_v1/);
  assert.match(body, /ensure_on_site_fsy_id/);
  assert.match(body, /'arrived'::public\.check_in_status/);
  assert.match(body, /'paperwork_follow_up', true/);
  assert.doesNotMatch(body, /registration_status[^\n]*'approved'/);
});

test("manual ground moves keep sex and the live 15-person cap hard", async () => {
  const migration = await read("supabase/migrations/20260914132500_participant_ground_roster_v72.sql");
  const start = migration.indexOf("create or replace function public.move_ground_participant_v1");
  const body = migration.slice(start);
  assert.match(body, /destination\.sex <> target\.sex/);
  assert.match(body, /ci\.status = 'arrived'/);
  assert.match(body, />= max_size/);
  assert.match(body, /participant_ground_group_changed/);
});

test("registration managers get the on-ground desk while Final roster remains available", async () => {
  const registration = await read("src/pages/Registration.jsx");
  const ground = await read("src/pages/ParticipantGroundRoster.jsx");
  assert.match(registration, /const canUseGroundRoster = live && capabilities\.includes\("registration_manage"\)/);
  assert.match(registration, /mode === "desk" && canUseGroundRoster/);
  assert.match(registration, /<ParticipantGroundRoster/);
  assert.match(ground, /Work with the people who are actually here/);
  assert.match(ground, /Check in & place/);
  assert.match(ground, /Add, place & check in/);
  assert.match(ground, /Live occupancy/);
  assert.match(ground, /Participants first, staff next/);
});

test("ground roster stays live and refreshes the PWA shell", async () => {
  const client = await read("src/lib/ground-roster.js");
  const sw = await read("public/sw.js");
  assert.match(client, /postgres_changes/);
  assert.match(client, /table: "check_ins"/);
  assert.match(client, /table: "participants"/);
  assert.match(client, /setInterval\(emit, 15000\)/);
  assert.match(sw, /fsy-kumasi-shell-v72/);
});
