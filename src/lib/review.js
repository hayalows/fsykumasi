import { operationalAgeRange, operationalEligibility } from "./registration.js";

export const REVIEW_QUEUE_ORDER = [
  "awaiting",
  "age_review",
  "verification",
  "unassigned",
  "missing_unit",
  "omitted",
  "cancelled",
];

export const REVIEW_QUEUE_META = {
  awaiting: {
    label: "Awaiting approval",
    short: "Awaiting official registration approval",
    help: "Kept in the registration list, but excluded from groups, check-in and head count until a newer official export marks the person Approved.",
  },
  age_review: {
    label: "Age review",
    short: "Outside the configured youth age range",
    help: "The source record is preserved, but the person stays out of youth operations until the source data or session age rule is intentionally corrected.",
  },
  verification: {
    label: "Needs verification",
    short: "On-site record needs an administrator decision",
    help: "Verify the day-of addition before assigning a counselor group or checking the participant in.",
  },
  unassigned: {
    label: "Ready but unassigned",
    short: "Approved and eligible, but no counselor group yet",
    help: "Assign a compatible counselor group before check-in. This queue excludes age-review and approval-review records.",
  },
  missing_unit: {
    label: "Missing ward / branch",
    short: "Church unit is missing",
    help: "Keep the source record, correct the official data when possible, then upload the newer complete export. Do not guess a unit.",
  },
  omitted: {
    label: "Missing from latest export",
    short: "Previously imported but omitted from the newest snapshot",
    help: "The record is protected when operational work already exists. Confirm the newest official export before taking further action.",
  },
  cancelled: {
    label: "Cancelled",
    short: "Registration is cancelled",
    help: "Visible for reference, but intentionally excluded from groups, check-in and head count.",
  },
};

export function reviewFlags(person, settings = {}) {
  const flags = [];
  const { min, max } = operationalAgeRange(settings);
  const age = Number(person.age);

  if (person.registrationStatus === "awaiting") flags.push("awaiting");
  if (person.registrationStatus === "cancelled") flags.push("cancelled");
  if (person.reconciliationStatus === "missing_from_latest") flags.push("omitted");
  if ((person.verificationStatus || "verified") !== "verified") flags.push("verification");
  if (!String(person.unit || "").trim()) flags.push("missing_unit");
  if (!Number.isFinite(age) || age < min || age > max) flags.push("age_review");
  if (operationalEligibility(person, settings).ok && !person.groupId) flags.push("unassigned");

  return flags;
}

export function buildRegistrationReview(participants = [], settings = {}) {
  const queues = Object.fromEntries(REVIEW_QUEUE_ORDER.map((key) => [key, []]));
  const unique = new Set();

  for (const person of participants) {
    const flags = reviewFlags(person, settings);
    for (const flag of flags) {
      queues[flag].push(person);
      unique.add(person.id);
    }
  }

  for (const key of REVIEW_QUEUE_ORDER) {
    queues[key].sort((left, right) => String(left.fullName || "").localeCompare(String(right.fullName || "")));
  }

  return {
    queues,
    totalUnique: unique.size,
    counts: Object.fromEntries(REVIEW_QUEUE_ORDER.map((key) => [key, queues[key].length])),
  };
}
