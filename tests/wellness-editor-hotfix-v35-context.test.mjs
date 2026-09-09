import assert from "node:assert/strict";
import test from "node:test";
import { humanizeSearchContext } from "../src/lib/person-search.js";

test("operational role slugs are human-readable in display context", () => {
  assert.equal(humanizeSearchContext("assistant_coordinator · Pakyi Branch"), "Assistant Coordinator · Pakyi Branch");
  assert.equal(humanizeSearchContext("logistics_admin · Kumasi"), "Logistics Admin · Kumasi");
});
