import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../supabase/migrations/20260904072000_identity_arrival_permissions_v2.sql", import.meta.url);
const hardeningPath = new URL("../supabase/migrations/20260904073500_identity_arrival_security_hardening.sql", import.meta.url);
const appPath = new URL("../src/App.jsx", import.meta.url);
const authPath = new URL("../src/lib/auth.js", import.meta.url);
const arrivalUiPath = new URL("../src/pages/RegistrationOperations.jsx", import.meta.url);

const read = (url) => readFile(url, "utf8");

test("FSY IDs preserve source identity and enforce one active slot", async () => {
  const sql = await read(migrationPath);
  assert.match(sql, /participant_badge_active_participant_uq/);
  assert.match(sql, /participant_badge_active_slot_uq/);
  assert.match(sql, /participant_badge_active_fsy_id_uq/);
  assert.match(sql, /case when e\.sex='female' then 0 else 1 end/);
  assert.match(sql, /origin_code\|\|'-C'/);
});

test("origin registry resolves Tamale and Techiman to distinct codes", async () => {
  const sql = await read(migrationPath);
  assert.match(sql, /'Tamale Ghana District','TGD'/);
  assert.match(sql, /'Techiman Ghana District','TEGD'/);
  assert.match(sql, /'Kumasi Ghana University Stake','KGUS'/);
});

test("replacement keeps audit history instead of overwriting the absent participant", async () => {
  const sql = await read(migrationPath);
  assert.match(sql, /replace_arrival_vacancy/);
  assert.match(sql, /state='retired'/);
  assert.match(sql, /replacement_for/);
  assert.match(sql, /arrival_vacancy_replaced/);
});

test("registration capability is authoritative for on-site and check-in operations", async () => {
  const sql = await read(migrationPath);
  assert.match(sql, /has_capability\(p_session_id,'checkin_record'\)/);
  assert.match(sql, /has_capability\(target\.session_id,'registration_manage'\)/);
  assert.match(sql, /identity_manage/);
  assert.match(sql, /arrival_manage/);
});

test("auth refreshes are silent and local sign-out stays on one device", async () => {
  const app = await read(appPath);
  const auth = await read(authPath);
  assert.match(app, /event==="TOKEN_REFRESHED"\|\|event==="USER_UPDATED"/);
  assert.match(app, /hydrateGeneration/);
  assert.match(app, /generation!==hydrateGeneration\.current/);
  assert.match(auth, /signOut\(\{ scope: "local" \}\)/);
});

test("arrival statuses allow later and follow-up without weakening validation", async () => {
  const sql = await read(hardeningPath);
  assert.match(sql, /attendance_status in \('expected','expected_later','unknown','confirmed_not_attending'\)/);
  assert.match(sql, /p_status='confirmed_not_attending'.*p_note/s);
  assert.match(sql, /already checked in cannot be marked not attending/);
});

test("coordinators get full operations but access administration stays explicitly delegated", async () => {
  const sql = await read(hardeningPath);
  const coordinatorBranch = sql.match(/when aa\.role='coordinator' then array\[([\s\S]*?)\]::text\[\]/)?.[1] || "";
  assert.ok(coordinatorBranch.includes("'wellness_private'"));
  assert.ok(coordinatorBranch.includes("'housing_manage'"));
  assert.ok(coordinatorBranch.includes("'registration_manage'"));
  assert.ok(!coordinatorBranch.includes("'access_admin'"));
  assert.match(sql, /aa\.role='coordinator' and 'access_admin'=any/);
  assert.match(sql, /aa\.role in \('logistics_admin','session_director'\)/);
});

test("assistant coordinator check-in and identity lookups stay company scoped", async () => {
  const sql = await read(hardeningPath);
  assert.match(sql, /caller_role='assistant_coordinator'.*can_access_company/s);
  assert.match(sql, /caller_role is distinct from 'assistant_coordinator'::public\.app_role[\s\S]*can_access_company/);
  assert.match(sql, /outside your assigned companies/);
});

test("vacancy replacement revalidates counselor-group unit integrity", async () => {
  const sql = await read(hardeningPath);
  assert.match(sql, /select avoid_same_unit into avoid_units/);
  assert.match(sql, /This counselor group already contains someone from the same unit/);
  assert.match(sql, /newcomer\.sex<>target_group\.sex/);
});

test("no-show confirmation is an accessible cancellable sheet instead of a browser prompt", async () => {
  const ui = await read(arrivalUiPath);
  assert.doesNotMatch(ui, /window\.prompt/);
  assert.match(ui, /DismissibleLayer/);
  assert.match(ui, /Parent or guardian confirmed/);
  assert.match(ui, /Confirm not attending/);
  assert.match(ui, /closeNoShowConfirmation/);
});
