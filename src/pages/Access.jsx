// Historical Access implementations remain in the repository for regression coverage.
// Access v18 keeps one person per row, reconciles existing staff-level sign-ins automatically,
// searches current Staff before creating anyone new, and asks for identity help only on real conflicts.
export { Access, createInitialAccessRequests } from "./AccessV18.jsx";
