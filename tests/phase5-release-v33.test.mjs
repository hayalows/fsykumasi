import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("Phase 5 uses a local single-flight guard for consequential UI writes",async()=>{
  const helper=await read("src/lib/reliable-action.js");
  assert.match(helper,/useSingleFlight/);
  assert.match(helper,/active\.current\.has\(actionKey\)/);
  assert.match(helper,/active\.current\.add\(actionKey\)/);
  assert.match(helper,/finally\s*\{\s*active\.current\.delete\(actionKey\)/);
  assert.match(helper,/usePendingPageGuard/);
  assert.match(helper,/beforeunload/);
  assert.match(helper,/No success is assumed until the server confirms it/);
});

test("Account password submit stays disabled until the fields are valid",async()=>{
  const profile=await read("src/pages/Profile.jsx");
  assert.match(profile,/passwordReady = Boolean/);
  assert.match(profile,/passwords\.next\.length >= 10/);
  assert.match(profile,/!passwordMismatch/);
  assert.match(profile,/!passwordUnchanged/);
  assert.match(profile,/disabled=\{passwordBusy \|\| !live \|\| !passwordReady\}/);
  assert.match(profile,/aria-invalid=\{passwordMismatch\}/);
  assert.match(profile,/profile-new-password-help/);
  assert.match(profile,/useSingleFlight\(\)/);
  assert.match(profile,/usePendingPageGuard\(busy \|\| passwordBusy\)/);
  assert.match(profile,/account-password/);
});

test("FSY identity writes cannot race one another",async()=>{
  const identity=await read("src/pages/RegistrationIdentityV31.jsx");
  assert.match(identity,/useSingleFlight\(\)/);
  assert.equal((identity.match(/runSingleFlight\("identity-write"/g)||[]).length,3);
  assert.match(identity,/usePendingPageGuard\(busy\)/);
  assert.match(identity,/aria-busy=\{busy\}/);
  assert.match(identity,/Confirm finalization/);
  assert.match(identity,/recoverableWriteError/);
});

test("Final roster keeps one in-flight action and explicit apply confirmation",async()=>{
  const finalRoster=await read("src/pages/RegistrationFinalBaselineV22.jsx");
  assert.match(finalRoster,/useSingleFlight\(\)/);
  assert.ok((finalRoster.match(/runSingleFlight\("final-roster-action"/g)||[]).length>=3);
  assert.match(finalRoster,/usePendingPageGuard\(busy==="apply"\)/);
  assert.match(finalRoster,/aria-busy=\{Boolean\(busy\)\}/);
  assert.match(finalRoster,/Make this file the final registration baseline/);
  assert.match(finalRoster,/disabled=\{!confirmReset\|\|Boolean\(busy\)\}/);
  assert.match(finalRoster,/one database transaction/i);
});

test("Leadership exception decisions require complete authority details and resist double submit",async()=>{
  const form=await read("src/components/ParticipantExceptionForm.jsx");
  assert.match(form,/useSingleFlight\(\)/);
  assert.match(form,/participant-exception-\$\{person\.id\}/);
  assert.match(form,/form\.authority\.trim\(\)\.length>=3/);
  assert.match(form,/form\.reason\.trim\(\)\.length>=5/);
  assert.match(form,/form\.registration&&form\.guardian&&form\.leadership/);
  assert.match(form,/disabled=\{busy\|\|!ready\}/);
  assert.match(form,/aria-busy=\{busy\}/);
});

test("Shared UI announces routes and mutation outcomes without stealing normal focus",async()=>{
  const ui=await read("src/components/UI.jsx");
  const main=await read("src/main.jsx");
  assert.match(main,/id="route-announcer"/);
  assert.match(main,/aria-live="polite"/);
  assert.match(ui,/document\.title = `\$\{title\} · FSY Kumasi`/);
  assert.match(ui,/document\.getElementById\("route-announcer"\)/);
  assert.match(ui,/aria-live=\{error \? "assertive" : "polite"\}/);
  assert.match(ui,/aria-atomic="true"/);
  assert.match(ui,/event\.key === "Home"/);
  assert.match(ui,/event\.key === "End"/);
});

test("Phase 5 has explicit responsive and assistive-display release contracts",async()=>{
  const css=await read("src/phase5-release-v33.css");
  for(const width of [1024,768,414,390,375,320]) assert.match(css,new RegExp(`@media\\(max-width:${width}px\\)`));
  assert.match(css,/@media\(pointer:coarse\)/);
  assert.match(css,/@media\(prefers-contrast:more\)/);
  assert.match(css,/@media\(forced-colors:active\)/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/:focus-visible/);
  assert.match(css,/overflow-x:hidden/);
});

test("Phase 5 release layer loads after the earlier overhaul layers",async()=>{
  const main=await read("src/main.jsx");
  const phase4=main.indexOf("phase4-operations-v32.css");
  const phase5=main.indexOf("phase5-release-v33.css");
  assert.ok(phase4>=0);
  assert.ok(phase5>phase4);
});

test("Phase 5 advances the PWA shell so installed clients receive the hardening release",async()=>{
  const sw=await read("public/sw.js");
  assert.match(sw,/fsy-kumasi-shell-v47/);
  assert.match(sw,/Phase 5 release hardening/);
});

test("Phase 5 release document records the full width and failure matrix",async()=>{
  const doc=await read("docs/audits/2026-09-08-phase5-release-validation.md");
  for(const width of ["320px","375px","390px","414px","768px","1024px","1440px"]) assert.match(doc,new RegExp(width.replace("px","px")));
  assert.match(doc,/double click \/ repeated submit/i);
  assert.match(doc,/network interruption during a write/i);
  assert.match(doc,/offline then reconnect/i);
  assert.match(doc,/concurrent edit/i);
  assert.match(doc,/400% browser zoom/i);
  assert.match(doc,/keyboard-only navigation/i);
  assert.match(doc,/Do not merge individual phases/i);
});
