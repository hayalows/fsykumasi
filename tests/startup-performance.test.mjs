import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("signed-in shell can render before secondary workspace reads finish", async () => {
  const source = await read("src/App.jsx");
  assert.match(source, /setRuntimeStatus\("ready"\);setWorkspacePhase\("refreshing"\)/);
  const paintBoundary = source.indexOf("await new Promise((resolve)=>setTimeout(resolve,120));");
  const fieldOperations = source.indexOf('["field operations",()=>loadFieldData');
  assert.ok(paintBoundary >= 0, "the shell-paint delay boundary should remain explicit");
  assert.ok(fieldOperations > paintBoundary, "registration field data should load only after the shell can paint");
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
