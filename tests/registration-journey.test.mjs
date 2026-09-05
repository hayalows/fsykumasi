import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Registration presents one Registration & check-in journey", async () => {
  const source = await read("src/pages/Registration.jsx");
  assert.match(source, /title="Registration & check-in"/);
  assert.match(source, /Check-in desk/);
  assert.match(source, /Roster/);
  assert.match(source, /Setup & review/);
  assert.match(source, /<RegistrationJourney view="desk"/);
  assert.match(source, /<RegistrationJourney view="roster"/);
  assert.doesNotMatch(source, /ArrivalOperations/);
});

test("day-one journey resolves participants and hands Housing off after check-in", async () => {
  const [journey, parts] = await Promise.all([
    read("src/pages/RegistrationJourneyV2.jsx"),
    read("src/pages/RegistrationJourneyParts.jsx"),
  ]);
  assert.match(journey, /view === "desk" \? "ready" : "all"/);
  assert.match(journey, /loadRegistrationHousingStatus/);
  assert.match(journey, /Housing can now see them in Arrivals waiting/);
  assert.match(journey, /replaceArrivalVacancy/);
  assert.match(journey, /assignParticipantToGroup/);
  assert.match(parts, /Start on-site registration|On-site registration/);
  assert.match(parts, /Verify & continue/);
  assert.match(parts, /Complete check-in/);
  assert.match(parts, /Waiting for Housing/);
  assert.match(parts, /Confirm not attending/);
  assert.match(parts, /parent \/ guardian registration and terms/i);
  assert.match(parts, /bishop or branch president approval/i);
  assert.match(parts, /payment information/i);
  assert.doesNotMatch(journey, /saveHousingAssignment|createHousingRoomAndAssignV2|HousingPicker/);
  assert.doesNotMatch(parts, /saveHousingAssignment|createHousingRoomAndAssignV2|HousingPicker/);
});

test("Registration Committee and Housing have separate operational ownership", async () => {
  const migration = await read("supabase/migrations/20260905012000_registration_housing_handoff.sql");
  assert.match(migration, /where team_key = 'registration'/);
  assert.match(migration, /where capability not in \('housing_view','housing_manage'\)/);
  assert.match(migration, /get_registration_housing_status/);
  assert.match(migration, /get_housing_arrival_queue/);
  assert.match(migration, /private\.has_capability\(session_id,'housing_view'\)/);
  assert.match(migration, /alter publication supabase_realtime add table public\.housing_assignments/);
  assert.doesNotMatch(migration, /access_admin.*registration/i);
});

test("unified journey uses progressive filters and responsive single-scroll sheets", async () => {
  const [journey, css] = await Promise.all([
    read("src/pages/RegistrationJourneyV2.jsx"),
    read("src/pages/registration-journey-v2.css"),
  ]);
  assert.match(journey, /Ready to check in/);
  assert.match(journey, /Needs attention/);
  assert.match(journey, /large total stays here/i);
  assert.match(css, /regjourney-more-filters/);
  assert.match(css, /@media \(max-width:720px\)/);
  assert.match(css, /max-height:none;overflow:visible/);
  assert.match(css, /min-height:48px/);
  assert.match(css, /prefers-reduced-motion/);
});

test("navigation prefers the unified registration desk for Registration users", async () => {
  const shell = await read("src/components/AppShell.jsx");
  assert.match(shell, /canRegistration/);
  assert.match(shell, /Registration & check-in/);
  assert.match(shell, /else if \(canCheckin\)/);
});
