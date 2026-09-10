import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("eligibility projection is set based for large sessions", async () => {
  const projection = await read("supabase/migrations/20260910162000_eligibility_projection_performance_v1.sql");
  assert.match(projection, /join public\.sessions s on s\.id = p\.session_id/);
  assert.match(projection, /left join public\.session_structure_settings ss/);
  assert.doesNotMatch(projection, /private\.session_participant_age/);
  assert.doesNotMatch(projection, /private\.operational_participant_is_eligible/);
});

test("Overview consumes the shared eligibility projection", async () => {
  const overview = await read("supabase/migrations/20260910160000_overview_reliability_v1.sql");
  assert.match(overview, /private\.participant_eligibility_projection/);
  assert.doesNotMatch(overview, /public\.get_meal_services/);
});
