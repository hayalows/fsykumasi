import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Wellness hotfix remains frontend-only and last in the style cascade", async () => {
  const [main, css] = await Promise.all([read("src/main.jsx"), read("src/pages/wellness-v35.css")]);
  assert.ok(main.indexOf('import "./pages/wellness-v35.css";') > main.indexOf('import "./phase5-release-v33.css";'));
  assert.match(css, /overflow-x:hidden/);
  assert.match(css, /overflow-y:auto/);
  assert.match(css, /overscroll-behavior-y:contain/);
  assert.match(css, /scrollbar-gutter:stable/);
});
