import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("PWA runtime recovers when an old deployment loses a lazy route chunk", async () => {
  const source = await read("src/lib/pwa-runtime.js");

  assert.match(source, /vite:preloadError/);
  assert.match(source, /failed to fetch dynamically imported module/i);
  assert.match(source, /chunkloaderror/i);
  assert.match(source, /unhandledrejection/);
  assert.match(source, /STALE_CLIENT_RECOVERY_WINDOW_MS = 45_000/);
  assert.match(source, /sessionStorage\.setItem\(STALE_CLIENT_RECOVERY_KEY/);
  assert.match(source, /serviceWorker\.getRegistration\(\)/);
  assert.match(source, /registration\?\.update\?\.\(\)/);
  assert.match(source, /window\.location\.reload\(\)/);
});

test("v73 activation clears the old shell and refreshes open clients once", async () => {
  const sw = await read("public/sw.js");

  assert.match(sw, /CACHE_NAME = "fsy-kumasi-shell-v73"/);
  assert.match(sw, /fsy-kumasi-shell-v72/);
  assert.match(sw, /self\.skipWaiting\(\)/);
  assert.match(sw, /self\.clients\.claim\(\)/);
  assert.match(sw, /self\.clients\.matchAll\(\{ type: "window", includeUncontrolled: true \}\)/);
  assert.match(sw, /client\.navigate\(client\.url\)/);
});
