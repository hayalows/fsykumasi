import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Assistant Coordinator reassignment keeps its action bar reachable", async () => {
  const css = await read("src/pages/assignments-live-v79.css");

  assert.match(css, /\.assignments-live-v79-layer\s*\{[\s\S]*?width:\s*min\(760px, calc\(100vw - 24px\)\)/);
  assert.doesNotMatch(css, /assignments-live-v79-layer\s+\.dismissible-layer-panel/);
  assert.match(css, /\.assignments-live-v79-actions\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?bottom:\s*-28px;/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.assignments-live-v79-actions\s*\{[\s\S]*?safe-area-inset-bottom/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.assignments-live-v79-actions button,[\s\S]*?width:\s*100%/);
});
