import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Overview is personalized by capability and starts with one next action", async () => {
  const source = await read("src/pages/Overview.jsx");
  assert.match(source, /Next best action/);
  assert.match(source, /Personalized to your access/);
  assert.match(source, /Only what you can use/);
  assert.match(source, /canRegistration/);
  assert.match(source, /canHousing/);
  assert.match(source, /canWellness/);
  assert.match(source, /canFood/);
});

test("Overview uses progressive disclosure and responsive task hierarchy", async () => {
  const [source, css] = await Promise.all([
    read("src/pages/Overview.jsx"),
    read("src/pages/overview-v2.css"),
  ]);
  assert.match(source, /<details className="panel overview-v2-setup"/);
  assert.match(source, /Session pulse/);
  assert.match(source, /Nothing urgent right now/);
  assert.match(css, /grid-template-columns:minmax\(0,1\.15fr\)/);
  assert.match(css, /@media\(max-width:720px\)/);
  assert.match(css, /min-height:50px/);
  assert.match(css, /prefers-reduced-motion/);
});

test("Overview does not expose irrelevant setup as the primary team experience", async () => {
  const source = await read("src/pages/Overview.jsx");
  assert.match(source, /const broadOps/);
  assert.match(source, /broadOps && setupIncomplete/);
  assert.doesNotMatch(source, /Conference operations, without the noise/);
  assert.doesNotMatch(source, /Fast by design/);
});
