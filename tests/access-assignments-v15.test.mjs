import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Access uses one invitation entry point for staff leaders and committee members", async () => {
  const [access, flow] = await Promise.all([read("src/pages/AccessV4.jsx"), read("src/components/LeaderSetupFlow.jsx")]);
  assert.match(access, /Invite someone/);
  assert.match(access, /allowCommittee=\{canInviteCommittee\}/);
  assert.match(flow, /committee_viewer/);
  assert.match(flow, /onCreateCommitteeInvite/);
  assert.match(flow, /createManualStaffLeader/);
  assert.match(flow, /createStaffLeaderInvite/);
  assert.match(flow, /Access follows responsibility/);
});

test("committee members and pending committee invites are visible in the main Access directory", async () => {
  const access = await read("src/pages/AccessV4.jsx");
  assert.match(access, /committeeActive/);
  assert.match(access, /committeePending/);
  assert.match(access, /committeeNames/);
  assert.match(access, /Committee member/);
  assert.match(access, /Name, email, role, company or committee/);
  assert.match(access, /Edit committees/);
  assert.doesNotMatch(access, /Committee & older accounts/);
});

test("Access feedback is transient and invite cancellation copy is concise", async () => {
  const access = await read("src/pages/AccessV4.jsx");
  assert.match(access, /ActionToast/);
  assert.match(access, /Invite cancelled for \$\{person\.name\}/);
  assert.doesNotMatch(access, /pending invite was revoked/);
  assert.doesNotMatch(access, /\{notice \? <MutationFeedback/);
});

test("Access prevents common duplicate-account and duplicate-invite mistakes before submit", async () => {
  const flow = await read("src/components/LeaderSetupFlow.jsx");
  assert.match(flow, /This email already has website access/);
  assert.match(flow, /An invite is already waiting for this email/);
  assert.match(flow, /knownAccounts/);
  assert.match(flow, /pendingInvites/);
  assert.match(flow, /emailConflict/);
});

test("modal foundation dismisses correctly and Access actions use a viewport portal", async () => {
  const [ui, access] = await Promise.all([read("src/components/UI.jsx"), read("src/pages/AccessV4.jsx")]);
  assert.match(ui, /event\.target === event\.currentTarget/);
  assert.match(ui, /Escape/);
  assert.match(access, /createPortal/);
  assert.match(access, /access-action-menu/);
  assert.match(access, /document\.addEventListener\("pointerdown", closeOutside\)/);
  assert.match(access, /window\.addEventListener\("scroll", update, true\)/);
});

test("Assignments exposes unfinished work directly and reviews exact suggested mappings", async () => {
  const assignments = await read("src/pages/AssignmentsV3.jsx");
  assert.match(assignments, /assignments-v15-quick/);
  assert.match(assignments, /Website access/);
  assert.match(assignments, /goToAccess\(accountSetupNeeded \? "needs" : "all"\)/);
  assert.match(assignments, /suggestionRows/);
  assert.match(assignments, /Review before applying/);
  assert.match(assignments, /Apply \$\{suggestionRows\.length\} assignments/);
  assert.match(assignments, /Committee access is managed in Access/);
  assert.doesNotMatch(assignments, /No website account needed/);
});

test("Access v16 is the final interface layer and ships shell v38", async () => {
  const [main, css, sw] = await Promise.all([read("src/main.jsx"), read("src/access-ux-v16.css"), read("public/sw.js")]);
  assert.ok(main.indexOf('import "./access-ux-v16.css";') > main.indexOf('import "./access-assignments-v15.css";'));
  assert.match(css, /access-action-menu/);
  assert.match(css, /leader-setup-flow:has\(\.leader-setup-success\)/);
  assert.match(css, /@media\(max-width:640px\)/);
  assert.match(sw, /fsy-kumasi-shell-v38/);
  assert.match(sw, /Access UX v16/);
});
