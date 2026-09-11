import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("staff birthdays load with the normal workspace hydration", async () => {
  const app = await read("src/App.jsx");
  assert.match(app, /\["staff birthdays",\(\)=>loadStaffBirthdays\(granted\.session_id\),\(value\)=>setStaffBirthdays\(value\)\]/);
});

test("staff birthday client uses v3 for age and safely falls back before the migration is deployed", async () => {
  const client = await read("src/lib/field-operations.js");
  assert.match(client, /get_staff_birthdays_v3/);
  assert.match(client, /get_staff_birthdays_v2/);
  assert.match(client, /staffBirthdayV3Missing/);
  assert.match(client, /turningAge:\s*row\.turning_age/);
  assert.doesNotMatch(client, /dateOfBirth:\s*row\.date_of_birth/);
});

test("staff birthday RPC keeps access scoped while returning birthday age", async () => {
  const migration = await read("supabase/migrations/20260911100500_staff_birthday_visibility_and_age.sql");
  assert.match(migration, /create or replace function public\.get_staff_birthdays_v3/);
  assert.match(migration, /turning_age integer/);
  assert.match(migration, /extract\(year from base\.birthday_date\).*extract\(year from details\.date_of_birth\)/s);
  assert.match(migration, /'coordinator','logistics_admin','session_director','area_advisory_couple'/);
  assert.match(migration, /private\.has_capability\(se\.id,'access_admin'\)/);
  assert.match(migration, /private\.is_assistant_coordinator\(se\.id\) and private\.staff_in_current_company_scope\(se\.id,s\.id\)/);
  assert.match(migration, /caller_tm\.team_id=target_tm\.team_id/);
  assert.match(migration, /grant execute on function public\.get_staff_birthdays_v3\(uuid\) to authenticated/);
});
