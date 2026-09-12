import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const shell = read("src/pages/HousingV8.jsx");
const live = read("src/pages/HousingV6.jsx");
const css = read("src/pages/housing-command-center.css");
const sw = read("public/sw.js");

test("Housing uses one consistent route hierarchy across Live, Plan and Inventory", () => {
  assert.match(shell, /housing-command-center\.css/);
  assert.doesNotMatch(shell, /if \(mode === "live"\) return/);
  assert.ok(shell.indexOf("<PageHead") < shell.indexOf("<WorkspaceNav"));
  assert.match(shell, /Live Housing/);
  assert.match(shell, /Company blocks/);
  assert.match(shell, /Rooms & imports/);
});

test("Live Housing is queue-first and removes repeated summary chrome", () => {
  assert.match(live, /Live from Registration/);
  assert.match(live, /waiting for rooms/);
  assert.match(css, /housing-v8-live \.housing-v5-metrics[\s\S]*display:\s*none !important/);
  assert.match(css, /housing-v8-live \.housing-v5-coverage[\s\S]*display:\s*none !important/);
  assert.match(css, /housing-v8-live \.housing-v5-live[\s\S]*box-shadow:\s*none/);
});

test("Housing stays touch-safe and compact on phones", () => {
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /housing-v8-mode-nav button[\s\S]*min-height:\s*44px/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("Housing command center ships in a fresh PWA shell", () => {
  assert.match(sw, /fsy-kumasi-shell-v52/);
  assert.match(sw, /Housing command center/);
});