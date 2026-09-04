import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const registration = await readFile(new URL("../src/pages/Registration.jsx", import.meta.url), "utf8");
const operations = await readFile(new URL("../src/pages/RegistrationOperationsV2.jsx", import.meta.url), "utf8");
const css = await readFile(new URL("../src/pages/registration-v5.css", import.meta.url), "utf8");

test("Registration exposes one clear four-area workflow", () => {
  assert.match(registration, /RegistrationOperationsV2/);
  assert.match(registration, /value: "registration", label: "Registration"/);
  assert.match(registration, /value: "arrival", label: "Arrival"/);
  assert.match(registration, /value: "identity", label: "FSY IDs"/);
  assert.match(registration, /value: "review", label: "Review"/);
  assert.match(registration, /registration-mode-cue-v5/);
});

test("Arrival worklist uses scannable chips and explicit operational statuses", () => {
  assert.match(operations, /ARRIVAL_FILTERS/);
  assert.match(operations, /arrival-filter-chips-v5/);
  assert.match(operations, /Checked in/);
  assert.match(operations, /Expected later/);
  assert.match(operations, /Follow up/);
  assert.match(operations, /Not attending/);
  assert.match(operations, /Actual check-in stays in Check-in/);
  assert.match(operations, /arrival-row-actions-v5/);
  assert.match(css, /\.arrival-row-actions-v5/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0,1fr\)\)/);
});

test("FSY ID flow makes preparation, review and finalization progressive", () => {
  assert.match(operations, /Prepare, review, then finalize/);
  assert.match(operations, /identity-stepper-v5/);
  assert.match(operations, /ID_FILTERS/);
  assert.match(operations, /Origin issue/);
  assert.match(operations, /Badge review/);
  assert.match(operations, /identity-origin-details-v5/);
  assert.match(operations, /identity-badge-modal-v5/);
});

test("Registration mobile UX keeps filters horizontally scannable and rows touch friendly", () => {
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /overflow-x: auto/);
  assert.match(css, /min-height: 42px/);
  assert.match(css, /\.identity-metrics-v5[\s\S]*scroll-snap-type: x proximity/);
  assert.match(css, /\.arrival-action-v5[\s\S]*min-height: 42px/);
});
