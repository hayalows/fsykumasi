import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("supabase/migrations/20260910081500_onsite_registration_flow_v31.sql", "utf8");
const parts = fs.readFileSync("src/pages/RegistrationJourneyPartsV4.jsx", "utf8");
const journey = fs.readFileSync("src/pages/RegistrationJourneyV29.jsx", "utf8");
const onsite = fs.readFileSync("src/lib/onsite.js", "utf8");
const registration = fs.readFileSync("src/pages/Registration.jsx", "utf8");
const workflow = fs.readFileSync("src/lib/registration-workflow-v30.js", "utf8");
const sw = fs.readFileSync("public/sw.js", "utf8");

test("on-site verification no longer auto-provisions structure", () => {
  const verifyStart = migration.indexOf("create or replace function public.verify_on_site_participant");
  const assignStart = migration.indexOf("create or replace function public.assign_participant_to_group");
  const verifyBody = migration.slice(verifyStart, assignStart);
  assert.ok(verifyStart >= 0);
  assert.ok(!verifyBody.includes("provision_supplemental_participant"));
  assert.match(verifyBody, /'next_step',case when p_approved then 'placement'/);
});

test("on-site placement keeps capacity and sex hard but waives unit duplication", () => {
  assert.match(migration, /target\.source_kind<>'on_site' and avoid_units/);
  assert.match(migration, /active_members>=max_size/);
  assert.match(migration, /target\.sex<>target_group\.sex/);
  assert.match(migration, /ensure_on_site_fsy_id/);
});

test("new on-site capture requires guardian phone and supports a second guardian", () => {
  assert.match(migration, /Add a parent or guardian phone number/);
  assert.match(migration, /contact_2_name,contact_2_phone/);
  assert.match(parts, /Parent \/ guardian phone<input required/);
  assert.match(parts, /Add another parent \/ guardian/);
  assert.match(onsite, /p_contact_2_phone: secondGuardianPhone/);
});

test("T-shirt sizes are selected from the approved five options", () => {
  for (const size of ["Small", "Medium", "Large", "Extra Large", "Extra Extra Large"]) {
    assert.ok(parts.includes(`\"${size}\"`));
  }
  assert.match(parts, /<select value=\{form\.tshirtSize\}/);
  assert.ok(!parts.includes("T-shirt size<input"));
});

test("settled roster preview does not rerun the planner", () => {
  const finalizedBranch = migration.indexOf("if final_row.id is not null then");
  const plannerCall = migration.indexOf("plan:=private.controlled_final_roster_plan_v3");
  assert.ok(finalizedBranch >= 0 && plannerCall > finalizedBranch);
  assert.match(migration, /'already_finalized',true/);
});

test("Registration hides misleading partial headline counts and resolved history blockers", () => {
  assert.ok(!registration.includes("registration-mode-summary"));
  assert.ok(!registration.includes("formatCount"));
  assert.match(workflow, /RESOLVED_HISTORY_REASONS/);
  assert.match(migration, /od\.cohort_state='excluded'/);
  assert.match(migration, /e\.eligible and p\.registration_status='awaiting'/);
});

test("unexpected database internals are not rendered directly in the participant flow", () => {
  assert.match(journey, /mutationErrorMessage/);
  assert.match(journey, /column reference\|ambiguous/);
  assert.ok(!journey.includes('setError(err.message||"That change could not be saved.")'));
});

test("v50 service worker forces installed clients onto the new Registration release", () => {
  assert.match(sw, /fsy-kumasi-shell-v50/);
});
