import Papa from "papaparse";

const aliases = {
  registrationId: ["registrationid", "registrationnumber", "participantid", "id"],
  firstName: ["firstname", "givenname", "first"],
  lastName: ["lastname", "surname", "familyname", "last"],
  fullName: ["fullname", "participantname", "name"],
  sex: ["sex", "gender", "assignmentsex"],
  age: ["age", "participantage"],
  unit: ["unit", "ward", "branch", "wardbranch", "homeunit", "congregation"],
};

function normalizeHeader(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findValue(row, headers, field) {
  const accepted = aliases[field];
  const index = headers.findIndex((header) => accepted.includes(normalizeHeader(header)));
  return index >= 0 ? row[index] : "";
}

function normalizeSex(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["f", "female", "young women", "yf"].includes(normalized)) return "Female";
  if (["m", "male", "young men", "ym"].includes(normalized)) return "Male";
  return "";
}

export function rowsToParticipants(rows) {
  const [headers = [], ...body] = rows;
  const participants = body
    .filter((row) => row.some((cell) => String(cell ?? "").trim()))
    .map((row, index) => {
      const fullName = String(findValue(row, headers, "fullName") || "").trim();
      const split = fullName.split(/\s+/).filter(Boolean);
      const firstName = String(findValue(row, headers, "firstName") || split[0] || "").trim();
      const lastName = String(findValue(row, headers, "lastName") || split.slice(1).join(" ") || "").trim();
      return {
        id: String(findValue(row, headers, "registrationId") || `row-${index + 2}`).trim(),
        registrationId: String(findValue(row, headers, "registrationId") || "").trim(),
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`.trim(),
        sex: normalizeSex(findValue(row, headers, "sex")),
        age: Number(findValue(row, headers, "age")) || null,
        unit: String(findValue(row, headers, "unit") || "").trim(),
        status: "Expected",
      };
    });

  const errors = [];
  const seen = new Set();
  participants.forEach((participant, index) => {
    const row = index + 2;
    if (!participant.registrationId) errors.push({ row, field: "Registration ID", message: "Registration ID is required", severity: "blocking" });
    if (!participant.firstName) errors.push({ row, field: "First name", message: "First name is required", severity: "blocking" });
    if (!participant.lastName) errors.push({ row, field: "Last name", message: "Last name is required", severity: "blocking" });
    if (!participant.sex) errors.push({ row, field: "Sex", message: "Sex is required for counselor-group assignment", severity: "blocking" });
    if (!participant.age || participant.age < 14 || participant.age > 18) errors.push({ row, field: "Age", message: "Age must be between 14 and 18", severity: "blocking" });
    if (!participant.unit) errors.push({ row, field: "Unit", message: "Ward, branch, or unit is required", severity: "blocking" });
    if (participant.registrationId && seen.has(participant.registrationId)) errors.push({ row, field: "Registration ID", message: "Duplicate registration ID", severity: "blocking" });
    if (participant.registrationId) seen.add(participant.registrationId);
  });
  return { participants, errors, headers };
}

export async function parseParticipantFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!["csv", "xlsx", "xls"].includes(extension)) throw new Error("Choose a CSV or Excel file.");
  if (file.size > 10 * 1024 * 1024) throw new Error("File is larger than the 10 MB import limit.");
  if (extension === "xlsx" || extension === "xls") {
    const { default: readXlsxFile } = await import("read-excel-file/browser");
    const rows = await readXlsxFile(file);
    return rowsToParticipants(rows);
  }
  const text = await file.text();
  const result = Papa.parse(text, { skipEmptyLines: "greedy" });
  if (result.errors.length) throw new Error(result.errors[0].message);
  return rowsToParticipants(result.data);
}

export const participantTemplate = [
  "registration_id,first_name,last_name,sex,age,unit",
  "REG-0001,Ama,Mensah,Female,16,Example Ward",
  "REG-0002,Kofi,Owusu,Male,17,Example Branch",
].join("\n");

export function downloadCsvTemplate() {
  const blob = new Blob([participantTemplate], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "fsy-kumasi-participant-import-template.csv";
  link.click();
  URL.revokeObjectURL(url);
}
