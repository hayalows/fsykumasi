import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("KCC FSY 2026 is the canonical shell and authentication identity", async () => {
  const [meta, shell, auth, app, ui, profile, html] = await Promise.all([
    read("src/lib/app-meta.js"),
    read("src/components/AppShell.jsx"),
    read("src/components/AuthGate.jsx"),
    read("src/App.jsx"),
    read("src/components/UI.jsx"),
    read("src/pages/Profile.jsx"),
    read("index.html"),
  ]);
  assert.match(meta, /APP_NAME = "KCC FSY 2026"/);
  assert.match(shell, /APP_NAME/);
  assert.match(shell, /canonicalSessionName/);
  assert.match(shell, /sessionDayContext/);
  assert.match(auth, /APP_NAME/);
  assert.match(ui, /canonicalSessionName\(sessionName\)/);
  assert.match(ui, /document\.title = `\$\{title\} · \$\{APP_NAME\}`/);
  assert.match(profile, /canonicalSessionName\(sessionInfo\?\.name \|\| sessionName\)/);
  for (const surface of [auth, app, ui, profile, html]) assert.doesNotMatch(surface, /FSY Kumasi(?: 2026)?/);
  assert.match(html, /<title>KCC FSY 2026 · Operations<\/title>/);
  assert.match(html, /apple-mobile-web-app-title" content="KCC FSY 2026"/);
});

test("browser and installed app use the supplied 2026 artwork instead of the legacy generated icon", async () => {
  const [manifestText, html, sw] = await Promise.all([
    read("public/manifest.webmanifest"),
    read("index.html"),
    read("public/sw.js"),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.name, "KCC FSY 2026 · Operations");
  assert.equal(manifest.short_name, "KCC FSY 2026");
  assert.equal(manifest.icons[0].src, "/brand/2026-theme-identifier-full-color.png");
  assert.doesNotMatch(manifestText, /app-icon\.svg/);
  assert.match(html, /rel="icon" type="image\/png" href="\/brand\/2026-theme-identifier-full-color\.png"/);
  assert.match(html, /rel="apple-touch-icon" href="\/brand\/2026-theme-identifier-full-color\.png"/);
  assert.doesNotMatch(sw, /"\/app-icon\.svg"/);
});

test("Overview exposes session context without turning it into another dashboard card", async () => {
  const [overview, css] = await Promise.all([
    read("src/pages/Overview.jsx"),
    read("src/pages/overview-session-v63.css"),
  ]);
  assert.match(overview, /overview-session-context/);
  assert.match(overview, /sessionDayContext/);
  assert.match(css, /overview-session-context[\s\S]*border-top:/);
  assert.doesNotMatch(css, /overview-session-context[^}]*box-shadow/);
});

test("v65 refreshes installed clients while retaining v62 history", async () => {
  const sw = await read("public/sw.js");
  assert.match(sw, /CACHE_NAME = "fsy-kumasi-shell-v65"/);
  assert.match(sw, /Session-aware shell v63/);
  assert.match(sw, /fsy-kumasi-shell-v62/);
});
