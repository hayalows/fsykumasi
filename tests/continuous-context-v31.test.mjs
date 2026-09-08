import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Phase 3 keeps the source workspace when a person opens a full record", async () => {
  const source = await read("src/components/PersonPeek.jsx");
  assert.match(source, /readWorkspaceLocation/);
  assert.match(source, /const origin=buildOrigin\(view,person,kind,target,context\)/);
  assert.match(source, /context\?\.returnTo\?\{\.\.\.base,\.\.\.context\.returnTo\}:base/);
  assert.match(source, /onNavigate\('people',\{personId:id,returnTo\}\)/);
  assert.match(source, /workspace-return-strip/);
  assert.match(source, /Back to \{returnLabel\}/);
});

test("Assignments person inspection returns to the exact assignment workspace", async () => {
  const [peek, assignments] = await Promise.all([
    read("src/components/PersonPeek.jsx"),
    read("src/pages/AssignmentsV3.jsx"),
  ]);
  assert.match(peek, /closest\?\.\('\.assignments-v3-person-row'\).*base\.tab='people'/s);
  assert.match(peek, /closest\?\.\('\.assignments-v3-coverage-row'\).*assistant_coordinator'\?'companies':'groups'/s);
  assert.match(peek, /base\.staffId=personId\(person\)/);
  assert.match(assignments, /if \(!initialStaffId \|\| !staff\.length \|\| setupTarget\) return/);
  assert.match(assignments, /setWorkspace\("people"\)/);
  assert.match(assignments, /setQuery\(person\.name\)/);
});

test("Groups can reopen and focus the exact company or counselor group", async () => {
  const groups = await read("src/pages/GroupsV2.jsx");
  assert.match(groups, /const focusGroupId=initialLocation\.groupId\|\|""/);
  assert.match(groups, /const focusCompanyId=initialLocation\.companyId\|\|""/);
  assert.match(groups, /useState\(group\.id===focusGroupId\)/);
  assert.match(groups, /company\.id===focusCompanyId\|\|\(company\.groups\|\|\[\]\)\.some\(group=>group\.id===focusGroupId\)/);
  assert.match(groups, /scrollIntoView\(\{behavior:"smooth",block:"center"\}\)/);
  assert.match(groups, /returnTo=\{view:"groups",groupId:group\.id,companyId:group\.companyId\}/);
  assert.match(groups, /context-focus/);
});

test("People links related work to Groups and Assignments without duplicating edit ownership", async () => {
  const people = await read("src/pages/PeopleV2.jsx");
  assert.match(people, /writeWorkspaceLocation\(destination\)/);
  assert.match(people, /view:"assignments",tab:"people",staffId:person\.id,returnTo:returnToPerson\(person\)/);
  assert.match(people, /view:"groups",groupId:group\?\.id\|\|"",companyId:company\?\.id\|\|group\?\.companyId\|\|"",returnTo:returnToPerson\(person\)/);
  assert.match(people, /Open in Assignments/);
  assert.match(people, /Open in Groups/);
  assert.match(people, /Assignments stays the source of truth/);
});

test("Phase 3 context UI stays usable on phones and loads after the shared UX foundation", async () => {
  const [css, main] = await Promise.all([
    read("src/phase3-context-v31.css"),
    read("src/main.jsx"),
  ]);
  assert.match(css, /\.workspace-return-strip/);
  assert.match(css, /\.people-v31-related/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.match(css, /min-height: 44px/);
  const foundation = main.indexOf('import "./ux-foundation-v30.css";');
  const context = main.indexOf('import "./phase3-context-v31.css";');
  assert.ok(context > foundation, "Phase 3 context refinements should load after the shared UX foundation");
});
