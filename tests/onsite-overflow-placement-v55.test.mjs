import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260912125500_onsite_overflow_placement_v55.sql', 'utf8');
const onsite = fs.readFileSync('src/lib/onsite.js', 'utf8');
const picker = fs.readFileSync('src/pages/RegistrationGroupPickerV55.jsx', 'utf8');
const parts = fs.readFileSync('src/pages/RegistrationJourneyPartsV4.jsx', 'utf8');
const workspace = fs.readFileSync('src/lib/registration-workspace-v29.js', 'utf8');

test('registration placement options expose live capacity and counselor readiness', () => {
  assert.match(migration, /get_registration_placement_groups_v1/);
  assert.match(migration, /member_count integer/);
  assert.match(migration, /max_size integer/);
  assert.match(migration, /counselor_ready boolean/);
  assert.match(migration, /st\.registration_status='approved'/);
  assert.match(migration, /service_clearance,'confirmation_required'\)='cleared'/);
  assert.match(migration, /arrival_state,'expected'\) in \('expected','arrived'\)/);
});

test('normal placement rejects unpublished, full, mismatched or unstaffed groups on the server', () => {
  assert.match(migration, /target_group\.state<>'published'/);
  assert.match(migration, /target\.sex<>target_group\.sex/);
  assert.match(migration, /target_group\.counselor_id is null/);
  assert.match(migration, /active_members>=max_size/);
  assert.match(migration, /does not have a ready counselor/);
});

test('overflow placement is review first and only available to verified on-site participants', () => {
  assert.match(migration, /preview_onsite_supplemental_placement_v1/);
  assert.match(migration, /apply_onsite_supplemental_placement_v1/);
  assert.match(migration, /target\.source_kind<>'on_site'/);
  assert.match(migration, /operational_participant_is_eligible/);
  assert.match(migration, /regular_space_available/);
  assert.match(migration, /Nothing is created until you confirm|Explicit audited on-site overflow placement/i);
  assert.match(picker, /Review overflow option/);
  assert.match(picker, /Create & place/);
});

test('overflow apply rechecks the suggested staff under a session lock and records an audit event', () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /p_expected_counselor_id/);
  assert.match(migration, /p_expected_assistant_id/);
  assert.match(migration, /suggested counselor changed/);
  assert.match(migration, /suggested Assistant Coordinator changed/);
  assert.match(migration, /onsite_overflow_placement_applied/);
  assert.match(migration, /perform public\.assign_participant_to_group/);
});

test('client loads authoritative placement rows instead of trusting stale group counts', () => {
  assert.match(onsite, /loadRegistrationPlacementGroups/);
  assert.match(onsite, /get_registration_placement_groups_v1/);
  assert.match(onsite, /maxSize: Number\(row\.max_size \|\| 10\)/);
  assert.match(onsite, /counselorReady: Boolean\(row\.counselor_ready\)/);
  assert.match(workspace, /sessionId,/);
  assert.match(picker, /loadRegistrationPlacementGroups\(row\.sessionId\)/);
  assert.match(picker, /group\.state === "published"/);
  assert.match(picker, /group\.counselorReady === true/);
});

test('search misses do not masquerade as full capacity', () => {
  assert.match(picker, /noSearchMatch/);
  assert.match(picker, /No matching groups/);
  assert.match(picker, /noStandardSpace/);
  assert.match(picker, /No standard counselor group has space/);
  assert.match(picker, /Live placement data did not load/);
});

test('the registration journey uses the v55 reviewed picker', () => {
  assert.match(parts, /RegistrationGroupPickerV55/);
  assert.match(parts, /<GroupPickerV55 \{\.\.\.props\} \/>/);
});
