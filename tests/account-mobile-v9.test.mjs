import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Account keeps edit text inside the desktop control and hides it on phones", async () => {
  const [profile, css] = await Promise.all([
    read("src/pages/Profile.jsx"),
    read("src/account-page-v9.css"),
  ]);
  assert.match(profile, /profile-edit-label/);
  assert.match(profile, /aria-label=\{editing \? "Close name editor" : "Edit account name"\}/);
  assert.match(css, /\.profile-edit-trigger\s*\{[\s\S]*min-width:\s*88px/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.profile-edit-trigger\s*\{[\s\S]*width:\s*44px\s*!important/);
  assert.match(css, /\.profile-edit-label\s*\{[\s\S]*display:\s*none\s*!important/);
});

test("Account disclosures override shared panel padding and stay compact on mobile", async () => {
  const css = await read("src/account-page-v9.css");
  assert.match(css, /\.profile-disclosure\.panel\s*\{[\s\S]*padding:\s*0\s*!important/);
  assert.match(css, /\.profile-disclosure > summary\s*\{[\s\S]*min-height:\s*74px\s*!important/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.profile-disclosure > summary\s*\{[\s\S]*min-height:\s*68px\s*!important/);
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
});

test("Account summary copy separates role, scope and session instead of forcing one long line", async () => {
  const profile = await read("src/pages/Profile.jsx");
  assert.match(profile, /<span className="kicker">Access<\/span><b>\{roleLabel\(currentRole\)\}<\/b><small>\{scope\} · \{activeSessionName\}<\/small>/);
  assert.match(profile, /<span className="kicker">Security<\/span><b>Password<\/b><small>Change the password you use to sign in\.<\/small>/);
  assert.match(profile, /Sign out of this device when you are done\./);
});

test("Account refinement loads after the shared and field workflow layers", async () => {
  const main = await read("src/main.jsx");
  const account = main.indexOf('import "./account-page-v9.css";');
  const registration = main.indexOf('import "./registration-flow-v7.css";');
  const interfaceLayer = main.indexOf('import "./interface-system.css";');
  assert.ok(account > registration);
  assert.ok(account > interfaceLayer);
});
