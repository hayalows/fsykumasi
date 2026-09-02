import Papa from "papaparse";

const aliases = {
  registrationId: ["registrationid", "registrationnumber", "participantid", "id"],
  firstName: ["firstname", "givenname", "first"], lastName: ["lastname", "surname", "familyname", "last"],
  preferredName: ["preferredname", "knownas"], fullName: ["fullname", "participantname", "name"],
  birthday: ["birthday", "birthdate", "dateofbirth", "dob"], sex: ["sex", "gender", "assignmentsex"],
  age: ["age", "participantage"], stake: ["stakedistrictname", "stake", "district"],
  unit: ["wardbranchname", "unit", "ward", "branch", "wardbranch", "homeunit", "congregation"],
  status: ["status", "registrationstatus"], type: ["type", "persontype", "registrationtype"],
  registeredAt: ["date", "registrationdate", "registeredat"], email: ["email"], phone: ["phone"],
  medical: ["medicalinformation", "medicalinfo"], dietary: ["dietaryinformation", "dietaryinfo"],
  tshirt: ["tshirtsize", "shirtsize"], contact1Name: ["contact1name"], contact1Email: ["contact1email"],
  contact1Phone: ["contact1phone"], contact2Name: ["contact2name"], contact2Email: ["contact2email"],
  contact2Phone: ["contact2phone"], bishopEmail: ["bishopsemail", "bishopemail"], bishopName: ["bishopsname", "bishopname"],
};

export function normalizeHeader(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function headerMap(headers) {
  const normalized = headers.map(normalizeHeader);
  return Object.fromEntries(Object.entries(aliases).map(([field, accepted]) => [field, normalized.findIndex((header) => accepted.includes(header))]));
}
function valueAt(row, map, field) { return map[field] >= 0 ? String(row[map[field]] ?? "").trim() : ""; }

export function normalizeSex(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["f", "female", "young women", "yf"].includes(normalized)) return "Female";
  if (["m", "male", "young men", "ym"].includes(normalized)) return "Male";
  return "";
}
export function normalizeRegistrationStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.startsWith("approv")) return "approved";
  if (normalized.startsWith("await") || normalized.startsWith("pend")) return "awaiting";
  if (normalized.startsWith("cancel")) return "cancelled";
  return "";
}
export function normalizePersonType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["participant", "youth"].includes(normalized)) return "participant";
  if (["counselor", "counsellor", "ysa", "staff"].includes(normalized)) return "counselor";
  return "";
}
export function parseIsoDate(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day) ? `${year}-${month}-${day}` : "";
}
function normalizeIdentityPart(value) { return String(value || "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " "); }
export function sourceIdentityMaterial(record) {
  return [record.personType, record.firstName, record.lastName, record.birthday, record.unit, record.registeredAt].map(normalizeIdentityPart).join("|");
}
export async function sha256(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function birthdayDuringSession(birthday, startsOn = "2026-09-14", endsOn = "2026-09-19") {
  const parsed = parseIsoDate(birthday);
  if (!parsed) return null;
  const year = Number(startsOn.slice(0, 4));
  const date = `${year}-${parsed.slice(5)}`;
  return date >= startsOn && date <= endsOn ? { date, turningAge: year - Number(parsed.slice(0, 4)) } : null;
}

function buildRecord(row, map, index) {
  const fullName = valueAt(row, map, "fullName");
  const split = fullName.split(/\s+/).filter(Boolean);
  const firstName = valueAt(row, map, "firstName") || split[0] || "";
  const lastName = valueAt(row, map, "lastName") || split.slice(1).join(" ");
  const ageValue = Number(valueAt(row, map, "age"));
  return {
    row: index + 2, id: valueAt(row, map, "registrationId") || `row-${index + 2}`,
    registrationId: valueAt(row, map, "registrationId"), firstName, lastName,
    preferredName: valueAt(row, map, "preferredName"), fullName: `${firstName} ${lastName}`.trim() || valueAt(row, map, "preferredName") || `Unnamed row ${index + 2}`,
    birthday: parseIsoDate(valueAt(row, map, "birthday")), sex: normalizeSex(valueAt(row, map, "sex")),
    age: Number.isFinite(ageValue) && ageValue > 0 ? ageValue : null, stake: valueAt(row, map, "stake"), unit: valueAt(row, map, "unit"),
    registrationStatus: normalizeRegistrationStatus(valueAt(row, map, "status")) || "approved",
    personType: normalizePersonType(valueAt(row, map, "type")) || "participant", registeredAt: valueAt(row, map, "registeredAt"),
    email: valueAt(row, map, "email"), phone: valueAt(row, map, "phone"), medicalInformation: valueAt(row, map, "medical"),
    dietaryInformation: valueAt(row, map, "dietary"), tshirtSize: valueAt(row, map, "tshirt"),
    contact1Name: valueAt(row, map, "contact1Name"), contact1Email: valueAt(row, map, "contact1Email"), contact1Phone: valueAt(row, map, "contact1Phone"),
    contact2Name: valueAt(row, map, "contact2Name"), contact2Email: valueAt(row, map, "contact2Email"), contact2Phone: valueAt(row, map, "contact2Phone"),
    bishopName: valueAt(row, map, "bishopName"), bishopEmail: valueAt(row, map, "bishopEmail"), sourceKey: "", status: "Expected",
  };
}

function validateRecords(records, map) {
  const errors = []; const warnings = []; const identityCounts = new Map();
  const hasRealExportColumns = map.birthday >= 0 || map.type >= 0 || map.registeredAt >= 0;
  records.forEach((record) => {
    const add = (field, message, severity = "blocking") => (severity === "blocking" ? errors : warnings).push({ row: record.row, field, message, severity });
    if (!record.firstName && !record.preferredName) add("First name", "First or preferred name is missing", "warning");
    if (!record.lastName) add("Last name", "Last name is missing", "warning");
    if (!record.sex) add("Sex", "Sex is required for counselor-group assignment");
    if (!record.age || record.age < 1 || record.age > 120) add("Age", "Age must be between 1 and 120");
    if (!record.unit) add("Unit", "Ward or branch is missing", "warning");
    if (hasRealExportColumns && !record.birthday) add("Birthday", "Birthday must use YYYY-MM-DD");
    if (hasRealExportColumns && !record.registeredAt) add("Registration date", "Registration date is required for stable reconciliation");
    const identity = sourceIdentityMaterial(record); identityCounts.set(identity, (identityCounts.get(identity) || 0) + 1);
  });
  records.forEach((record) => { if (identityCounts.get(sourceIdentityMaterial(record)) > 1) errors.push({ row: record.row, field: "Identity", message: "Duplicate name, birthday, unit, type, and registration date", severity: "blocking" }); });
  return { errors, warnings };
}

export async function rowsToRegistration(rows) {
  const [headers = [], ...body] = rows; const map = headerMap(headers);
  const records = body.filter((row) => row.some((cell) => String(cell ?? "").trim())).map((row, index) => buildRecord(row, map, index));
  const { errors, warnings } = validateRecords(records, map);
  await Promise.all(records.map(async (record) => { record.sourceKey = await sha256(sourceIdentityMaterial(record)); }));
  const participants = records.filter((record) => record.personType === "participant");
  const staff = records.filter((record) => record.personType === "counselor");
  return { records, participants, staff, approvedParticipants: participants.filter((r) => r.registrationStatus === "approved"), errors, warnings, headers,
    summary: { total: records.length, participants: participants.length, staff: staff.length,
      approved: records.filter((r) => r.registrationStatus === "approved").length,
      awaiting: records.filter((r) => r.registrationStatus === "awaiting").length,
      cancelled: records.filter((r) => r.registrationStatus === "cancelled").length,
      birthdays: participants.filter((r) => birthdayDuringSession(r.birthday)).length,
      missingUnit: records.filter((r) => !r.unit).length } };
}

// Compatibility for the original six-column rehearsal template.
export function rowsToParticipants(rows) {
  const [headers = [], ...body] = rows; const map = headerMap(headers);
  const participants = body.filter((row) => row.some((cell) => String(cell ?? "").trim())).map((row, index) => buildRecord(row, map, index));
  const errors = []; const seen = new Set();
  participants.forEach((p) => {
    if (!p.registrationId) errors.push({ row: p.row, field: "Registration ID", message: "Registration ID is required", severity: "blocking" });
    if (!p.firstName) errors.push({ row: p.row, field: "First name", message: "First name is required", severity: "blocking" });
    if (!p.lastName) errors.push({ row: p.row, field: "Last name", message: "Last name is required", severity: "blocking" });
    if (!p.sex) errors.push({ row: p.row, field: "Sex", message: "Sex is required for counselor-group assignment", severity: "blocking" });
    if (!p.age || p.age < 14 || p.age > 18) errors.push({ row: p.row, field: "Age", message: "Age must be between 14 and 18", severity: "blocking" });
    if (!p.unit) errors.push({ row: p.row, field: "Unit", message: "Ward, branch, or unit is required", severity: "blocking" });
    if (p.registrationId && seen.has(p.registrationId)) errors.push({ row: p.row, field: "Registration ID", message: "Duplicate registration ID", severity: "blocking" });
    if (p.registrationId) seen.add(p.registrationId);
  });
  return { participants, errors, warnings: [], headers };
}

export async function parseParticipantFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!["csv", "xlsx", "xls"].includes(extension)) throw new Error("Choose a CSV or Excel file.");
  if (file.size > 10 * 1024 * 1024) throw new Error("File is larger than the 10 MB import limit.");
  const buffer = await file.arrayBuffer(); let rows;
  if (extension === "xlsx" || extension === "xls") {
    const { default: readXlsxFile } = await import("read-excel-file/browser"); rows = await readXlsxFile(file);
  } else {
    const parsed = Papa.parse(new TextDecoder("windows-1252").decode(buffer), { skipEmptyLines: "greedy" });
    if (parsed.errors.length) throw new Error(parsed.errors[0].message); rows = parsed.data;
  }
  const result = await rowsToRegistration(rows); result.sourceSha256 = await sha256(new Uint8Array(buffer)); return result;
}

export const participantTemplate = ["registration_id,first_name,last_name,sex,age,unit", "REG-0001,Ama,Mensah,Female,16,Example Ward", "REG-0002,Kofi,Owusu,Male,17,Example Branch"].join("\n");
export function downloadCsvTemplate() {
  const blob = new Blob([participantTemplate], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = "fsy-kumasi-participant-import-template.csv"; link.click(); URL.revokeObjectURL(url);
}
