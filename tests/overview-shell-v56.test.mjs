import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Overview uses one task surface instead of decorative gradient cards", async () => {
  const css = await read("src/pages/overview-v3.css");
  assert.match(css, /\.overview-focus[\s\S]*border-left-width:\s*4px/);
  assert.match(css, /\.overview-focus[\s\S]*box-shadow:\s*none/);
  assert.doesNotMatch(css, /\.overview-focus[^}]*linear-gradient/);
  assert.match(css, /\.overview-focus \.primary[\s\S]*min-height:\s*var\(--ds-control/);
});

test("Overview scope metrics are grouped facts rather than separate cards", async () => {
  const css = await read("src/pages/overview-v3.css");
  assert.match(css, /\.overview-metrics[\s\S]*gap:\s*1px/);
  assert.match(css, /\.overview-metrics[\s\S]*background:\s*var\(--ds-line/);
  assert.match(css, /\.overview-metrics > div[\s\S]*border:\s*0/);
  assert.match(css, /\.overview-metrics > div[\s\S]*border-radius:\s*0/);
  assert.match(css, /\.overview-metrics > div[\s\S]*box-shadow:\s*none/);
});

test("Top search reads as a consistent secondary action", async () => {
  const shell = await read("src/design-system/refinements.css");
  const component = await read("src/components/session-switcher.css");
  for (const css of [shell, component]) {
    assert.match(css, /Search people/);
    assert.match(css, /\.global-search-button[\s\S]*border-radius:\s*var\(--ds-radius-sm/);
    assert.match(css, /\.global-search-button[\s\S]*box-shadow:\s*none/);
  }
  assert.doesNotMatch(shell, /Find person/);
  assert.doesNotMatch(component, /Find person/);
});

test("Overview keeps a phone layout without reintroducing card grids", async () => {
  const css = await read("src/pages/overview-v3.css");
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.overview-focus[\s\S]*grid-template-columns:\s*44px minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.overview-metrics[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});
