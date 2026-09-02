import test from "node:test";
import assert from "node:assert/strict";
import { isOperationalParticipant, validateManualParticipant } from "../src/lib/registration.js";

test("manual additions require search, identity, assignment sex, age, and unit", () => {
  const missing = validateManualParticipant({ firstName: "", lastName: "", sex: "", age: "", unit: "" }, false);
  assert.equal(missing.length, 6);
  assert.deepEqual(validateManualParticipant({ firstName: "Ama", lastName: "Mensah", sex: "Female", age: "16", unit: "Asokwa Ward" }, true), []);
});

test("only current approved verified youth are operational", () => {
  assert.equal(isOperationalParticipant({ isCurrent: true, registrationStatus: "approved", verificationStatus: "verified" }), true);
  assert.equal(isOperationalParticipant({ isCurrent: true, registrationStatus: "awaiting", verificationStatus: "verified" }), false);
  assert.equal(isOperationalParticipant({ isCurrent: true, registrationStatus: "approved", verificationStatus: "pending" }), false);
  assert.equal(isOperationalParticipant({ isCurrent: false, registrationStatus: "approved", verificationStatus: "verified" }), false);
});
