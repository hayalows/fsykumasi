import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/20260911173000_participant_membership_profile_v1.sql", "utf8");
const membership = fs.readFileSync("src/lib/membership.js", "utf8");
const panel = fs.readFileSync("src/components/ParticipantMembershipPanel.jsx", "utf8");
const registration = fs.readFileSync("src/pages/Registration.jsx", "utf8");
const personPeek = fs.readFileSync("src/components/PersonPeek.jsx", "utf8");

test("membership classification is participant-only and stores no baptism date", () => {
  assert.match(migration, /references public\.participants\(id\)/);
  assert.doesNotMatch(migration, /references public\.staff\(id\)/);
  assert.doesNotMatch(migration, /baptism_date|confirmation_date/i);
  for (const status of ["non_member", "recent_convert", "member_12_plus", "unconfirmed"]) {
    assert.ok(migration.includes(status));
    assert.ok(membership.includes(status));
  }
});

test("sensitive membership table has no direct authenticated access", () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.participant_membership_profiles from public, anon, authenticated/);
  assert.match(migration, /private\.can_read_participant_membership/);
  assert.match(migration, /private\.can_access_company/);
});

test("membership status changes require registration or scoped check-in access", () => {
  const setterStart = migration.indexOf("create or replace function public.set_participant_membership_status");
  const summaryStart = migration.indexOf("create or replace function public.get_participant_membership_summary");
  const setter = migration.slice(setterStart, summaryStart);
  assert.match(setter, /registration_manage/);
  assert.match(setter, /checkin_record/);
  assert.match(setter, /private\.can_access_company/);
  assert.match(setter, /participant_membership_status_updated/);
});

test("membership status never changes participant check-in eligibility", () => {
  assert.doesNotMatch(migration, /create or replace function public\.record_participant_checkin/);
  assert.match(panel, /never changes check-in eligibility/);
});

test("Registration exposes a compact participant membership workflow", () => {
  assert.match(registration, /ParticipantMembershipPanel/);
  assert.match(panel, /Participant membership/);
  assert.match(panel, /Recent convert · under 12 months/);
  assert.match(panel, /Member · 12\+ months/);
  assert.match(panel, /Not confirmed/);
  assert.match(panel, /Do not guess from ward, surname or registration history/);
  assert.match(panel, /Tap one option\. It saves immediately/);
});

test("staff person peek never receives a membership label", () => {
  assert.match(personPeek, /identity\?\.kind==='participant'\?membershipByParticipant\.get\(identity\.id\):null/);
  assert.match(personPeek, /\['Church membership',participantMembership\?membershipLabel\(participantMembership\.status\):null\]/);
});

test("end-of-session membership reporting stays aggregate", () => {
  assert.match(migration, /get_participant_membership_summary/);
  assert.match(migration, /roster_count integer/);
  assert.match(migration, /checked_in_count integer/);
  assert.match(panel, /Aggregate report/);
  assert.match(panel, /Names are left out/);
  assert.match(panel, /downloadCsv\("Participant membership summary"/);
  assert.match(panel, /Print \/ PDF/);
});
