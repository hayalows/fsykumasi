import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_TIME_ZONE, sessionDayContext, sessionPhase } from "../src/lib/overview-phase.js";

const session = { startsOn: "2026-09-14", endsOn: "2026-09-19", timeZone: SESSION_TIME_ZONE };
const context = (iso) => sessionDayContext({ ...session, now: new Date(iso) });

test("KCC session context moves from Day 0 through checkout in Ghana time", () => {
  assert.equal(context("2026-09-13T13:00:00Z").label, "Day 0");
  assert.equal(context("2026-09-13T13:00:00Z").detail, "Session starts tomorrow");
  assert.equal(sessionPhase({ ...session, now: new Date("2026-09-13T13:00:00Z") }), "pre_session");

  assert.equal(context("2026-09-14T08:00:00Z").label, "Day 1");
  assert.equal(context("2026-09-14T08:00:00Z").detail, "Arrival & check-in");
  assert.equal(context("2026-09-15T08:00:00Z").label, "Day 2");
  assert.equal(context("2026-09-15T08:00:00Z").detail, "Session live");
  assert.equal(context("2026-09-18T08:00:00Z").detail, "Final program day");
  assert.equal(context("2026-09-19T08:00:00Z").label, "Day 6");
  assert.equal(context("2026-09-19T08:00:00Z").detail, "Checkout & wrap-up");
  assert.equal(context("2026-09-20T08:00:00Z").label, "Session complete");
});

test("pre-session countdown is concise before Day 0", () => {
  assert.equal(context("2026-09-11T10:00:00Z").compact, "Starts in 3 days");
  assert.equal(context("2026-09-12T10:00:00Z").compact, "Starts in 2 days");
});
