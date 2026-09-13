import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Housing v61 refinement layer loads after the command-center styles", async () => {
  const source = await read("src/pages/HousingV8.jsx");
  assert.match(source, /housing-command-center\.css[\s\S]*housing-live-v61\.css/);
});

test("Housing assignment keeps confirmation reachable outside the scrolling room list", async () => {
  const css = await read("src/pages/housing-live-v61.css");
  assert.match(css, /housing-v5-assignment-modal\.housing-v36-assignment-modal[\s\S]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto !important/);
  assert.match(css, /housing-v5-assignment-body[\s\S]*overflow-y:\s*auto !important/);
  assert.match(css, /housing-v5-assignment-actions\.housing-v36-assignment-actions[\s\S]*position:\s*relative !important/);
  assert.match(css, /housing-v37-footer-buttons[\s\S]*min-height:\s*48px !important/);
});

test("Housing assignment is viewport safe on phones and respects iOS safe areas", async () => {
  const css = await read("src/pages/housing-live-v61.css");
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*housing-v5-assignment-layer\.layer-panel[\s\S]*height:\s*100dvh !important/);
  assert.match(css, /housing-v5-assignment-actions\.housing-v36-assignment-actions[\s\S]*env\(safe-area-inset-bottom/);
  assert.match(css, /housing-v37-footer-buttons button,[\s\S]*min-height:\s*52px !important/);
  assert.match(css, /housing-v5-assignment-body \.search-field input[\s\S]*font-size:\s*16px !important/);
});

test("Live Housing keeps people states readable and operational actions touch friendly", async () => {
  const css = await read("src/pages/housing-live-v61.css");
  assert.match(css, /housing-v5-desktop-status[\s\S]*display:\s*block !important/);
  assert.match(css, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /housing-person-identity-row \.assignment[\s\S]*min-height:\s*48px/);
  assert.match(css, /housing-v6-availability[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/);
});

test("Housing v61 ships through the full repository suite and a fresh PWA shell", async () => {
  const [pkg, sw] = await Promise.all([read("package.json"), read("public/sw.js")]);
  assert.match(pkg, /"test": "node --test tests\/\*\.test\.mjs"/);
  assert.match(sw, /CACHE_NAME = "fsy-kumasi-shell-v61"/);
  assert.match(sw, /Housing live v61/);
  assert.match(sw, /fsy-kumasi-shell-v60/);
});
