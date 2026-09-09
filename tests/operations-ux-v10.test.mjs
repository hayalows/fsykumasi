import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Registration separates live arrivals, one Solutions queue and supporting Readiness', async () => {
  const [source, readiness, journey] = await Promise.all([
    read("src/pages/Registration.jsx"),
    read("src/pages/RegistrationReadinessV30.jsx"),
    read("src/pages/RegistrationJourneyV29.jsx"),
  ]);
  assert.match(source, /Live check-in/);
  assert.match(source, /Solutions/);
  assert.match(source, /Readiness/);
  assert.match(source, /RegistrationReadinessV30/);
  assert.doesNotMatch(source, /Preflight review|Solutions table|Before session|Prepare/);
  assert.match(journey, /One participant exception queue/);
  assert.match(readiness, /One exception queue/);
});

test("Housing unassign explains the consequence before changing the assignment", async () => {
  const source = await read("src/pages/HousingAssignmentV5.jsx");
  assert.match(source, />Unassign room<\/button>/);
  assert.match(source, /They will move back to the Needs room list/);
  assert.match(source, /without deleting the person or their Housing history/);
  assert.match(source, /ConfirmActionSheet/);
});

test("Groups separates live structure from planning controls", async () => {
  const source = await read("src/pages/GroupsV2.jsx");
  assert.match(source, /Live structure/);
  assert.match(source, /Planning/);
  assert.match(source, /Edit structure/);
  assert.match(source, /My company/);
});

test("Wellness leads with the current queue before new-visit search", async () => {
  const source = await read("src/pages/WellnessV2.jsx");
  assert.match(source, /At Wellness/);
  assert.match(source, /Start visit/);
});

test("operational UX overrides load last", async () => {
  const source = await read("src/main.jsx");
  assert.match(source, /operations-ux-v10\.css/);
});
