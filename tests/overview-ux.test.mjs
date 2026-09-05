import test from "node:test";
import assert from "node:assert/strict";
import { buildOperationalInbox } from "../src/lib/overview-inbox.js";

test("assistant coordinator stays company-scoped and sees coverage work first", () => {
  const inbox = buildOperationalInbox({
    role: "assistant_coordinator",
    capabilities: ["groups_view", "headcount_view"],
    summary: {
      scope: { companyCount: 4, companyNames: ["Company 1", "Company 2", "Company 3", "Company 4"], counselorCount: 8, participantCount: 78, uncoveredGroups: 1 },
      headcount: {},
    },
  });
  assert.equal(inbox.whole, false);
  assert.equal(inbox.scopeLabel, "4 assigned companies");
  assert.equal(inbox.primary.id, "assignments");
  assert.equal(inbox.metrics.find((item) => item.label === "Youth")?.value, 78);
});

test("registration committee sees the live arrival desk directly", () => {
  const inbox = buildOperationalInbox({
    role: "committee_viewer",
    capabilities: ["registration_view", "registration_manage", "checkin_record"],
    summary: {
      session: { recentArrivals: 12 },
      registration: { ready: 18, attention: 3, arrived: 41, onSitePendingId: 0 },
    },
  });
  assert.equal(inbox.primary.id, "registration");
  assert.match(inbox.primary.title, /3 registration records/);
  assert.equal(inbox.metrics.find((item) => item.label === "Ready")?.value, 18);
  assert.equal(inbox.metrics.find((item) => item.label === "Last 15 min")?.value, 12);
});

test("on-site identity is treated as a blocking registration action", () => {
  const inbox = buildOperationalInbox({
    role: "committee_viewer",
    capabilities: ["registration_manage", "checkin_record"],
    summary: { registration: { ready: 5, attention: 2, onSitePendingId: 2 } },
  });
  assert.equal(inbox.primary.id, "registration");
  assert.match(inbox.primary.title, /FSY ID/);
  assert.equal(inbox.primary.priority, 100);
});

test("modern missing head count outranks routine food work", () => {
  const inbox = buildOperationalInbox({
    role: "coordinator",
    capabilities: ["headcount_view", "food_view"],
    summary: {
      wholeSession: true,
      scope: { companyCount: 40 },
      headcount: { roundId: "modern-round", label: "Evening check", closesAt: null, missing: 2, unresolved: 8, total: 1600 },
      food: { dietaryOpen: 4 },
    },
  });
  assert.equal(inbox.primary.id, "headcount");
  assert.match(inbox.primary.title, /2 people marked missing/);
});

test("legacy head-count data cannot become an Overview action", () => {
  const inbox = buildOperationalInbox({
    role: "coordinator",
    capabilities: ["headcount_view"],
    summary: {
      wholeSession: true,
      scope: { companyCount: 40 },
      headcount: {},
      legacyHeadcount: { label: "Lunch head count", closesAt: null, unresolved: 1000 },
    },
  });
  assert.notEqual(inbox.primary.id, "headcount");
});

test("food committee receives only food work without session leadership", () => {
  const inbox = buildOperationalInbox({
    role: "committee_viewer",
    capabilities: ["food_view"],
    summary: { food: { dietaryOpen: 5, serviceStatus: "closed", remaining: 0 } },
  });
  assert.equal(inbox.whole, false);
  assert.equal(inbox.primary.id, "food");
  assert.match(inbox.primary.title, /5 dietary needs/);
});
