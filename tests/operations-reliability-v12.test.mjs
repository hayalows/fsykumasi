import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

test("legacy check-in is canonicalized into Registration desk", () => {
  const nav=read("src/lib/navigation.js"); const shell=read("src/components/AppShell.jsx"); const app=read("src/App.jsx");
  assert.match(nav,/legacyCheckin \? "registration"/); assert.match(nav,/legacyCheckin \? "desk"/);
  assert.match(shell,/canRegistration \|\| canCheckin/); assert.doesNotMatch(app,/effectiveActive==="checkin"/);
});

test("registration never renders a confirmed empty state while loading", () => {
  const source=read("src/pages/RegistrationJourneyV5.jsx");
  assert.match(source,/initialLoading/); assert.match(source,/aria-busy=\{initialLoading \|\| refreshing\}/);
  assert.match(source,/!initialLoading && !loadError && !visible.length/);
});

test("signed-in workspace errors are distinct from sign-in errors", () => {
  const app=read("src/App.jsx"); const auth=read("src/components/AuthGate.jsx");
  assert.match(app,/authSession\?<WorkspaceRecoveryScreen/); assert.match(auth,/Signed in/); assert.match(app,/Promise\.allSettled/);
});

test("Housing rooms require usable wayfinding before new assignment", () => {
  const dialogs=read("src/pages/HousingDialogsV4.jsx"); const assignment=read("src/pages/HousingAssignmentV5.jsx"); const migration=read("supabase/migrations/20260907120000_operations_reliability_v12.sql");
  assert.match(dialogs,/roomHasWayfinding/); assert.match(dialogs,/Location \/ building/); assert.match(assignment,/roomHasWayfinding\(room\)/); assert.match(migration,/Add a location people can use to find this room/);
});

test("Assistant Coordinator reporting is server-scoped by company", () => {
  const reports=read("src/lib/reports.js"); const migration=read("supabase/migrations/20260907120000_operations_reliability_v12.sql");
  assert.match(reports,/role === "assistant_coordinator"/); assert.match(migration,/current_user_company_ids/); assert.match(migration,/staff_in_current_company_scope/); assert.match(migration,/current_report_scope_label/);
});

test("committee responsibilities expose sensitive labels in plain language", () => {
  const setup=read("src/components/AccountSetup.jsx");
  assert.match(setup,/Sensitive · private health information/); assert.match(setup,/Sensitive · financial information/);
});

test("birthdays derive richer assignment context and can deep-link to assignments", () => {
  const field=read("src/lib/field-operations.js"); const birthdays=read("src/pages/Birthdays.jsx"); const app=read("src/App.jsx");
  assert.match(field,/get_staff_birthdays_v2/); assert.match(field,/group: row\.group_name/); assert.match(birthdays,/Open assignment/); assert.match(app,/tab:"people",staffId/);
});

test("Overview actions carry exact destinations", () => {
  const inbox=read("src/lib/overview-inbox.js"); const overview=read("src/pages/Overview.jsx");
  assert.match(inbox,/view:"housing",tab:"arrivals",filter:"waiting"/); assert.match(inbox,/view:"registration",mode:"desk",filter:"ready"/); assert.match(inbox,/view:"assignments",tab:"groups",filter:"needs"/); assert.match(overview,/primary\.destination/);
});

test("v34 shell and final responsive reliability CSS are wired last", () => {
  assert.match(read("public/sw.js"),/fsy-kumasi-shell-v35/); assert.match(read("src/main.jsx"),/operations-reliability-v12\.css/);
});


test("Assistant Coordinators can navigate to scoped Reports and Food attention deep-links open the right queue", () => {
  const shell=read("src/components/AppShell.jsx"); const food=read("src/pages/FoodV3.jsx"); const app=read("src/App.jsx");
  assert.match(shell,/currentRole === "assistant_coordinator" \|\| REPORT_CAPABILITIES/);
  assert.match(food,/initialTab === "dietary"/);
  assert.match(app,/initialTab=\{workspaceContext\.tab/);
});
