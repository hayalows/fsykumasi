import { isSupabaseConfigured, supabase } from "./supabase.js";

function client() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured for this deployment.");
  return supabase;
}

export const DEFAULT_STRUCTURE_SETTINGS = {
  groupMinSize: 8,
  groupMaxSize: 10,
  groupsPerCompany: 2,
  useAgeBands: false,
  avoidSameUnit: true,
  balanceSexes: true,
  participantMinAge: 13,
  participantMaxAge: 20,
  companiesPerAssistantCoordinator: 4,
};

export async function loadLatestImport(sessionId) {
  const { data, error } = await client()
    .from("import_batches")
    .select("id, source_filename, record_count, participant_count, staff_count, omitted_count, exception_count, status, created_at")
    .eq("session_id", sessionId)
    .eq("status", "applied")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? {
    id: data.id,
    sourceFilename: data.source_filename,
    recordCount: data.record_count,
    participantCount: data.participant_count,
    staffCount: data.staff_count,
    omittedCount: data.omitted_count,
    exceptionCount: data.exception_count,
    status: data.status,
    createdAt: data.created_at,
  } : null;
}

export async function loadStructureSettings(sessionId) {
  const { data, error } = await client()
    .from("session_structure_settings")
    .select("group_min_size, group_max_size, groups_per_company, use_age_bands, avoid_same_unit, balance_sexes, participant_min_age, participant_max_age, companies_per_assistant_coordinator, updated_at")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ...DEFAULT_STRUCTURE_SETTINGS };
  return {
    groupMinSize: data.group_min_size,
    groupMaxSize: data.group_max_size,
    groupsPerCompany: data.groups_per_company,
    useAgeBands: data.use_age_bands,
    avoidSameUnit: data.avoid_same_unit,
    balanceSexes: data.balance_sexes,
    participantMinAge: data.participant_min_age ?? DEFAULT_STRUCTURE_SETTINGS.participantMinAge,
    participantMaxAge: data.participant_max_age ?? DEFAULT_STRUCTURE_SETTINGS.participantMaxAge,
    companiesPerAssistantCoordinator: data.companies_per_assistant_coordinator ?? DEFAULT_STRUCTURE_SETTINGS.companiesPerAssistantCoordinator,
    updatedAt: data.updated_at,
  };
}

export async function saveStructureSettings(sessionId, settings) {
  const { error } = await client().rpc("save_session_structure_settings", {
    p_session_id: sessionId,
    p_group_min_size: Number(settings.groupMinSize),
    p_group_max_size: Number(settings.groupMaxSize),
    p_groups_per_company: Number(settings.groupsPerCompany),
    p_use_age_bands: Boolean(settings.useAgeBands),
    p_avoid_same_unit: Boolean(settings.avoidSameUnit),
    p_balance_sexes: Boolean(settings.balanceSexes),
    p_participant_min_age: Number(settings.participantMinAge),
    p_participant_max_age: Number(settings.participantMaxAge),
    p_companies_per_assistant_coordinator: Number(settings.companiesPerAssistantCoordinator),
  });
  if (error) throw error;
}

export async function loadStaff(sessionId) {
  const [{ data: rows, error }, { data: groupRows, error: groupError }, { data: companyAssignments, error: assignmentError }] = await Promise.all([
    client().from("staff")
      .select("id, full_name, first_name, last_name, preferred_name, sex, age, unit_name, stake_name, staff_role, operational_role, registration_status, is_current")
      .eq("session_id", sessionId)
      .order("full_name"),
    client().from("counselor_groups").select("id, counselor_id, company_id").eq("session_id", sessionId),
    client().from("staff_company_assignments").select("staff_id, company_id").eq("session_id", sessionId),
  ]);
  if (error) throw error;
  if (groupError) throw groupError;
  if (assignmentError) throw assignmentError;
  const counselorGroup = new Map((groupRows || []).filter((row) => row.counselor_id).map((row) => [row.counselor_id, row.id]));
  const companiesByStaff = (companyAssignments || []).reduce((map, row) => {
    if (!map.has(row.staff_id)) map.set(row.staff_id, []);
    map.get(row.staff_id).push(row.company_id);
    return map;
  }, new Map());
  return (rows || []).map((row) => ({
    id: row.id,
    name: row.full_name || `${row.first_name || ""} ${row.last_name || ""}`.trim(),
    firstName: row.first_name,
    lastName: row.last_name,
    preferredName: row.preferred_name,
    sex: row.sex === "female" ? "Female" : row.sex === "male" ? "Male" : "",
    age: row.age,
    unit: row.unit_name,
    stake: row.stake_name,
    sourceRole: row.staff_role,
    operationalRole: row.operational_role || "counselor",
    registrationStatus: row.registration_status,
    isCurrent: row.is_current,
    counselorGroupId: counselorGroup.get(row.id) || "",
    companyIds: companiesByStaff.get(row.id) || [],
  }));
}

export async function loadOperationalStructure(sessionId) {
  const [{ data: companies, error: companyError }, { data: groups, error: groupError }, { data: assignments, error: assignmentError }] = await Promise.all([
    client().from("companies")
      .select("id, name, color, custom_name, scripture_reference, meeting_spot")
      .eq("session_id", sessionId).order("name"),
    client().from("counselor_groups")
      .select("id, company_id, name, custom_name, sex, state, counselor_id, participants(count)")
      .eq("session_id", sessionId).order("name"),
    client().from("staff_company_assignments").select("staff_id, company_id").eq("session_id", sessionId),
  ]);
  if (companyError) throw companyError;
  if (groupError) throw groupError;
  if (assignmentError) throw assignmentError;
  const mappedGroups = (groups || []).map((row) => ({
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    customName: row.custom_name,
    displayName: row.custom_name || row.name,
    sex: row.sex === "female" ? "Female" : "Male",
    state: row.state,
    counselorId: row.counselor_id || "",
    memberCount: row.participants?.[0]?.count || 0,
  }));
  const companyStaff = (assignments || []).reduce((map, row) => {
    if (!map.has(row.company_id)) map.set(row.company_id, []);
    map.get(row.company_id).push(row.staff_id);
    return map;
  }, new Map());
  const mappedCompanies = (companies || []).map((row) => ({
    id: row.id,
    name: row.name,
    customName: row.custom_name,
    displayName: row.custom_name || row.name,
    color: row.color,
    scriptureReference: row.scripture_reference || "",
    meetingSpot: row.meeting_spot || "",
    assistantCoordinatorIds: companyStaff.get(row.id) || [],
    groups: mappedGroups.filter((group) => group.companyId === row.id),
  }));
  return { groups: mappedGroups, companies: mappedCompanies, published: mappedGroups.some((group) => group.state === "published") };
}

export async function loadPersonPrivateDetails(kind, id) {
  const table = kind === "staff" ? "staff_private_details" : "participant_private_details";
  const key = kind === "staff" ? "staff_id" : "participant_id";
  const { data, error } = await client().from(table).select("*").eq(key, id).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function setStaffOperationalRole(staffId, role) {
  const { error } = await client().rpc("set_staff_operational_role", { p_staff_id: staffId, p_role: role });
  if (error) throw error;
}

export async function transitionStaffOperationalRole({
  staffId,
  role,
  replacementCounselorId = null,
  counselorGroupId = null,
  companyIds = [],
}) {
  const { data, error } = await client().rpc("transition_staff_operational_role", {
    p_staff_id: staffId,
    p_role: role,
    p_replacement_counselor_id: replacementCounselorId || null,
    p_counselor_group_id: counselorGroupId || null,
    p_company_ids: companyIds || [],
  });
  if (error) throw error;
  return data;
}

export async function assignCounselorToGroup(staffId, groupId) {
  const { error } = await client().rpc("assign_counselor_to_group", { p_staff_id: staffId, p_group_id: groupId });
  if (error) throw error;
}

export async function unassignCounselorFromGroup(groupId) {
  const { error } = await client().rpc("unassign_counselor_from_group", { p_group_id: groupId });
  if (error) throw error;
}

export async function setStaffCompanyAssignment(staffId, companyId, assigned) {
  const { error } = await client().rpc("set_staff_company_assignment", {
    p_staff_id: staffId,
    p_company_id: companyId,
    p_assigned: Boolean(assigned),
  });
  if (error) throw error;
}

export async function applyStaffAssignmentPlan(sessionId, suggestions) {
  const { data, error } = await client().rpc("apply_staff_assignment_plan", {
    p_session_id: sessionId,
    p_counselor_assignments: (suggestions?.counselors || []).map((item) => ({ staff_id: item.staffId, group_id: item.groupId })),
    p_assistant_assignments: (suggestions?.assistants || []).map((item) => ({ staff_id: item.staffId, company_id: item.companyId })),
  });
  if (error) throw error;
  return data;
}

export async function updateCompanyDetails(companyId, values) {
  const { error } = await client().rpc("update_company_details", {
    p_company_id: companyId,
    p_custom_name: values.customName || null,
    p_scripture_reference: values.scriptureReference || null,
    p_meeting_spot: values.meetingSpot || null,
  });
  if (error) throw error;
}

export async function updateGroupDetails(groupId, customName) {
  const { error } = await client().rpc("update_group_details", { p_group_id: groupId, p_custom_name: customName || null });
  if (error) throw error;
}

export async function setBirthdayAcknowledgement(sessionId, participantId, acknowledged) {
  const { error } = await client().rpc("set_birthday_acknowledgement", {
    p_session_id: sessionId,
    p_participant_id: participantId,
    p_acknowledged: Boolean(acknowledged),
  });
  if (error) throw error;
}
