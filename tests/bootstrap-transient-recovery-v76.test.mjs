import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Supabase retries only safe bootstrap reads after transient gateway or network failures", async () => {
  const source = await read("src/lib/supabase.js");

  assert.match(source, /RETRYABLE_READ_STATUS = new Set\(\[502, 503, 504\]\)/);
  assert.match(source, /SAFE_READ_RPCS = new Set\(\["my_access_state"\]\)/);
  assert.match(source, /method === "GET" \|\| method === "HEAD"/);
  assert.match(source, /method !== "POST"/);
  assert.match(source, /async function resilientReadFetch/);
  assert.match(source, /global: \{ fetch: resilientReadFetch \}/);
  assert.match(source, /await new Promise\(\(resolve\) => setTimeout\(resolve, retryDelay\(\)\)\)/);
});

test("transient connection failures no longer imply the user's internet is definitely at fault", async () => {
  const source = await read("src/lib/ux-errors.js");

  assert.match(source, /Live FSY data is taking too long/);
  assert.match(source, /The live data service or your connection did not respond in time/);
  assert.match(source, /retry safe reads automatically/i);
});
