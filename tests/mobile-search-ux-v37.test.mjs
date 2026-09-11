import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("mobile form controls stay at 16px so iPhone focus does not zoom the page", async () => {
  const css = await read("src/mobile-search-ux-v37.css");
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)[\s\S]*font-size:\s*16px\s*!important/);
  assert.match(css, /\.search input,[\s\S]*\.search-field input[\s\S]*font-size:\s*16px\s*!important/);
  assert.match(css, /-webkit-text-size-adjust:\s*100%/);
});

test("mobile search layer loads after the design system so the 14px desktop field rule cannot win", async () => {
  const main = await read("src/main.jsx");
  const designSystem = main.indexOf('import "./design-system/index.css";');
  const mobileSearch = main.indexOf('import "./mobile-search-ux-v37.css";');
  assert.ok(designSystem >= 0);
  assert.ok(mobileSearch > designSystem);
});

test("Wellness search results expose a clear start-visit action and wrap identity context", async () => {
  const css = await read("src/mobile-search-ux-v37.css");
  assert.match(css, /\.wellness-picker-results > button:not\(:disabled\)::after\s*\{[\s\S]*content:\s*"Start visit"/);
  assert.match(css, /\.wellness-picker-results > button > span:nth-child\(2\) small\s*\{[\s\S]*white-space:\s*normal/);
  assert.match(css, /\.wellness-picker-results[\s\S]*overflow-y:\s*auto/);
});

test("People search results wrap long metadata instead of squeezing the row", async () => {
  const css = await read("src/mobile-search-ux-v37.css");
  assert.match(css, /\.people-v2-list > button > span:nth-child\(2\) > small\s*\{[\s\S]*white-space:\s*normal/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.people-v2-list > button\s*\{[\s\S]*grid-template-columns:\s*42px minmax\(0, 1fr\)/);
});
