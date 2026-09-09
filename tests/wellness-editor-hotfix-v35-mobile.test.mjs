import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Wellness mobile editor uses the full dynamic viewport", async () => {
  const css = await read("src/pages/wellness-v35.css");
  const mobile = css.slice(css.indexOf("@media(max-width:700px)"), css.indexOf("@media(max-width:420px)"));
  assert.match(mobile, /height:100dvh/);
  assert.match(mobile, /max-height:100dvh/);
  assert.match(mobile, /scroll-padding-bottom:104px/);
  assert.match(mobile, /safe-area-inset-bottom/);
});
