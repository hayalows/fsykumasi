import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260909143500_session_finalization_v1.sql', 'utf8');
const authority = fs.readFileSync('supabase/migrations/20260909145000_final_roster_authority_v1.sql', 'utf8');
const policyV2 = fs.readFileSync('supabase/migrations/20260909184719_final_roster_policy_v2.sql', 'utf8');
const settingsHotfix = fs.readFileSync('supabase/migrations/20260909200000_fix_final_roster_settings_reference.sql', 'utf8');
const arrivalPolicy = fs.readFileSync('supabase/migrations/20260909200500_hide_excluded_age20_arrival_roster.sql', 'utf8');
const reliability = fs.readFileSync('supabase/migrations/20260909203000_registration_checkin_reliability_v1.sql', 'utf8');
const registration = fs.readFileSync('src/pages/Registration.jsx', 'utf8');
const finalization = fs.readFileSync('src/pages/SessionFinalization.jsx', 'utf8');
const staffState = fs.readFileSync('src/lib/staff-state.js', 'utf8');
const staffSheet = fs.readFileSync('src/components/StaffOperationsSheet.jsx', 'utf8');
const resolution = fs.readFileSync('src/components/RegistrationLeadershipResolution.jsx', 'utf8');

test('finalization is additive and preserves source registration history', () => {
  assert.match(migration, /session_roster_finalizations/);
  assert.match(migration, /session_roster_freezes/);
  assert.doesNotMatch(migration, /set is_current=false,reconciliation_status='omitted'/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.participants/i);
  assert.doesNotMatch(migration, /set\s+registration_status\s*=\s*'approved'/i);
  assert.match(migration, /participant_operation_decisions/);
});

test('finalization supports whole-session pre-session leaders', () => {
  for (const role of ['logistics_admin', 'session_director']) {
    assert.match(migration, new RegExp(role));
    assert.match(authority, new RegExp(role));
  }
  assert.match(migration, /role::text in \('logistics_admin','session_director'\)/);
  assert.match(authority, /array\['logistics_admin','session_director'\]/);
  assert.match(resolution, /\["session_director", "logistics_admin", "coordinator", "area_advisory_couple"\]/);
  assert.match(staffSheet, /WHOLE_SESSION_LEADERS\s*=\s*\[\s*'session_director',\s*'logistics_admin',\s*'coordinator',\s*'area_advisory_couple'\s*\]/);
  assert.match(policyV2, /array\['coordinator','logistics_admin','session_director','area_advisory_couple'\]/);
});

test('supplemental structure never republishes the baseline', () => {
  assert.match(migration, /Company '\|\|\(next_company\+i\)/);
  assert.match(migration, /YW Group '\|\|\(next_yw\+i\)/);
  assert.match(migration, /YM Group '\|\|\(next_ym\+i\)/);
  assert.match(migration, /target_group_id/);
  assert.match(migration, /member_count/);
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

test('v2 roster policy allows 12–13 and awaiting participants while hiding 20+', () => {
  assert.match(policyV2, /between 12 and 19/);
  assert.match(policyV2, /p\.registration_status in \('approved','awaiting'\)/);
  assert.match(policyV2, /session_participant_age\(target_session,p\.id\)>=20 then false/);
  assert.match(policyV2, /get_participant_roster_v2/);
  assert.match(policyV2, /participant_operation_decisions/);
  assert.match(policyV2, /finalization_cohort/);
  assert.match(policyV2, /source registration retained/);
});

test('final-roster settings columns are qualified in both deployed functions', () => {
  assert.match(policyV2, /coalesce\(ss\.groups_per_company,2\)/g);
  assert.match(policyV2, /from public\.session_structure_settings ss where ss\.session_id=p_session_id/g);
  assert.match(settingsHotfix, /get_session_finalization_preview_v2/);
  assert.match(settingsHotfix, /apply_session_finalization_v2/);
  assert.match(settingsHotfix, /ss\.groups_per_company/);
  assert.match(reliability, /groups_per_company:=greatest\(coalesce\(groups_per_company,2\),1\)/g);
  assert.match(reliability, /Final-roster preview settings normalization is neither repaired nor repairable/);
  assert.match(reliability, /if replaced <> body then/);
});

test('registration actions keep the user informed while saving', () => {
  assert.match(staffSheet, /onSubmit=\{save\} noValidate/);
  assert.match(staffSheet, /type="submit"[^>]+className="primary"/);
  assert.match(staffSheet, /staff-status-v36-action-buttons/);
});

test('active arrival roster excludes age 20+ and locally excluded source records', () => {
  assert.match(arrivalPolicy, /coalesce\(od\.cohort_state,'normal'\)<>'excluded'/);
  assert.match(arrivalPolicy, /\) < 20/);
  assert.match(arrivalPolicy, /grant execute on function public\.get_arrival_reconciliation\(uuid\) to authenticated/);
});

test('finalization does not show a staffing error while its preview is unavailable', () => {
  assert.match(finalization, /const blocked = Boolean\(preview\) && !preview\?\.safe_to_apply/);
  assert.match(finalization, /participantBlockers/);
  assert.match(finalization, /assistantShortfall/);
});
