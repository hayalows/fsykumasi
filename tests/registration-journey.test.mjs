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

test("day-one journey resolves participant issues without page hopping", async () => {
  const source = await read("src/pages/RegistrationJourney.jsx");
  assert.match(source, /Start on-site registration/);
  assert.match(source, /Resolve & check in/);
  assert.match(source, /Verify & continue/);
  assert.match(source, /assignParticipantToGroup/);
  assert.match(source, /replaceArrivalVacancy/);
  assert.match(source, /saveHousingAssignment/);
  assert.match(source, /createHousingRoomAndAssignV2/);
  assert.match(source, /Complete check-in/);
  assert.match(source, /Confirm not attending/);
  assert.match(source, /parent \/ guardian registration and terms/i);
  assert.match(source, /bishop or branch president approval/i);
  assert.match(source, /payment information/i);
});

test("Registration Committee receives narrow operational powers, not access administration", async () => {
  const migration = await read("supabase/migrations/20260905001500_unified_registration_checkin_permissions.sql");
  assert.match(migration, /where team_key = 'registration'/);
  assert.match(migration, /'housing_view','housing_manage'/);
  assert.match(migration, /private\.has_capability\(p_session_id,'registration_manage'\)/);
  assert.match(migration, /private\.has_capability\(target\.session_id,'registration_manage'\)/);
  assert.match(migration, /private\.operational_participant_is_eligible/);
  assert.match(migration, /group_max_size,avoid_same_unit/);
  assert.doesNotMatch(migration, /access_admin.*registration/i);
});

test("unified journey preserves responsive single-scroll modal behavior", async () => {
  const css = await read("src/pages/registration-journey.css");
  assert.match(css, /regjourney-person-layer/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /max-height:none; overflow:visible/);
  assert.match(css, /min-height:48px/);
  assert.match(css, /prefers-reduced-motion/);
});

test("navigation prefers the unified registration desk for Registration users", async () => {
  const shell = await read("src/components/AppShell.jsx");
  assert.match(shell, /canRegistration/);
  assert.match(shell, /Registration & check-in/);
  assert.match(shell, /else if \(canCheckin\)/);
});
