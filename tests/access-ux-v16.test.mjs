import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("older accounts, older invites and older requests are folded into the main people directory", async () => {
  const access = await read("src/pages/AccessV4.jsx");
  assert.match(access, /legacyAccountRows/);
  assert.match(access, /legacyInviteRows/);
  assert.match(access, /requestRows/);
  assert.match(access, /return \[\.\.\.staffRows, \.\.\.committeeActive, \.\.\.committeePending, \.\.\.legacyAccountRows, \.\.\.legacyInviteRows, \.\.\.requestRows\]/);
  assert.match(access, /Connect to staff/);
  assert.match(access, /Move to current setup/);
  assert.doesNotMatch(access, /Older & unmatched access/);
});

test("legacy migration reuses the connected leader setup and bypasses only the record being replaced", async () => {
  const [access, flow] = await Promise.all([read("src/pages/AccessV4.jsx"), read("src/components/LeaderSetupFlow.jsx")]);
  assert.match(access, /migrationMode: true/);
  assert.match(access, /knownAccounts=\{setupTarget\.migrationMode \? \[\] : roster\}/);
  assert.match(access, /pendingInvites=\{setupTarget\.migrationMode \? \[\] : invites\}/);
  assert.match(flow, /createStaffLeaderInvite/);
});

test("Access exposes live online state and offline sign-in recency", async () => {
  const [access, presence, shell] = await Promise.all([read("src/pages/AccessV4.jsx"), read("src/lib/presence.js"), read("src/components/AppShell.jsx")]);
  assert.match(access, /subscribeSessionPresence/);
  assert.match(access, /Online now/);
  assert.match(access, /Last signed in/);
  assert.match(access, /filter === "online"/);
  assert.match(presence, /channel\.track/);
  assert.match(shell, /trackSessionPresence/);
});

test("leader setup has one scroll surface and success uses the correct grid rows", async () => {
  const css = await read("src/access-ux-v16.css");
  assert.match(css, /leader-setup-scroll\{[^}]*overflow:auto/);
  assert.match(css, /account-choice-list-v2,.leader-setup-v15 \.leader-setup-company-list\{max-height:none;overflow:visible/);
  assert.match(css, /leader-setup-flow:has\(\.leader-setup-success\)\{[^}]*grid-template-rows:auto minmax\(0,1fr\) auto/);
  assert.match(css, /position:fixed;inset:0;width:100vw;height:100dvh/);
});
