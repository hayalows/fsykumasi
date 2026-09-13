import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("staff check-in uses the shared resilient person search", async () => {
  const source = await read("src/pages/StaffCheckin.jsx");
  assert.match(source, /import \{ searchPeople \} from "\.\.\/lib\/person-search\.js"/);
  assert.match(source, /return searchPeople\(staff, query, searchContext\)/);
  assert.match(source, /const source = text \? searchMatches : staff/);
  assert.match(source, /Name order and small spelling mistakes are handled too/);
});

test("smart staff search still checks inactive records before offering on-site creation", async () => {
  const source = await read("src/pages/StaffCheckin.jsx");
  assert.match(source, /inactiveMatches = useMemo\(\(\) => searchMatches\.filter/);
  assert.match(source, /missingRosterMatch = searching && visible\.length === 0 && inactiveMatches\.length === 0/);
});
