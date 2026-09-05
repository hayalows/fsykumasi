import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Registration presents one Registration & check-in journey", async () => {
  const [source, wrapper] = await Promise.all([
    read("src/pages/Registration.jsx"),
    read("src/pages/RegistrationJourney.jsx"),
  ]);
  assert.match(source, /title="Registration & check-in"/);
  assert.match(source, /Check-in desk/);
  assert.match(source, /Roster/);
  assert.match(source, /Setup & review/);
  assert.match(source, /<RegistrationJourney view="desk"/);
  assert.match(source, /<RegistrationJourney view="roster"/);
  assert.match(wrapper, /RegistrationJourneyV3/);
  assert.doesNotMatch(source, /ArrivalOperations/);
});

test("day-one journey resolves participants and hands Housing off after check-in", async () => {
  const [journey, parts] = await Promise.all([
    read("src/pages/RegistrationJourneyV3.jsx"),
    read("src/pages/RegistrationJourneyPartsV3.jsx"),
  ]);
  assert.match(journey, /view === "desk" \? "ready" : "all"/);
  assert.match(journey, /loadRegistrationHousingStatus/);
  assert.match(journey, /Housing can now see them in Arrivals waiting/);
  assert.match(journey, /replaceArrivalVacancy/);
  assert.match(journey, /assignParticipantToGroup/);
  assert.match(parts, /Add participant/);
  assert.match(parts, /Verify & continue/);
  assert.match(parts, /Complete check-in/);
  assert.match(parts, /Waiting for Housing/);
  assert.match(parts, /Confirm not attending/);
  assert.match(parts, /parent \/ guardian terms/i);
  assert.match(parts, /bishop or branch president approval/i);
  assert.match(parts, /payment checked/i);
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

test("on-site registration uses the session unit directory and fills stake or district", async () => {
  const [journey, parts] = await Promise.all([
    read("src/pages/RegistrationJourneyV3.jsx"),
    read("src/pages/RegistrationJourneyPartsV3.jsx"),
  ]);
  assert.match(journey, /const unitDirectory = useMemo/);
  assert.match(journey, /row\.unit/);
  assert.match(journey, /row\.stake/);
  assert.match(journey, /unitDirectory=\{unitDirectory\}/);
  assert.match(parts, /function UnitCombobox/);
  assert.match(parts, /aria-autocomplete="list"/);
  assert.match(parts, /Stake \/ district filled automatically/);
  assert.match(parts, /Search the session directory/);
  assert.match(parts, /autoComplete="given-name"/);
  assert.match(parts, /autoComplete="family-name"/);
});

test("participant states block placement when eligibility is unresolved", async () => {
  const parts = await read("src/pages/RegistrationJourneyPartsV3.jsx");
  assert.match(parts, /const placementAllowed = !eligibility \|\| eligibility\.eligible/);
  assert.match(parts, /&& placementAllowed/);
  assert.match(parts, /Resolve this eligibility issue before placement or check-in/);
});

test("refined journey keeps sheets single-scroll and secondary actions progressive", async () => {
  const [journey, parts, css] = await Promise.all([
    read("src/pages/RegistrationJourneyV3.jsx"),
    read("src/pages/RegistrationJourneyPartsV3.jsx"),
    read("src/pages/registration-journey-v3.css"),
  ]);
  assert.match(journey, /Clear filters/);
  assert.match(parts, /Ready/);
  assert.match(parts, /Needs attention/);
  assert.match(parts, /Not checking in now\?/);
  assert.match(parts, /regjourney-layer-close/);
  assert.match(css, /regjourney-choice-list\{max-height:none;overflow:visible/);
  assert.match(css, /regjourney-sheet-actions\{position:static/);
  assert.match(css, /max-height:min\(92dvh,880px\)/);
  assert.match(css, /@media \(max-width:720px\)/);
  assert.match(css, /min-height:50px/);
  assert.match(css, /prefers-reduced-motion/);
});

test("navigation prefers the unified registration desk for Registration users", async () => {
  const shell = await read("src/components/AppShell.jsx");
  assert.match(shell, /canRegistration/);
  assert.match(shell, /Registration & check-in/);
  assert.match(shell, /else if \(canCheckin\)/);
});
