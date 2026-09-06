import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("on-site registration uses compact step progress and explicit placement confirmation", async () => {
  const parts = await read("src/pages/RegistrationJourneyPartsV4.jsx");
  assert.match(parts, /function StepIndicator/);
  assert.match(parts, /Step \{step\} of 4/);
  assert.match(parts, /Lowest load/);
  assert.doesNotMatch(parts, /Best fit/);
  assert.match(parts, /Nothing is saved until you confirm below/);
  assert.match(parts, /Place in \$\{selected\.displayName/);
});

test("mobile registration is full-screen and keeps mutation outcomes in view", async () => {
  const [css, parts] = await Promise.all([
    read("src/registration-flow-v7.css"),
    read("src/pages/RegistrationJourneyPartsV4.jsx"),
  ]);
  assert.match(css, /height:\s*100dvh\s*!important/);
  assert.match(css, /\.regjourney-person-flow-v5 \.regjourney-progress \{ display: none !important; \}/);
  assert.match(css, /padding:\s*10px 14px 10px 44px\s*!important/);
  assert.match(parts, /readyRef\.current\?\.scrollIntoView/);
  assert.match(parts, /completionRef\.current\?\.scrollIntoView/);
  assert.match(parts, /Saving check-in…/);
});

test("Housing is queue-first on mobile and room choices explain recommendation reasons", async () => {
  const [housing, assignment, css] = await Promise.all([
    read("src/pages/HousingV5.jsx"),
    read("src/pages/HousingAssignmentV5.jsx"),
    read("src/housing-operations-v5.css"),
  ]);
  assert.match(housing, /Live from Registration/);
  assert.ok(housing.indexOf("housing-v5-people") < housing.indexOf("housing-v5-rooms"), "arrival work should appear before room browsing in the source order");
  assert.match(housing, /Arrivals[\s\S]*Rooms[\s\S]*Assigned/);
  assert.match(assignment, /sameGroup/);
  assert.match(assignment, /Keeps group together/);
  assert.match(assignment, /Nothing is saved until you confirm/);
  assert.match(css, /\.housing-v5-mobile-tabs \{ display: grid/);
  assert.match(css, /\.housing-v5-panel\.mobile-hidden \{ display: none; \}/);
});

test("mobile navigation keeps responsibility-first destinations stable", async () => {
  const shell = await read("src/components/AppShell.jsx");
  assert.match(shell, /currentRole === "assistant_coordinator"/);
  assert.match(shell, /currentRole === "committee_viewer"/);
  assert.match(shell, /const primaryTeam = canHousing \? housing : canFood \? food : canWellness \? wellness : registration/);
  assert.match(shell, /mobile = uniqueItems\(\[overview, primaryTeam, people, headcount \|\| registration\]\)\.slice\(0,4\)/);
  assert.match(shell, /const activeInMore=nav\.moreIds\.has\(active\) && !nav\.mobile\.some/);
});

test("new field-workflow styles load last and ship with PWA shell v33", async () => {
  const [main, sw, housingExport] = await Promise.all([
    read("src/main.jsx"),
    read("public/sw.js"),
    read("src/pages/Housing.jsx"),
  ]);
  assert.ok(main.indexOf('import "./housing-operations-v5.css";') > main.indexOf('import "./housing-assignment-v4.css";'));
  assert.ok(main.indexOf('import "./housing-room-action-v8.css";') > main.indexOf('import "./housing-operations-v5.css";'));
  assert.ok(main.indexOf('import "./registration-flow-v7.css";') > main.indexOf('import "./registration-checkin-v6.css";'));
  assert.match(sw, /fsy-kumasi-shell-v33/);
  assert.match(housingExport, /HousingV5/);
});
