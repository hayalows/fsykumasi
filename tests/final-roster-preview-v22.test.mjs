import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath = new URL("../supabase/migrations/20260907235500_final_roster_preview_performance_v22.sql", import.meta.url);
const sql = fs.readFileSync(migrationPath, "utf8");

test("final roster preview uses set-wise identity joins instead of per-row correlated scans", () => {
  assert.match(sql, /left join stage_counts sc on sc\.identity_key=s\.identity_key/);
  assert.match(sql, /left join existing_counts ec on ec\.identity_key=s\.identity_key/);
  assert.doesNotMatch(sql, /select\s+sc\.n\s+from\s+stage_counts/i);
  assert.doesNotMatch(sql, /select\s+ec\.n\s+from\s+existing_counts/i);
});

test("preview optimization preserves source-key matching and does not weaken the role timeout globally", () => {
  assert.match(sql, /p\.source_record_key=s\.source_record_key/);
  assert.match(sql, /st\.source_record_key=s\.source_record_key/);
  assert.doesNotMatch(sql, /alter\s+role\s+authenticated/i);
  assert.doesNotMatch(sql, /statement_timeout\s*=/i);
});
