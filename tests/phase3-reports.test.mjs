import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildCsvText, buildXlsxBlob } from "../src/lib/report-files.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Phase 3 reports are lazy and server-authorized by responsibility", async () => {
  const [migration, reportsPage, reportLib, app, shell] = await Promise.all([
    read("supabase/migrations/20260904133000_phase3_reporting.sql"),
    read("src/pages/Reports.jsx"),
    read("src/lib/reports.js"),
    read("src/App.jsx"),
    read("src/components/AppShell.jsx"),
  ]);
  assert.match(migration, /create or replace function public\.get_operational_report/);
  assert.match(migration, /p_report_key = 'wellness_visits'[\s\S]*wellness_export/);
  assert.match(migration, /p_report_key = 'meal_attendance'[\s\S]*food_export/);
  assert.match(migration, /p_report_key = 'audit_activity'[\s\S]*access_admin/);
  assert.doesNotMatch(migration, /service_role/i);
  assert.match(reportsPage, /loadOperationalReport\(sessionId, reportKey\)/);
  assert.match(reportsPage, /Building the live snapshot/);
  assert.match(reportLib, /wellness_export/);
  assert.match(app, /REPORT_CAPABILITIES/);
  assert.match(shell, /wellness_export/);
});

test("Report Centre provides named operational products rather than generic data dumping", async () => {
  const reportLib = await read("src/lib/reports.js");
  for (const key of [
    "participant_master","unit_arrival","stake_summary","company_roster","counselor_group",
    "badge_production","badge_exceptions","onsite_registrations","replacements","housing_occupancy",
    "meal_attendance","headcount_history","wellness_visits","audit_activity",
  ]) assert.match(reportLib, new RegExp(`key: \\\"${key}\\\"`));
  assert.match(reportLib, /Participant Master Roster/);
  assert.match(reportLib, /No-shows & Replacements/);
  assert.match(reportLib, /Wellness Visit Log/);
});

test("CSV keeps Unicode data and genuine XLSX is an OOXML ZIP package", async () => {
  const columns = [["id","FSY ID","text"],["name","Full name","text"],["served","Served","boolean"],["date","Date","date"]];
  const rows = [{ id: "KGBS-C01-01", name: "Kwame Osei-Boateng", served: true, date: "2026-09-14" }, { id: "GKM-C01-02", name: "Ɔhemaa Mensah", served: false, date: "2026-09-14" }];
  const csv = buildCsvText(columns, rows);
  assert.match(csv, /Ɔhemaa Mensah/);
  assert.match(csv, /^\ufeff/);
  const blob = buildXlsxBlob(columns, rows, { title: "Participant Master Roster", generatedBy: "FSY Leader" });
  assert.equal(blob.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  const source = await read("src/lib/report-files.js");
  assert.match(source, /state=\"frozen\"/);
  assert.match(source, /<autoFilter ref=/);
  assert.match(source, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
});

test("Report preview exposes the complete schema and makes export scope explicit", async () => {
  const [page, css] = await Promise.all([read("src/pages/Reports.jsx"), read("src/reports-v77.css")]);
  assert.match(page, /const exportColumns = selected\?\.columns \|\| \[\]/);
  assert.match(page, /All \{selected\.columns\.length\} defined report fields are included in the files/);
  assert.match(page, /Blank fields stay visible so the report structure does not change/);
  assert.match(page, /Show all \{filteredRows\.length\.toLocaleString\(\)\}/);
  assert.match(page, /All \{rows\.length\.toLocaleString\(\)\}/);
  assert.match(page, /Matching \{filteredRows\.length\.toLocaleString\(\)\}/);
  assert.match(page, /Print \/ PDF/);
  assert.match(page, />Excel</);
  assert.match(css, /@media \(max-width: 760px\)/);
});

test("Reports isolate cached snapshots by session and retry only transient read failures once", async () => {
  const [page, loader] = await Promise.all([read("src/pages/Reports.jsx"), read("src/lib/reports-v53.js")]);
  assert.match(page, /return `\$\{sessionId \|\| "demo"\}:\$\{reportKey \|\| "none"\}`/);
  assert.match(page, /loadingByKey/);
  assert.match(page, /errorsByKey/);
  assert.match(loader, /error\.code === "57014"/);
  assert.match(loader, /TRANSIENT_REPORT_STATUS = new Set\(\[502, 503, 504\]\)/);
  assert.match(loader, /async function loadWithOneRetry/);
  assert.match(loader, /setTimeout\(resolve, 450\)/);
});

test("Participant membership report builds rows and summary from one materialized projection", async () => {
  const migration = await read("supabase/migrations/20260914215920_participant_membership_report_performance_v77.sql");
  assert.match(migration, /membership_rows as materialized/);
  assert.equal((migration.match(/private\.participant_report_rows\(p_session_id\)/g) || []).length, 1);
  assert.match(migration, /count\(\*\) filter \(where mr\.membership_status_key = 'member_12_plus'\)/);
  assert.match(migration, /'rows', report_rows/);
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
  assert.match(migration, /array\['wellness_export'\]/);
});
