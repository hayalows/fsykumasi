import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Registration exposes one clear Live check-in, Solutions and Readiness journey", async () => {
  const registration = await read("src/pages/Registration.jsx");
  assert.match(registration, /Registration & check-in/);
  assert.match(registration, /value: "desk", label: "Live check-in"/);
  assert.match(registration, /value: "roster", label: "Solutions"/);
  assert.match(registration, /value: "readiness", label: "Readiness"/);
  assert.match(registration, /registration-mode-cue-v5/);
  assert.doesNotMatch(registration, /RegistrationReviewInbox/);
  assert.doesNotMatch(registration, /ArrivalOperations/);
});

test("Check-in desk stays task first while Solutions exposes the next action", async () => {
  const [journey, parts] = await Promise.all([
    read("src/pages/RegistrationJourneyV29.jsx"),
    read("src/pages/RegistrationJourneyPartsV4.jsx"),
  ]);
  assert.match(journey, /Find a participant/);
  assert.match(journey, /All blockers/);
  assert.match(journey, /regjourney-next-action-v30/);
  assert.match(journey, /blocker\.nextAction/);
  assert.match(journey, />Resolve<ArrowRight/);
  assert.match(parts, /Complete check-in/);
  assert.match(parts, /Waiting for Housing/);
});

test("Readiness owns FSY IDs, Staff readiness and Final roster without duplicating participant review", async () => {
  const [readiness, identity] = await Promise.all([
    read("src/pages/RegistrationReadinessV30.jsx"),
    read("src/pages/RegistrationIdentityV28.jsx"),
  ]);
  assert.match(readiness, /title="FSY IDs"/);
  assert.match(readiness, /title="Staff readiness"/);
  assert.match(readiness, /title="Final roster"/);
  assert.match(readiness, /One exception queue/);
  assert.match(readiness, /Open Solutions/);
  assert.doesNotMatch(readiness, /RegistrationReviewInbox/);
  assert.match(identity, /Prepare, review, then finalize/);
  assert.match(identity, /identity-stepper-v5/);
  assert.match(identity, /Origin issues/);
  assert.match(identity, /Preferred name review/);
  assert.match(identity, /identity-origin-details-v5/);
  assert.match(identity, /identity-badge-modal-v5/);
});

test("Registration Phase 2 mobile UX supports compact tabs, readiness cards and one-column Solutions", async () => {
  const css = await read("src/pages/registration-phase2-v30.css");
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /registration-readiness-grid-v30\{grid-template-columns:1fr\}/);
  assert.match(css, /@media\(max-width:390px\)/);
  assert.match(css, /regjourney-v30 \.regjourney-solutions-queues-v30\{grid-template-columns:1fr\}/);
});
