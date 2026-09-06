const normalize = (value) => String(value || "").trim().toLowerCase();

function fieldsFor(row, housing) {
  return [
    row.fullName,
    row.preferredName,
    row.fsyId,
    ...(row.previousFsyIds || []),
    row.unit,
    row.stake,
    row.companyName,
    row.groupName,
    housing?.roomName,
  ].filter(Boolean).map((value) => normalize(value));
}

export function registrationSearchRank(row, query, housing) {
  const text = normalize(query);
  if (!text) return 0;

  const fullName = normalize(row.fullName);
  const preferredName = normalize(row.preferredName);
  const fsyId = normalize(row.fsyId);
  const previousIds = (row.previousFsyIds || []).map(normalize);
  const fields = fieldsFor(row, housing);

  if (fsyId === text || previousIds.includes(text)) return 0;
  if (fullName === text || preferredName === text) return 1;
  if (fsyId.startsWith(text) || fullName.startsWith(text) || preferredName.startsWith(text)) return 2;
  if (fields.some((value) => value.startsWith(text))) return 3;
  if (fields.some((value) => value.includes(text))) return 4;
  return Number.POSITIVE_INFINITY;
}

export function matchesRegistrationSearchV6(row, query, housing) {
  return Number.isFinite(registrationSearchRank(row, query, housing));
}
