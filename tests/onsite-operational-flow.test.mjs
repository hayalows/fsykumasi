import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationPath = new URL("../supabase/migrations/20260905143000_operational_inbox_and_onsite_identity.sql", import.meta.url);
const partsPath = new URL("../src/pages/RegistrationJourneyPartsV4.jsx", import.meta.url);
const journeyPath = new URL("../src/pages/RegistrationJourneyV4.jsx", import.meta.url);
const journeyV29Path = new URL("../src/pages/RegistrationJourneyV29.jsx", import.meta.url);

const [migration, parts, journey, journeyV29] = await Promise.all([
  readFile(migrationPath, "utf8"),
  readFile(partsPath, "utf8"),
  readFile(journeyPath, "utf8"),
  readFile(journeyV29Path, "utf8"),
]);

test("on-site group placement issues an FSY ID in the same transaction", () => {
  assert.match(migration, /create or replace function private\.ensure_on_site_fsy_id/i);
  assert.match(migration, /if target\.source_kind = 'on_site' then\s+perform private\.ensure_on_site_fsy_id/i);
  assert.match(migration, /on_site_fsy_id_issued/);
});

test("on-site arrivals cannot bypass identity before check-in", () => {
  assert.match(migration, /On-site participant still needs an FSY ID before check-in/);
  assert.match(parts, /return "Needs FSY ID"/);
  assert.match(parts, /FSY ID will be created with this company when placement is saved/);
});

test("normal on-site placement is primary and confirmed vacancy is optional", () => {
  assert.match(parts, /Choose a counselor group/);
  assert.match(parts, /FSY ID is created in the same save/);
  assert.match(parts, /Use a confirmed vacancy instead/);
  assert.doesNotMatch(parts, /No compatible confirmed vacancy/);
});

test("placement refresh failures stay visible and recoverable in the placement step", () => {
  assert.match(journeyV29, /onRefreshError/);
  assert.match(journeyV29, /Placement was saved, but the roster could not refresh/);
  assert.match(journeyV29, /onRetry=\{retryRegistrationWorkspace\}/);
  assert.doesNotMatch(journeyV29, /void reload\(\)\.catch\(\(\)=>\{\}\)/);
  assert.match(parts, /Retry roster/);
  assert.match(parts, /placementRefreshFailed/);
});

test("vacancy success copy does not claim the retired participant ID transfers", () => {
  assert.match(journey, /Their FSY ID was issued automatically/);
  assert.doesNotMatch(journey, /now has \$\{vacancy\.fsyId\}/);
});

test("Overview server summary only promotes modern person-level head count", () => {
  assert.match(migration, /r\.roster_version >= 3/);
  assert.match(migration, /legacy_headcount_round_archived/);
});

test("Food non-answers are filtered before payload leaves Postgres", () => {
  assert.match(migration, /create or replace function public\.get_food_needs/);
  assert.match(migration, /'noallergies'.*'nodietaryneeds'/s);
});
