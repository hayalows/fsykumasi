export const WORKSPACE_VIEWS = [
  "overview",
  "registration",
  "people",
  "assignments",
  "birthdays",
  "groups",
  "headcount",
  "housing",
  "wellness",
  "food",
  "reports",
  "profile",
  "access",
];

const viewSet = new Set(WORKSPACE_VIEWS);
const NAV_KEYS = ["view", "mode", "tab", "filter", "person", "staff", "company", "group"];

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeContext(source = {}) {
  const requestedView = clean(source.view);
  return {
    view: viewSet.has(requestedView) ? requestedView : "overview",
    mode: clean(source.mode),
    tab: clean(source.tab),
    filter: clean(source.filter),
    personId: clean(source.personId || source.person),
    staffId: clean(source.staffId || source.staff),
    companyId: clean(source.companyId || source.company),
    groupId: clean(source.groupId || source.group),
  };
}

export function normalizeWorkspaceDestination(destination = {}) {
  const source = typeof destination === "string" ? { view: destination } : destination || {};
  const legacyCheckin = source.view === "checkin";
  const requestedView = legacyCheckin ? "registration" : clean(source.view);
  const returnTo = source.returnTo && typeof source.returnTo === "object" ? normalizeContext(source.returnTo) : null;
  return {
    view: viewSet.has(requestedView) ? requestedView : "overview",
    mode: legacyCheckin ? "desk" : clean(source.mode),
    tab: clean(source.tab),
    filter: clean(source.filter),
    personId: clean(source.personId || source.person),
    staffId: clean(source.staffId || source.staff),
    companyId: clean(source.companyId || source.company),
    groupId: clean(source.groupId || source.group),
    returnTo,
    legacyCheckin,
  };
}

export function readWorkspaceLocation() {
  if (typeof window === "undefined") return normalizeWorkspaceDestination({ view: "overview" });
  const params = new URLSearchParams(window.location.search);
  const state = window.history?.state && typeof window.history.state === "object" ? window.history.state : {};
  return normalizeWorkspaceDestination({
    view: params.get("view") || "overview",
    mode: params.get("mode") || "",
    tab: params.get("tab") || "",
    filter: params.get("filter") || "",
    person: params.get("person") || "",
    staff: params.get("staff") || "",
    company: params.get("company") || "",
    group: params.get("group") || "",
    returnTo: state.returnTo || null,
  });
}

export function writeWorkspaceLocation(destination, options = {}) {
  if (typeof window === "undefined") return;
  const next = normalizeWorkspaceDestination(
    typeof destination === "string" ? { view: destination, ...options } : { ...(destination || {}), ...options },
  );
  const url = new URL(window.location.href);
  NAV_KEYS.forEach((key) => url.searchParams.delete(key));
  if (next.view !== "overview") url.searchParams.set("view", next.view);
  if (next.mode) url.searchParams.set("mode", next.mode);
  if (next.tab) url.searchParams.set("tab", next.tab);
  if (next.filter) url.searchParams.set("filter", next.filter);
  if (next.view === "people" && next.personId) url.searchParams.set("person", next.personId);
  if (next.staffId) url.searchParams.set("staff", next.staffId);
  if (next.companyId) url.searchParams.set("company", next.companyId);
  if (next.groupId) url.searchParams.set("group", next.groupId);
  const href = `${url.pathname}${url.search}${url.hash}`;
  window.history[options.replace || next.replace ? "replaceState" : "pushState"](next, "", href);
}
