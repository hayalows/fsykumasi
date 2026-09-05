import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const modalRefinement = readFileSync(new URL("../src/modal-refinement-v2.css", import.meta.url), "utf8");
const accountSetup = readFileSync(new URL("../src/components/AccountSetup.jsx", import.meta.url), "utf8");
const mainEntry = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");

test("modal refinement prevents radio and checkbox controls from stretching like text inputs", () => {
  assert.match(modalRefinement, /input\[type="radio"\]/);
  assert.match(modalRefinement, /input\[type="checkbox"\]/);
  assert.match(modalRefinement, /width:\s*20px\s*!important/);
  assert.match(modalRefinement, /grid-template-columns:\s*20px minmax\(0, 1fr\)/);
});

test("guided responsibility sheet uses compact mobile reflow and reachable actions", () => {
  assert.match(modalRefinement, /@media \(max-width: 760px\)/);
  assert.match(modalRefinement, /\.staff-role-transition-sheet/);
  assert.match(modalRefinement, /\.role-transition-choice-grid[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(modalRefinement, /\.role-transition-actions[\s\S]*minmax\(96px, \.72fr\)/);
  assert.match(modalRefinement, /env\(safe-area-inset-bottom\)/);
});

test("connected Access account sheets have explicit close actions and shared sticky footers", () => {
  assert.match(accountSetup, /account-setup-sheet/);
  assert.match(accountSetup, /account-team-sheet/);
  assert.match(accountSetup, /data-layer-close/);
  assert.match(accountSetup, /field-sheet-actions/);
  assert.match(modalRefinement, /\.account-choice/);
});

test("modal refinement stylesheet loads last so it can safely override legacy modal rules", () => {
  assert.match(mainEntry, /\.\/modal-refinement-v2\.css/);
  const refinementIndex = mainEntry.indexOf("./modal-refinement-v2.css");
  const transitionIndex = mainEntry.indexOf("./components/staff-role-transition.css");
  assert.ok(refinementIndex > transitionIndex);
});
