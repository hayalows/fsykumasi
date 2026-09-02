import test from "node:test";
import assert from "node:assert/strict";
import { buildRegistrationReview, reviewFlags } from "../src/lib/review.js";

test("review inbox separates approval, age, verification and assignment exceptions", () => {
  const base = { isCurrent: true, registrationStatus: "approved", verificationStatus: "verified", unit: "Bantama Ward", age: 16, groupId: "group-1" };
  const participants = [
    { ...base, id: "awaiting", fullName: "Awaiting Youth", registrationStatus: "awaiting", groupId: null },
    { ...base, id: "adult", fullName: "Adult Record", age: 28, groupId: null },
    { ...base, id: "ready", fullName: "Ready Youth", groupId: null },
    { ...base, id: "pending", fullName: "Pending On-site", verificationStatus: "pending", groupId: null },
  ];
  const review = buildRegistrationReview(participants, { participantMinAge: 13, participantMaxAge: 20 });
  assert.equal(review.counts.awaiting, 1);
  assert.equal(review.counts.age_review, 1);
  assert.equal(review.counts.unassigned, 1);
  assert.equal(review.counts.verification, 1);
  assert.equal(review.totalUnique, 4);
  assert.deepEqual(reviewFlags(participants[1], { participantMinAge: 13, participantMaxAge: 20 }), ["age_review"]);
  assert.ok(!review.queues.unassigned.some((person) => person.id === "adult"));
});

test("overlapping review reasons count a person once in the headline", () => {
  const participant = { id: "one", fullName: "One Person", age: 25, registrationStatus: "awaiting", verificationStatus: "verified", isCurrent: true, unit: "Test Ward", groupId: null };
  const review = buildRegistrationReview([participant], { participantMinAge: 13, participantMaxAge: 20 });
  assert.equal(review.counts.awaiting, 1);
  assert.equal(review.counts.age_review, 1);
  assert.equal(review.totalUnique, 1);
});
