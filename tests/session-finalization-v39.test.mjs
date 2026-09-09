import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260909143500_session_finalization_v1.sql', 'utf8');
const authority = fs.readFileSync('supabase/migrations/20260909145000_final_roster_authority_v1.sql', 'utf8');
const registration = fs.readFileSync('src/pages/Registration.jsx', 'utf8');
const finalization = fs.readFileSync('src/pages/SessionFinalization.jsx', 'utf8');
const staffState = fs.readFileSync('src/lib/staff-state.js', 'utf8');
const staffSheet = fs.readFileSync('src/components/StaffOperationsSheet.jsx', 'utf8');
const resolution = fs.readFileSync('src/components/RegistrationLeadershipResolution.jsx', 'utf8');

test('finalization is additive and preserves source registration history', () => {
  assert.match(migration, /session_roster_finalizations/);
  assert.match(migration, /session_roster_freezes/);
  assert.match(migration, /set is_current=false,reconciliation_status='omitted'/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.participants/i);
  assert.doesNotMatch(migration, /set\s+registration_status\s*=\s*'approved'/i);
  assert.match(migration, /existing_placements_moved',0/);
});

test('finalization supports whole-session pre-session leaders', () => {
  for (const role of ['logistics_admin', 'coordinator', 'session_director']) {
    assert.match(migration, new RegExp(role));
    assert.match(authority, new RegExp(role));
  }
  assert.match(resolution, /\["session_director", "logistics_admin", "coordinator"\]/);
  assert.match(staffSheet, /\['session_director','logistics_admin','coordinator'\]/);
});

test('supplemental structure never republishes the baseline', () => {
  assert.match(migration, /Company '\|\|\(next_company\+i\)/);
  assert.match(migration, /YW Group '\|\|\(next_yw\+i\)/);
  assert.match(migration, /YM Group '\|\|\(next_ym\+i\)/);
  assert.match(migration, /where p\.id=m\.id/);
  assert.doesNotMatch(migration, /publish_grouping_plan/i);
});

test('staff and counselor coverage are completed inside the atomic batch', () => {
  assert.match(migration, /service_clearance='cleared'/);
  assert.match(migration, /tmp_open_groups/);
  assert.match(migration, /Counselor sex must match|ac\.sex='female'|ac\.sex='male'/);
  assert.match(migration, /staff_company_assignments/);
  assert.match(migration, /At least one published counselor group still lacks an available counselor/);
});

test('supplemental identities preserve existing IDs and tolerate one missing origin', () => {
  assert.match(migration, /not exists\(select 1 from public\.participant_badge_assignments/);
  assert.match(migration, /origin_code:='UNK'/);
  assert.match(migration, /Supplemental final roster · existing IDs preserved/);
});

test('Registration presents final roster as a first-class pre-session task', () => {
  assert.match(registration, /label: "Final roster"/);
  assert.match(registration, /<SessionFinalization/);
  assert.match(finalization, /ConfirmActionSheet/);
  assert.match(finalization, /Existing participant placements are not moved/);
  assert.match(finalization, /New participants or Staff are handled through the on-site registration flows/);
});

test('committee staff use a direct responsibility label', () => {
  assert.match(staffState, /staffResponsibilityLabel/);
  assert.match(staffState, /return `\$\{clean\.charAt\(0\)\.toUpperCase\(\)\}\$\{clean\.slice\(1\)\} committee`/);
  assert.match(staffSheet, /staffResponsibilityLabel/);
});
