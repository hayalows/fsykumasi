import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("short desktop Wellness editor reduces form height pressure", async () => {
  const css = await read("src/pages/wellness-v35.css");
  assert.match(css, /@media\(max-height:760px\) and \(min-width:701px\)/);
  assert.match(css, /min-height:68px/);
});
