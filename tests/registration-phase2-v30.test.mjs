import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isRegistrationReady,
  registrationBlocker,
  registrationBlockerCount,
  registrationNextAction,
} from "../src/lib/registration-workflow-v30.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const base = {
  isCurrent: true,
  sourceKind: "official",
  verificationStatus: "verified",
  attendanceStatus: "expected",
  checkinStatus: "not_checked_in",
  groupId: "group-1",
  groupName: "Group 1",
  fsyId: "KUM-001",
};

test("Phase 2 gives each normal Registration blocker one next useful action", () => {
  const awaiting = registrationBlocker(base, { eligible: false, reason: "Registration is not approved" });
  assert.equal(awaiting.label, "Registration is not approved");
  assert.equal(awaiting.nextAction, "Record the final session decision");
  assert.equal(awaiting.authority, "Session Directing Couple or Logistical Administrator");

  const onsite = registrationBlocker({ ...base, sourceKind: "on_site", verificationStatus: "pending" }, { eligible: true, reason: "Eligible" });
  assert.equal(onsite.label, "Needs verification");
  assert.equal(onsite.nextAction, "Confirm the on-site registration checks");

  const unassigned = registrationBlocker({ ...base, groupId: "", groupName: "" }, { eligible: true, reason: "Eligible" });
  assert.equal(unassigned.label, "Needs counselor group");
  assert.equal(registrationNextAction({ ...base, groupId: "", groupName: "" }, { eligible: true, reason: "Eligible" }), "Assign a compatible counselor group");
});

test("Phase 2 blocker model preserves current check-in readiness policy", () => {
  assert.equal(isRegistrationReady(base, { eligible: true, reason: "Eligible" }), true);
  assert.equal(isRegistrationReady({ ...base, attendanceStatus: "unknown" }, { eligible: true, reason: "Eligible" }), false);
  assert.equal(isRegistrationReady({ ...base, checkinStatus: "arrived" }, { eligible: true, reason: "Eligible" }), false);
  assert.equal(registrationBlocker({ ...base, checkinStatus: "arrived" }, { eligible: true, reason: "Eligible" }), null);
});

test("Registration top-level IA has one participant exception queue", async () => {
  const [registration, journey, readiness] = await Promise.all([
    read("src/pages/Registration.jsx"),
    read("src/pages/RegistrationJourneyV29.jsx"),
    read("src/pages/RegistrationReadinessV30.jsx"),
  ]);
  assert.match(registration, /value: "desk", label: "Live check-in"/);
  assert.match(registration, /value: "roster", label: "Final roster"/);
  assert.match(registration, /value: "readiness", label: "Readiness"/);
  assert.doesNotMatch(registration, /Preflight review/);
  assert.doesNotMatch(registration, /RegistrationReviewInbox/);
  assert.match(journey, /One final participant queue/);
  assert.match(readiness, /One final participant queue/);
  assert.doesNotMatch(readiness, /RegistrationReviewInbox/);
});

test("Final roster rows expose blocker and next action before opening the sheet", async () => {
  const journey = await read("src/pages/RegistrationJourneyV29.jsx");
  assert.match(journey, /registrationBlocker\(row,eligibility\)/);
  assert.match(journey, /regjourney-next-action-v30/);
  assert.match(journey, /blocker\.nextAction/);
  assert.match(journey, />Resolve<ArrowRight/);
  assert.match(journey, /All blockers/);
  assert.match(journey, /Leadership decision/);
  assert.match(journey, /Place participant/);
});

test("Readiness never turns a failed supporting check into a ready state", async () => {
  const readiness = await read("src/pages/RegistrationReadinessV30.jsx");
  assert.match(readiness, /const \[checkErrors, setCheckErrors\]/);
  assert.match(readiness, /checkErrors\.identity \? "Could not load"/);
  assert.match(readiness, /checkErrors\.staff \? "Could not load"/);
  assert.match(readiness, /checkErrors\.baseline \? "Could not load"/);
  assert.match(readiness, /No failed check is being shown as ready/);
  assert.match(readiness, /Retry the readiness checks/);
});

test("Readiness keeps heavy tools lazy and routes participant blockers back to Final roster", async () => {
  const readiness = await read("src/pages/RegistrationReadinessV30.jsx");
  assert.match(readiness, /visited\.has\("identity"\)/);
  assert.match(readiness, /visited\.has\("staff"\)/);
  assert.match(readiness, /visited\.has\("final"\)/);
  assert.match(readiness, /mode: "roster", filter: "needs_help"/);
  assert.match(readiness, /RegistrationFinalBaselineV21/);
  assert.match(readiness, /IdentityFoundationV28/);
  assert.match(readiness, /StaffReadiness/);
});

test("Final roster count is based on actionable blockers rather than the old review inbox", async () => {
  const rows = [
    { ...base, id: "1", serverEligibility: { eligible: true, reason: "Eligible" } },
    { ...base, id: "2", groupId: "", groupName: "", serverEligibility: { eligible: true, reason: "Eligible" } },
    { ...base, id: "3", attendanceStatus: "unknown", serverEligibility: { eligible: true, reason: "Eligible" } },
    { ...base, id: "4", checkinStatus: "arrived", serverEligibility: { eligible: true, reason: "Eligible" } },
  ];
  assert.equal(registrationBlockerCount(rows), 2);
  const registration = await read("src/pages/Registration.jsx");
  assert.match(registration, /registrationBlockerCount\(imported\)/);
});

test("Phase 2 compact layouts keep the three work areas and Final roster usable at phone widths", async () => {
  const css = await read("src/pages/registration-phase2-v30.css");
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /registration-mode-switch\{width:100%;display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:390px\)/);
  assert.match(css, /regjourney-v30 \.regjourney-solutions-queues-v30\{grid-template-columns:1fr\}/);
});
