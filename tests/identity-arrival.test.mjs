import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../supabase/migrations/20260904072000_identity_arrival_permissions_v2.sql", import.meta.url);
const appPath = new URL("../src/App.jsx", import.meta.url);
const authPath = new URL("../src/lib/auth.js", import.meta.url);

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
