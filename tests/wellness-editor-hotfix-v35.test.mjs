import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { humanizeSearchContext, searchPeople } from "../src/lib/person-search.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Wellness staff context shows human role labels while preserving the operational value", () => {
  const staff = [{
    id: "s1",
    name: "Gyan Kweku Mensah",
    operationalRole: "assistant_coordinator",
    context: "assistant_coordinator · Pakyi Branch",
  }];
  const [result] = searchPeople(staff, "Gyan");
  assert.equal(result.context, "Assistant Coordinator · Pakyi Branch");
  assert.equal(result.operationalRole, "assistant_coordinator");
  assert.equal(humanizeSearchContext("session_director · Bantama"), "Session Director · Bantama");
});

test("Wellness editor owns its scroll region and keeps actions reachable", async () => {
  const [css, main] = await Promise.all([
    read("src/pages/wellness-v35.css"),
    read("src/main.jsx"),
  ]);
  assert.match(css, /\.wellness-editor-layer \.wellness-sheet\{[\s\S]*min-height:0;[\s\S]*overflow-y:auto;/);
  assert.match(css, /touch-action:pan-y/);
  assert.match(css, /scroll-padding-bottom:96px/);
  assert.match(css, /\.wellness-editor-layer \.wellness-editor-actions\{[\s\S]*bottom:0;/);
  assert.match(css, /height:100dvh/);
  assert.match(css, /env\(safe-area-inset-bottom,0px\)/);
  assert.doesNotMatch(css, /bottom:-/);
  assert.ok(main.indexOf('import "./pages/wellness-v35.css";') > main.indexOf('import "./phase5-release-v33.css";'));
});

test("Wellness editor remains compact on short desktop viewports and narrow phones", async () => {
  const css = await read("src/pages/wellness-v35.css");
  assert.match(css, /@media\(max-width:420px\)/);
  assert.match(css, /@media\(max-height:760px\) and \(min-width:701px\)/);
  assert.match(css, /min-height:46px/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\) minmax\(0,1\.15fr\)/);
});
