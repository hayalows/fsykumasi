import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/pages/Overview.jsx", import.meta.url), "utf8");

test("Overview does not dereference inbox before the live summary exists", () => {
  assert.match(source, /const scopeLabel=inbox\?\.scopeLabel\|\|\(loading\?"Loading scope":"Session scope"\)/);
  assert.doesNotMatch(source, /\{inbox\.scopeLabel\}/);
  assert.match(source, /Preparing live overview/);
  assert.match(source, /Loading live FSY information/);
});
