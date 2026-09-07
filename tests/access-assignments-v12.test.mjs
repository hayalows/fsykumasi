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
  assert.match(access, /Add & set up leader/);
  assert.match(assignments, /Add & set up leader/);
});

test("leader setup completes responsibility, company scope and optional sign-in without page switching", async () => {
  const flow = await read("src/components/LeaderSetupFlow.jsx");
  assert.match(flow, /createManualStaffLeader/);
  assert.match(flow, /setAssistantCoordinatorCompanies/);
  assert.match(flow, /createStaffLeaderInvite/);
  assert.match(flow, /Nothing else is needed on another page/);
  assert.match(flow, /Assignments and Access stay synchronized/);
  assert.doesNotMatch(flow, /view=access|view=assignments/);
});

test("existing leaders cannot back into the new-leader identity step", async () => {
  const flow = await read("src/components/LeaderSetupFlow.jsx");
  assert.match(flow, /const firstStep = existing \? 2 : 1/);
  assert.match(flow, /const canGoBack = step > firstStep/);
  assert.match(flow, /!existing && step === 1/);
  assert.match(flow, /const totalSteps = existing \? 2 : 3/);
});

test("mobile leader setup is a full-height single task with sticky actions", async () => {
  const css = await read("src/access-assignments-v12.css");
  assert.match(css, /height:calc\(100dvh - max\(8px,env\(safe-area-inset-top\)\)\)/);
  assert.match(css, /leader-setup-scroll\{[^}]*overflow:auto/);
  assert.match(css, /leader-setup-footer\{[^}]*safe-area-inset-bottom/);
  assert.match(css, /font-size:16px/);
});

test("Access defaults to setup work and Assignments suggestions are deterministic", async () => {
  const [access, assignments] = await Promise.all([read("src/pages/AccessV4.jsx"), read("src/pages/AssignmentsV3.jsx")]);
  assert.match(access, /initialFilter[\s\S]*"needs"/);
  assert.match(access, /Needs setup/);
  assert.doesNotMatch(assignments, /Math\.random/);
  assert.match(assignments, /accountSetupNeeded/);
});

test("PWA shell keeps connected setup and the current Housing release", async () => {
  const [sw, main] = await Promise.all([read("public/sw.js"), read("src/main.jsx")]);
  assert.match(sw, /fsy-kumasi-shell-v34/);
  assert.match(sw, /Housing UX v13/);
  assert.match(main, /access-assignments-v12\.css/);
});
