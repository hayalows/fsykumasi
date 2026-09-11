import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("signed-in shell can render before secondary workspace reads finish", async () => {
  const source = await read("src/App.jsx");
  assert.match(source, /setRuntimeStatus\("ready"\);setWorkspacePhase\("refreshing"\)/);
  const paintMarker = source.indexOf("Let the signed-in shell and the first route paint");
  const fieldOperations = source.indexOf('["field operations",()=>loadFieldData');
  assert.ok(paintMarker >= 0, "the shell-paint boundary should remain explicit");
  assert.ok(fieldOperations > paintMarker, "registration field data should load only after the shell can paint");
  assert.match(source, /loadFieldData\(granted\.session_id,granted\.capabilities\|\|\[\],"registration"\)/);
});

test("large participant roster reads are paged instead of capped at the API default", async () => {
  const source = await read("src/lib/backend.js");
  assert.match(source, /loadRpcPages\([\s\S]*get_participant_roster_v2/);
  assert.match(source, /\["participant_id"\]/);
});

test("route bundles are loaded on demand", async () => {
  const source = await read("src/App.jsx");
  assert.match(source, /const Overview = lazyPage\(\(\) => import\("\.\/pages\/Overview\.jsx"\)/);
  assert.match(source, /<Suspense fallback=\{<RouteLoading \/>\}>\{content\}<\/Suspense>/);
});

test("Overview refresh is bounded and avoids overlapping retries", async () => {
  const source = await read("src/pages/Overview.jsx");
  assert.match(source, /overviewInFlightRef/);
  assert.match(source, /Overview request timed out/);
  assert.match(source, /sessionInfo\?\.starts_on/);
});
