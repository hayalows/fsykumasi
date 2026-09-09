import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const controlled = fs.readFileSync('supabase/migrations/20260909223000_controlled_final_roster_rebalance_v1.sql', 'utf8');
const ageGuard = fs.readFileSync('supabase/migrations/20260909223500_controlled_roster_age_guard_v1.sql', 'utf8');
const client = fs.readFileSync('src/lib/session-finalization.js', 'utf8');
const page = fs.readFileSync('src/pages/SessionFinalization.jsx', 'utf8');
const css = fs.readFileSync('src/pages/session-finalization.css', 'utf8');
const agents = fs.readFileSync('AGENTS.md', 'utf8');

test('controlled closeout supersedes the old supplemental-only strategy with age 12-18', () => {
  assert.match(controlled, /controlled-v3-12-18/);
  assert.match(controlled, /between 12 and 18/);
  assert.match(controlled, /participant_min_age,participant_max_age/);
  assert.match(controlled, /values\(p_session_id,12,18/);
  assert.match(controlled, /age_policy_excluded/);
  assert.doesNotMatch(controlled, /delete\s+from\s+public\.participants/i);
  assert.match(agents, /supersedes the earlier additive 12–19 supplemental-closeout rules/i);
});

test('planner starts from published placements and creates only the mathematically necessary structure', () => {
  assert.match(controlled, /valid_group_id/);
  assert.match(controlled, /target_female_groups/);
  assert.match(controlled, /target_male_groups/);
  assert.match(controlled, /new_female_groups:=greatest\(target_female_groups-existing_female_groups,0\)/);
  assert.match(controlled, /new_male_groups:=greatest\(target_male_groups-existing_male_groups,0\)/);
  assert.match(controlled, /tmp_cr_company_capacity/);
  assert.match(controlled, /free_groups/);
  assert.match(controlled, /new_companies:=company_seq/);
});

test('same ward or branch cannot repeat in a counselor group', () => {
  assert.match(controlled, /avoid_same_unit/);
  assert.match(controlled, /unit_key=any\(g\.unit_keys\)/);
  assert.match(controlled, /duplicate ward\/branch membership/);
  assert.match(controlled, /baseline_unit_conflicts/);
});

test('existing placements move only to satisfy the configured minimum and donor moves prefer the same company', () => {
  assert.match(controlled, /member_count<min_size/);
  assert.match(controlled, /assignment_kind='moved'/);
  assert.match(controlled, /c\.original_company_id=\(select company_id from tmp_cr_groups where group_key=new_group_row\.group_key\) then 0 else 1/);
  assert.match(controlled, /existing_placements_moved/);
});

test('existing FSY IDs survive same-company group changes and company changes are explicitly replaced', () => {
  assert.match(controlled, /badge_row\.company_id=target_company_id/);
  assert.match(controlled, /update public\.participant_badge_assignments set group_id=target_group_id/);
  assert.match(controlled, /Retired by controlled final-roster company change/);
  assert.match(controlled, /Controlled final-roster replacement/);
  assert.match(controlled, /participant_badge_id_history/);
  assert.match(controlled, /badge_ids_preserved/);
  assert.match(controlled, /badge_ids_changed/);
  assert.match(controlled, /new_ids_issued/);
});

test('a complete operational rollback point is saved before apply and again before restore', () => {
  assert.match(controlled, /create table if not exists public\.session_roster_versions/);
  for (const key of [
    'participant_state', 'participant_decisions', 'companies', 'groups', 'badges',
    'badge_history', 'staff_company_assignments', 'staff_operations', 'settings',
    'finalization', 'freeze',
  ]) assert.match(controlled, new RegExp(`'${key}'`));
  assert.match(controlled, /Before controlled final roster/);
  assert.match(controlled, /Before roster restore/);
  assert.match(controlled, /pre_restore_version/);
});

test('apply and restore refuse to overwrite live operational work', () => {
  assert.match(controlled, /Reset all live check-ins before applying the controlled final roster/);
  assert.match(controlled, /Reset all live check-ins before restoring a saved roster version/);
  assert.match(controlled, /Active Housing assignments exist/);
  assert.match(controlled, /Head-count history references a company created after this version/);
  assert.match(client, /FINAL_ROSTER_LIVE_CHECKINS/);
  assert.match(client, /FINAL_ROSTER_HOUSING_ACTIVE/);
  assert.match(client, /FINAL_ROSTER_HEADCOUNT_DEPENDENCY/);
});

test('badge activation follows the session age policy across every participant badge path', () => {
  assert.match(ageGuard, /enforce_active_participant_badge_policy_v1/);
  assert.match(ageGuard, /new\.state='retired'/);
  assert.match(ageGuard, /private\.operational_participant_is_eligible\(new\.session_id,new\.participant_id\)/);
  assert.match(ageGuard, /before insert or update of session_id,participant_id,state/);
});

test('the frontend uses only the controlled v3 preview/apply path and exposes roster versions', () => {
  assert.match(client, /get_controlled_final_roster_preview_v3/);
  assert.match(client, /apply_controlled_final_roster_rebalance_v3/);
  assert.match(client, /save_session_roster_version_v1/);
  assert.match(client, /list_session_roster_versions_v1/);
  assert.match(client, /restore_session_roster_version_v1/);
  assert.doesNotMatch(client, /get_session_finalization_preview_v2/);
  assert.doesNotMatch(client, /apply_session_finalization_v2/);
});

test('final roster UI makes movement, added structure, ID impact and rollback visible before confirmation', () => {
  assert.match(page, /Existing placements moved/);
  assert.match(page, /Groups to add/);
  assert.match(page, /Companies to add/);
  assert.match(page, /Existing FSY IDs preserved/);
  assert.match(page, /Save current roster/);
  assert.match(page, /Saved roster versions/);
  assert.match(page, /Restore saved roster/);
  assert.match(page, /Nothing is applied by this preview/);
  assert.match(css, /session-finalization-backup-card/);
  assert.match(css, /session-roster-versions/);
});
