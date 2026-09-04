import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Birthdays keeps identity clear while progressively disclosing completed work", async () => {
  const [page, css] = await Promise.all([
    read("src/pages/Birthdays.jsx"),
    read("src/pages/birthdays.css"),
  ]);

  assert.match(page, /Youth ages are shown; adult ages stay private/i);
  assert.match(page, /staffRoleLabel\(person\.staffRole\)/);
  assert.match(page, /birthday-context-chips/);
  assert.match(page, /Needs acknowledgement/);
  assert.match(page, /<SegmentedControl/);
  assert.match(page, /<SearchField/);
  assert.match(page, /<details/);
  assert.match(page, /All acknowledged/);
  assert.match(page, /Mark acknowledged/);
  assert.match(css, /\.birthday-day-card\[open\]/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});
