import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Wellness waits for live data before showing operational zero states", async () => {
  const page = await read("src/pages/WellnessV3.jsx");
  assert.match(page, /const \[loadState, setLoadState\]/);
  assert.match(page, /loadState === "loading" \? <WellnessLoading/);
  assert.match(page, /loadState === "error" && !rows\.length/);
  assert.match(page, /Nothing has been shown as clear or zero because the live record is unavailable/);
});

test("open Wellness follow-up stays visible across calendar days", async () => {
  const page = await read("src/pages/WellnessV3.jsx");
  assert.match(page, /const followUp = useMemo\([\s\S]*rows\.filter\(isFollowUpOpen\)/);
  assert.match(page, /These stay here across days until someone marks the follow-up resolved/);
  assert.doesNotMatch(page, /dayRows\.filter\(isFollowUpOpen\)/);
});

test("Wellness prioritizes current care and moves historical browsing to a secondary rail", async () => {
  const [page, styles] = await Promise.all([read("src/pages/WellnessV3.jsx"), read("src/pages/wellness-v3.css")]);
  assert.match(page, /wellness-workspace/);
  assert.match(page, /wellness-priority-column/);
  assert.match(page, /wellness-activity-column/);
  assert.match(page, /Daily record/);
  assert.match(page, /slice\(0, 12\)/);
  assert.match(styles, /grid-template-columns:minmax\(0,1\.55fr\) minmax\(320px,\.72fr\)/);
});

test("start visit is a focused picker instead of a permanent search form", async () => {
  const page = await read("src/pages/WellnessV3.jsx");
  assert.match(page, /function StartVisitPicker/);
  assert.match(page, /Start visit/);
  assert.match(page, /Search participants or staff by name, FSY ID, unit, company or group/);
  assert.match(page, /canEdit = canManage && canViewPrivate/);
  assert.match(page, /Already active/);
});

test("Wellness keeps privacy, mobile touch targets and emergency reporting cues visible", async () => {
  const [page, styles] = await Promise.all([read("src/pages/WellnessV3.jsx"), read("src/pages/wellness-v3.css")]);
  assert.match(page, /statusOnly \? <ShieldCheck/);
  assert.match(page, /Private notes stay with authorized Wellness users/);
  assert.match(page, /If emergency help is needed, call emergency services first/);
  assert.match(styles, /@media\(max-width:700px\)/);
  assert.match(styles, /min-height:44px/);
  assert.match(styles, /env\(safe-area-inset-bottom,0px\)/);
});
