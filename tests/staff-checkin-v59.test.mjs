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

test("Registration staff check-in records only arrival in the v59 baseline", async () => {
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

test("Staff-only administrators land on a focused Staff workspace", async () => {
  const [app, shell, registration] = await Promise.all([
    read("src/App.jsx"),
    read("src/components/AppShell.jsx"),
    read("src/pages/Registration.jsx"),
  ]);
  assert.match(app, /const canUseStaffCheckin=!live\|\|hasCapability\(currentCapabilities,"registration_manage"\)\|\|hasCapability\(currentCapabilities,"staff_manage"\)/);
  assert.match(app, /view===\"registration\"\).*canUseStaffCheckin/);
  assert.match(shell, /has\(currentCapabilities,"staff_manage"\)/);
  assert.match(registration, /const canUseParticipantRegistration =/);
  assert.match(registration, /if \(canUseStaffCheckin\) return "staff"/);
  assert.match(registration, /canUseParticipantDesk \? \[\{\s*value: "desk", label: "Live check-in"/);
});

test("v59 staff arrival edits cannot overwrite no-show or left lifecycle states", async () => {
  const [migration, css] = await Promise.all([
    read("supabase/migrations/20260913103000_staff_arrival_checkin_v59.sql"),
    read("src/pages/staff-checkin.css"),
  ]);
  assert.match(migration, /p_arrival = 'arrived' and previous\.arrival_state <> 'expected'/);
  assert.match(migration, /Manage no-show or left in Staff status/);
  assert.match(css, /\.staff-checkin-undo \{[\s\S]*min-height: 44px/);
});

test("Staff arrival desk provides live refresh plus a network fallback", async () => {
  const client = await read("src/lib/staff-checkin.js");
  assert.match(client, /postgres_changes/);
  assert.match(client, /table:\s*"staff_operations"/);
  assert.match(client, /setInterval\(emit, 15000\)/);
});

test("Staff check-in UI treats the current ground roster as ready to work", async () => {
  const source = await read("src/pages/StaffCheckin.jsx");
  assert.match(source, /Who is actually on site\?/);
  assert.match(source, /ground roster is the operating source/i);
  assert.match(source, /Present, needs placement/);
  assert.match(source, /ready to serve/i);
  assert.match(source, /Check in/);
});
