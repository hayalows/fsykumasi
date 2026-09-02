import test from "node:test";
import assert from "node:assert/strict";
import { buildBalancedAssignments, distributeSizes } from "../src/lib/grouping.js";
import { createDemoParticipants } from "../src/data/demo.js";

test("group sizes remain within 8–10 for a conference-sized pool", () => {
  const sizes = distributeSizes(820);
  assert.equal(sizes.reduce((sum, size) => sum + size, 0), 820);
  assert.ok(sizes.every((size) => size >= 8 && size <= 10));
});

test("every participant in a 1,640-youth rehearsal is assigned exactly once", () => {
  const participants = createDemoParticipants(1640);
  const result = buildBalancedAssignments(participants);
  const ids = result.groups.flatMap((group) => group.members.map((member) => member.id));
  assert.equal(ids.length, participants.length);
  assert.equal(new Set(ids).size, participants.length);
  assert.ok(result.groups.every((group) => group.members.length >= 8 && group.members.length <= 10));
  assert.equal(result.companies.length, 82);
});

test("synthetic full-scale assignment keeps duplicate units out of counselor groups", () => {
  const result = buildBalancedAssignments(createDemoParticipants(1640));
  for (const group of result.groups) {
    const units = group.members.map((member) => member.unit);
    assert.equal(new Set(units).size, units.length);
  }
  assert.equal(result.issues.length, 0);
});

test("default grouping spreads ages across each same-sex counselor pool", () => {
  const result = buildBalancedAssignments(createDemoParticipants(1640));
  assert.equal(result.settings.useAgeBands, false);
  assert.equal(result.settings.mixAges, true);
  for (const group of result.groups) {
    const ages = group.members.map((member) => Number(member.age)).filter(Number.isFinite);
    const distinctAges = new Set(ages);
    assert.ok(distinctAges.size >= 4, `${group.name} should contain a broad age mix`);
    assert.ok(Math.max(...ages) - Math.min(...ages) >= 3, `${group.name} should span multiple ages`);
  }
  assert.ok(result.companies.every((company) => company.ageBand === "All ages"));
});

test("sex-specific groups are paired into companies by default", () => {
  const result = buildBalancedAssignments(createDemoParticipants(80));
  assert.ok(result.companies.length > 0);
  for (const company of result.companies) {
    assert.ok(company.groups.length >= 1 && company.groups.length <= 2);
    assert.equal(new Set(company.groups.map((group) => group.sex)).size, company.groups.length);
  }
});

test("admins can deliberately preview four-group companies with age bands separated", () => {
  const participants = createDemoParticipants(1640);
  const result = buildBalancedAssignments(participants, {
    minSize: 8,
    maxSize: 10,
    groupsPerCompany: 4,
    useAgeBands: true,
    avoidSameUnit: true,
    balanceSexes: true,
  });
  const ids = result.groups.flatMap((group) => group.members.map((member) => member.id));
  assert.equal(ids.length, participants.length);
  assert.equal(new Set(ids).size, participants.length);
  assert.ok(result.companies.every((company) => company.groups.length >= 1 && company.groups.length <= 4));
  for (const company of result.companies) {
    assert.equal(new Set(company.groups.map((group) => group.ageBand)).size, 1);
    if (company.groups.length === 4 && new Set(company.groups.map((group) => group.sex)).size === 2) {
      assert.equal(company.groups.filter((group) => group.sex === "Female").length, 2);
      assert.equal(company.groups.filter((group) => group.sex === "Male").length, 2);
    }
  }
});
