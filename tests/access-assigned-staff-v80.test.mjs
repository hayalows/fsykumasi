import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const accessWrapper = read("src/pages/Access.jsx");
const accessPage = read("src/pages/AccessV19.jsx");

test("assigned staff who postpone website setup remain visible when Access opens", () => {
  assert.match(accessWrapper, /const initialFilter = props\.initialFilter \|\| "all"/);
  assert.match(accessWrapper, /initialFilter=\{initialFilter\}/);
  assert.match(accessPage, /person\.staffId && person\.accessState === "not_enabled"/);
  assert.match(accessPage, />Invite<\/button>/);
  assert.match(accessPage, /Search name, email, assignment, company or committee/);
});

test("explicit Access filters still override the safer default", () => {
  assert.match(accessWrapper, /props\.initialFilter \|\| "all"/);
});
