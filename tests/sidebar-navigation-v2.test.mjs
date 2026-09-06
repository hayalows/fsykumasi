import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("mobile sidebar keeps stable context while only the navigation body scrolls", async () => {
  const css = await read("src/sidebar-navigation-v2.css");
  assert.match(css, /\.session-badge\s*\{[\s\S]*height:\s*auto\s*!important[\s\S]*overflow:\s*visible\s*!important/);
  assert.match(css, /\.session-badge small\s*\{[\s\S]*white-space:\s*normal[\s\S]*line-height:\s*1\.35/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.sidebar\s*\{[\s\S]*width:\s*clamp\(288px, 82vw, 328px\)[\s\S]*height:\s*100dvh[\s\S]*env\(safe-area-inset-top\)/);
  assert.match(css, /\.sidebar-nav\s*\{[\s\S]*flex:\s*1 1 auto[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /\.sidebar-foot\s*\{[\s\S]*flex:\s*none/);
});

test("navigation grid packs rows at the top instead of stretching destinations down the drawer", async () => {
  const css = await read("src/sidebar-navigation-v2.css");
  assert.match(css, /\.sidebar-nav\s*\{[\s\S]*grid-auto-rows:\s*max-content[\s\S]*align-content:\s*start/);
  assert.match(css, /\.nav-group\s*\{[\s\S]*grid-auto-rows:\s*max-content[\s\S]*align-content:\s*start/);
  assert.match(css, /\.sidebar nav button\s*\{[\s\S]*min-height:\s*48px/);
  assert.match(css, /\.sidebar-more-items button\s*\{[\s\S]*min-height:\s*44px/);
});

test("secondary navigation has one strong current-page state and a quiet More disclosure", async () => {
  const css = await read("src/sidebar-navigation-v2.css");
  assert.match(css, /\.sidebar-more-trigger\.active\s*\{[\s\S]*background:\s*transparent\s*!important[\s\S]*box-shadow:\s*none\s*!important/);
  assert.match(css, /\.sidebar-more-trigger\[aria-expanded="true"\]\s*\{[\s\S]*rgba\(196, 233, 245, \.065\)/);
  assert.match(css, /\.sidebar-more-items button\.active\s*\{[\s\S]*background:\s*rgba\(196, 233, 245, \.94\)\s*!important/);
  assert.match(css, /\.sidebar\.open ~ \.workspace \.mobile-nav\s*\{[\s\S]*pointer-events:\s*none/);
});

test("drawer adapts to small, large and short phone viewports without model-specific CSS", async () => {
  const css = await read("src/sidebar-navigation-v2.css");
  assert.match(css, /@media \(max-width: 350px\)/);
  assert.match(css, /@media \(min-width: 600px\) and \(max-width: 760px\)/);
  assert.match(css, /@media \(max-width: 760px\) and \(max-height: 700px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /iPhone|Samsung|Galaxy/i);
});

test("sidebar refinement remains the final CSS layer and ships through a fresh PWA shell", async () => {
  const [main, sw] = await Promise.all([
    read("src/main.jsx"),
    read("public/sw.js"),
  ]);
  const sidebarImport = main.indexOf('import "./sidebar-navigation-v2.css";');
  const previousImport = main.indexOf('import "./modal-refinement-v2.css";');
  assert.ok(sidebarImport > previousImport, "sidebar overrides should load after earlier shell and modal layers");
  assert.match(sw, /fsy-kumasi-shell-v27/);
});
