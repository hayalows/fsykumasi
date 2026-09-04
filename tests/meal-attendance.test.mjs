import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migrationPath = "supabase/migrations/20260904182500_scoped_participant_meal_attendance.sql";

test("assistant coordinators receive narrow participant meal capabilities only", async () => {
  const migration = await read(migrationPath);
  const assistantBlock = migration.match(/when aa\.role='assistant_coordinator' then array\[([\s\S]*?)\]::text\[\]/)?.[1] || "";
  assert.match(assistantBlock, /meal_attendance_view/);
  assert.match(assistantBlock, /meal_attendance_record/);
  assert.doesNotMatch(assistantBlock, /food_manage|food_export|wellness_private/);
});

test("meal roster and writes enforce company scope on the server", async () => {
  const migration = await read(migrationPath);
  assert.match(migration, /create or replace function public\.get_meal_roster/);
  assert.match(migration, /private\.can_access_company\(p_session_id, c\.id\)/);
  assert.match(migration, /create or replace function public\.set_participant_meal_served/);
  assert.match(migration, /private\.can_access_company\(target\.session_id, participant_company\)/);
  assert.match(migration, /meal_attendance_unmarked/);
  assert.match(migration, /target\.status <> 'open'/);
});

test("meal progress is participant-first and session leaders can see overall progress", async () => {
  const migration = await read(migrationPath);
  assert.match(migration, /create or replace function public\.get_meal_progress/);
  assert.match(migration, /private\.operational_participant_is_eligible/);
  assert.match(migration, /coalesce\(nullif\(c\.custom_name, ''\), c\.name, 'Unassigned'\)/);
  assert.match(migration, /private\.has_capability\(target_session, 'food_view'\)/);
});

test("Food UI uses a large-row checkbox checklist with immediate save and polling", async () => {
  const [page, css, shell] = await Promise.all([
    read("src/pages/Food.jsx"),
    read("src/pages/meal-attendance.css"),
    read("src/components/AppShell.jsx"),
  ]);
  assert.match(page, /type="checkbox"/);
  assert.match(page, /Each tick saves immediately/);
  assert.match(page, /setParticipantMealServed/);
  assert.match(page, /12000/);
  assert.match(page, /Company progress/);
  assert.match(css, /\.meal-check-row[\s\S]*min-height: 58px/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(shell, /meal_attendance_view/);
});
