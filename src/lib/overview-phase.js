export const SESSION_TIME_ZONE = "Africa/Accra";

function sourceDateKey(value) {
  if (!value) return "";
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function localDateKey(value = new Date(), timeZone = SESSION_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return sourceDateKey(value);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  const year = pick("year"); const month = pick("month"); const day = pick("day");
  return year && month && day ? `${year}-${month}-${day}` : "";
}

function dayNumber(key) {
  const match = String(key || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return NaN;
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000);
}

function daysBetween(fromKey, toKey) {
  const from = dayNumber(fromKey); const to = dayNumber(toKey);
  return Number.isFinite(from) && Number.isFinite(to) ? to - from : NaN;
}

export function sessionDayContext({ startsOn, endsOn, now = new Date(), timeZone = SESSION_TIME_ZONE }) {
  const today = localDateKey(now, timeZone); const start = sourceDateKey(startsOn); const end = sourceDateKey(endsOn);
  if (!start || !today) return { phase: "unknown", label: "Session", detail: "", compact: "Session", dayNumber: null, daysUntilStart: null };

  const untilStart = daysBetween(today, start);
  if (untilStart > 1) return { phase: "pre_session", label: `Starts in ${untilStart} days`, detail: "Preparation", compact: `Starts in ${untilStart} days`, dayNumber: null, daysUntilStart: untilStart };
  if (untilStart === 1) return { phase: "pre_session", label: "Day 0", detail: "Session starts tomorrow", compact: "Day 0 · Starts tomorrow", dayNumber: 0, daysUntilStart: 1 };

  if (untilStart === 0) return { phase: "arrival", label: "Day 1", detail: "Arrival & check-in", compact: "Day 1 · Arrival & check-in", dayNumber: 1, daysUntilStart: 0 };

  if (end && today > end) return { phase: "post_session", label: "Session complete", detail: "KCC FSY 2026", compact: "Session complete", dayNumber: null, daysUntilStart: 0 };

  const index = daysBetween(start, today) + 1;
  const day = Number.isFinite(index) && index > 0 ? index : null;
  const isCheckout = Boolean(end && today === end);
  const isFinalProgramDay = Boolean(end && daysBetween(today, end) === 1);
  const detail = isCheckout ? "Checkout & wrap-up" : isFinalProgramDay ? "Final program day" : "Session live";
  return {
    phase: "live",
    label: day ? `Day ${day}` : "Session live",
    detail,
    compact: day ? `Day ${day} · ${detail}` : detail,
    dayNumber: day,
    daysUntilStart: 0,
  };
}

export function sessionPhase({ startsOn, endsOn, now = new Date(), timeZone = SESSION_TIME_ZONE }) {
  return sessionDayContext({ startsOn, endsOn, now, timeZone }).phase;
}

export function phaseLabel(phase) {
  return phase === "pre_session" ? "Pre-session" : phase === "arrival" ? "Arrival day" : phase === "live" ? "Session live" : phase === "post_session" ? "Session complete" : "Session";
}

export function shapeOverviewForPhase(summary = {}, phase = "unknown") {
  if (phase !== "pre_session") return summary;
  return { ...summary,
    session: { ...(summary.session || {}), checkedIn: 0, recentArrivals: 0 },
    registration: { ...(summary.registration || {}), ready: 0, arrived: 0 },
    housing: { ...(summary.housing || {}), waiting: 0 },
    headcount: {}, wellness: { ...(summary.wellness || {}), open: 0 },
    food: { ...(summary.food || {}), remaining: 0, serviceStatus: "planned" },
  };
}

export function preSessionArea(summary = {}) {
  const registration = summary.registration || {}, scope = summary.scope || {}, access = summary.access || {};
  return { areaTitle: "Pre-session readiness", areaDetail: "Preparation issues take priority until the session starts. Test check-ins and live-day signals stay out of the way.", metrics: [{ label: "Registration review", value: Number(registration.attention || 0), attention: Number(registration.attention || 0) > 0 }, { label: "Uncovered groups", value: Number(scope.uncoveredGroups || 0), attention: Number(scope.uncoveredGroups || 0) > 0 }, { label: "Access setup", value: Number(access.pending || 0), attention: Number(access.pending || 0) > 0 }, { label: "Companies", value: Number(scope.companyCount || 0) }] };
}
