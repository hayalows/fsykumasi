import test from "node:test";
import assert from "node:assert/strict";
import { buildBalancedAssignments, distributeSizes } from "../src/lib/grouping.js";
import { createDemoParticipants } from "../src/data/demo.js";

test("group sizes remain within 8–10 for a conference-sized pool", () => {
  const sizes = distributeSizes(362);
  assert.equal(sizes.reduce((sum, size) => sum + size, 0), 362);
  assert.ok(sizes.every((size) => size >= 8 && size <= 10));
});

test("every synthetic participant is assigned once", () => {
  const participants = createDemoParticipants(724);
  const result = buildBalancedAssignments(participants);
  const ids = result.groups.flatMap((group) => group.members.map((member) => member.id));
  assert.equal(ids.length, participants.length);
  assert.equal(new Set(ids).size, participants.length);
  assert.ok(result.groups.every((group) => group.members.length >= 8 && group.members.length <= 10));
});

test("sex-specific groups are paired into companies", () => {
  const result = buildBalancedAssignments(createDemoParticipants(80));
  assert.ok(result.companies.length > 0);
  for (const company of result.companies) {
    assert.ok(company.groups.length >= 1 && company.groups.length <= 2);
    assert.equal(new Set(company.groups.map((group) => group.sex)).size, company.groups.length);
  }
});
