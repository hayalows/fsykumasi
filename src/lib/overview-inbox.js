const WHOLE_SESSION = new Set(["coordinator", "logistics_admin", "session_director"]);

const n = (value) => Number(value || 0);
const plural = (count, one, many = `${one}s`) => count === 1 ? one : many;

function task(id, title, detail, action, priority, tone = "default") {
  return { id, title, detail, action, priority, tone };
}

export function buildOperationalInbox({ role, capabilities = [], summary = {} }) {
  const has = (key) => capabilities.includes(key);
  const whole = WHOLE_SESSION.has(role) || Boolean(summary.wholeSession);
  const scope = summary.scope || {};
  const registration = summary.registration || {};
  const housing = summary.housing || {};
  const headcount = summary.headcount || {};
  const wellness = summary.wellness || {};
  const food = summary.food || {};
  const access = summary.access || {};
  const session = summary.session || {};
  const tasks = [];

  const registrationAccess = has("registration_view") || has("registration_manage") || has("checkin_record");
  const housingAccess = has("housing_view");
  const wellnessAccess = has("wellness_private") || has("wellness_status");
  const foodAccess = has("food_view") || has("meal_attendance_view");
  const headcountAccess = whole || has("headcount_view") || has("headcount_record");

  const pendingId = n(registration.onSitePendingId);
  if (registrationAccess && pendingId) {
    tasks.push(task(
      "registration",
      `${pendingId} on-site ${plural(pendingId, "participant")} need ${plural(pendingId, "an FSY ID", "FSY IDs")}`,
      "Finish identity before check-in so the participant moves through the same flow as everyone else.",
      "Resolve registration",
      100,
      "urgent",
    ));
  }

  const otherRegistrationAttention = Math.max(0, n(registration.attention) - pendingId);
  if (registrationAccess && otherRegistrationAttention) {
    tasks.push(task(
      "registration",
      `${otherRegistrationAttention} registration ${plural(otherRegistrationAttention, "record")} need attention`,
      "Verification, eligibility or placement is stopping these participants from checking in.",
      "Review registration",
      96,
      "attention",
    ));
  }

  const headcountOpen = Boolean(headcount.roundId) && !headcount.closesAt;
  const missing = n(headcount.missing);
  const unresolved = n(headcount.unresolved);
  if (headcountAccess && headcountOpen && missing) {
    tasks.push(task(
      "headcount",
      `${missing} ${plural(missing, "person", "people")} marked missing`,
      unresolved ? `${unresolved} ${plural(unresolved, "person", "people")} still unchecked in ${headcount.label || "the current head count"}.` : `Resolve the exception in ${headcount.label || "the current head count"}.`,
      "Review head count",
      94,
      "urgent",
    ));
  } else if (headcountAccess && headcountOpen && unresolved) {
    tasks.push(task(
      "headcount",
      `${unresolved} ${plural(unresolved, "person", "people")} still need head count`,
      `${headcount.label || "Current round"} is still in progress for your scope.`,
      "Continue head count",
      80,
      "attention",
    ));
  } else if (whole && headcountOpen && n(headcount.total) > 0) {
    tasks.push(task(
      "headcount",
      `${headcount.label || "Head count"} is ready to close`,
      "Everyone in the current person-level round is accounted for.",
      "Review & close",
      30,
      "calm",
    ));
  }

  const openWellness = n(wellness.open);
  if (wellnessAccess && openWellness) {
    tasks.push(task(
      "wellness",
      `${openWellness} open Wellness ${plural(openWellness, "visit")}`,
      "Review the current queue and any follow-up that still needs attention.",
      "Open Wellness",
      90,
      "urgent",
    ));
  }

  const waitingRooms = n(housing.waiting);
  if (housingAccess && waitingRooms) {
    tasks.push(task(
      "housing",
      `${waitingRooms} checked-in ${plural(waitingRooms, "participant")} waiting for a room`,
      "Registration has finished its part. Continue the Housing handoff.",
      "Assign rooms",
      88,
      "attention",
    ));
  }

  const ready = n(registration.ready);
  if (registrationAccess && ready) {
    tasks.push(task(
      "registration",
      `${ready} ${plural(ready, "participant")} ready to check in`,
      n(session.recentArrivals) ? `${n(session.recentArrivals)} checked in during the last 15 minutes.` : "Open the ready queue and keep arrivals moving.",
      "Open check-in desk",
      84,
      "positive",
    ));
  }

  const uncovered = n(scope.uncoveredGroups);
  if ((whole || role === "assistant_coordinator") && uncovered) {
    tasks.push(task(
      "assignments",
      `${uncovered} counselor ${plural(uncovered, "group")} uncovered`,
      role === "assistant_coordinator" ? "A group in your companies does not have a counselor assigned." : "Counselor coverage needs attention before the next participant activity.",
      "Review assignments",
      76,
      "attention",
    ));
  }

  const dietaryOpen = n(food.dietaryOpen);
  if (has("food_view") && dietaryOpen) {
    tasks.push(task(
      "food",
      `${dietaryOpen} dietary ${plural(dietaryOpen, "need")} to review`,
      "Only responses that appear to contain an actual dietary need are included here.",
      "Review dietary needs",
      65,
      "attention",
    ));
  }

  const accessPending = n(access.pending);
  if ((whole || has("access_admin")) && accessPending) {
    tasks.push(task(
      "access",
      `${accessPending} access ${plural(accessPending, "invite or request", "invites or requests")} waiting`,
      "Finish account setup or review pending access when it is useful.",
      "Open Access",
      55,
      "calm",
    ));
  }

  const mealRemaining = n(food.remaining);
  if (foodAccess && food.serviceStatus === "open" && mealRemaining) {
    tasks.push(task(
      "food",
      `${food.serviceLabel || "Meal service"} is in progress`,
      `${n(food.served).toLocaleString()} served · ${mealRemaining.toLocaleString()} remaining in your visible scope.`,
      "Open meal service",
      42,
      "calm",
    ));
  }

  tasks.sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));

  const companyCount = n(scope.companyCount);
  const fallback = role === "assistant_coordinator"
    ? task("groups", "Your companies are ready", companyCount ? `Review the ${companyCount} ${plural(companyCount, "company", "companies")} and counselors you supervise.` : "Your company assignment will appear here when it is ready.", "View companies", 0, "calm")
    : registrationAccess
      ? task("registration", "Registration & check-in", "Your arrival queues are clear right now. Search a participant whenever you need them.", "Open check-in desk", 0, "calm")
      : housingAccess
        ? task("housing", "Housing is clear", "No checked-in participant is currently waiting for a room.", "Open Housing", 0, "calm")
        : wellnessAccess
          ? task("wellness", "Wellness is clear", "There are no open Wellness visits right now.", "Open Wellness", 0, "calm")
          : foodAccess
            ? task("food", "Food operations", food.serviceStatus === "open" ? `${food.serviceLabel || "Meal service"} is open.` : "No meal service needs immediate attention.", "Open Food", 0, "calm")
            : task("profile", "Your responsibilities", "Review the access and responsibilities assigned to your account.", "View profile", 0, "calm");

  let areaTitle = "Your area";
  let areaDetail = "Only the information that helps you supervise your current responsibility is shown here.";
  let metrics = [];

  if (role === "assistant_coordinator") {
    areaTitle = "Your companies";
    areaDetail = (scope.companyNames || []).length ? scope.companyNames.join(" · ") : "Your assigned companies and counselors.";
    metrics = [
      { label: "Companies", value: companyCount },
      { label: "Counselors", value: n(scope.counselorCount) },
      { label: "Youth", value: n(scope.participantCount) },
      { label: "Uncovered groups", value: uncovered, attention: uncovered > 0 },
    ];
  } else if (whole) {
    areaTitle = "Session pulse";
    areaDetail = "A small set of live operational signals. Open a workspace only when something needs action.";
    metrics = [
      { label: "Checked in", value: n(session.checkedIn) },
      { label: "Companies", value: companyCount },
      { label: "Housing waiting", value: waitingRooms, attention: waitingRooms > 0 },
      { label: "Uncovered groups", value: uncovered, attention: uncovered > 0 },
    ];
  } else if (registrationAccess) {
    areaTitle = "Arrival desk";
    areaDetail = "Ready people first. Exceptions stay separate so the desk can keep moving.";
    metrics = [
      { label: "Ready", value: ready },
      { label: "Needs attention", value: n(registration.attention), attention: n(registration.attention) > 0 },
      { label: "Checked in", value: n(registration.arrived) },
      { label: "Last 15 min", value: n(session.recentArrivals) },
    ];
  } else if (housingAccess) {
    areaTitle = "Housing handoff";
    areaDetail = "Checked-in arrivals appear automatically when Registration finishes its part.";
    metrics = [
      { label: "Waiting", value: waitingRooms, attention: waitingRooms > 0 },
      { label: "Assigned", value: n(housing.assigned) },
    ];
  } else if (foodAccess) {
    areaTitle = "Food operations";
    areaDetail = food.serviceStatus === "open" ? `${food.serviceLabel || "Meal service"} is open now.` : "Current meal and dietary work.";
    metrics = [
      { label: "Dietary review", value: dietaryOpen, attention: dietaryOpen > 0 },
      { label: "Served", value: n(food.served) },
      { label: "Remaining", value: mealRemaining },
    ];
  } else if (wellnessAccess) {
    areaTitle = "Wellness";
    areaDetail = "Only current operational status is surfaced on Overview.";
    metrics = [{ label: "Open visits", value: openWellness, attention: openWellness > 0 }];
  }

  const scopeLabel = role === "assistant_coordinator"
    ? `${companyCount} assigned ${plural(companyCount, "company", "companies")}`
    : whole ? "Whole session" : "Your committee work";

  return {
    whole,
    scopeLabel,
    primary: tasks[0] || fallback,
    others: tasks.slice(1, 3),
    taskCount: tasks.length,
    areaTitle,
    areaDetail,
    metrics,
  };
}
