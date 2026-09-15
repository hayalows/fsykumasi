import {
  REPORT_DEFINITIONS as BASE_REPORT_DEFINITIONS,
  getAvailableReports as getBaseAvailableReports,
  getReportDefinition as getBaseReportDefinition,
  loadOperationalReport as loadBaseOperationalReport,
} from "./reports.js";
import { loadParticipantMembershipReport } from "./participant-membership.js";

const TRANSIENT_REPORT_MESSAGE = /(statement timeout|canceling statement|timed out|timeout|failed to fetch|fetch failed|network error|load failed|connection.*(?:closed|reset|timeout))/i;
const TRANSIENT_REPORT_STATUS = new Set([502, 503, 504]);

export const PARTICIPANT_MEMBERSHIP_REPORT = {
  key: "participant_membership",
  title: "Participant Membership Summary",
  description: "Checked-in participant membership categories with end-of-program counts. Staff are excluded.",
  category: "Restricted",
  available: (capabilities = []) => capabilities.includes("reports_export"),
  sensitive: true,
  columns: [
    ["full_name", "Participant", "text"],
    ["fsy_id", "FSY ID", "text"],
    ["membership_status", "Membership status", "text"],
    ["origin", "Stake / District / Mission", "text"],
    ["unit", "Ward / Branch", "text"],
    ["company", "Company", "text"],
    ["counselor_group", "Counselor group", "text"],
    ["captured_at", "Captured", "datetime"],
  ],
};

export const REPORT_DEFINITIONS = [...BASE_REPORT_DEFINITIONS, PARTICIPANT_MEMBERSHIP_REPORT];

export function getAvailableReports(capabilities = [], role = "") {
  const base = getBaseAvailableReports(capabilities, role);
  return PARTICIPANT_MEMBERSHIP_REPORT.available(capabilities, role)
    ? [...base, PARTICIPANT_MEMBERSHIP_REPORT]
    : base;
}

export function getReportDefinition(key) {
  if (key === PARTICIPANT_MEMBERSHIP_REPORT.key) return PARTICIPANT_MEMBERSHIP_REPORT;
  return getBaseReportDefinition(key);
}

export function isTransientReportError(error) {
  if (!error) return false;
  if (error.code === "57014") return true;
  const status = Number(error.status || error.statusCode || error?.context?.status || 0);
  if (TRANSIENT_REPORT_STATUS.has(status)) return true;
  return TRANSIENT_REPORT_MESSAGE.test([
    error.message,
    error.details,
    error.hint,
  ].filter(Boolean).join(" "));
}

async function loadWithOneRetry(loader) {
  try {
    return await loader();
  } catch (error) {
    if (!isTransientReportError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 450));
    return loader();
  }
}

async function loadParticipantMembership(sessionId) {
  const payload = await loadParticipantMembershipReport(sessionId);
  return {
    key: payload.key || PARTICIPANT_MEMBERSHIP_REPORT.key,
    title: payload.title || PARTICIPANT_MEMBERSHIP_REPORT.title,
    generatedAt: payload.generated_at || new Date().toISOString(),
    generatedBy: payload.generated_by || "FSY leader",
    scope: payload.scope || "Checked-in participants only · staff excluded",
    rows: Array.isArray(payload.rows) ? payload.rows : [],
    summary: payload.summary && typeof payload.summary === "object" ? payload.summary : {},
  };
}

export async function loadOperationalReport(sessionId, reportKey) {
  return loadWithOneRetry(() => reportKey === PARTICIPANT_MEMBERSHIP_REPORT.key
    ? loadParticipantMembership(sessionId)
    : loadBaseOperationalReport(sessionId, reportKey));
}
