import test from "node:test";
import assert from "node:assert/strict";
import {
  ageOnDate,
  isOperationalParticipant,
  operationalEligibility,
  validateManualParticipant,
  validateManualParticipantDetailed,
  validateManualStaff,
} from "../src/lib/registration.js";
import { summarizeCohort } from "../src/lib/cohort.js";

test("legacy manual additions still validate identity, age, and unit", () => {
  const missing = validateManualParticipant({ firstName: "", lastName: "", sex: "", age: "", unit: "" }, false);
  assert.equal(missing.length, 6);
  assert.deepEqual(validateManualParticipant({ firstName: "Ama", lastName: "Mensah", sex: "Female", age: "16", unit: "Asokwa Ward" }, true), []);
});

test("age is calculated against the FSY session date without timezone drift", () => {
  assert.equal(ageOnDate("2010-09-14", "2026-09-14"), 16);
  assert.equal(ageOnDate("2010-09-15", "2026-09-14"), 15);
  assert.equal(ageOnDate("2008-02-29", "2026-09-14"), 18);
  assert.equal(ageOnDate("not-a-date", "2026-09-14"), null);
  assert.equal(ageOnDate("2010-02-31", "2026-09-14"), null);
});

test("detailed youth capture requires DOB, unit and one reachable phone", () => {
  const base = {
    firstName: "Ama", lastName: "Mensah", sex: "Female", birthday: "2010-09-14",
    age: "16", unit: "Asokwa Ward", phone: "", guardianPhone: "0240000000",
  };
  assert.deepEqual(validateManualParticipantDetailed(base, true), []);
  assert.ok(validateManualParticipantDetailed({ ...base, guardianPhone: "" }, true).some((item) => item.includes("phone")));
  assert.ok(validateManualParticipantDetailed({ ...base, birthday: "" }, true).some((item) => item.includes("Date of birth")));
});

test("manual staff capture requires contact and a supported staff assignment type", () => {
  const base = {
    firstName: "Kojo", lastName: "Asare", sex: "Male", birthday: "2001-05-04",
    age: "25", unit: "Bantama Ward", phone: "0200000000", email: "",
    operationalRole: "counselor",
  };
  assert.deepEqual(validateManualStaff(base, true), []);
  assert.ok(validateManualStaff({ ...base, phone: "" }, true).some((item) => item.includes("phone number or email")));
  assert.ok(validateManualStaff({ ...base, operationalRole: "logistics_admin" }, true).some((item) => item.includes("staff assignment type")));
});

test("operational eligibility uses one configurable age boundary", () => {
  const ready = { age: 16, isCurrent: true, registrationStatus: "approved", verificationStatus: "verified" };
  assert.equal(isOperationalParticipant(ready), true);
  assert.equal(isOperationalParticipant({ ...ready, age: 28 }), false);
  assert.equal(isOperationalParticipant({ ...ready, age: 12 }), false);
  assert.equal(isOperationalParticipant({ ...ready, age: 20 }), true);
  assert.equal(isOperationalParticipant({ ...ready, age: 21 }), false);
  assert.equal(isOperationalParticipant({ ...ready, age: 21 }, { participantMinAge: 13, participantMaxAge: 21 }), true);
  assert.match(operationalEligibility({ ...ready, age: 28 }).reason, /Age review/);
  assert.equal(isOperationalParticipant({ ...ready, registrationStatus: "awaiting" }), false);
  assert.equal(isOperationalParticipant({ ...ready, verificationStatus: "pending" }), false);
  assert.equal(isOperationalParticipant({ ...ready, isCurrent: false }), false);
});

test("cohort summary separates data exceptions from placement work", () => {
  const people = [
    { id: "ready", age: 16, unit: "Asokwa Ward", groupId: null },
    { id: "missing-unit", age: 16, unit: "", groupId: null },
    { id: "awaiting", age: 16, unit: "Bantama Ward", registrationStatus: "awaiting", groupId: null },
  ];
  const summary = summarizeCohort(people);
  assert.equal(summary.eligible, 2);
  assert.equal(summary.unassigned, 1);
  assert.equal(summary.reviewExceptions, 2);
  assert.equal(summary.review, 3);
});
