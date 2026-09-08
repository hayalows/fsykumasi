import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Registration v29 stays mounted while Live check-in and Solutions switch around Readiness", async () => {
  const [entry, registration, sw] = await Promise.all([
    read("src/pages/RegistrationJourney.jsx"),
    read("src/pages/Registration.jsx"),
    read("public/sw.js"),
  ]);
  assert.match(entry, /RegistrationJourneyV29 as RegistrationJourney/);
  assert.match(registration, /<RegistrationJourney view=\{journeyMode\}/);
  assert.match(registration, /hidden=\{mode === "readiness"\}/);
  assert.doesNotMatch(registration, /mode === "desk" \?[^\n]*<RegistrationJourney/);
  assert.doesNotMatch(registration, /mode === "roster" \?[^\n]*<RegistrationJourney/);
  assert.match(sw, /fsy-kumasi-shell-v46/);
});

test("Readiness mounts lazily and its heavy tools remain warm after first visit", async () => {
  const [registration, readiness] = await Promise.all([
    read("src/pages/Registration.jsx"),
    read("src/pages/RegistrationReadinessV30.jsx"),
  ]);
  assert.match(registration, /readinessVisited/);
  assert.match(registration, /setReadinessVisited\(true\)/);
  assert.match(registration, /hidden=\{mode !== "readiness"\}/);
  assert.match(readiness, /visited\.has\("identity"\)/);
  assert.match(readiness, /hidden=\{tool !== "identity"\}/);
  assert.match(readiness, /visited\.has\("staff"\)/);
  assert.match(readiness, /hidden=\{tool !== "staff"\}/);
  assert.match(readiness, /visited\.has\("final"\)/);
  assert.match(readiness, /hidden=\{tool !== "final"\}/);
});

test("live Registration starts from one paged workspace read instead of seven eager data loads", async () => {
  const [journey, loader, pages] = await Promise.all([
    read("src/pages/RegistrationJourneyV29.jsx"),
    read("src/lib/registration-workspace-v29.js"),
    read("src/lib/rpc-pages.js"),
  ]);
  assert.match(journey, /loadRegistrationWorkspaceV29\(sessionId\)/);
  assert.doesNotMatch(journey, /loadArrivalRoster|loadParticipantEligibility|loadIdentityReadiness|loadRegistrationHousingStatus/);
  assert.match(loader, /get_registration_workspace_v29/);
  assert.match(loader, /\["participant_id"\],[\s\S]*1000/);
  assert.match(pages, /pageSize = 1000/);
});

test("normal check-in does not block on a full roster or parent-field refresh", async () => {
  const journey = await read("src/pages/RegistrationJourneyV29.jsx");
  assert.match(journey, /recordCheckin\([\s\S]*\{refresh:false,parent:false\}/);
  assert.match(journey, /checkinStatus:"arrived"/);
});

test("database v29 computes eligibility and identity readiness set-wise", async () => {
  const migration = await read("supabase/migrations/20260908152000_registration_performance_v29.sql");
  assert.match(migration, /private\.participant_eligibility_projection/);
  assert.match(migration, /get_registration_workspace_v29/);
  assert.match(migration, /with origin_keys as/);
  assert.match(migration, /join private\.participant_eligibility_projection\(p_session_id\)/);
  assert.doesNotMatch(migration, /private\.operational_participant_is_eligible\(p_session_id,p\.id\)/);
});
