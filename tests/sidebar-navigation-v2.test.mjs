import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("mobile sidebar keeps session context visible and the middle navigation independently scrollable", async () => {
  const css = await read("src/sidebar-navigation-v2.css");
  assert.match(css, /\.session-badge\s*\{[\s\S]*height:\s*auto\s*!important[\s\S]*overflow:\s*visible\s*!important/);
  assert.match(css, /\.session-badge small\s*\{[\s\S]*white-space:\s*normal[\s\S]*line-height:\s*1\.4/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.sidebar\s*\{[\s\S]*height:\s*100dvh[\s\S]*env\(safe-area-inset-top\)/);
  assert.match(css, /\.sidebar-nav\s*\{[\s\S]*flex:\s*1 1 auto[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /\.sidebar-foot\s*\{[\s\S]*flex:\s*none/);
});

test("secondary navigation has one strong current-page state instead of selecting More twice", async () => {
  const css = await read("src/sidebar-navigation-v2.css");
  assert.match(css, /\.sidebar-more-trigger\.active\s*\{[\s\S]*rgba\(196, 233, 245, \.09\)/);
  assert.match(css, /\.sidebar-more-items button\.active\s*\{[\s\S]*background:\s*var\(--blue-5\)\s*!important/);
  assert.match(css, /\.sidebar\.open ~ \.workspace \.mobile-nav\s*\{[\s\S]*pointer-events:\s*none/);
});

test("sidebar refinement is the final CSS layer and ships through a fresh PWA shell", async () => {
  const [main, sw] = await Promise.all([
    read("src/main.jsx"),
    read("public/sw.js"),
  ]);
  const sidebarImport = main.indexOf('import "./sidebar-navigation-v2.css";');
  const previousImport = main.indexOf('import "./modal-refinement-v2.css";');
  assert.ok(sidebarImport > previousImport, "sidebar overrides should load after earlier shell and modal layers");
  assert.match(sw, /fsy-kumasi-shell-v26/);
});
