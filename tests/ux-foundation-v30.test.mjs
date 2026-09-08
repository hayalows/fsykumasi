import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  humanizeOperationalValue,
  naturalCompare,
  participantOperationalContext,
  sortByNatural,
  workspaceDataState,
} from "../src/lib/ux-foundation.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("natural ordering keeps numbered companies and groups in human order", () => {
  assert.deepEqual(
    sortByNatural(["Company 10", "Company 2", "Company 1"]),
    ["Company 1", "Company 2", "Company 10"],
  );
  assert.ok(naturalCompare("Young Men Group 9", "Young Men Group 10") < 0);
});

test("workspace state never reports ready while updating, stale, failed, or offline", () => {
  assert.equal(workspaceDataState({ refreshing: true, hasData: true }).state, "updating");
  assert.equal(workspaceDataState({ error: "timeout", hasData: true }).state, "stale");
  assert.equal(workspaceDataState({ error: "timeout", hasData: false }).state, "failed");
  assert.equal(workspaceDataState({ online: false, hasData: true }).state, "offline");
  assert.equal(workspaceDataState({ hasData: true }).state, "ready");
});

test("operational values are presented as readable states", () => {
  assert.equal(humanizeOperationalValue("expected_later"), "Expected later");
  assert.equal(humanizeOperationalValue("confirmation_required"), "Confirmation required");
  assert.equal(humanizeOperationalValue("not_checked_in"), "Not checked in");
});

test("participant context keeps identity and the source work context together", () => {
  const context = participantOperationalContext(
    {
      id: "p-1",
      fullName: "Ama Mensah",
      fsyId: "KUM-0001",
      companyName: "Company 2",
      groupName: "Young Women Group 3",
      registrationStatus: "approved",
      checkinStatus: "arrived",
    },
    { view: "groups", companyId: "c-2", groupId: "g-3", search: "Ama" },
  );
  assert.equal(context.participantId, "p-1");
  assert.equal(context.fsyId, "KUM-0001");
  assert.equal(context.source.view, "groups");
  assert.equal(context.source.companyId, "c-2");
  assert.equal(context.source.search, "Ama");
});

test("Phase 1 applies natural ordering to the live Groups screen", async () => {
  const groups = await read("src/pages/GroupsV2.jsx");
  assert.match(groups, /sortByNatural/);
  assert.match(groups, /const companies=sortByNatural/);
  assert.match(groups, /const groups=sortByNatural/);
  assert.match(groups, /naturalCompare\(companyName\(a\.company\),companyName\(b\.company\)\)/);
});

test("Staff readiness is explicit and non-ready while source data is loading", async () => {
  const staff = await read("src/pages/StaffReadiness.jsx");
  assert.match(staff, /aria-busy=\{loading\}/);
  assert.match(staff, /label:"Loading"/);
  assert.match(staff, /Confirmation required/);
  assert.match(staff, /disabled=\{loading\}/);
  assert.match(staff, /Loading Staff readiness/);
});

test("responsive foundation supports narrow screens, safe sheets, touch targets and reduced motion", async () => {
  const css = await read("src/ux-foundation-v30.css");
  assert.match(css, /--ux-touch-target:\s*44px/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /\.dismissible-layer \.layer-panel/);
  assert.match(css, /\.groups-v2-live-summary[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /overflow-wrap: anywhere/);
});

test("workspace navigation can retain a return context without leaking it into the visible URL", async () => {
  const navigation = await read("src/lib/navigation.js");
  assert.match(navigation, /returnTo/);
  assert.match(navigation, /window\.history\?\.state/);
  assert.doesNotMatch(navigation, /searchParams\.set\("returnTo"/);
});

test("the UX foundation stylesheet is loaded after existing screen styles", async () => {
  const main = await read("src/main.jsx");
  const foundation = main.indexOf('import "./ux-foundation-v30.css"');
  const previous = main.indexOf('import "./access-operations-v16.css"');
  assert.ok(foundation > previous);
});
