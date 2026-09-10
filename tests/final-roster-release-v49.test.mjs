import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("controlled roster ward comparison treats the group unit set as a text array", () => {
  const sql = read("supabase/migrations/20260909235000_controlled_roster_unit_array_hotfix_v1.sql");
  assert.match(sql, /unit_key=any\(coalesce\(\(select g_target\.unit_keys/);
  assert.match(sql, /\{\}''::text\[\]/);
});

test("controlled roster apply lookups cannot collide with PLpgSQL variable names", () => {
  const lookup = read("supabase/migrations/20260909235500_controlled_roster_apply_lookup_hotfix_v1.sql");
  const counselor = read("supabase/migrations/20260909235800_controlled_roster_apply_variable_hotfix_v1.sql");
  assert.match(lookup, /m\.company_key=\(group_spec->>''company_key''\)/);
  assert.match(lookup, /m\.group_key=\(placement->>''target_group_key''\)/);
  assert.match(counselor, /execute ''update public\.counselor_groups set counselor_id=\$1 where id=\$2'' using counselor_id,group_id/);
});

test("missing production roster RPC is a friendly recoverable release state", () => {
  const source = read("src/lib/session-finalization.js");
  assert.match(source, /PGRST202/);
  assert.match(source, /FINAL_ROSTER_ENGINE_MISSING/);
  assert.match(source, /Final roster update is still syncing/);
  assert.doesNotMatch(source, /message:\s*raw\b/);
});

test("registration workspace uses a compact non-duplicated summary", () => {
  const source = read("src/pages/Registration.jsx");
  const css = read("src/pages/registration-workspace.css");
  assert.match(source, /showRecordCount/);
  assert.match(source, /Review the final plan, resolve only real blockers, then lock the roster/);
  assert.match(css, /grid-template-columns:\s*minmax\(390px, 510px\) minmax\(0, 1fr\)/);
  assert.match(css, /regjourney-solution-principle-v30[\s\S]*display:\s*none/);
});

test("final roster recovery and plan stay compact", () => {
  const css = read("src/pages/session-finalization.css");
  assert.match(css, /session-finalization-recovery-card[\s\S]*padding:\s*12px 13px/);
  assert.match(css, /session-finalization-sections[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /session-finalization-guard:not\(\.session-finalization-backup-card\)\s*\{\s*display:\s*none/);
});

test("PWA shell advances for the roster release", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /fsy-kumasi-shell-v49/);
});
