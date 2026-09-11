import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Wellness mobile picker keeps one or a few search results compact", async () => {
  const css = await read("src/wellness-picker-mobile-v38.css");

  assert.match(css, /\.wellness-picker-layer\.layer-panel\s*\{[\s\S]*height:\s*auto\s*!important[\s\S]*max-height:\s*min\(88dvh, 700px\)\s*!important/);
  assert.match(css, /\.wellness-picker \.wellness-picker-results\s*\{[\s\S]*flex:\s*0 1 auto\s*!important/);
  assert.match(css, /\.wellness-picker \.wellness-picker-results\s*\{[\s\S]*align-content:\s*start\s*!important/);
  assert.match(css, /\.wellness-picker \.wellness-picker-results\s*\{[\s\S]*grid-auto-rows:\s*max-content\s*!important/);
});

test("Wellness mobile picker still caps and scrolls long result lists", async () => {
  const css = await read("src/wellness-picker-mobile-v38.css");

  assert.match(css, /max-height:\s*min\(46dvh, 430px\)\s*!important/);
  assert.match(css, /overflow-y:\s*auto\s*!important/);
});

test("compact Wellness picker override loads after the earlier mobile search rules", async () => {
  const main = await read("src/main.jsx");
  const mobileSearch = main.indexOf('import "./mobile-search-ux-v37.css";');
  const wellnessCompact = main.indexOf('import "./wellness-picker-mobile-v38.css";');

  assert.ok(mobileSearch >= 0);
  assert.ok(wellnessCompact > mobileSearch);
});
