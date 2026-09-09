import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("FSY design system is the final product style layer", async () => {
  const main = await read("src/main.jsx");
  const oldProduct = main.indexOf('import "./operations-product-v36.css";');
  const designSystem = main.indexOf('import "./design-system/index.css";');
  assert.ok(oldProduct >= 0);
  assert.ok(designSystem > oldProduct);
});

test("design system defines semantic tokens instead of page-local visual values", async () => {
  const tokens = await read("src/design-system/tokens.css");
  for (const token of ["--ds-canvas", "--ds-surface", "--ds-text", "--ds-brand", "--ds-line", "--ds-shadow-float", "--ds-control", "--ds-gutter"]) {
    assert.match(tokens, new RegExp(token.replace(/[-]/g, "\\-")));
  }
  assert.match(tokens, /--shadow:\s*0 1px 2px/);
});

test("cards are no longer the default page section language", async () => {
  const [foundation, components, patterns] = await Promise.all([
    read("src/design-system/foundation.css"),
    read("src/design-system/components.css"),
    read("src/design-system/patterns.css"),
  ]);
  assert.match(foundation, /\.panel\s*\{[\s\S]*border-top:\s*1px solid var\(--ds-line\)/);
  assert.match(foundation, /\.panel\s*\{[\s\S]*box-shadow:\s*none/);
  assert.match(components, /Metrics are facts, not cards/);
  assert.match(patterns, /Summary strips/);
  assert.match(patterns, /Row grammar/);
});

test("contextual sheets become drawers on desktop and bottom sheets on mobile", async () => {
  const [components, responsive] = await Promise.all([
    read("src/design-system/components.css"),
    read("src/design-system/responsive.css"),
  ]);
  assert.match(components, /Sheet means contextual work/);
  assert.match(components, /width:\s*min\(560px, 94vw\)/);
  assert.match(components, /height:\s*100dvh/);
  assert.match(responsive, /Contextual sheets become bottom sheets on phones/);
  assert.match(responsive, /border-radius:\s*var\(--ds-radius-xl\) var\(--ds-radius-xl\) 0 0/);
});

test("mobile rules protect 320px layouts and reachable actions", async () => {
  const [responsive, components] = await Promise.all([
    read("src/design-system/responsive.css"),
    read("src/design-system/components.css"),
  ]);
  assert.match(responsive, /@media \(max-width: 390px\)/);
  assert.match(responsive, /calc\(104px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(components, /\.field-sheet-actions/);
  assert.match(components, /position:\s*sticky/);
  assert.match(components, /bottom:\s*0/);
});

test("shared composition primitives exist for future page migrations", async () => {
  const source = await read("src/components/DesignSystem.jsx");
  for (const component of ["Section", "SummaryStrip", "Toolbar", "ActionList", "ActionListItem", "DetailPane", "InlineBanner"]) {
    assert.match(source, new RegExp(`export function ${component}`));
  }
});
