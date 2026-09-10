import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "public/sw.js"), "utf8");

assert.match(source, /CACHE_NAME = "fsy-kumasi-shell-v51"/);
assert.match(source, /NAVIGATION_TIMEOUT_MS = 8000/);
assert.match(source, /fetchWithTimeout\(request, NAVIGATION_TIMEOUT_MS\)/);
assert.match(source, /catch\(\(\) => caches\.match\("\/"\)/);

console.log("Service worker resilience checks passed.");
