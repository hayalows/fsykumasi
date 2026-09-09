import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Wellness footer never uses a negative sticky bottom offset", async () => {
  const css = await read("src/pages/wellness-v35.css");
  const actionBlock = css.slice(css.indexOf(".wellness-editor-layer .wellness-editor-actions{"), css.indexOf(".wellness-editor-layer .wellness-editor-actions button"));
  assert.match(actionBlock, /bottom:0/);
  assert.doesNotMatch(actionBlock, /bottom:-/);
});
