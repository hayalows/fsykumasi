import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("staff website access accepts ordinary email domains", async () => {
  const migration = await read("supabase/migrations/20260915130000_staff_access_email_validation_v84.sql");

  const correctPattern = "^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$";
  const brokenPattern = "^[^[:space:]@]+@[^[:space:]@]+\\\\.[^[:space:]@]+$";

  assert.ok(migration.includes(correctPattern));
  assert.ok(!migration.includes(brokenPattern));
});

test("existing FSY sign-ins remain a supported website access path", async () => {
  const migration = await read("supabase/migrations/20260915130000_staff_access_email_validation_v84.sql");

  assert.match(migration, /from public\.profiles p where lower\(trim\(coalesce\(p\.email,''\)\)\) = normalized_email/);
  assert.match(migration, /into account_exists/);
  assert.match(migration, /return query select new_id, formatted_code, new_expiry, account_exists/);
});
