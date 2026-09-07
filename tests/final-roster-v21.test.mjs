import test from "node:test";
import assert from "node:assert/strict";
import {
  ageOnSessionDate,
  normalizeRegistrationTimestamp,
  resolveFinalRosterRecords,
  rowsToFinalRoster,
} from "../src/lib/final-roster-import.js";
import { ageBand } from "../src/lib/grouping.js";

const headers = [
  "First Name","Last Name","Preferred Name","Birthday","Gender","Phone","Email",
  "Medical Information","T-shirt Size","Dietary Information","Contact 1 Name","Contact 1 Email",
  "Contact 1 Phone","Contact 2 Name","Contact 2 Email","Contact 2 Phone","Age","Date","Status",
  "Type","Stake - District Name","Ward - Branch Name","Bishop's Email","Bishop's Name",
];

function row({ first="Ama", last="Mensah", birthday="2011-09-13", gender="Female", phone="0550000000", email="ama@example.com", age="14", date="31/01/2026, 15:27:19", status="Approved", type="Participant", stake="Kumasi Stake", unit="Example Ward" } = {}) {
  return [first,last,"",birthday,gender,phone,email,"","M","","","","","","","",age,date,status,type,stake,unit,"",""];
}

test("normalizes the final export registration timestamp before Postgres sees it", () => {
  assert.equal(normalizeRegistrationTimestamp("31/01/2026, 15:27:19"), "2026-01-31T15:27:19");
  assert.equal(normalizeRegistrationTimestamp("2026-01-31T15:27:19"), "2026-01-31T15:27:19");
  assert.equal(normalizeRegistrationTimestamp("31/02/2026, 15:27:19"), "");
});

test("uses the FSY start date for operational age instead of the source Age column", async () => {
  assert.equal(ageOnSessionDate("2011-09-13", "2026-09-14"), 15);
  const parsed = await rowsToFinalRoster([headers, row({ age: "14" })], { sessionStart: "2026-09-14", sessionEnd: "2026-09-19" });
  assert.equal(parsed.records[0].sourceAge, 14);
  assert.equal(parsed.records[0].age, 15);
  assert.equal(parsed.summary.ageAdjusted, 1);
});

test("cancelled then approved registration is suggested as one person and keeps the latest source row", async () => {
  const parsed = await rowsToFinalRoster([
    headers,
    row({ date: "01/02/2026, 10:00:00", status: "Cancelled" }),
    row({ date: "15/03/2026, 12:00:00", status: "Approved" }),
  ], { sessionStart: "2026-09-14", sessionEnd: "2026-09-19" });
  assert.equal(parsed.identityConflicts.length, 1);
  assert.equal(parsed.identityConflicts[0].resolution, "merge");
  const resolved = await resolveFinalRosterRecords(parsed, { [parsed.identityConflicts[0].id]: "merge" });
  assert.equal(resolved.records.length, 1);
  assert.equal(resolved.records[0].registrationStatus, "approved");
  assert.equal(resolved.mergedRows, 1);
  assert.match(resolved.records[0].sourceKey, /^[0-9a-f]{64}$/);
});

test("same identity can be kept separate only after an explicit review decision", async () => {
  const parsed = await rowsToFinalRoster([
    headers,
    row({ unit: "Ward A", email: "one@example.com", phone: "0551111111", date: "01/02/2026, 10:00:00" }),
    row({ unit: "Ward B", email: "two@example.com", phone: "0552222222", date: "02/02/2026, 10:00:00" }),
  ], { sessionStart: "2026-09-14", sessionEnd: "2026-09-19" });
  assert.equal(parsed.identityConflicts.length, 1);
  assert.equal(parsed.identityConflicts[0].resolution, "");
  await assert.rejects(() => resolveFinalRosterRecords(parsed, {}), /decision/);
  const resolved = await resolveFinalRosterRecords(parsed, { [parsed.identityConflicts[0].id]: "keep" });
  assert.equal(resolved.records.length, 2);
  assert.equal(new Set(resolved.records.map((record) => record.sourceKey)).size, 2);
});

test("FSY age bands include 13-year-olds in the younger band", () => {
  assert.equal(ageBand(13), "13–15");
  assert.equal(ageBand(15), "13–15");
  assert.equal(ageBand(16), "16–18");
  assert.equal(ageBand(18), "16–18");
});
