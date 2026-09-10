const AGE_REASONS = new Set([
  "Too young for this FSY year",
  "Turns 19 before or on the end of this session",
  "Age 19 or older at session start",
  "Date of birth is missing",
]);

const RESOLVED_HISTORY_REASONS = new Set([
  "Excluded from active youth operations",
  "Age 20+ removed from active participant roster",
  "Outside active youth age policy",
]);

function eligibilityFor(row, eligibility) {
  return eligibility || row?.serverEligibility || null;
}

export function registrationBlocker(row = {}, eligibility) {
  const decision = eligibilityFor(row, eligibility);
  if (!row.isCurrent || row.attendanceStatus === "confirmed_not_attending" || row.checkinStatus === "arrived") return null;
  if (row.operationalStatus && row.operationalStatus !== "active") return null;

  if (row.sourceKind === "on_site" && row.verificationStatus !== "verified") {
    return {
      key: "verification",
      queue: "verification",
      label: "Needs verification",
      nextAction: "Confirm the on-site registration checks",
      authority: "Registration Committee",
    };
  }

  if (decision && decision.eligible === false) {
    const reason = decision.reason || "Needs review";
    if (RESOLVED_HISTORY_REASONS.has(reason)) return null;
    if (reason === "Registration is not approved") {
      return {
        key: "awaiting",
        queue: "awaiting",
        label: reason,
        nextAction: "Record the final session decision",
        authority: "Session Directing Couple or Logistical Administrator",
      };
    }
    if (AGE_REASONS.has(reason)) {
      return {
        key: "age_review",
        queue: "age_review",
        label: reason,
        nextAction: reason === "Date of birth is missing" ? "Confirm the date of birth from the source" : "Record the final session decision",
        authority: reason === "Date of birth is missing" ? "Registration Committee" : "Session Directing Couple or Logistical Administrator",
      };
    }
    return {
      key: "eligibility",
      queue: "needs_help",
      label: reason,
      nextAction: "Review the eligibility issue",
      authority: "Registration Committee",
    };
  }

  if (!row.groupName && !row.groupId) {
    return {
      key: "needs_group",
      queue: "needs_group",
      label: "Needs counselor group",
      nextAction: "Choose an available counselor group",
      authority: "Registration Committee",
    };
  }

  if (row.sourceKind === "on_site" && row.verificationStatus === "verified" && !row.fsyId) {
    return {
      key: "needs_id",
      queue: "needs_id",
      label: "Needs FSY ID",
      nextAction: "Complete placement and identity",
      authority: "Registration Committee",
    };
  }

  if (row.attendanceStatus === "unknown") {
    return {
      key: "follow_up",
      queue: "needs_help",
      label: "Needs follow-up",
      nextAction: "Confirm whether the participant is still expected",
      authority: "Registration Committee",
    };
  }

  return null;
}

export function registrationProblem(row = {}, eligibility) {
  return registrationBlocker(row, eligibility)?.label || "";
}

export function isRegistrationReady(row = {}, eligibility) {
  return Boolean(
    row.isCurrent
    && (!row.operationalStatus || row.operationalStatus === "active")
    && row.attendanceStatus !== "confirmed_not_attending"
    && row.checkinStatus !== "arrived"
    && !registrationBlocker(row, eligibility),
  );
}

export function registrationNextAction(row = {}, eligibility) {
  return registrationBlocker(row, eligibility)?.nextAction || "";
}

export function registrationBlockerCount(rows = []) {
  return rows.reduce((count, row) => count + (registrationBlocker(row, row?.serverEligibility) ? 1 : 0), 0);
}

export function registrationBlockerBreakdown(rows = []) {
  const counts = {};
  for (const row of rows) {
    const blocker = registrationBlocker(row, row?.serverEligibility);
    if (!blocker) continue;
    counts[blocker.key] = (counts[blocker.key] || 0) + 1;
  }
  return counts;
}
