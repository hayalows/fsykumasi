export const WORKSPACE_VIEWS = [
  "overview",
  "registration",
  "people",
  "assignments",
  "birthdays",
  "groups",
  "checkin",
  "headcount",
  "profile",
  "access",
];

const viewSet = new Set(WORKSPACE_VIEWS);

export function readWorkspaceLocation() {
  if (typeof window === "undefined") return { view: "overview", personId: "" };
  const params = new URLSearchParams(window.location.search);
  const requestedView = params.get("view");
  return {
    view: viewSet.has(requestedView) ? requestedView : "overview",
    personId: params.get("person") || "",
  };
}

export function writeWorkspaceLocation(view, { personId = "", replace = false } = {}) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (view && view !== "overview") url.searchParams.set("view", view);
  else url.searchParams.delete("view");
  if (view === "people" && personId) url.searchParams.set("person", personId);
  else url.searchParams.delete("person");
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history[replace ? "replaceState" : "pushState"]({ view, personId }, "", next);
}
