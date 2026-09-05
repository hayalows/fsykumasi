import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Phase 3 reports are lazy and server-authorized by responsibility", async () => {
  const [reports, migration] = await Promise.all([
    read("src/pages/Reports.jsx"),
    read("supabase/migrations/20260904133000_phase3_reporting.sql"),
  ]);
  assert.match(reports, /loadOperationalReport/);
  assert.match(reports, /REPORTS/);
  assert.match(reports, /canUseReport/);
  assert.match(migration, /get_operational_report/);
  assert.match(migration, /reports_export/);
  assert.match(migration, /housing_export/);
  assert.match(migration, /food_export/);
  assert.match(migration, /wellness_export/);
});

test("Report Centre provides named operational products rather than generic data dumping", async () => {
  const page = await read("src/pages/Reports.jsx");
  assert.match(page, /Participant Directory/);
  assert.match(page, /Housing Assignments/);
  assert.match(page, /Dietary Accommodation List/);
  assert.match(page, /Registration Exceptions/);
  assert.match(page, /Staff Roster/);
  assert.match(page, /Audit Activity/);
  assert.match(page, /Search participant directory|Search report/);
});

test("CSV keeps Unicode data and genuine XLSX is an OOXML ZIP package", async () => {
  const exports = await read("src/lib/report-export.js");
  assert.match(exports, /\uFEFF/);
  assert.match(exports, /PK/);
  assert.match(exports, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
});

test("Report preview stays responsive and makes filtered export scope explicit", async () => {
  const [page, css] = await Promise.all([read("src/pages/Reports.jsx"), read("src/pages/reports.css")]);
  assert.match(page, /Exporting \$\{exportLabel\} rows matching this search/);
  assert.match(page, /Show 120 more/);
  assert.match(page, /Print \/ PDF/);
  assert.match(page, />Excel</);
  assert.match(css, /@media\(max-width:620px\)/);
  assert.match(css, /content:attr\(data-label\)/);
  assert.match(css, /min-height:44px/);
});

test("Housing exposes room occupants with server-derived check-in context", async () => {
  const [migration, housing, dialogs, loader] = await Promise.all([
    read("supabase/migrations/20260904133500_phase3_housing_context.sql"),
    read("src/pages/HousingV4.jsx"),
    read("src/pages/HousingDialogsV4.jsx"),
    read("src/lib/housing-context.js"),
  ]);
  assert.match(migration, /get_housing_assignments_v2/);
  assert.match(migration, /checkin_status text/);
  assert.match(migration, /participant_badge_assignments/);
  assert.match(housing, /setSelectedRoom\(r\)/);
  assert.match(dialogs, /People in this room/);
  assert.match(dialogs, /Checked in/);
  assert.match(dialogs, /Awaiting check-in/);
  assert.match(loader, /get_housing_assignments_v2/);
});

test("Wellness private export is not granted through the generic report gate", async () => {
  const migration = await read("supabase/migrations/20260904133000_phase3_reporting.sql");
  const wellnessGate = migration.slice(migration.indexOf("elsif p_report_key = 'wellness_visits'"), migration.indexOf("elsif p_report_key = 'audit_activity'"));
  assert.match(wellnessGate, /wellness_export/);
  assert.doesNotMatch(wellnessGate, /reports_export/);
  assert.match(migration, /team_key = 'wellness'/);
});
