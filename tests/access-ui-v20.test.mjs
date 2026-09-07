import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Access v20 is a presentation layer over the proven v19 access model", async () => {
  const wrapper = await read("src/pages/Access.jsx");
  assert.match(wrapper, /AccessV19/);
  assert.match(wrapper, /access-operations-v20\.css/);
  assert.match(wrapper, /access-v20-shell/);
});

test("desktop Access removes repeated card hierarchy and groups scope with the person", async () => {
  const css = await read("src/access-operations-v20.css");
  assert.match(css, /\.access-v17-directory-head\{display:none\}/);
  assert.match(css, /\.access-v17-row\{[\s\S]*grid-template-columns:minmax\(330px,1fr\) minmax\(190px,\.55fr\) auto/);
  assert.match(css, /\.access-v17-scope\{[\s\S]*grid-column:1;[\s\S]*grid-row:2;[\s\S]*padding-left:46px/);
  assert.match(css, /\.access-v17-meta>span:nth-child\(2\)\{display:none\}/);
});

test("uncommon Add access paths use progressive disclosure", async () => {
  const addFlow = await read("src/components/AccessAddFlowV18.jsx");
  assert.match(addFlow, /<details className="access-v20-new-person">/);
  assert.match(addFlow, /Can't find them\?/);
  assert.match(addFlow, /Choose from Staff/);
  assert.match(addFlow, /Search by name or email/);
});

test("Access task sheets use one main scroll surface instead of nested company and committee scrollers", async () => {
  const css = await read("src/access-operations-v20.css");
  assert.match(css, /\.leader-setup-v15 \.leader-setup-company-list\{max-height:none!important;overflow:visible!important/);
  assert.match(css, /\.leader-setup-v15 \.leader-setup-committee-choice \.account-choice-list-v2\{max-height:none!important;overflow:visible!important/);
  assert.match(css, /\.account-team-sheet \.account-choice-list-v2\{max-height:none!important;overflow:visible!important/);
});

test("mobile Access keeps controls and actions in normal flow with safe task sheets", async () => {
  const css = await read("src/access-operations-v20.css");
  assert.match(css, /@media\(max-width:760px\)[\s\S]*\.access-v20-shell \.access-v17-toolbar\{position:static/);
  assert.match(css, /height:calc\(100dvh - max\(8px,env\(safe-area-inset-top\)\)\)/);
  assert.match(css, /\.access-v20-shell \.access-v17-actions\{grid-column:1;grid-row:4/);
});

test("Access v20 keeps the More action affordance and ships a fresh PWA shell", async () => {
  const [access, css, sw] = await Promise.all([
    read("src/pages/AccessV19.jsx"),
    read("src/access-operations-v20.css"),
    read("public/sw.js"),
  ]);
  assert.match(access, /staff-access-more/);
  assert.match(css, /staff-access-more/);
  assert.match(sw, /fsy-kumasi-shell-v42/);
  assert.match(sw, /Access operations v20/);
  assert.match(sw, /fsy-kumasi-shell-v41/);
  assert.match(sw, /Access operations v19/);
});
