import Papa from "papaparse";

const aliases = {
  firstName: ["firstname", "givenname", "first"],
  lastName: ["lastname", "surname", "familyname", "last"],
  preferredName: ["preferredname", "knownas"],
  birthday: ["birthday", "birthdate", "dateofbirth", "dob"],
  sex: ["gender", "sex", "assignmentsex"],
  phone: ["phone"],
  email: ["email"],
  medical: ["medicalinformation", "medicalinfo"],
  tshirt: ["tshirtsize", "shirtsize"],
  dietary: ["dietaryinformation", "dietaryinfo"],
  contact1Name: ["contact1name"],
  contact1Email: ["contact1email"],
  contact1Phone: ["contact1phone"],
  contact2Name: ["contact2name"],
  contact2Email: ["contact2email"],
  contact2Phone: ["contact2phone"],
  sourceAge: ["age", "participantage"],
  registeredAt: ["date", "registrationdate", "registeredat"],
  status: ["status", "registrationstatus"],
  type: ["type", "persontype", "registrationtype"],
  stake: ["stakedistrictname", "stake", "district"],
  unit: ["wardbranchname", "unit", "ward", "branch", "wardbranch", "homeunit", "congregation"],
  bishopEmail: ["bishopsemail", "bishopemail"],
  bishopName: ["bishopsname", "bishopname"],
};

function normalizeHeader(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function normalizeIdentityPart(value) { return String(value || "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " "); }
function normalizeEmail(value) { return normalizeIdentityPart(value); }
function normalizePhone(value) { return String(value || "").replace(/\D/g, ""); }
function pad(value) { return String(value).padStart(2, "0"); }

function headerMap(headers) {
  const normalized = headers.map(normalizeHeader);
  return Object.fromEntries(Object.entries(aliases).map(([field, accepted]) => [field, normalized.findIndex((header) => accepted.includes(header))]));
}
function valueAt(row, map, field) { return map[field] >= 0 ? String(row[map[field]] ?? "").trim() : ""; }

export function normalizeFinalSex(value) {
  const normalized = normalizeIdentityPart(value);
  if (["f", "female", "young women", "yf"].includes(normalized)) return "Female";
  if (["m", "male", "young men", "ym"].includes(normalized)) return "Male";
  return "";
}

export function normalizeFinalStatus(value) {
  const normalized = normalizeIdentityPart(value);
  if (normalized.startsWith("approv")) return "approved";
  if (normalized.startsWith("await") || normalized.startsWith("pend")) return "awaiting";
  if (normalized.startsWith("cancel")) return "cancelled";
  return "";
}

export function normalizeFinalType(value) {
  const normalized = normalizeIdentityPart(value);
  if (["participant", "youth"].includes(normalized)) return "participant";
  if (["counselor", "counsellor", "ysa", "staff"].includes(normalized)) return "counselor";
  return "";
}

export function normalizeFinalDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day)
    ? `${year}-${month}-${day}` : "";
}

export function normalizeRegistrationTimestamp(value) {
  const text = String(value || "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z)?$/);
  const local = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  const parts = iso
    ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]), hour: Number(iso[4]), minute: Number(iso[5]), second: Number(iso[6]) }
    : local
      ? { year: Number(local[3]), month: Number(local[2]), day: Number(local[1]), hour: Number(local[4]), minute: Number(local[5]), second: Number(local[6]) }
      : null;
  if (!parts) return "";
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  if (date.getUTCFullYear() !== parts.year || date.getUTCMonth() !== parts.month - 1 || date.getUTCDate() !== parts.day
      || date.getUTCHours() !== parts.hour || date.getUTCMinutes() !== parts.minute || date.getUTCSeconds() !== parts.second) return "";
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

export function ageOnSessionDate(birthday, referenceDate) {
  const birth = normalizeFinalDate(birthday);
  const reference = normalizeFinalDate(referenceDate);
  if (!birth || !reference) return null;
  const [by, bm, bd] = birth.split("-").map(Number);
  const [ry, rm, rd] = reference.split("-").map(Number);
  let age = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
}

export function finalIdentityMaterial(record) {
  return [record.personType, record.firstName, record.lastName, record.birthday, record.sex]
    .map(normalizeIdentityPart).join("|");
}

export async function finalRosterSha256(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function birthdayDuringSession(birthday, startsOn, endsOn) {
  const parsed = normalizeFinalDate(birthday);
  if (!parsed || !startsOn || !endsOn) return null;
  const year = Number(startsOn.slice(0, 4));
  const date = `${year}-${parsed.slice(5)}`;
  return date >= startsOn && date <= endsOn ? date : null;
}

function buildRecord(row, map, index, sessionStart) {
  const firstName = valueAt(row, map, "firstName");
  const lastName = valueAt(row, map, "lastName");
  const birthday = normalizeFinalDate(valueAt(row, map, "birthday"));
  const registeredAtRaw = valueAt(row, map, "registeredAt");
  const registeredAt = normalizeRegistrationTimestamp(registeredAtRaw);
  const sourceAgeValue = Number(valueAt(row, map, "sourceAge"));
  const sourceAge = Number.isFinite(sourceAgeValue) && sourceAgeValue > 0 ? sourceAgeValue : null;
  return {
    row: index + 2,
    firstName,
    lastName,
    preferredName: valueAt(row, map, "preferredName"),
    fullName: `${firstName} ${lastName}`.replace(/\s+/g, " ").trim() || valueAt(row, map, "preferredName") || `Unnamed row ${index + 2}`,
    birthday,
    sex: normalizeFinalSex(valueAt(row, map, "sex")),
    sourceAge,
    age: ageOnSessionDate(birthday, sessionStart),
    stake: valueAt(row, map, "stake"),
    unit: valueAt(row, map, "unit"),
    registrationStatus: normalizeFinalStatus(valueAt(row, map, "status")),
    personType: normalizeFinalType(valueAt(row, map, "type")),
    registeredAt,
    registeredAtRaw,
    email: valueAt(row, map, "email"),
    phone: valueAt(row, map, "phone"),
    medicalInformation: valueAt(row, map, "medical"),
    dietaryInformation: valueAt(row, map, "dietary"),
    tshirtSize: valueAt(row, map, "tshirt"),
    contact1Name: valueAt(row, map, "contact1Name"),
    contact1Email: valueAt(row, map, "contact1Email"),
    contact1Phone: valueAt(row, map, "contact1Phone"),
    contact2Name: valueAt(row, map, "contact2Name"),
    contact2Email: valueAt(row, map, "contact2Email"),
    contact2Phone: valueAt(row, map, "contact2Phone"),
    bishopName: valueAt(row, map, "bishopName"),
    bishopEmail: valueAt(row, map, "bishopEmail"),
    sourceKey: "",
  };
}

function mergeSuggestion(rows) {
  const units = new Set(rows.map((row) => normalizeIdentityPart(row.unit)).filter(Boolean));
  const emails = rows.map((row) => normalizeEmail(row.email)).filter(Boolean);
  const phones = rows.map((row) => normalizePhone(row.phone)).filter((value) => value.length >= 7);
  const sharedEmail = emails.some((value, index) => emails.indexOf(value) !== index);
  const sharedPhone = phones.some((value, index) => phones.indexOf(value) !== index);
  const hasCancelled = rows.some((row) => row.registrationStatus === "cancelled");
  if (units.size <= 1 && (sharedEmail || sharedPhone || hasCancelled)) {
    return {
      resolution: "merge",
      reason: hasCancelled ? "Likely re-registration: the same person has a cancelled and later registration." : "Likely duplicate: the registration shares the same person details, unit and contact information.",
    };
  }
  return { resolution: "", reason: "The name, birthday, sex and registration type match, but the records are not similar enough to merge automatically." };
}

function validateRecords(records) {
  const errors = [];
  const warnings = [];
  records.forEach((record) => {
    const error = (field, message) => errors.push({ row: record.row, field, message, severity: "blocking" });
    const warn = (field, message) => warnings.push({ row: record.row, field, message, severity: "warning" });
    if (!record.firstName && !record.preferredName) warn("First name", "First or preferred name is missing");
    if (!record.lastName) warn("Last name", "Last name is missing");
    if (!record.firstName && !record.lastName && !record.preferredName) error("Name", "A usable name is required");
    if (!record.birthday) error("Birthday", "Birthday must use YYYY-MM-DD");
    if (!record.sex) error("Gender", "Gender is required for counselor-group planning");
    if (!record.personType) error("Type", "Type must be Participant or Counselor");
    if (!record.registrationStatus) error("Status", "Status must be Approved, Awaiting Approval, or Cancelled");
    if (!record.registeredAt) error("Date", `Registration timestamp “${record.registeredAtRaw || "blank"}” could not be read`);
    if (record.age === null) error("Birthday", "Age could not be calculated for the FSY start date");
    if (!record.unit) warn("Ward / branch", "Ward or branch is missing");
  });
  return { errors, warnings };
}

function buildIdentityConflicts(records) {
  const groups = new Map();
  records.forEach((record) => {
    const key = finalIdentityMaterial(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });
  return [...groups.entries()].filter(([, rows]) => rows.length > 1).map(([id, rows]) => ({ id, rows, ...mergeSuggestion(rows) }));
}

export async function rowsToFinalRoster(rows, { sessionStart = "2026-09-14", sessionEnd = "2026-09-19" } = {}) {
  const [headers = [], ...body] = rows;
  const map = headerMap(headers);
  const records = body.filter((row) => row.some((cell) => String(cell ?? "").trim())).map((row, index) => buildRecord(row, map, index, sessionStart));
  const { errors, warnings } = validateRecords(records);
  const identityConflicts = buildIdentityConflicts(records);
  const ageAdjusted = records.filter((record) => record.sourceAge !== null && record.age !== null && record.sourceAge !== record.age).length;
  return {
    records,
    errors,
    warnings,
    identityConflicts,
    headers,
    sessionStart,
    sessionEnd,
    summary: {
      total: records.length,
      participants: records.filter((record) => record.personType === "participant").length,
      staff: records.filter((record) => record.personType === "counselor").length,
      approved: records.filter((record) => record.registrationStatus === "approved").length,
      awaiting: records.filter((record) => record.registrationStatus === "awaiting").length,
      cancelled: records.filter((record) => record.registrationStatus === "cancelled").length,
      birthdays: records.filter((record) => record.personType === "participant" && birthdayDuringSession(record.birthday, sessionStart, sessionEnd)).length,
      missingUnit: records.filter((record) => !record.unit).length,
      ageAdjusted,
    },
  };
}

export async function resolveFinalRosterRecords(result, resolutions = {}) {
  if (!result?.records?.length) return { records: [], mergedRows: 0, keptCollisionRows: 0 };
  const conflictById = new Map((result.identityConflicts || []).map((group) => [group.id, group]));
  const conflictRows = new Set((result.identityConflicts || []).flatMap((group) => group.rows.map((row) => row.row)));
  const unresolved = (result.identityConflicts || []).filter((group) => !resolutions[group.id]);
  if (unresolved.length) throw new Error(`${unresolved.length} possible duplicate ${unresolved.length === 1 ? "person needs" : "people need"} a decision before the final roster can be previewed.`);

  const resolved = [];
  let mergedRows = 0;
  let keptCollisionRows = 0;

  for (const record of result.records.filter((row) => !conflictRows.has(row.row))) {
    resolved.push({ ...record, sourceKey: await finalRosterSha256(finalIdentityMaterial(record)) });
  }

  for (const [id, group] of conflictById) {
    const resolution = resolutions[id];
    if (resolution === "merge") {
      const chosen = [...group.rows].sort((left, right) => String(right.registeredAt).localeCompare(String(left.registeredAt)) || right.row - left.row)[0];
      resolved.push({ ...chosen, sourceKey: await finalRosterSha256(id) });
      mergedRows += group.rows.length - 1;
      continue;
    }
    if (resolution !== "keep") throw new Error("Choose whether each possible duplicate is one person or different people.");
    keptCollisionRows += group.rows.length;
    for (const record of group.rows) {
      const distinctMaterial = [id, "distinct", record.registeredAt, record.unit, record.email, record.phone, record.row].map(normalizeIdentityPart).join("|");
      resolved.push({ ...record, sourceKey: await finalRosterSha256(distinctMaterial) });
    }
  }

  resolved.sort((left, right) => left.row - right.row);
  const keys = new Set(resolved.map((record) => record.sourceKey));
  if (keys.size !== resolved.length) throw new Error("The final roster still contains duplicate source identities after review.");
  return { records: resolved, mergedRows, keptCollisionRows };
}

export async function parseFinalRosterFile(file, options = {}) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!["csv", "xlsx", "xls"].includes(extension)) throw new Error("Choose a CSV or Excel file.");
  if (file.size > 10 * 1024 * 1024) throw new Error("File is larger than the 10 MB import limit.");
  const buffer = await file.arrayBuffer();
  let rows;
  if (extension === "xlsx" || extension === "xls") {
    const { default: readXlsxFile } = await import("read-excel-file/browser");
    rows = await readXlsxFile(file);
  } else {
    const parsed = Papa.parse(new TextDecoder("windows-1252").decode(buffer), { skipEmptyLines: "greedy" });
    if (parsed.errors.length) throw new Error(parsed.errors[0].message);
    rows = parsed.data;
  }
  const result = await rowsToFinalRoster(rows, options);
  result.sourceSha256 = await finalRosterSha256(new Uint8Array(buffer));
  return result;
}
