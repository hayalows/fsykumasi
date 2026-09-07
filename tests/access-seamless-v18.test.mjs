import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Access v18 is active while AccessV17 remains available for historical coverage", async () => {
  const wrapper = await read("src/pages/Access.jsx");
  assert.match(wrapper, /AccessV17 remain/);
  assert.match(wrapper, /AccessV18/);
});

test("existing staff-level sign-ins are reconciled automatically before normal Access work is shown", async () => {
  const access = await read("src/pages/AccessV18.jsx");
  assert.match(access, /Preparing access/);
  assert.match(access, /adoptLegacyAccessAccount/);
  assert.match(access, /strongStaffMatch/);
  assert.match(access, /createManualStaffLeader/);
  assert.match(access, /safeMissingAc/);
  assert.match(access, /await onRefreshRoster/);
  assert.doesNotMatch(access, /Move this account to Staff/);
  assert.doesNotMatch(access, /Is this person already in Staff/);
  assert.doesNotMatch(access, />Connect account</);
});

test("identity review is reserved for unresolved conflicts and keeps the existing sign-in", async () => {
  const review = await read("src/components/AccessIdentityReviewV18.jsx");
  assert.match(review, /Identity review/);
  assert.match(review, /already has an FSY sign-in/);
  assert.match(review, /real identity conflict/);
  assert.match(review, /This password and account will be kept/);
  assert.match(review, /Already connected to another sign-in/);
  assert.match(review, /Use selected Staff record/);
});

test("Add access searches existing Staff before offering to create a new person", async () => {
  const add = await read("src/components/AccessAddFlowV18.jsx");
  assert.match(add, /Current Staff without website access/);
  assert.match(add, /use their existing Staff record instead of creating another one/);
  assert.match(add, /Add new Staff person/);
  assert.match(add, /Committee-only access/);
  assert.match(add, /Search Staff/);
});

test("Access v18 keeps people-first progressive controls and one primary row task", async () => {
  const [access, css] = await Promise.all([read("src/pages/AccessV18.jsx"), read("src/access-operations-v18.css")]);
  assert.match(access, /Needs attention/);
  assert.match(access, /Everyone/);
  assert.match(access, /Review identity/);
  assert.match(access, /Choose companies/);
  assert.match(access, />Invite</);
  assert.match(access, />Enable</);
  assert.match(access, /staff-access-more/);
  assert.match(css, /access-v18-preparing/);
  assert.match(css, /access-v18-candidate/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /prefers-reduced-motion/);
});
