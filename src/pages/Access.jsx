// AccessV17 remains in the repository for historical regression coverage. AccessV18 remains too.
// Access v19 treats auth user_id + email as website identity, keeps names out of identity matching,
// reconciles existing staff-level sign-ins in the database, and asks admins only for real setup work.
export { Access, createInitialAccessRequests } from "./AccessV19.jsx";
