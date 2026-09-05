const normalize = (value) => String(value || "").trim().toLowerCase();
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

// Preserve distinct unit/stake pairs; a common unit name is not a unique identity.
export function buildUnitDirectory(rows) {
  const entries = new Map();
  for (const row of rows) {
    const unit = String(row.unit || "").trim();
    const stake = String(row.stake || "").trim();
    if (unit) entries.set(JSON.stringify([normalize(unit), normalize(stake)]), { unit, stake });
  }
  return [...entries.values()].sort((a, b) => collator.compare(a.unit, b.unit) || collator.compare(a.stake, b.stake));
}

export function uniqueUnitMatch(options, value) {
  const matches = options.filter((option) => normalize(option.unit) === normalize(value));
  return matches.length === 1 ? matches[0] : null;
}

export function matchesRegistrationSearch(row, query, housing) {
  const text = normalize(query);
  return !text || [row.fullName, row.preferredName, row.fsyId, row.unit, row.stake,
    row.companyName, row.groupName, housing?.roomName].filter(Boolean).join(" ").toLowerCase().includes(text);
}
