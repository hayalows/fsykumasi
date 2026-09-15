import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260915130000_staff_access_email_validation_v83.sql");

const browserEquivalentEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

test("ordinary and tagged staff email addresses remain valid for website access", () => {
  for (const email of [
    "beatriceowusuafriyie4@gmail.com",
    "first.last+fsy@gmail.com",
    "leader@subdomain.example.org",
  ]) {
    assert.equal(browserEquivalentEmail.test(email), true, `${email} should be accepted`);
  }
});

test("database staff-invite validation uses an unambiguous literal dot", () => {
  assert.ok(
    migration.includes("normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'"),
    "Postgres email validation should use [.] instead of an escape-sensitive backslash sequence",
  );
  assert.ok(!migration.includes("\\\\."), "migration must not reintroduce the double-backslash dot bug");
});

test("existing accounts are still detected and returned instead of creating a second identity", () => {
  assert.match(migration, /from public\.profiles p where lower\(trim\(coalesce\(p\.email,''\)\)\) = normalized_email/i);
  assert.match(migration, /return query select new_id, formatted_code, new_expiry, account_exists/i);
});
