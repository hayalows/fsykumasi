import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { matchesRegistrationSearchV6, registrationSearchRank } from "../src/lib/registration-search-v6.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("live desk search ranks identity before broad metadata matches", () => {
  const exactId = { fullName: "Ama Mensah", fsyId: "KU-0142", unit: "Bantama Ward", companyName: "Company 4" };
  const name = { fullName: "KU 0142 Owusu", fsyId: "KU-0999", unit: "Asokwa Ward" };
  const room = { fullName: "Kwame Boateng", fsyId: "KU-0200", unit: "Daban Ward" };
  assert.equal(registrationSearchRank(exactId, "KU-0142"), 0);
  assert.ok(registrationSearchRank(exactId, "Ama") < registrationSearchRank(name, "0142"));
  assert.equal(matchesRegistrationSearchV6(room, "Room 17", { roomName: "Room 17" }), true);
  assert.equal(matchesRegistrationSearchV6(room, "No Such Participant"), false);
});

test("check-in search is global and on-site creation waits for a genuine no-match", async () => {
  const source = await read("src/pages/RegistrationJourneyV5.jsx");
  assert.match(source, /view === "desk" && text\) return matchesRegistrationSearchV6/);
  assert.match(source, /Searching all participants/);
  assert.match(source, /canManageRegistration\s*&&\s*view\s*!==\s*"desk"/);
  assert.match(source, /No participant found/);
  assert.match(source, /Add on-site participant/);
  assert.match(source, /scrollIntoView/);
});

test("mobile Registration controls reflow in document flow instead of floating over work", async () => {
  const css = await read("src/registration-checkin-v6.css");
  assert.match(css, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)\s*!important/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.registration-workspace-navigation-v5\s*\{[\s\S]*position:\s*static\s*!important/);
  assert.match(css, /\.regjourney-v4 \.regjourney-more-filters > div\s*\{[\s\S]*position:\s*static\s*!important[\s\S]*box-shadow:\s*none\s*!important/);
  assert.match(css, /grid-template-areas:[\s\S]*"person status"[\s\S]*"assignment action"/);
  assert.match(css, /\.regjourney-v4 \.regjourney-row-action button\s*\{[\s\S]*min-height:\s*46px/);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.match(css, /@media \(max-width: 350px\)/);
  assert.match(css, /@media \(max-width: 760px\) and \(max-height: 620px\)/);
  assert.doesNotMatch(css, /iPhone|Galaxy|Samsung|Pixel/i);
});

test("Registration workspace copy stays task-first while the focused flow layers remain ordered", async () => {
  const [registration, main, sw] = await Promise.all([
    read("src/pages/Registration.jsx"),
    read("src/main.jsx"),
    read("public/sw.js"),
  ]);
  assert.match(registration, /Find the participant and complete normal arrivals quickly\. If something blocks check-in, send only that person to Solutions\./);
  assert.match(registration, /description="Keep normal arrivals fast\. Resolve participant blockers in one Solutions queue, and use Readiness for the supporting setup\."/);
  const v6 = main.indexOf('import "./registration-checkin-v6.css";');
  const modal = main.indexOf('import "./registration-modal-v4.css";');
  const v7 = main.indexOf('import "./registration-flow-v7.css";');
  assert.ok(v6 > modal, "Registration desk refinements should load after modal and legacy workspace layers");
  assert.ok(v7 > v6, "focused mobile flow refinements should load after desk refinements");
  assert.match(sw, /fsy-kumasi-shell-v39/);
});
