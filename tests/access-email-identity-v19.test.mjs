import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Access v19 is active and routine identity review is removed", async () => {
  const [wrapper, access] = await Promise.all([read("src/pages/Access.jsx"), read("src/pages/AccessV19.jsx")]);
  assert.match(wrapper, /AccessV19/);
  assert.match(access, /reconcileExistingStaffAccounts/);
  assert.match(access, /Syncing access/);
  assert.doesNotMatch(access, /AccessIdentityReviewV18/);
  assert.doesNotMatch(access, /Which Staff person is/);
  assert.doesNotMatch(access, /Review identity/);
});

test("Access v19 never uses names as an identity key", async () => {
  const access = await read("src/pages/AccessV19.jsx");
  assert.match(access, /Identity reconciliation is intentionally email-only/);
  assert.match(access, /normalizeEmail\(item\.accountEmail \|\| item\.email\) === email/);
  assert.doesNotMatch(access, /normalizeName/);
  assert.doesNotMatch(access, /sameName/);
  assert.doesNotMatch(access, /strongStaffMatch/);
});

test("new Staff setup allows an existing auth email while committee duplicates remain protected", async () => {
  const access = await read("src/pages/AccessV19.jsx");
  assert.match(access, /setupTarget\?\.newStaffOnly \? \[\] : knownAccounts/);
  assert.match(access, /newStaffOnly: true/);
  assert.match(access, /committeeOnly: true/);
  assert.match(access, /knownAccounts=\{setupKnownAccounts\}/);
});

test("database reconciliation uses exact leadership email and never a name match", async () => {
  const migration = await read("supabase/migrations/20260907171000_access_v19_email_identity_reconciliation.sql");
  assert.match(migration, /reconcile_existing_staff_account/);
  assert.match(migration, /normalized_email/);
  assert.match(migration, /exact_email_count/);
  assert.match(migration, /created_from_account/);
  assert.match(migration, /legacy_unique_email/);
  assert.match(migration, /Names remain display\/search data and are never used to decide identity/);
  assert.doesNotMatch(migration, /regexp_replace\(lower\(trim\(s\.full_name\)/);
});

test("Assistant Coordinator identity can be resolved without stealing conflicting company scope", async () => {
  const migration = await read("supabase/migrations/20260907171000_access_v19_email_identity_reconciliation.sql");
  assert.match(migration, /company_review := true/);
  assert.match(migration, /safe_to_sync := false/);
  assert.match(migration, /legacy_scope_preserved/);
  assert.match(migration, /staff_company_access_sync/);
  assert.match(migration, /sync_staff_login_access/);
});

test("Access v19 keeps one primary task and treats unreconciled legacy data as repair, not identity selection", async () => {
  const access = await read("src/pages/AccessV19.jsx");
  assert.match(access, /Account repair needed/);
  assert.match(access, /Retry repair/);
  assert.match(access, /Choose companies/);
  assert.match(access, />Invite</);
  assert.match(access, />Enable</);
  assert.match(access, /staff-access-more/);
  assert.match(access, /Recovery/);
});

test("Access v19 ships a fresh PWA shell", async () => {
  const sw = await read("public/sw.js");
  assert.match(sw, /fsy-kumasi-shell-v41/);
  assert.match(sw, /Access operations v19/);
  assert.match(sw, /email-first identity reconciliation/);
  assert.match(sw, /skipWaiting/);
  assert.match(sw, /clients\.claim/);
});
