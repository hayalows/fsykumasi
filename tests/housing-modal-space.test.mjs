import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Housing assignment modal preserves room-browsing space on desktop and avoids nested mobile scrolling", async () => {
  const [main, css] = await Promise.all([
    read("src/main.jsx"),
    read("src/housing-assignment-v4.css"),
  ]);

  assert.match(main, /housing-assignment-v4\.css/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(280px, 320px\)/);
  assert.match(css, /housing-room-choice-list-v3[\s\S]*max-height:\s*none !important/);
  assert.match(css, /housing-move-reason[\s\S]*grid-column:\s*2/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*housing-room-choice-list-v3[\s\S]*overflow:\s*visible !important/);
  assert.match(css, /@media \(min-width: 761px\) and \(max-height: 690px\)/);
});
