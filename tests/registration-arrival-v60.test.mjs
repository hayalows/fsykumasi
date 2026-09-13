import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Registration keeps one compact arrival hierarchy", async () => {
  const source = await read("src/pages/Registration.jsx");
  assert.match(source, /registration-arrival-v60\.css/);
  assert.match(source, /registration-arrival-v60 registration-mode-/);
  assert.match(source, /description=\{modeMeta\.help\}/);
  assert.match(source, /Find → confirm → check in\./);
  assert.match(source, /Search includes checked-in participants too/);
  assert.doesNotMatch(source, /registration-mode-cue-v5/);
});

test("Staff search ignores arrival filters while an operator is searching", async () => {
  const source = await read("src/pages/StaffCheckin.jsx");
  assert.match(source, /const searching = Boolean\(query\.trim\(\)\)/);
  assert.match(source, /\.filter\(\(person\) => text \|\| filter === "all" \|\| person\.arrivalState === filter\)/);
  assert.match(source, /Searching all staff/);
  assert.match(source, /Expected, checked in, no-show and left records are included/);
  assert.match(source, /<SearchField[\s\S]*inputRef=\{searchRef\}/);
});

test("Staff arrival returns to search and offers immediate Undo", async () => {
  const source = await read("src/pages/StaffCheckin.jsx");
  assert.match(source, /setUndoTarget\(current\)/);
  assert.match(source, /setQuery\(""\)/);
  assert.match(source, /setFilter\("expected"\)/);
  assert.match(source, /focusSearch\(\)/);
  assert.match(source, /Undo check-in/);
  assert.match(source, /<ActionToast[\s\S]*actionLabel="Undo"[\s\S]*onAction=\{undoTarget \? undoLastCheckin : undefined\}/);
});

test("Arrival refinements preserve touch and mobile search requirements", async () => {
  const css = await read("src/pages/registration-arrival-v60.css");
  assert.match(css, /staff-checkin-search \.search-field input \{[\s\S]*min-height: 48px;[\s\S]*font-size: 16px;/);
  assert.match(css, /staff-checkin-action \.primary,[\s\S]*staff-checkin-undo \{[\s\S]*min-height: 44px;/);
  assert.match(css, /max-height: 800px/);
  assert.match(css, /max-width: 430px/);
});

test("PWA shell refreshes for registration arrival v60", async () => {
  const sw = await read("public/sw.js");
  assert.match(sw, /fsy-kumasi-shell-v60/);
  assert.match(sw, /Registration arrival v60/);
});
