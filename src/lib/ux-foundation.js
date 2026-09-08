export const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function naturalCompare(left, right) {
  return naturalCollator.compare(String(left || ""), String(right || ""));
}

export function sortByNatural(items = [], getLabel = (item) => item) {
  return [...items].sort((left, right) => naturalCompare(getLabel(left), getLabel(right)));
}

export function workspaceDataState({ online = true, refreshing = false, error = "", hasData = true, lastUpdatedAt = "" } = {}) {
  if (!online) {
    return {
      state: "offline",
      label: "Offline",
      tone: "muted",
      detail: hasData ? "Showing the last data loaded on this device." : "Live FSY data is unavailable until the connection returns.",
      lastUpdatedAt,
      canRetry: false,
    };
  }
  if (error && hasData) {
    return {
      state: "stale",
      label: "Update problem",
      tone: "warn",
      detail: "What is already on screen may be out of date.",
      lastUpdatedAt,
      canRetry: true,
    };
  }
  if (error) {
    return {
      state: "failed",
      label: "Could not load",
      tone: "danger",
      detail: "Live FSY data could not be loaded.",
      lastUpdatedAt,
      canRetry: true,
    };
  }
  if (refreshing && hasData) {
    return {
      state: "updating",
      label: "Updating",
      tone: "info",
      detail: "Keeping the current view in place while newer data loads.",
      lastUpdatedAt,
      canRetry: false,
    };
  }
  if (refreshing || !hasData) {
    return {
      state: "loading",
      label: "Loading",
      tone: "info",
      detail: "Loading live FSY data.",
      lastUpdatedAt,
      canRetry: false,
    };
  }
  return {
    state: "ready",
    label: "Ready",
    tone: "good",
    detail: "Live FSY data is ready.",
    lastUpdatedAt,
    canRetry: false,
  };
}

const OPERATIONAL_VALUE_LABELS = {
  approved: "Approved",
  awaiting: "Awaiting approval",
  cancelled: "Cancelled",
  expected: "Expected today",
  expected_later: "Expected later",
  unknown: "Follow up",
  confirmed_not_attending: "Not attending",
  arrived: "Checked in",
  not_checked_in: "Not checked in",
  confirmation_required: "Confirmation required",
  cleared: "Cleared",
  pending: "Pending",
  verified: "Verified",
  rejected: "Rejected",
};

export function humanizeOperationalValue(value, fallback = "Not recorded") {
  if (value === null || value === undefined || value === "") return fallback;
  const raw = String(value);
  if (OPERATIONAL_VALUE_LABELS[raw]) return OPERATIONAL_VALUE_LABELS[raw];
  return raw.replace(/[_-]+/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function participantOperationalContext(person = {}, source = {}) {
  return {
    participantId: person.id || person.participantId || person.person_id || "",
    name: person.fullName || person.name || person.full_name || "Participant",
    fsyId: person.fsyId || person.fsy_id || "",
    companyId: person.companyId || person.company_id || source.companyId || "",
    company: person.companyName || person.company || source.company || "",
    groupId: person.groupId || person.group_id || source.groupId || "",
    group: person.groupName || person.group || source.group || "",
    registrationStatus: person.registrationStatus || person.registration_status || "",
    checkinStatus: person.checkinStatus || person.checkin_status || "",
    attendanceStatus: person.attendanceStatus || person.attendance_status || "",
    housingStatus: person.housingStatus || person.housing_status || "",
    source: {
      view: source.view || "",
      mode: source.mode || "",
      tab: source.tab || "",
      filter: source.filter || "",
      companyId: source.companyId || "",
      groupId: source.groupId || "",
      search: source.search || "",
    },
  };
}

export function compactReturnContext(destination = {}) {
  const source = destination || {};
  return {
    view: source.view || "",
    mode: source.mode || "",
    tab: source.tab || "",
    filter: source.filter || "",
    personId: source.personId || source.person || "",
    staffId: source.staffId || source.staff || "",
    companyId: source.companyId || source.company || "",
    groupId: source.groupId || source.group || "",
  };
}
