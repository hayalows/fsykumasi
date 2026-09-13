import assert from "node:assert/strict";
import test from "node:test";
import { APP_NAME, APP_SHORT_NAME, canonicalSessionName } from "../src/lib/app-meta.js";

test("canonical app identity maps legacy live-session labels to KCC FSY 2026", () => {
  assert.equal(APP_NAME, "KCC FSY 2026");
  assert.equal(APP_SHORT_NAME, "KCC FSY");
  assert.equal(canonicalSessionName("FSY Kumasi"), "KCC FSY 2026");
  assert.equal(canonicalSessionName("FSY Kumasi 2026"), "KCC FSY 2026");
  assert.equal(canonicalSessionName("FSY Kumasi 2026 Development"), "KCC FSY 2026 Development");
  assert.equal(canonicalSessionName("Training Sandbox"), "Training Sandbox");
});
