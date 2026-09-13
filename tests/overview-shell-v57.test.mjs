import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Overview primary work reads as page content rather than a rounded card", async () => {
  const css = await read("src/pages/overview-v3.css");
  assert.match(css, /\.overview-focus[\s\S]*border-top:\s*1px solid/);
  assert.match(css, /\.overview-focus[\s\S]*border-bottom:\s*1px solid/);
  assert.match(css, /\.overview-focus[\s\S]*border-radius:\s*0/);
  assert.match(css, /\.overview-focus[\s\S]*background:\s*transparent/);
  assert.match(css, /\.overview-focus[\s\S]*box-shadow:\s*none/);
  assert.doesNotMatch(css, /\.overview-focus[^}]*linear-gradient/);
});

test("Overview secondary work aligns to a centered desktop content rail", async () => {
  const css = await read("src/pages/overview-v3.css");
  assert.match(css, /\.overview-home \.overview-followups[\s\S]*width:\s*min\(100%, 860px\)/);
  assert.match(css, /\.overview-home \.overview-followups[\s\S]*margin:\s*18px auto 0/);
  assert.match(css, /\.overview-scope-head[\s\S]*width:\s*min\(100%, 860px\)/);
  assert.match(css, /\.overview-scope-head[\s\S]*margin:\s*0 auto 18px/);
});

test("Overview readiness metrics are balanced and centered on desktop", async () => {
  const css = await read("src/pages/overview-v3.css");
  assert.match(css, /\.overview-home \.overview-metrics[\s\S]*width:\s*min\(100%, 860px\)/);
  assert.match(css, /\.overview-home \.overview-metrics[\s\S]*margin-inline:\s*auto/);
  assert.match(css, /\.overview-metrics > div[\s\S]*align-items:\s*center/);
  assert.match(css, /\.overview-metrics > div[\s\S]*text-align:\s*center/);
});

test("Overview metrics use typography and separators rather than metric cards", async () => {
  const css = await read("src/pages/overview-v3.css");
  assert.match(css, /\.overview-home \.overview-metrics[\s\S]*border-top:\s*1px solid/);
  assert.match(css, /\.overview-home \.overview-metrics[\s\S]*border-bottom:\s*1px solid/);
  assert.match(css, /\.overview-metrics > div[\s\S]*border-radius:\s*0/);
  assert.match(css, /\.overview-metrics > div[\s\S]*background:\s*transparent/);
  assert.match(css, /\.overview-metrics > div[\s\S]*box-shadow:\s*none/);
});

test("Top toolbar search is a familiar icon action without button-card chrome", async () => {
  const shell = await read("src/design-system/refinements.css");
  const component = await read("src/components/session-switcher.css");
  for (const css of [shell, component]) {
    assert.match(css, /\.global-search-button::after[\s\S]*content:\s*none/);
    assert.match(css, /\.global-search-button[\s\S]*border:\s*0/);
    assert.match(css, /\.global-search-button[\s\S]*border-radius:\s*(50%|var\(--ds-radius-round)/);
    assert.match(css, /\.global-search-button[\s\S]*box-shadow:\s*none/);
  }
});

test("Connection state stays visible without becoming a status pill", async () => {
  const shell = await read("src/design-system/refinements.css");
  assert.match(shell, /\.connection[\s\S]*border:\s*0/);
  assert.match(shell, /\.connection[\s\S]*background:\s*transparent/);
  assert.match(shell, /\.connection::before/);
});

test("Overview keeps a compact phone hierarchy", async () => {
  const css = await read("src/pages/overview-v3.css");
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.overview-focus[\s\S]*grid-template-columns:\s*18px minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.overview-home \.overview-metrics[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.overview-metrics > div[\s\S]*align-items:\s*flex-start/);
});
