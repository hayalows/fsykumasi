import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Housing keeps room creation inside the Rooms workspace", async () => {
  const housing = await read("src/pages/HousingV5.jsx");
  assert.match(housing, /housing-v5-room-panel-head/);
  assert.match(housing, /housing-v5-add-room/);
  assert.match(housing, />Add room<\/button>/);
  assert.match(housing, /housing-v5-empty-add-room/);
  assert.match(housing, />Add first room<\/button>/);
  assert.doesNotMatch(housing, /<PageHead[^>]*action=/);
});

test("mobile Rooms tab reports total rooms and exposes a reachable contextual action", async () => {
  const [housing, css, main] = await Promise.all([
    read("src/pages/HousingV5.jsx"),
    read("src/housing-room-action-v8.css"),
    read("src/main.jsx"),
  ]);
  assert.match(housing, /<span>Rooms<\/span><b>\{rooms\.length\}<\/b>/);
  assert.match(css, /\.housing-v5-room-panel-head[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  assert.match(css, /\.housing-v5-add-room[\s\S]*min-height:\s*46px/);
  assert.match(css, /@media \(max-width: 380px\)[\s\S]*\.housing-v5-add-room[\s\S]*width:\s*100%/);
  assert.ok(main.indexOf('import "./housing-room-action-v8.css";') > main.indexOf('import "./housing-operations-v5.css";'));
});
