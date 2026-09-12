import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const registration = read("src/pages/Registration.jsx");
const styles = read("src/participant-membership-v55.css");

test("Registration loads the laptop membership refinement after the existing membership styles", () => {
  assert.match(registration, /participant-membership-v54\.css/);
  assert.match(registration, /participant-membership-v55\.css/);
  assert.ok(registration.indexOf("participant-membership-v55.css") > registration.indexOf("participant-membership-v54.css"));
});

test("desktop membership choices use available width instead of forcing four tall rows", () => {
  assert.match(styles, /@media \(min-width: 761px\)/);
  assert.match(styles, /width: min\(720px, calc\(100vw - 48px\)\)/);
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /max-height: calc\(100dvh - 32px\)/);
});

test("short laptop screens compact the sheet without shrinking the choice targets too far", () => {
  assert.match(styles, /@media \(min-width: 761px\) and \(max-height: 760px\)/);
  assert.match(styles, /min-height: 62px/);
  assert.match(styles, /max-height: calc\(100dvh - 20px\)/);
  assert.match(styles, /participant-membership-actions-v54[\s\S]*border-top/);
});

test("mobile remains a single-column scrolling sheet", () => {
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /overflow-y: auto/);
  assert.match(styles, /grid-template-columns: 1fr/);
});
