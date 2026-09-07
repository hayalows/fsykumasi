import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Access v17 renders one people directory with a small work queue", async () => {
  const [wrapper, access] = await Promise.all([read("src/pages/Access.jsx"), read("src/pages/AccessV17.jsx")]);
  assert.match(wrapper, /AccessV17/);
  assert.match(access, /reconcileAccessPeople/);
  assert.match(access, /Needs attention/);
  assert.match(access, /Everyone/);
  assert.match(access, /Current staff, committee members and existing sign-ins appear as one person each/);
  assert.doesNotMatch(access, /Older & unmatched access/);
  assert.doesNotMatch(access, /Move to new system/);
});

test("existing sign-ins are reconciled with matching Staff and stale invites by identity", async () => {
  const access = await read("src/pages/AccessV17.jsx");
  assert.match(access, /strongStaffMatch/);
  assert.match(access, /connectionConfidence/);
  assert.match(access, /normalizeEmail\(item\.accountEmail \|\| item\.email\) === email/);
  assert.match(access, /mergeInvite\(people\[index\], invite, true\)/);
  assert.match(access, /Existing sign-in needs connecting/);
  assert.match(access, /Connect account/);
});

test("existing-account migration keeps the sign-in and progressively discloses identity choices", async () => {
  const component = await read("src/components/LegacyAccessMigrationV17.jsx");
  assert.match(component, /Keep the account they already use/);
  assert.match(component, /Recommended match/);
  assert.match(component, /Choose a different Staff record/);
  assert.match(component, /Person is not in Staff/);
  assert.match(component, /Add to Staff & connect/);
  assert.doesNotMatch(component, /Email address/);
  assert.doesNotMatch(component, /Create a new account/);
});

test("legacy adoption treats an exact email match as a Staff connection instead of a duplicate error", async () => {
  const migration = await read("supabase/migrations/20260907123500_access_v17_existing_account_connection.sql");
  assert.match(migration, /email_match_count/);
  assert.match(migration, /email_match_count = 1/);
  assert.match(migration, /select s\.\* into target/);
  assert.match(migration, /Existing-account migration should treat an exact email match as evidence of identity/);
  assert.match(migration, /already connected to another sign-in/);
  assert.match(migration, /perform private\.sync_staff_login_access\(target\.id\)/);
});

test("Access v17 uses progressive filters and keeps online activity separate from access state", async () => {
  const [access, css] = await Promise.all([read("src/pages/AccessV17.jsx"), read("src/access-operations-v17.css")]);
  assert.match(access, /access-v17-tabs/);
  assert.match(access, /access-v17-filters/);
  assert.match(access, /statusFilter/);
  assert.match(access, /roleFilter/);
  assert.match(access, /onlineUserIds/);
  assert.match(css, /access-v17-filter-popover/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /position:fixed/);
});

test("each person row exposes one main task while secondary actions stay under More", async () => {
  const access = await read("src/pages/AccessV17.jsx");
  assert.match(access, /const primary = canConnect/);
  assert.match(access, /Choose companies/);
  assert.match(access, />Invite</);
  assert.match(access, />Enable</);
  assert.match(access, /staff-access-more/);
  assert.match(access, /Recovery/);
  assert.match(access, /Disable sign-in/);
  assert.match(access, /Remove old access/);
});

test("Access v17 ships with a fresh PWA shell so existing clients update", async () => {
  const sw = await read("public/sw.js");
  assert.match(sw, /fsy-kumasi-shell-v39/);
  assert.match(sw, /Access operations v17/);
  assert.match(sw, /skipWaiting/);
  assert.match(sw, /clients\.claim/);
});
