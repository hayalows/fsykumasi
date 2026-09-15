import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260915130000_fix_leader_email_validation_v84.sql");
const setupFlow = read("src/components/LeaderSetupFlow.jsx");
const app = read("src/App.jsx");
const invites = read("src/lib/invites.js");

test("leader invite email validation accepts ordinary addresses without backslash ambiguity", () => {
  const safePattern = "^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$";
  assert.equal((migration.match(new RegExp(safePattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length, 2);
  assert.match(migration, /create or replace function public\.create_staff_leader_invite/i);
  assert.match(migration, /create or replace function public\.create_leader_invite/i);
});

test("staff invite detects an existing FSY account instead of treating the email as unusable", () => {
  assert.match(migration, /from public\.profiles p where lower\(trim\(coalesce\(p\.email,''\)\)\) = normalized_email/i);
  assert.match(migration, /existing_account boolean/i);
  assert.match(setupFlow, /created\.invite\.existingAccount/);
});

test("an already signed-in matching account can claim the setup code and connect access", () => {
  assert.match(invites, /claim_leader_invite_authenticated/);
  assert.match(app, /InviteClaimScreen/);
  assert.match(app, /claimInviteWhileSignedIn/);
  assert.match(app, /initialCode=\{initialInvite\}/);
});
