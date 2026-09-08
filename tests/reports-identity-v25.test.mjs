import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const reportsPath = new URL("../src/lib/reports.js", import.meta.url);
const migrationPath = new URL("../supabase/migrations/20260908063000_reports_source_id_and_fsy_ids_v25.sql", import.meta.url);
const swPath = new URL("../public/sw.js", import.meta.url);

test("operational reports do not expose the imported Source ID column", async () => {
  const source = await readFile(reportsPath, "utf8");
  assert.doesNotMatch(source, /\[\s*["']source_id["']\s*,\s*["']Source ID["']/);
  assert.match(source, /get_operational_report_v2/);
  assert.match(source, /source_id:\s*_sourceId/);
});

test("report RPC v2 strips source_id from participant-facing report rows", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /get_operational_report_v2/);
  assert.match(sql, /item\s*-\s*'source_id'/);
  assert.match(sql, /participant_master/);
  assert.match(sql, /onsite_registrations/);
});

test("published Kumasi structure receives unique finalized company-first FSY IDs", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /row_number\(\) over/);
  assert.match(sql, /participant_badge_assignments/);
  assert.match(sql, /count\(distinct fsy_id\)/);
  assert.match(sql, /state = 'finalized'/);
  assert.match(sql, /private\.origin_code_for_participant/);
  assert.doesNotMatch(sql, /d6168b42-0d57-4e8d-a2ae-db1e97ec3308/);
});

test("PWA shell advances for reports and identity v25", async () => {
  const source = await readFile(swPath, "utf8");
  assert.match(source, /fsy-kumasi-shell-v44/);
  assert.match(source, /Reports \+ identity v25/);
  assert.match(source, /fsy-kumasi-shell-v43/);
});
