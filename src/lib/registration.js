export const DEFAULT_OPERATIONAL_AGE_RANGE = { participantMinAge: 13, participantMaxAge: 20 };

export function operationalAgeRange(settings = {}) {
  const min = Number(settings.participantMinAge ?? DEFAULT_OPERATIONAL_AGE_RANGE.participantMinAge);
  const max = Number(settings.participantMaxAge ?? DEFAULT_OPERATIONAL_AGE_RANGE.participantMaxAge);
  return { min: Number.isFinite(min) ? min : DEFAULT_OPERATIONAL_AGE_RANGE.participantMinAge, max: Number.isFinite(max) ? max : DEFAULT_OPERATIONAL_AGE_RANGE.participantMaxAge };
}

export function operationalEligibility(person, settings = {}) {
  if (person.isCurrent === false) return { ok: false, reason: "Not current" };
  if ((person.registrationStatus || "approved") === "awaiting") return { ok: false, reason: "Awaiting approval" };
  if ((person.registrationStatus || "approved") === "cancelled") return { ok: false, reason: "Cancelled" };
  if ((person.verificationStatus || "verified") !== "verified") return { ok: false, reason: "Needs verification" };
  if (person.attendanceStatus === "confirmed_not_attending") return { ok: false, reason: "Confirmed not attending" };
  if (person.serverEligibility && typeof person.serverEligibility.eligible === "boolean") {
    return { ok: person.serverEligibility.eligible, reason: person.serverEligibility.reason || (person.serverEligibility.eligible ? "Eligible" : "Needs review") };
  }
  const { min, max } = operationalAgeRange(settings);
  const age = Number(person.age);
  if (!Number.isFinite(age) || age < min || age > max) return { ok: false, reason: `Age review · ${min}–${max} configured` };
  return { ok: true, reason: "Operationally eligible" };
}

export function isOperationalParticipant(person, settings = {}) { return operationalEligibility(person, settings).ok; }

function dateOnly(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function ageOnDate(dateOfBirth, referenceDate) {
  const birth = dateOnly(dateOfBirth); const reference = dateOnly(referenceDate);
  if (!birth || !reference) return null;
  let age = reference.year - birth.year;
  if (reference.month < birth.month || (reference.month === birth.month && reference.day < birth.day)) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
}

export function validateManualParticipant(person, searchConfirmed = false) {
  const errors = [];
  if (!searchConfirmed) errors.push("Search the existing registration list first.");
  if (!String(person.firstName || "").trim()) errors.push("First name is required.");
  if (!String(person.lastName || "").trim()) errors.push("Last name is required.");
  if (!["Female", "Male"].includes(person.sex)) errors.push("Select Female or Male for group assignment.");
  const age = Number(person.age);
  if (!Number.isInteger(age) || age < 1 || age > 120) errors.push("Enter a valid age.");
  if (!String(person.unit || "").trim()) errors.push("Ward or branch is required.");
  return errors;
}

export function validateManualParticipantDetailed(person, searchConfirmed = false) {
  const errors = [];
  if (!searchConfirmed) errors.push("Search the existing registration list first.");
  if (!String(person.firstName || "").trim()) errors.push("First name is required.");
  if (!String(person.lastName || "").trim()) errors.push("Last name is required.");
  if (!["Female", "Male"].includes(person.sex)) errors.push("Select Female or Male for group assignment.");
  if (!dateOnly(person.birthday)) errors.push("Date of birth is required.");
  const age = Number(person.age);
  if (!Number.isInteger(age) || age < 1 || age > 120) errors.push("Age could not be calculated from the date of birth.");
  if (!String(person.unit || "").trim()) errors.push("Ward or branch is required.");
  if (!String(person.phone || "").trim() && !String(person.guardianPhone || "").trim()) errors.push("Add the participant phone or a parent/guardian phone number.");
  return errors;
}

export function validateManualStaff(person, searchConfirmed = false) {
  const errors = [];
  if (!searchConfirmed) errors.push("Search the existing people list first.");
  if (!String(person.firstName || "").trim()) errors.push("First name is required.");
  if (!String(person.lastName || "").trim()) errors.push("Last name is required.");
  if (!["Female", "Male"].includes(person.sex)) errors.push("Select Female or Male.");
  if (!dateOnly(person.birthday)) errors.push("Date of birth is required.");
  const age = Number(person.age);
  if (!Number.isInteger(age) || age < 1 || age > 120) errors.push("Age could not be calculated from the date of birth.");
  if (!String(person.unit || "").trim()) errors.push("Ward or branch is required.");
  if (!String(person.phone || "").trim() && !String(person.email || "").trim()) errors.push("Add a phone number or email address.");
  if (!["counselor", "assistant_coordinator", "committee_member", "other"].includes(person.operationalRole)) errors.push("Choose the staff assignment type.");
  return errors;
}
