import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Access loads committee choices when the app-level catalog has not hydrated yet", async () => {
  const wrapper = await read("src/pages/Access.jsx");
  assert.match(wrapper, /loadTeamCatalog/);
  assert.match(wrapper, /resolvedTeams/);
  assert.match(wrapper, /teams=\{resolvedTeams\}/);
});

test("committee setup never shows an invisible required selection", async () => {
  const accountSetup = await read("src/components/AccountSetup.jsx");
  assert.match(accountSetup, /No committee choices are available yet/);
  assert.match(accountSetup, /Primary FSY responsibility stays separate/);
  assert.match(accountSetup, /A Coordinator can serve on committees without giving up the Coordinator role/);
});

test("Needs attention ignores people who have never started website access", async () => {
  const access = await read("src/pages/AccessV19.jsx");
  assert.match(access, /function accessStarted/);
  assert.match(access, /function missingRequiredScope/);
  assert.match(access, /Staff who have never been invited are not treated as problems/);
  assert.doesNotMatch(access, /if \(person\.staffId && person\.accessState === "not_enabled"\) return true/);
});

test("staff-level roles can carry additive committee responsibilities", async () => {
  const access = await read("src/pages/AccessV19.jsx");
  assert.match(access, /committeeKeys/);
  assert.match(access, /Add committee/);
  assert.match(access, /Primary assignment/);
});

test("desktop topbar keeps global people search as a familiar icon action", async () => {
  const css = await read("src/components/session-switcher.css");
  assert.match(css, /\.global-search-button::after/);
  assert.match(css, /content:\s*none/);
  assert.match(css, /\.global-search-button[\s\S]*border:\s*0/);
  assert.match(css, /\.global-search-button[\s\S]*width:\s*44px/);
});
