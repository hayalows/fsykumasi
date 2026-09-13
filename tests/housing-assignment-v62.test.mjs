import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Housing v62 loads after the v61 refinement layer", async () => {
  const source = await read("src/pages/HousingV8.jsx");
  assert.match(source, /housing-live-v61\.css[\s\S]*housing-live-v62\.css/);
});

test("mobile Housing never hides the room confirmation button wrapper", async () => {
  const [assignment, css] = await Promise.all([
    read("src/pages/HousingAssignmentV5.jsx"),
    read("src/pages/housing-live-v62.css"),
  ]);

  assert.match(assignment, /housing-v37-footer-buttons/);
  assert.match(assignment, /`Assign \$\{selectedRoom\.name\}`/);
  assert.match(assignment, /Create room & assign/);
  assert.match(css, /housing-v5-assignment-actions\.housing-v37-assignment-actions > \.housing-v37-footer-buttons[\s\S]*display:\s*grid !important/);
  assert.match(css, /housing-v37-footer-buttons > button,[\s\S]*display:\s*inline-flex !important/);
  assert.match(css, /min-height:\s*52px !important/);
});

test("mobile Housing keeps room context, actions and final choices above the safe area", async () => {
  const css = await read("src/pages/housing-live-v62.css");
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /housing-v5-assignment-body[\s\S]*scroll-padding-bottom:\s*150px/);
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*housing-v5-picker-head\.housing-v36-picker-head[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /housing-v5-picker-head\.housing-v36-picker-head > button[\s\S]*min-height:\s*48px/);
});

test("Housing v62 refreshes the installed app shell", async () => {
  const sw = await read("public/sw.js");
  assert.match(sw, /CACHE_NAME = "fsy-kumasi-shell-v62"/);
  assert.match(sw, /Housing assignment v62/);
  assert.match(sw, /fsy-kumasi-shell-v61/);
});
