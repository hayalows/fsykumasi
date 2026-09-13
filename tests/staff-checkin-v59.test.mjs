import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Registration exposes staff arrival as a focused work area", async () => {
  const source = await read("src/pages/Registration.jsx");
  assert.match(source, /value:\s*"staff",\s*label:\s*"Staff"/);
  assert.match(source, /<StaffCheckin sessionId=\{sessionId\} live=\{live\}/);
  assert.match(source, /capabilities\.includes\("registration_manage"\)/);
  assert.match(source, /capabilities\.includes\("staff_manage"\)/);
});

test("Registration staff check-in records only arrival", async () => {
  const client = await read("src/lib/staff-checkin.js");
  const migration = await read("supabase/migrations/20260913103000_staff_arrival_checkin_v59.sql");
  assert.match(client, /record_staff_arrival_v1/);
  assert.match(client, /\["expected", "arrived"\]/);
  assert.match(migration, /p_arrival not in \('expected', 'arrived'\)/);
  assert.match(migration, /set arrival_state = p_arrival/);
  assert.doesNotMatch(migration, /set planning_state = p_arrival/);
  assert.doesNotMatch(migration, /set service_clearance = p_arrival/);
});

test("Registration capability can check staff in without broad staff management", async () => {
  const migration = await read("supabase/migrations/20260913103000_staff_arrival_checkin_v59.sql");
  assert.match(migration, /has_capability\(target\.session_id, 'registration_manage'\)/);
  assert.match(migration, /has_capability\(target\.session_id, 'staff_manage'\)/);
  assert.match(migration, /'staff_checked_in'/);
  assert.match(migration, /'staff_checkin_undone'/);
});

test("Staff arrival desk provides live refresh plus a network fallback", async () => {
  const client = await read("src/lib/staff-checkin.js");
  assert.match(client, /postgres_changes/);
  assert.match(client, /table:\s*"staff_operations"/);
  assert.match(client, /setInterval\(emit, 15000\)/);
});

test("Staff check-in UI separates presence from leadership confirmation", async () => {
  const source = await read("src/pages/StaffCheckin.jsx");
  assert.match(source, /Who is actually on site\?/);
  assert.match(source, /Registration records arrival only/);
  assert.match(source, /Present, needs confirmation/);
  assert.match(source, /Needs leadership confirmation before active service/);
  assert.match(source, /Check in/);
});
