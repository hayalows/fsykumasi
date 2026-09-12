import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("design-system loads the shared interaction refinement layer last", async () => {
  const index = await read("src/design-system/index.css");
  assert.match(index, /@import "\.\/refinements\.css";/);
  assert.ok(index.lastIndexOf("refinements.css") > index.lastIndexOf("operations.css"));
});

test("touch inputs stay native-friendly without disabling zoom", async () => {
  const css = await read("src/design-system/refinements.css");
  assert.match(css, /@media \(hover: none\) and \(pointer: coarse\)/);
  assert.match(css, /font-size:\s*16px !important/);
  assert.match(css, /--ds-touch-target:\s*44px/);
  assert.doesNotMatch(css, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i);
});

test("shell refinements make search and workspace state easier to discover", async () => {
  const css = await read("src/design-system/refinements.css");
  assert.match(css, /\.global-search-button::after[\s\S]*Find person/);
  assert.match(css, /\.session-select[\s\S]*border-radius:\s*var\(--ds-radius-sm\)/);
  assert.match(css, /\.connection::before/);
  assert.match(css, /\.training-banner,[\s\S]*\.sync-warning/);
});

test("mobile local navigation and temporary feedback remain reachable", async () => {
  const css = await read("src/design-system/refinements.css");
  assert.match(css, /scroll-snap-type:\s*x proximity/);
  assert.match(css, /\.segmented button[\s\S]*min-height:\s*var\(--ds-touch-target\)/);
  assert.match(css, /\.action-toast button:not\(\.action-toast-dismiss\)[\s\S]*min-height:\s*var\(--ds-touch-target\)/);
});
