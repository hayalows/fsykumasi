import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  new URL("../supabase/migrations/20260908061000_group_publish_eligibility_v24.sql", import.meta.url),
  "utf8",
);

test("group publishing uses the same DOB/session operational eligibility as the live workspace", () => {
  assert.match(migration, /p\.attendance_status<>'confirmed_not_attending'/);
  assert.match(migration, /extract\(year from sess\.starts_on\)::int-extract\(year from d\.date_of_birth\)::int>=14/);
  assert.match(migration, /sess\.ends_on<\(d\.date_of_birth\+interval '19 years'\)::date/);
  assert.doesNotMatch(
    migration,
    /select count\(\*\) into participant_total[\s\S]{0,500}p\.age between min_age and max_age/,
  );
});

test("group publishing explains a stale reviewed draft with actual counts", () => {
  assert.match(
    migration,
    /Reviewed structure has % youth \(% unique\), but % are currently eligible\. Rebuild the structure and publish again\./,
  );
});
