import { isSupabaseConfigured, supabase } from "./supabase.js";

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

const general = (capabilities = []) => capabilities.includes("reports_export");
const any = (capabilities = [], keys = []) => keys.some((key) => capabilities.includes(key));

export const REPORT_DEFINITIONS = [
  {
    key: "participant_master",
    title: "Participant Master Roster",
    description: "One operational roster with names, placement, arrival, check-in, Housing and badge state.",
    category: "People & placement",
    available: general,
    columns: [
      ["fsy_id", "FSY ID", "text"], ["source_id", "Source ID", "text"], ["full_name", "Full name", "text"],
      ["preferred_name", "Preferred name", "text"], ["badge_name", "Badge name", "text"], ["sex", "Sex", "text"],
      ["age", "Age", "number"], ["origin", "Stake / District / Mission", "text"], ["unit", "Ward / Branch", "text"],
      ["company", "Company", "text"], ["counselor_group", "Counselor group", "text"], ["counselor", "Counselor", "text"],
      ["registration_status", "Registration", "text"], ["verification_status", "Verification", "text"], ["arrival_status", "Arrival", "text"],
      ["checkin_status", "Check-in", "text"], ["housing_room", "Housing room", "text"], ["source_kind", "Source", "text"],
      ["badge_state", "Badge state", "text"], ["eligible", "Operationally eligible", "boolean"],
    ],
  },
  {
    key: "unit_arrival",
    title: "Unit Arrival Sheet",
    description: "Day-one list grouped naturally by origin and unit for physical arrival reconciliation.",
    category: "Arrival & badges",
    available: general,
    columns: [["fsy_id","FSY ID","text"],["full_name","Full name","text"],["origin","Stake / District / Mission","text"],["unit","Ward / Branch","text"],["company","Company","text"],["counselor_group","Counselor group","text"],["arrival_status","Arrival","text"],["checkin_status","Check-in","text"]],
  },
  {
    key: "stake_summary",
    title: "Stake & District Arrival Summary",
    description: "Leadership view of who has arrived, who is later, who needs follow-up and confirmed absences.",
    category: "Arrival & badges",
    available: general,
    columns: [["origin","Stake / District / Mission","text"],["roster","Roster","number"],["operational_expected","Operational expected","number"],["checked_in","Checked in","number"],["expected_later","Expected later","number"],["follow_up","Follow up","number"],["not_attending","Not attending","number"]],
  },
  {
    key: "company_roster",
    title: "Company Roster",
    description: "Company-by-company youth list ordered by operational company and counselor group number.",
    category: "People & placement",
    available: general,
    columns: [["company_number","Company #","number"],["company","Company","text"],["group_number","Group #","number"],["counselor_group","Counselor group","text"],["fsy_id","FSY ID","text"],["full_name","Full name","text"],["origin","Origin","text"],["unit","Unit","text"],["counselor","Counselor","text"],["arrival_status","Arrival","text"],["checkin_status","Check-in","text"]],
  },
  {
    key: "counselor_group",
    title: "Counselor Group Sheet",
    description: "Field-friendly group lists for counselors and Assistant Coordinators.",
    category: "People & placement",
    available: general,
    columns: [["company_number","Company #","number"],["company","Company","text"],["group_number","Group #","number"],["counselor_group","Counselor group","text"],["counselor","Counselor","text"],["fsy_id","FSY ID","text"],["full_name","Full name","text"],["origin","Origin","text"],["unit","Unit","text"],["arrival_status","Arrival","text"],["checkin_status","Check-in","text"]],
  },
  {
    key: "badge_production",
    title: "Badge Production",
    description: "Final badge dataset with roster slot, production state and reprint readiness.",
    category: "Arrival & badges",
    available: general,
    columns: [["fsy_id","FSY ID","text"],["badge_name","Badge name","text"],["full_name","Full name","text"],["origin_code","Origin code","text"],["company_number","Company #","number"],["company","Company","text"],["counselor_group","Counselor group","text"],["slot_number","Slot","number"],["badge_state","Badge state","text"],["needs_reprint","Needs reprint","boolean"],["production_status","Production status","text"]],
  },
  {
    key: "badge_exceptions",
    title: "Badge Exceptions",
    description: "Only the identity and badge problems that still need action.",
    category: "Arrival & badges",
    available: general,
    columns: [["fsy_id","FSY ID","text"],["full_name","Full name","text"],["origin","Origin","text"],["company","Company","text"],["counselor_group","Counselor group","text"],["badge_state","Badge state","text"],["needs_reprint","Needs reprint","boolean"],["issue","Issue","text"]],
  },
  {
    key: "onsite_registrations",
    title: "On-site Registrations",
    description: "Every day-of participant added outside the original registration import and where they stand now.",
    category: "Arrival & badges",
    available: general,
    columns: [["created_at","Added","datetime"],["source_id","Source ID","text"],["fsy_id","FSY ID","text"],["full_name","Full name","text"],["origin","Origin","text"],["unit","Unit","text"],["verification_status","Verification","text"],["company","Company","text"],["counselor_group","Counselor group","text"],["housing_room","Housing","text"],["arrival_status","Arrival","text"],["checkin_status","Check-in","text"]],
  },
  {
    key: "replacements",
    title: "No-shows & Replacements",
    description: "Historical trace of the original roster position and the verified on-site participant who filled it.",
    category: "Arrival & badges",
    available: general,
    columns: [["original_fsy_id","Original FSY ID","text"],["original_name","Original participant","text"],["company","Company","text"],["counselor_group","Counselor group","text"],["slot_number","Slot","number"],["no_show_confirmation","No-show confirmation","text"],["no_show_confirmed_at","Confirmed","datetime"],["replacement_fsy_id","Replacement FSY ID","text"],["replacement_name","Replacement participant","text"],["replaced_at","Replaced","datetime"],["replaced_by","Replaced by","text"]],
  },
  {
    key: "housing_occupancy",
    title: "Housing Occupancy",
    description: "Room-by-room occupants, bed/key labels and participant check-in state.",
    category: "Daily operations",
    available: (caps) => any(caps, ["housing_export", "reports_export"]),
    columns: [["building","Building","text"],["room","Room","text"],["bed_key","Bed / key","text"],["person_type","Type","text"],["fsy_id","FSY ID","text"],["name","Name","text"],["sex","Sex","text"],["company","Company","text"],["counselor_group","Counselor group","text"],["checkin_status","Check-in","text"]],
  },
  {
    key: "meal_attendance",
    title: "Meal Attendance",
    description: "Meal-service summary plus the individual attendance trail for Food operations.",
    category: "Daily operations",
    available: (caps) => caps.includes("food_export"),
    columns: [["service_date","Date","date"],["meal","Meal","text"],["service_status","Service status","text"],["fsy_id","FSY ID","text"],["name","Name","text"],["person_type","Type","text"],["company","Company","text"],["counselor_group","Counselor group","text"],["served_at","Served at","datetime"],["recorded_by","Recorded by","text"]],
  },
  {
    key: "headcount_history",
    title: "Head Count History",
    description: "Every company submission across every round, including recorded reconciliation detail.",
    category: "Daily operations",
    available: general,
    columns: [["round","Round","text"],["opened_at","Opened","datetime"],["closed_at","Closed","datetime"],["company_number","Company #","number"],["company","Company","text"],["expected_count","Expected","number"],["accounted_count","Accounted","number"],["status","Status","text"],["note","Note","text"],["reconciliation","Reconciliation","text"],["submitted_at","Submitted","datetime"],["submitted_by","Submitted by","text"]],
  },
  {
    key: "wellness_visits",
    title: "Wellness Visit Log",
    description: "Restricted confidential visit history for authorized Wellness leaders only.",
    category: "Restricted",
    available: (caps) => caps.includes("wellness_export"),
    sensitive: true,
    columns: [["fsy_id","FSY ID","text"],["name","Name","text"],["person_type","Type","text"],["started_at","Started","datetime"],["closed_at","Checked out","datetime"],["duration_minutes","Duration (min)","number"],["concern","Concern","text"],["care_provided","Care provided","text"],["medicine_provided","Medicine","text"],["outcome","Outcome","text"],["follow_up_status","Follow-up","text"],["recorded_by","Recorded by","text"]],
  },
  {
    key: "audit_activity",
    title: "Operational Audit Activity",
    description: "High-impact changes for leaders who manage access and accountability.",
    category: "Restricted",
    available: (caps) => caps.includes("access_admin"),
    sensitive: true,
    columns: [["created_at","Time","datetime"],["action","Action","text"],["entity_type","Entity","text"],["entity_id","Entity ID","text"],["actor","Actor","text"],["details","Details","text"]],
  },
];

export function getAvailableReports(capabilities = []) {
  return REPORT_DEFINITIONS.filter((report) => report.available(capabilities));
}

export function getReportDefinition(key) {
  return REPORT_DEFINITIONS.find((report) => report.key === key) || null;
}

export async function loadOperationalReport(sessionId, reportKey) {
  const { data, error } = await client().rpc("get_operational_report", {
    p_session_id: sessionId,
    p_report_key: reportKey,
  });
  if (error) throw error;
  const payload = data || {};
  return {
    key: payload.key || reportKey,
    title: payload.title || getReportDefinition(reportKey)?.title || "Operational report",
    generatedAt: payload.generated_at || new Date().toISOString(),
    generatedBy: payload.generated_by || "FSY leader",
    scope: payload.scope || "FSY Kumasi session",
    rows: Array.isArray(payload.rows) ? payload.rows : [],
    summary: payload.summary && typeof payload.summary === "object" ? payload.summary : {},
  };
}
