export const ROLE_META = {
  assistant_coordinator: {
    label: "Assistant coordinator",
    visibility: "Assigned companies",
    canApproveAccess: false,
    rank: 1,
  },
  committee_viewer: {
    label: "Committee viewer",
    visibility: "Assigned committee scope",
    canApproveAccess: false,
    rank: 1,
  },
  coordinator: {
    label: "Coordinator",
    visibility: "Whole session",
    canApproveAccess: true,
    rank: 3,
  },
  logistics_admin: {
    label: "Logistical administrator",
    visibility: "Whole session",
    canApproveAccess: true,
    rank: 3,
  },
  session_director: {
    label: "Session directing couple",
    visibility: "Whole session",
    canApproveAccess: true,
    rank: 3,
  },
};

export const REQUESTABLE_ROLES = ["assistant_coordinator", "coordinator", "committee_viewer"];

export function roleLabel(role) {
  return ROLE_META[role]?.label || role;
}

export function roleVisibility(role) {
  return ROLE_META[role]?.visibility || "Assigned scope";
}

export function canApproveAccess(role, capabilities = []) {
  return Boolean(ROLE_META[role]?.canApproveAccess || capabilities.includes("access_admin"));
}

export function hasSessionWideVisibility(role) {
  return ["coordinator", "logistics_admin", "session_director"].includes(role);
}
