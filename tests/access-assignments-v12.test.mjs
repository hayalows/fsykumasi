import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Access and Assignments both use the connected leader setup flow", async () => {
  const [accessWrapper, assignmentsWrapper, access, assignments] = await Promise.all([
    read("src/pages/Access.jsx"),
    read("src/pages/Assignments.jsx"),
    read("src/pages/AccessV4.jsx"),
    read("src/pages/AssignmentsV3.jsx"),
  ]);
  assert.match(accessWrapper, /AccessV4/);
  assert.match(assignmentsWrapper, /AssignmentsV3/);
  assert.match(access, /LeaderSetupFlow/);
  assert.match(assignments, /LeaderSetupFlow/);
  assert.match(access, /Invite someone/);
  assert.match(assignments, /Add & set up leader/);
});

test("leader setup completes responsibility, scope and sign-in without page switching", async () => {
  const flow = await read("src/components/LeaderSetupFlow.jsx");
  assert.match(flow, /STAFF_ROLE_OPTIONS/);
  assert.match(flow, /committee_viewer/);
  assert.match(flow, /createManualStaffLeader/);
  assert.match(flow, /setAssistantCoordinatorCompanies/);
  assert.match(flow, /createStaffLeaderInvite/);
  assert.match(flow, /onCreateCommitteeInvite/);
  assert.match(flow, /Review/);
  assert.match(flow, /Access follows responsibility/);
  assert.doesNotMatch(flow, /view=access|view=assignments/);
});

test("existing leaders cannot back into the new-person identity step", async () => {
  const flow = await read("src/components/LeaderSetupFlow.jsx");
  assert.match(flow, /const firstStep = existing \? 2 : 1/);
  assert.match(flow, /const canGoBack = step > firstStep/);
  assert.match(flow, /!existing && step === 1/);
  assert.match(flow, /const totalSteps = existing \? 2 : 3/);
});

test("mobile leader setup keeps a full-height single task with sticky actions", async () => {
  const [baseCss, v16Css] = await Promise.all([read("src/access-assignments-v12.css"), read("src/access-ux-v16.css")]);
  assert.match(baseCss, /leader-setup-scroll\{[^}]*overflow:auto/);
  assert.match(baseCss, /leader-setup-footer\{[^}]*safe-area-inset-bottom/);
  assert.match(baseCss, /font-size:16px/);
  assert.match(v16Css, /position:fixed;inset:0;width:100vw;height:100dvh/);
  assert.match(v16Css, /leader-setup-footer\{[^}]*safe-area-inset-bottom/);
});

test("Access defaults to unfinished work and Assignments suggestions are deterministic", async () => {
  const [access, assignments] = await Promise.all([read("src/pages/AccessV4.jsx"), read("src/pages/AssignmentsV3.jsx")]);
  assert.match(access, /initialFilter[\s\S]*"needs"/);
  assert.match(access, /Needs action/);
  assert.doesNotMatch(assignments, /Math\.random/);
  assert.match(assignments, /accountSetupNeeded/);
  assert.match(assignments, /Review before applying/);
});

test("PWA shell keeps the earlier interface layers and advances Access UX to v16", async () => {
  const [sw, main] = await Promise.all([read("public/sw.js"), read("src/main.jsx")]);
  assert.match(sw, /fsy-kumasi-shell-v38/);
  assert.match(sw, /Access UX v16/);
  assert.match(main, /access-assignments-v12\.css/);
  assert.match(main, /access-assignments-v15\.css/);
  assert.match(main, /access-ux-v16\.css/);
});
