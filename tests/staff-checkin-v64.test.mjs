import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("staff check-in can add a genuinely missing staff member from the desk", async () => {
  const [registration, source, client] = await Promise.all([
    read("src/pages/Registration.jsx"),
    read("src/pages/StaffCheckin.jsx"),
    read("src/lib/staff-checkin.js"),
  ]);

  assert.match(registration, /<StaffCheckin sessionId=\{sessionId\} live=\{live\} capabilities=\{capabilities\}/);
  assert.match(source, /This person is not on the current ground roster\./);
  assert.match(source, /Add staff on site/);
  assert.match(source, /submitLabel="Add & check in"/);
  assert.match(client, /add_on_site_staff_from_checkin_v2/);
});

test("staff search exposes inactive matches instead of silently treating them as missing", async () => {
  const source = await read("src/pages/StaffCheckin.jsx");
  assert.match(source, /inactiveMatches/);
  assert.match(source, /Existing record needs review/);
  assert.match(source, /Do not add this person again/);
  assert.match(source, /Older or non-current staff record/);
  assert.match(source, /Not in the active staff plan/);
});

test("v64 capture kept source registration history and duplicate protection", async () => {
  const migration = await read("supabase/migrations/20260913191500_staff_checkin_onsite_capture_v64.sql");
  assert.match(migration, /has_capability\(p_session_id, 'registration_manage'\)/);
  assert.match(migration, /has_capability\(p_session_id, 'staff_manage'\)/);
  assert.match(migration, /'awaiting'/);
  assert.match(migration, /'staff_added_from_checkin'/);
  assert.match(migration, /Review the existing record instead of adding another/);
  assert.doesNotMatch(migration, /where staff_member\.session_id = p_session_id[\s\S]{0,160}staff_member\.is_current/);
});

test("on-site staff sheet supports the fast arrival context without forking the form", async () => {
  const source = await read("src/components/OnSiteStaffSheet.jsx");
  assert.match(source, /initialQuery = ""/);
  assert.match(source, /createStaff = addOnSiteStaff/);
  assert.match(source, /submitLabel = "Add Staff for confirmation"/);
  assert.match(source, /I checked the results\. This person is not already listed\./);
});

test("newly captured staff become ready for day-of service", async () => {
  const source = await read("src/pages/StaffCheckin.jsx");
  assert.match(source, /recordStaffArrival\(person, "arrived"\)/);
  assert.match(source, /was added and is ready to serve/);
  assert.match(source, /marks them present and ready/);
  assert.match(source, /The staff record was added, but check-in did not finish/);
});
