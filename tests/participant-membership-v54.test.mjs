import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const migration = read("supabase/migrations/20260911173000_participant_membership_confirm_undo_v54.sql");
const helper = read("src/lib/participant-membership.js");
const journey = read("src/pages/RegistrationJourneyV53.jsx");
const registration = read("src/pages/Registration.jsx");
const styles = read("src/participant-membership-v54.css");

test("membership choice is selected first and saved only by the explicit check-in action", () => {
  assert.match(journey, /setMembershipChoice\(option\.value\)/);
  assert.match(journey, /Save & check in/);
  assert.match(journey, /disabled=\{!membershipChoice\|\|busyId===membershipPrompt\.row\.participantId\}/);
  assert.match(journey, /role="radiogroup"/);
  assert.match(journey, /role="radio"/);
  assert.match(journey, /aria-checked=\{membershipChoice===option\.value\}/);
  assert.doesNotMatch(journey, /onClick=\{\(\)=>chooseMembership\(option\.value\)\}/);
});

test("membership-aware check-in returns the server timestamp used by safe undo", () => {
  assert.match(migration, /record_participant_checkin_with_membership_v2/);
  assert.match(migration, /'recorded_at', checkin_at/);
  assert.match(helper, /recorded_at \|\| row\.recordedAt/);
  assert.match(journey, /checkinSuccess\(row,state,keepOpen\)/);
});

test("undo reverses membership only when that exact check-in created it", () => {
  assert.match(migration, /created_checkin_recorded_at/);
  assert.match(migration, /undo_participant_checkin_with_membership_v2/);
  assert.match(migration, /perform|undo_result := public\.undo_participant_checkin/);
  assert.match(migration, /participant_membership_status_reverted/);
  assert.match(helper, /undoParticipantMembershipCheckin/);
  assert.match(registration, /membershipAwareUndo/);
  assert.match(journey, /Membership status was removed/);
});

test("the deliberate selection state is visible and mobile actions remain touch friendly", () => {
  assert.match(styles, /aria-checked="true"/);
  assert.match(styles, /participant-membership-choice-indicator-v54/);
  assert.match(styles, /min-height: 50px/);
  assert.match(styles, /@media \(max-width: 430px\)/);
});
