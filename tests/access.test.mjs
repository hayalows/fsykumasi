import test from "node:test";
import assert from "node:assert/strict";
import { canApproveAccess, hasSessionWideVisibility, REQUESTABLE_ROLES } from "../src/lib/access.js";

test("coordinators have session-wide visibility", () => {
  assert.equal(hasSessionWideVisibility("coordinator"), true);
});

test("full session administrators can manage website access", () => {
  assert.equal(canApproveAccess("coordinator"), true);
  assert.equal(canApproveAccess("logistics_admin"), true);
  assert.equal(canApproveAccess("session_director"), true);
  assert.equal(canApproveAccess("assistant_coordinator"), false);
});

test("explicit access_admin still works for compatible legacy assignments", () => {
  assert.equal(canApproveAccess("committee_viewer", ["access_admin"]), true);
  assert.equal(canApproveAccess("assistant_coordinator", []), false);
});

test("top-level roles cannot be self-requested", () => {
  assert.deepEqual(REQUESTABLE_ROLES, ["assistant_coordinator", "coordinator", "committee_viewer"]);
});
