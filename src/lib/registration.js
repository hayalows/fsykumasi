export function isOperationalParticipant(person) {
  return person.isCurrent !== false
    && (person.registrationStatus || "approved") === "approved"
    && (person.verificationStatus || "verified") === "verified";
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
