import test from "node:test";
import assert from "node:assert/strict";
import { birthdayDuringSession, rowsToParticipants, rowsToRegistration, sourceIdentityMaterial } from "../src/lib/import.js";

const headers = ["registration_id", "first_name", "last_name", "sex", "age", "unit"];

test("participant import blocks missing identifiers and name parts", () => {
  const result = rowsToParticipants([
    headers,
    ["", "Ama", "", "Female", "16", "Asokwa Ward"],
  ]);
  assert.deepEqual(
    result.errors.filter((error) => error.severity === "blocking").map((error) => error.field),
    ["Registration ID", "Last name"],
  );
});

test("participant import blocks ages outside the supported session range", () => {
  const result = rowsToParticipants([
    headers,
    ["REG-1", "Ama", "Mensah", "Female", "19", "Asokwa Ward"],
  ]);
  assert.equal(result.errors.find((error) => error.field === "Age")?.severity, "blocking");
});

test("participant import blocks duplicate registration identifiers", () => {
  const result = rowsToParticipants([
    headers,
    ["REG-1", "Ama", "Mensah", "Female", "16", "Asokwa Ward"],
    ["REG-1", "Kofi", "Owusu", "Male", "17", "Bantama Ward"],
  ]);
  assert.equal(result.errors.find((error) => error.message === "Duplicate registration ID")?.severity, "blocking");
});

test("real registration export separates youth and counselors and preserves status", async () => {
  const result = await rowsToRegistration([
    ["First Name", "Last Name", "Preferred Name", "Birthday", "Gender", "Age", "Date", "Status", "Type", "Stake - District Name", "Ward - Branch Name"],
    ["Ama", "Mensah", "Ama", "2010-09-14", "Female", "15", "2026-02-01 10:00:00", "Approved", "Participant", "Kumasi Stake", "Example Ward"],
    ["Kojo", "Owusu", "Kojo", "2003-04-08", "Male", "23", "2026-02-01 10:01:00", "Awaiting Approval", "Counselor", "Kumasi Stake", "Other Ward"],
  ]);
  assert.equal(result.errors.length, 0);
  assert.equal(result.participants.length, 1);
  assert.equal(result.staff.length, 1);
  assert.equal(result.summary.awaiting, 1);
  assert.match(result.records[0].sourceKey, /^[0-9a-f]{64}$/);
});

test("source identity does not rely on shared email or phone", () => {
  const base = { personType: "participant", firstName: "Ama", lastName: "Mensah", birthday: "2010-09-14", unit: "Example Ward", registeredAt: "2026-02-01 10:00:00" };
  assert.equal(sourceIdentityMaterial({ ...base, email: "family@example.org", phone: "123" }), sourceIdentityMaterial({ ...base, email: "other@example.org", phone: "456" }));
});

test("birthday window is inclusive and turning age ignores birth year for matching", () => {
  assert.deepEqual(birthdayDuringSession("2010-09-14"), { date: "2026-09-14", turningAge: 16 });
  assert.deepEqual(birthdayDuringSession("2008-09-19"), { date: "2026-09-19", turningAge: 18 });
  assert.equal(birthdayDuringSession("2010-09-20"), null);
});
