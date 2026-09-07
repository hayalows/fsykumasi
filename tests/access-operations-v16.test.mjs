import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Access v5 unifies current, invited and older access into one directory", async () => {
  const [wrapper, access] = await Promise.all([read("src/pages/Access.jsx"), read("src/pages/AccessV5.jsx")]);
  assert.match(wrapper, /AccessV5/);
  assert.match(access, /legacyAccounts/);
  assert.match(access, /legacyInvites/);
  assert.match(access, /legacyRequests/);
  assert.match(access, /allPeople/);
  assert.match(access, /Needs Staff link/);
  assert.match(access, /Move to new system/);
  assert.match(access, /Move to new setup/);
  assert.doesNotMatch(access, /Older & unmatched access/);
});

test("legacy reconciliation preserves Staff as source of truth and blocks unsafe AC duplication", async () => {
  const migration = await read("supabase/migrations/20260907103000_access_v16_legacy_reconciliation.sql");
  assert.match(migration, /create or replace function public\.adopt_legacy_access_account/i);
  assert.match(migration, /staff_account_links/i);
  assert.match(migration, /perform private\.sync_staff_login_access\(target\.id\)/i);
  assert.match(migration, /One or more old companies are already assigned in Staff/i);
  assert.match(migration, /current Staff record already has this name/i);
  assert.match(migration, /create or replace function public\.retire_legacy_access_account/i);
  assert.match(migration, /only Full Session Administrator/i);
});

test("legacy migration is a guided identity decision instead of an automatic guess", async () => {
  const component = await read("src/components/LegacyAccessMigration.jsx");
  assert.match(component, /Connect to existing Staff/);
  assert.match(component, /Create a Staff record/);
  assert.match(component, /The Staff assignment will win/);
  assert.match(component, /Likely match/);
  assert.match(component, /Move account/);
});

test("Access exposes real-time presence and refreshes last sign-in metadata", async () => {
  const [access, presence] = await Promise.all([read("src/pages/AccessV5.jsx"), read("src/lib/presence.js")]);
  assert.match(access, /\["online", "Online now"\]/);
  assert.match(access, /subscribeSessionPresence/);
  assert.match(access, /loadSessionAccountActivity\(sessionId\)/);
  assert.match(access, /60000/);
  assert.match(access, /FSY app is currently open/);
  assert.match(presence, /presence:\s*\{ key: userId \}/);
  assert.match(presence, /event: "join"/);
  assert.match(presence, /event: "leave"/);
});

test("desktop More menus escape the directory card and bottom rows open upward", async () => {
  const css = await read("src/access-operations-v16.css");
  assert.match(css, /access-v4-directory\{overflow:visible!important\}/);
  assert.match(css, /staff-access-more\[open\]\{z-index:40\}/);
  assert.match(css, /nth-last-child\(-n\+2\).*staff-access-more>div\{top:auto;bottom:/s);
  assert.match(css, /@media\(max-width:760px\)[\s\S]*staff-access-more>div\{position:fixed/);
});

test("leader setup success uses the correct grid rows and one scroll surface", async () => {
  const css = await read("src/access-operations-v16.css");
  assert.match(css, /leader-setup-flow:has\(\.leader-setup-success\)\{grid-template-rows:auto minmax\(0,1fr\) auto\}/);
  assert.match(css, /leader-setup-committee-choice \.account-choice-list-v2\{max-height:none!important;overflow:visible!important/);
  assert.match(css, /leader-setup-code strong\{font-size:clamp/);
  assert.match(css, /max-height:calc\(100dvh - 32px\)/);
});

test("mobile and short desktop modal layouts preserve safe, reachable actions", async () => {
  const css = await read("src/access-operations-v16.css");
  assert.match(css, /height:calc\(100dvh - max\(8px,env\(safe-area-inset-top\)\)\)/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /@media\(max-height:720px\) and \(min-width:761px\)/);
  assert.match(css, /legacy-migration-footer button\{width:100%;min-width:0;min-height:48px\}/);
});

test("v16 remains loaded beneath the current Access release", async () => {
  const [main, sw] = await Promise.all([read("src/main.jsx"), read("public/sw.js")]);
  const v15 = main.indexOf('import "./access-assignments-v15.css";');
  const v16 = main.indexOf('import "./access-operations-v16.css";');
  assert.ok(v16 > v15);
  assert.match(sw, /fsy-kumasi-shell-v39/);
  assert.match(sw, /Access operations v17/);
});
