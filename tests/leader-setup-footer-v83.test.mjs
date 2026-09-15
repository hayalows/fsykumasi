import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("existing leader access keeps actions visible after companies load", async () => {
  const [component, css, main] = await Promise.all([
    read("src/components/LeaderSetupFlow.jsx"),
    read("src/leader-setup-v83.css"),
    read("src/main.jsx"),
  ]);

  assert.match(component, /!created && !existing \? <div className="leader-setup-progress"/);
  assert.match(component, /<footer className="leader-setup-footer">/);
  assert.match(css, /\.leader-setup-flow:not\(:has\(\.leader-setup-progress\)\)\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/);
  assert.match(css, /\.leader-setup-v15 \.leader-setup-scroll\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*auto;/);
  assert.match(css, /\.dismissible-layer \.layer-panel\.leader-setup-layer\s*\{[\s\S]*?overflow:\s*hidden;/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?safe-area-inset-bottom/);
  assert.ok(main.lastIndexOf('import "./leader-setup-v83.css";') > main.lastIndexOf('import "./participant-membership-v53.css";'));
});
