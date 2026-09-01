import test from "node:test";
import assert from "node:assert/strict";
import { rowsToParticipants } from "../src/lib/import.js";

const headers = ["registration_id", "first_name", "last_name", "sex", "age", "unit"];

test("participant import blocks missing identifiers and name parts", () => {
  const result = rowsToParticipants([
    headers,
    ["", "Ama", "", "Female", "16", "Asokwa Ward"],
  ]);
  assert.deepEqual(
    result.errors.filter((error) => error.severity === "blocking").map((error) => error.field),
    ["Registration ID", "Last name"],
  );
});

test("participant import blocks ages outside the supported session range", () => {
  const result = rowsToParticipants([
    headers,
    ["REG-1", "Ama", "Mensah", "Female", "19", "Asokwa Ward"],
  ]);
  assert.equal(result.errors.find((error) => error.field === "Age")?.severity, "blocking");
});

test("participant import blocks duplicate registration identifiers", () => {
  const result = rowsToParticipants([
    headers,
    ["REG-1", "Ama", "Mensah", "Female", "16", "Asokwa Ward"],
    ["REG-1", "Kofi", "Owusu", "Male", "17", "Bantama Ward"],
  ]);
  assert.equal(result.errors.find((error) => error.message === "Duplicate registration ID")?.severity, "blocking");
});
