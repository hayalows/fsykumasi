import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("live workspaces refresh stale operational data without interrupting active edits or overloading the backend", async () => {
  const source = await read("src/components/AppShell.jsx");

  assert.match(source, /LIVE_REFRESH_INTERVAL_MS = 5 \* 60_000/);
  assert.match(source, /LIVE_REFRESH_TICK_MS = 30_000/);
  assert.match(source, /LIVE_REFRESH_RESUME_MIN_AGE_MS = 90_000/);
  assert.match(source, /LIVE_REFRESH_IDLE_MS = 5_000/);
  assert.match(source, /document\.querySelector\(LIVE_REFRESH_BLOCKING_SELECTOR\)/);
  assert.match(source, /focused instanceof Element && focused\.matches\(LIVE_REFRESH_EDITABLE_SELECTOR\)/);
  assert.match(source, /workspacePhaseRef\.current/);
  assert.match(source, /refreshInFlightRef\.current/);
});

test("live workspaces recover after backgrounding or a network reconnect", async () => {
  const source = await read("src/components/AppShell.jsx");

  assert.match(source, /window\.addEventListener\("focus", refreshAfterResume\)/);
  assert.match(source, /window\.addEventListener\("pageshow", refreshAfterResume\)/);
  assert.match(source, /window\.addEventListener\("online", refreshAfterReconnect\)/);
  assert.match(source, /document\.addEventListener\("visibilitychange", refreshAfterResume\)/);
  assert.match(source, /window\.setInterval\(\(\) => refreshWhenSafe\(LIVE_REFRESH_INTERVAL_MS\), LIVE_REFRESH_TICK_MS\)/);
  assert.match(source, /await refresh\(\)/);
});

test("installed and long-lived clients check for a newer deployment after resume", async () => {
  const source = await read("src/lib/pwa-runtime.js");

  assert.match(source, /SERVICE_WORKER_UPDATE_COOLDOWN_MS = 60_000/);
  assert.match(source, /SERVICE_WORKER_UPDATE_INTERVAL_MS = 5 \* 60_000/);
  assert.match(source, /function requestLatestServiceWorker\(\)/);
  assert.match(source, /registration\?\.update\?\.\(\)/);
  assert.match(source, /window\.addEventListener\("online", onOnline\)/);
  assert.match(source, /requestLatestServiceWorker\(\)/);
  assert.match(source, /window\.setInterval\(\(\) => \{/);
});
