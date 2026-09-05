import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const registration = await readFile(new URL("../src/pages/Registration.jsx", import.meta.url), "utf8");
const journey = await readFile(new URL("../src/pages/RegistrationJourneyV2.jsx", import.meta.url), "utf8");
const journeyParts = await readFile(new URL("../src/pages/RegistrationJourneyParts.jsx", import.meta.url), "utf8");
const operations = await readFile(new URL("../src/pages/RegistrationOperationsV2.jsx", import.meta.url), "utf8");
const css = await readFile(new URL("../src/pages/registration-journey-v2.css", import.meta.url), "utf8");

test("Registration exposes one clear three-area journey", () => {
  assert.match(registration, /Registration & check-in/);
  assert.match(registration, /value: "desk", label: "Check-in desk"/);
  assert.match(registration, /value: "roster", label: "Roster"/);
  assert.match(registration, /value: "setup", label: "Setup & review"/);
  assert.match(registration, /registration-mode-cue-v5/);
  assert.doesNotMatch(registration, /ArrivalOperations/);
});

test("Check-in desk uses one search and task-first operational states", () => {
  assert.match(journey, /Find participant/);
  assert.match(journey, /Ready to check in/);
  assert.match(journey, /Checked in/);
  assert.match(journey, /Needs attention/);
  assert.match(journey, /On-site/);
  assert.match(journey, /Not attending/);
  assert.match(journeyParts, /Complete check-in/);
  assert.match(journeyParts, /Waiting for Housing/);
});

test("FSY ID flow remains available under Setup and keeps its progressive workflow", () => {
  assert.match(registration, /value: "identity", label: "FSY IDs"/);
  assert.match(operations, /Prepare, review, then finalize/);
  assert.match(operations, /identity-stepper-v5/);
  assert.match(operations, /Origin issue/);
  assert.match(operations, /Badge review/);
  assert.match(operations, /identity-origin-details-v5/);
  assert.match(operations, /identity-badge-modal-v5/);
});

test("Registration mobile UX keeps filters scannable and choices free of nested scrolling", () => {
  assert.match(css, /@media \(max-width:720px\)/);
  assert.match(css, /overflow-x:auto/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /min-height:48px/);
  assert.match(css, /max-height:none;overflow:visible/);
});
