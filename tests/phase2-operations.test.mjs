import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Wellness has an explicit active-visit checkout and follow-up lifecycle", async () => {
  const [migration, page, fieldLib] = await Promise.all([
    read("supabase/migrations/20260904110000_phase2_wellness_daily_operations.sql"),
    read("src/pages/Wellness.jsx"),
    read("src/lib/field-operations.js"),
  ]);
  assert.match(migration, /create unique index if not exists wellness_active_participant_uq/);
  assert.match(migration, /create or replace function public\.checkout_wellness_encounter/);
  assert.match(migration, /create or replace function public\.start_wellness_visit/);
  assert.match(migration, /returns table\(encounter_id uuid, created boolean\)/);
  assert.match(migration, /target\.closed_at is not null then raise exception/);
  assert.match(migration, /create or replace function public\.resolve_wellness_follow_up/);
  assert.match(migration, /follow_up_status = case when p_outcome = 'follow_up_needed' then 'open'/);
  assert.match(page, /Check out this visit/);
  assert.match(page, /already has an active Wellness visit/);
  assert.match(page, /Follow-up queue/);
  assert.match(fieldLib, /checkout_wellness_encounter/);
  assert.match(fieldLib, /resolve_wellness_follow_up/);
});

test("Wellness status-only reads exclude private concern and medicine fields", async () => {
  const migration = await read("supabase/migrations/20260904110000_phase2_wellness_daily_operations.sql");
  const statusStart = migration.indexOf("create or replace function public.get_wellness_status");
  const privateStart = migration.indexOf("create or replace function public.get_wellness_encounters_v2");
  assert.ok(statusStart >= 0 && privateStart > statusStart);
  const statusFunction = migration.slice(statusStart, privateStart);
  assert.match(statusFunction, /wellness_status/);
  assert.doesNotMatch(statusFunction, /concern|care_provided|medicine_provided|recorded_by/);
});

test("Food meal attendance is independent, idempotent, and guarded by RPCs", async () => {
  const [migration, page, fieldLib] = await Promise.all([
    read("supabase/migrations/20260904110000_phase2_wellness_daily_operations.sql"),
    read("src/pages/Food.jsx"),
    read("src/lib/field-operations.js"),
  ]);
  assert.match(migration, /create table if not exists public\.meal_services/);
  assert.match(migration, /unique\(session_id, service_date, meal_type\)/);
  assert.match(migration, /create table if not exists public\.meal_attendance/);
  assert.match(migration, /meal_attendance_participant_uq/);
  assert.match(migration, /on conflict do nothing returning id, served_at/);
  assert.match(migration, /revoke all on public\.meal_services, public\.meal_attendance from anon, authenticated/);
  assert.match(page, /Mark \$\{selectedService\.label\.toLowerCase\(\)\} served/);
  assert.match(page, /Dietary needs/);
  assert.match(fieldLib, /get_meal_roster/);
  assert.match(fieldLib, /mark_meal_served/);
});

test("Head Count uses a server-computed workspace and atomic reconciliation payload", async () => {
  const [migration, backend, page] = await Promise.all([
    read("supabase/migrations/20260904110000_phase2_wellness_daily_operations.sql"),
    read("src/lib/backend.js"),
    read("src/pages/Headcount.jsx"),
  ]);
  assert.match(migration, /create or replace function private\.expected_participant_count/);
  assert.match(migration, /create or replace function public\.get_headcount_workspace/);
  assert.match(migration, /create or replace function public\.submit_company_headcount_v2/);
  assert.match(migration, /for update/);
  assert.match(migration, /unique\(round_id, participant_id\)/);
  assert.match(backend, /get_headcount_workspace/);
  assert.match(backend, /p_person_statuses: personStatuses/);
  assert.match(page, /Reconcile missing people/);
  assert.match(page, /Direct head-count status only\. Wellness status stays separate/);
});

test("new operational tables keep direct grants closed and source contains no service-role credential", async () => {
  const migration = await read("supabase/migrations/20260904110000_phase2_wellness_daily_operations.sql");
  assert.match(migration, /alter table public\.headcount_person_statuses enable row level security/);
  assert.match(migration, /alter table public\.meal_services enable row level security/);
  assert.match(migration, /alter table public\.meal_attendance enable row level security/);
  assert.doesNotMatch(migration, /service_role/i);

  const sourceFiles = await readdir(new URL("../src/", import.meta.url), { recursive: true });
  const sourceText = await Promise.all(sourceFiles.filter((path) => /\.(js|jsx|css)$/.test(path)).map((path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8")));
  assert.ok(sourceText.every((source) => !/service_role/i.test(source)));
});

test("mobile field actions stay reachable and elapsed time has compact labels", async () => {
  const [css, fieldLib] = await Promise.all([read("src/phase2-operations.css"), read("src/lib/field-operations.js")]);
  assert.match(css, /\.sidebar\s*\{[\s\S]*height: 100dvh/);
  assert.match(css, /\.headcount-all-here[\s\S]*width: 100%/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /min-height: 44px/);
  assert.match(fieldLib, /return remainder \? `\$\{hours\}h \$\{remainder\}m`/);
});
