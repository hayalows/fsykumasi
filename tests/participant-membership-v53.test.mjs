import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const migration = read("supabase/migrations/20260911170000_participant_membership_checkin_v53.sql");
const helper = read("src/lib/participant-membership.js");
const journey = read("src/pages/RegistrationJourneyV53.jsx");
const journeyEntry = read("src/pages/RegistrationJourney.jsx");
const reports = read("src/lib/reports-v53.js");
const reportsEntry = read("src/pages/Reports.jsx");
const main = read("src/main.jsx");

const statuses = ["member_12_plus", "recent_convert", "non_member", "not_sure"];

test("membership capture is participant-only and stores a bounded category", () => {
  assert.match(migration, /create table if not exists public\.participant_membership_profiles/);
  assert.match(migration, /participant_id uuid primary key references public\.participants\(id\)/);
  assert.doesNotMatch(migration, /staff_id\s+uuid/i);
  assert.doesNotMatch(migration, /references public\.staff\(id\)/i);
  for (const status of statuses) assert.match(migration, new RegExp(`'${status}'`));
});

test("first arrival requires classification and atomic capture completes check-in", () => {
  assert.match(migration, /PARTICIPANT_MEMBERSHIP_STATUS_REQUIRED/);
  assert.match(migration, /create or replace function public\.record_participant_checkin_with_membership/);
  assert.match(migration, /perform public\.record_participant_checkin\(/);
  assert.match(migration, /on conflict \(participant_id\) do nothing/);
  assert.match(migration, /participant_membership_status_recorded/);
});

test("check-in UI asks only when the server reports missing membership status", () => {
  assert.match(journeyEntry, /RegistrationJourneyV53/);
  assert.match(journey, /requiresParticipantMembership\(err\)/);
  assert.match(journey, /setMembershipPrompt\(\{row,keepOpen\}\)/);
  assert.match(journey, /PARTICIPANT_MEMBERSHIP_OPTIONS\.map/);
  assert.match(journey, /recordParticipantMembershipCheckin/);
  assert.match(journey, /If you are unsure, choose “Not sure” instead of guessing\./);
  assert.match(helper, /Baptized at least 12 months ago/);
  assert.match(helper, /Baptized within the last 12 months/);
});

test("participant membership report is restricted, excludes staff, and remains exportable", () => {
  assert.match(migration, /private\.has_capability\(p_session_id, 'reports_export'\)/);
  assert.match(migration, /Checked-in participants only · staff excluded/);
  assert.match(migration, /where r\.checkin_status = 'arrived'/);
  assert.match(reports, /key: "participant_membership"/);
  assert.match(reports, /sensitive: true/);
  assert.match(reports, /loadParticipantMembershipReport/);
  assert.match(reportsEntry, /ReportsV53/);
});

test("membership UI styles are loaded by the production entrypoint", () => {
  assert.match(main, /participant-membership-v53\.css/);
});
