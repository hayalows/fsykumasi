import test from "node:test";
import assert from "node:assert/strict";
import {
  ageOnDate,
  isOperationalParticipant,
  validateManualParticipant,
  validateManualParticipantDetailed,
  validateManualStaff,
} from "../src/lib/registration.js";

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

test("only current approved verified youth are operational", () => {
  assert.equal(isOperationalParticipant({ isCurrent: true, registrationStatus: "approved", verificationStatus: "verified" }), true);
  assert.equal(isOperationalParticipant({ isCurrent: true, registrationStatus: "awaiting", verificationStatus: "verified" }), false);
  assert.equal(isOperationalParticipant({ isCurrent: true, registrationStatus: "approved", verificationStatus: "pending" }), false);
  assert.equal(isOperationalParticipant({ isCurrent: false, registrationStatus: "approved", verificationStatus: "verified" }), false);
});
