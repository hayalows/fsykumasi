import test from "node:test";
import assert from "node:assert/strict";
import { canApproveAccess, hasSessionWideVisibility, REQUESTABLE_ROLES } from "../src/lib/access.js";

test("coordinators have session-wide visibility", () => {
  assert.equal(hasSessionWideVisibility("coordinator"), true);
});

test("only logistics admins and session directors approve lower-role access", () => {
  assert.equal(canApproveAccess("logistics_admin"), true);
  assert.equal(canApproveAccess("session_director"), true);
  assert.equal(canApproveAccess("coordinator"), false);
  assert.equal(canApproveAccess("assistant_coordinator"), false);
});

test("a coordinator needs the explicit access_admin capability", () => {
  assert.equal(canApproveAccess("coordinator", []), false);
  assert.equal(canApproveAccess("coordinator", ["access_admin"]), true);
  assert.equal(canApproveAccess("assistant_coordinator", ["access_admin"]), false);
});

test("top-level roles cannot be self-requested", () => {
  assert.deepEqual(REQUESTABLE_ROLES, ["assistant_coordinator", "coordinator", "committee_viewer"]);
});
