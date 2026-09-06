import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("registration sheets use one bounded scroll surface on phones and desktop", async () => {
  const css = await read("src/registration-modal-v4.css");
  assert.match(css, /\.regjourney-person-layer-v3 \.regjourney-person-flow-v3,[\s\S]*max-height:\s*min\(88dvh, 900px\)[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.regjourney-person-layer-v3\.layer-panel,[\s\S]*max-height:\s*min\(94dvh, 940px\)/);
  assert.match(css, /\.regjourney-onsite-layer-v3 \.regjourney-onsite-form-v3[\s\S]*overflow-y:\s*auto/);
});

test("participant readiness stays a single four-step row and blockers remove false affordance", async () => {
  const css = await read("src/registration-modal-v4.css");
  assert.match(css, /\.regjourney-person-flow-v3 \.regjourney-progress\s*\{[\s\S]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /@supports selector\(\.regjourney-progress:has\(~ \.regjourney-blocked\)\)[\s\S]*\.regjourney-progress:has\(~ \.regjourney-blocked\)[\s\S]*display:\s*none\s*!important/);
  assert.match(css, /\.regjourney-person-header:has\(~ \.regjourney-blocked\) > \.status[\s\S]*display:\s*none/);
});

test("on-site registration adapts to compact phones without nested suggestion overlays", async () => {
  const css = await read("src/registration-modal-v4.css");
  assert.match(css, /@media \(max-width: 540px\)[\s\S]*\.regjourney-unit-options\s*\{[\s\S]*position:\s*static[\s\S]*max-height:\s*none[\s\S]*overflow:\s*visible/);
  assert.match(css, /\.regjourney-onsite-form-v3 \.regjourney-sheet-actions[\s\S]*grid-template-columns:\s*1fr\s*!important/);
  assert.match(css, /@media \(max-width: 380px\)/);
  assert.match(css, /@media \(max-width: 760px\) and \(max-height: 700px\)/);
  assert.doesNotMatch(css, /iPhone|Samsung|Galaxy|Pixel/i);
});

test("registration modal refinements stay after shared shell layers and ship through the current PWA shell", async () => {
  const [main, sw] = await Promise.all([read("src/main.jsx"), read("public/sw.js")]);
  const registrationImport = main.indexOf('import "./registration-modal-v4.css";');
  const sidebarImport = main.indexOf('import "./sidebar-navigation-v2.css";');
  assert.ok(registrationImport > sidebarImport, "registration modal overrides should load after shared shell layers");
  assert.match(sw, /fsy-kumasi-shell-v31/);
});
