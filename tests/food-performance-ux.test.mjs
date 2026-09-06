import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migrationPath = "supabase/migrations/20260906094000_food_workspace_performance_v2.sql";

test("Food v2 pages the live roster on the server instead of hydrating the conference", async () => {
  const [migration, client, page] = await Promise.all([
    read(migrationPath),
    read("src/lib/food-workspace.js"),
    read("src/pages/FoodV2.jsx"),
  ]);

  assert.match(migration, /create or replace function public\.get_meal_roster_page_v2/);
  assert.match(migration, /count\(\*\) over\(\)::integer/);
  assert.match(migration, /least\(200, greatest\(1, coalesce\(p_limit, 80\)\)\)/);
  assert.match(client, /get_meal_roster_page_v2/);
  assert.match(page, /PAGE_SIZE = 80/);
  assert.match(page, /loadMealRosterPageV2/);
  assert.doesNotMatch(page, /loadRpcPages/);
  assert.doesNotMatch(page, /loadMealRoster\(/);
});

test("Food server summaries evaluate caller scope once and use set-based eligible populations", async () => {
  const migration = await read(migrationPath);
  assert.match(migration, /visible_participants as materialized/);
  assert.match(migration, /eligible as materialized/);
  assert.match(migration, /caps := coalesce\(private\.effective_capabilities/);
  assert.match(migration, /expected as \([\s\S]*count\(\*\)::integer/);
  assert.match(migration, /served as \([\s\S]*group by a\.meal_service_id/);
  assert.doesNotMatch(migration, /private\.operational_participant_is_eligible\(p_session_id, p\.id\)/);
});

test("Food serving uses optimistic focused writes and dietary data is deferred", async () => {
  const page = await read("src/pages/FoodV2.jsx");
  const optimisticPosition = page.indexOf("setRows((current) => current.map");
  const writePosition = page.indexOf("setParticipantMealServedV2({");
  assert.ok(optimisticPosition >= 0 && writePosition > optimisticPosition, "local row feedback should happen before the network write");
  assert.match(page, /if \(tab === "needs"\) loadNeeds\(\)/);
  assert.match(page, /needsLoaded \|\| needsLoading/);
  assert.match(page, /REFRESH_INTERVAL = 20000/);
  assert.doesNotMatch(page, /window\.setInterval[\s\S]*12000/);
});

test("Food mobile UX keeps primary serving actions large and secondary controls progressive", async () => {
  const [page, css] = await Promise.all([
    read("src/pages/FoodV2.jsx"),
    read("src/pages/food-v2.css"),
  ]);
  assert.match(page, /Not served/);
  assert.match(page, /<details className="food-meal-controls">/);
  assert.match(page, /<details className="food-company-progress">/);
  assert.match(page, /DismissibleLayer[\s\S]*Set up a meal/);
  assert.match(css, /@media\(max-width:720px\)/);
  assert.match(css, /\.food-meal-row\{[\s\S]*min-height:72px/);
  assert.match(css, /\.food-new-meal\{width:100%/);
  assert.match(css, /min-height:48px/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});
