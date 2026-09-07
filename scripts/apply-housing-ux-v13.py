from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path, old, new):
    p = ROOT / path
    text = p.read_text()
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:100]!r}")
    p.write_text(text.replace(old, new, 1))


# Housing page: simplify the hierarchy, make mobile information architecture match desktop,
# and never present loading counts as confirmed zeros.
replace_once(
    "src/pages/HousingV5.jsx",
    'description="Assign rooms to checked-in arrivals. The queue updates automatically from Registration."',
    'description="Plan rooms before the conference, then place checked-in arrivals quickly as they come in."',
)
replace_once(
    "src/pages/HousingV5.jsx",
    '<button type="button" role="tab" aria-selected={mobileArea === "queue"} className={mobileArea === "queue" ? "active" : ""} onClick={() => chooseMobileArea("queue")}><span>Arrivals</span><b>{waitingPeople.length}</b></button>\n      <button type="button" role="tab" aria-selected={mobileArea === "rooms"} className={mobileArea === "rooms" ? "active" : ""} onClick={() => chooseMobileArea("rooms")}><span>Rooms</span><b>{rooms.length}</b></button>\n      <button type="button" role="tab" aria-selected={mobileArea === "assigned"} className={mobileArea === "assigned" ? "active" : ""} onClick={() => chooseMobileArea("assigned")}><span>Assigned</span><b>{assignedCount}</b></button>',
    '<button type="button" role="tab" aria-selected={mobileArea !== "rooms"} className={mobileArea !== "rooms" ? "active" : ""} onClick={() => chooseMobileArea("queue")}><span>People</span><b>{waitingPeople.length}</b></button>\n      <button type="button" role="tab" aria-selected={mobileArea === "rooms"} className={mobileArea === "rooms" ? "active" : ""} onClick={() => chooseMobileArea("rooms")}><span>Rooms</span><b>{rooms.length}</b></button>',
)
replace_once(
    "src/pages/HousingV5.jsx",
    '<span><b>{waitingPeople.length}</b><small>waiting</small></span>\n      <span><b>{openSpaces}</b><small>spaces open</small></span>\n      <span><b>{openRooms}</b><small>rooms open</small></span>\n      <span><b>{assignedCount}</b><small>assigned</small></span>',
    '<span><b>{initialLoading ? "—" : waitingPeople.length}</b><small>waiting</small></span>\n      <span><b>{initialLoading ? "—" : openSpaces}</b><small>spaces open</small></span>\n      <span><b>{initialLoading ? "—" : openRooms}</b><small>rooms open</small></span>\n      <span><b>{initialLoading ? "—" : assignedCount}</b><small>assigned</small></span>',
)
replace_once(
    "src/pages/HousingV5.jsx",
    '<div className="housing-v5-panel-head"><div><span className="kicker">Assignments</span>',
    '<div className="housing-v5-panel-head"><div><span className="kicker">Housing work</span>',
)
replace_once(
    "src/pages/HousingV5.jsx",
    '<div className="housing-v5-panel-head housing-v5-room-panel-head"><div><span className="kicker">Rooms</span><h2>Room map</h2>',
    '<div className="housing-v5-panel-head housing-v5-room-panel-head"><div><span className="kicker">Setup</span><h2>Rooms</h2>',
)

# Room editor: keep optional/required markers in one stable label row instead of allowing
# anonymous CSS-grid items to split the label and marker apart on desktop.
replace_once(
    "src/pages/HousingDialogsV4.jsx",
    '<label>Location / building<input value={form.building}',
    '<label><span className="housing-field-label"><b>Location / building</b><em>Required</em></span><input value={form.building}',
)
replace_once(
    "src/pages/HousingDialogsV4.jsx",
    '<label>Floor / area <span>Optional</span><input value={form.floor}',
    '<label><span className="housing-field-label"><b>Floor / area</b><em>Optional</em></span><input value={form.floor}',
)

# Assignment flow: same field-label pattern plus explicit optional bed/key metadata.
replace_once(
    "src/pages/HousingAssignmentV5.jsx",
    'return <label className="housing-v5-move-reason">Reason for room change <span>Optional · recommended</span><textarea',
    'return <label className="housing-v5-move-reason"><span className="housing-field-label"><b>Reason for room change</b><em>Optional · recommended</em></span><textarea',
)
replace_once(
    "src/pages/HousingAssignmentV5.jsx",
    '<label>Bed / key label<input value={bedLabel}',
    '<label><span className="housing-field-label"><b>Bed / key label</b><em>Optional</em></span><input value={bedLabel}',
)
replace_once(
    "src/pages/HousingAssignmentV5.jsx",
    '<label>Location / building<input required value={newRoom.building}',
    '<label><span className="housing-field-label"><b>Location / building</b><em>Required</em></span><input required value={newRoom.building}',
)
replace_once(
    "src/pages/HousingAssignmentV5.jsx",
    '<label>Floor / area <span>Optional</span><input value={newRoom.floor}',
    '<label><span className="housing-field-label"><b>Floor / area</b><em>Optional</em></span><input value={newRoom.floor}',
)

css = r'''/* Housing UX v13: one calm information hierarchy across phone, laptop and wide desktop. */
.housing-v5 {
  width: 100%;
  max-width: 1240px;
  min-width: 0;
  gap: 12px;
}

.housing-v5 .page-head {
  margin-bottom: 14px;
}
.housing-v5 .page-head > div { min-width: 0; }
.housing-v5 .page-head p:last-child { max-width: 64ch; }

/* The live strip communicates the handoff state. Summary numbers live in one place below it. */
.housing-v5-live {
  min-width: 0;
  padding: 11px 14px;
  border-radius: 14px;
  box-shadow: none;
}
.housing-v5-live-stats { display: none !important; }
.housing-v5-live > div:first-child small { overflow-wrap: anywhere; }

.housing-v5-metrics {
  grid-template-columns: repeat(4, minmax(120px, 1fr));
  gap: 7px;
}
.housing-v5-metrics > span {
  min-width: 0;
  padding: 9px 11px;
  box-shadow: none;
}
.housing-v5-metrics small { white-space: normal; }

.housing-v5-layout,
.housing-v5-panel,
.housing-v5-panel-head,
.housing-v5-person-controls,
.housing-v5-room-controls,
.housing-v5-person-list,
.housing-v5-room-grid { min-width: 0; }

/* A common 13-inch laptop still gets two useful panes; narrower workspaces collapse before they feel cramped. */
.housing-v5-layout {
  grid-template-columns: minmax(0, 1.08fr) minmax(380px, .92fr);
  gap: 12px;
}
.housing-v5-panel { box-shadow: 0 6px 20px rgba(0, 81, 117, .045); }
.housing-v5-panel-head { padding: 15px 16px 12px; }
.housing-v5-panel-head p { max-width: 56ch; }

.housing-v5-person-controls,
.housing-v5-room-controls { padding: 11px 12px; }
.housing-v5-room-controls {
  grid-template-columns: minmax(0, 1fr) minmax(154px, 180px);
}
.housing-v5-person-controls .segmented {
  max-width: 100%;
  scrollbar-width: thin;
}

.housing-v5-person-list > button { min-width: 0; }
.housing-v5-person-list .copy,
.housing-v5-person-list .assignment { min-width: 0; }
.housing-v5-person-list .assignment {
  max-width: 160px;
}
.housing-v5-person-list .assignment b,
.housing-v5-person-list .assignment small {
  white-space: normal;
  overflow-wrap: anywhere;
}

/* Let the grid choose the number of useful room cards instead of forcing cramped columns. */
.housing-v5-room-grid {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 215px), 1fr));
  gap: 8px;
}
.housing-v5-room-card {
  min-width: 0;
  min-height: 108px;
  align-content: start;
}
.housing-v5-room-card > span:first-child,
.housing-v5-room-card .capacity { min-width: 0; }
.housing-v5-room-card > span:first-child b {
  white-space: normal !important;
  overflow: visible !important;
  text-overflow: clip !important;
  overflow-wrap: anywhere;
  line-height: 1.25;
}
.housing-v5-room-card > span:first-child small {
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.35;
}
.housing-v5-room-card .capacity {
  min-width: 58px;
}

/* Stable form labels. The generic modal label grid must never place Optional on its own accidental row. */
.housing-field-label {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  display: flex !important;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  color: #284954 !important;
}
.housing-field-label b {
  min-width: 0;
  color: inherit;
  font-size: 12px;
  font-weight: 780;
  line-height: 1.3;
}
.housing-field-label em {
  flex: none;
  color: #7a878d;
  font-size: 10.5px;
  font-style: normal;
  font-weight: 560;
  line-height: 1.3;
  white-space: nowrap;
}

/* Wayfinding is easier to scan vertically and leaves room for long real-world location names. */
.housing-wayfinding-fields {
  grid-template-columns: 1fr !important;
  gap: 12px;
}
.housing-wayfinding-fields input,
.housing-v4-modal-body input,
.housing-v4-modal-body select,
.housing-v4-modal-body textarea,
.housing-v5-assignment-body input,
.housing-v5-assignment-body select,
.housing-v5-assignment-body textarea {
  width: 100%;
  min-width: 0;
}

/* One scroll surface per Housing sheet. Header and actions stay stable while only the task body scrolls. */
.housing-v5-assignment-layer.layer-panel,
.housing-v4-room-editor-layer.layer-panel,
.housing-v4-room-detail-layer.layer-panel {
  padding: 0 !important;
  overflow: hidden !important;
  scrollbar-gutter: auto !important;
}
.housing-v5-assignment-layer.layer-panel {
  width: min(860px, calc(100vw - 40px));
  max-width: 860px;
  height: min(820px, calc(100dvh - 48px));
  max-height: 90dvh;
}
.housing-v4-room-editor-layer.layer-panel {
  width: min(640px, calc(100vw - 40px));
  max-width: 640px;
  max-height: min(760px, calc(100dvh - 48px));
}
.housing-v4-room-detail-layer.layer-panel {
  width: min(720px, calc(100vw - 40px));
  max-width: 720px;
  max-height: min(800px, calc(100dvh - 48px));
}
.housing-v5-assignment-modal,
.housing-v4-room-editor-layer .housing-v4-modal,
.housing-v4-room-detail-layer .housing-v4-modal {
  min-width: 0;
  max-height: inherit;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
}
.housing-v4-room-detail-layer .housing-v4-modal { grid-template-rows: auto minmax(0, 1fr); }
.housing-v5-assignment-body,
.housing-v4-room-editor-layer .housing-v4-modal-body,
.housing-v4-room-detail-layer .housing-v4-modal-body {
  min-height: 0;
  overflow-x: hidden !important;
  overflow-y: auto !important;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.housing-v4-room-editor-layer .housing-v4-modal-actions,
.housing-v5-assignment-actions {
  position: relative !important;
  inset: auto !important;
  z-index: 4;
}

.housing-v5-room-choices {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr));
  align-content: start;
}
.housing-v5-room-choice { min-width: 0; }
.housing-v5-room-choice .room-copy b,
.housing-v5-room-choice .room-copy small,
.housing-v5-room-choice .room-meta small {
  white-space: normal;
  overflow-wrap: anywhere;
}

.housing-v5-move-reason > .housing-field-label { color: #6e551e !important; }
.housing-v5-move-reason > .housing-field-label em { color: #8b7651; }

/* Keep large monitors readable instead of stretching operational rows indefinitely. */
@media (min-width: 1600px) {
  .housing-v5 { max-width: 1260px; }
}

/* A 1280px viewport still loses substantial width to the desktop sidebar, so collapse here. */
@media (max-width: 1280px) {
  .housing-v5-layout { grid-template-columns: 1fr; }
  .housing-v5-room-grid { grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr)); }
}

@media (max-width: 760px) {
  .housing-v5 {
    gap: 9px;
    padding-top: 22px;
  }
  .housing-v5 .page-head {
    margin-bottom: 8px;
    padding-bottom: 0;
  }
  .housing-v5 .page-head h1 {
    margin-bottom: 6px;
    font-size: clamp(30px, 9vw, 38px) !important;
    line-height: 1.02 !important;
  }
  .housing-v5 .page-head > div > p:last-child {
    max-width: 38ch;
    font-size: 13.5px !important;
    line-height: 1.42 !important;
  }
  .housing-v5-live { padding: 10px 11px; }
  .housing-v5-live .kicker { margin-bottom: 3px; }

  /* Mobile has two objects: people and rooms. Waiting/needs/assigned are states inside People. */
  .housing-v5-mobile-tabs {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }
  .housing-v5-desktop-status {
    display: block !important;
    min-width: 0;
  }
  .housing-v5-desktop-status .segmented {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    overflow: visible;
  }
  .housing-v5-desktop-status .segmented button {
    min-width: 0;
    min-height: 46px;
    padding-inline: 6px;
    white-space: normal;
    line-height: 1.15;
  }
  .housing-v5-desktop-status .segmented-label { overflow-wrap: anywhere; }
  .housing-v5-prearrival { display: none !important; }

  /* Tabs already carry waiting/people counts; keep the summary focused on physical capacity. */
  .housing-v5-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: 6px;
  }
  .housing-v5-metrics > span:nth-child(1),
  .housing-v5-metrics > span:nth-child(4) { display: none; }
  .housing-v5-metrics > span {
    min-height: 48px;
    padding: 8px 10px;
    display: flex;
    justify-content: center;
    gap: 6px;
  }
  .housing-v5-metrics small { font-size: 10px !important; }

  .housing-v5-panel-head { padding: 12px 12px 10px; }
  .housing-v5-panel-head p { font-size: 11.5px; }
  .housing-v5-person-controls,
  .housing-v5-room-controls { padding: 9px 10px; }
  .housing-v5-room-controls { grid-template-columns: 1fr; }

  .housing-v5-person-list .assignment { max-width: none; }
  .housing-v5-room-grid { grid-template-columns: 1fr; }
  .housing-v5-room-card { min-height: 92px; }

  .housing-v5-assignment-layer.layer-panel,
  .housing-v4-room-editor-layer.layer-panel,
  .housing-v4-room-detail-layer.layer-panel {
    width: 100% !important;
    max-width: none !important;
    height: calc(100dvh - max(6px, env(safe-area-inset-top))) !important;
    max-height: calc(100dvh - max(6px, env(safe-area-inset-top))) !important;
    margin-top: max(6px, env(safe-area-inset-top));
    border-radius: 20px 20px 0 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
  }
  .sheet-layer .housing-v5-assignment-layer.layer-panel::before,
  .sheet-layer .housing-v4-room-editor-layer.layer-panel::before,
  .sheet-layer .housing-v4-room-detail-layer.layer-panel::before { display: none !important; }

  .housing-v5-assignment-modal,
  .housing-v4-room-editor-layer .housing-v4-modal,
  .housing-v4-room-detail-layer .housing-v4-modal {
    height: 100%;
    max-height: 100%;
  }
  .housing-v5-assignment-head,
  .housing-v4-modal-head {
    padding: 14px 14px 11px;
  }
  .housing-v4-room-editor-layer .housing-v4-modal-body,
  .housing-v4-room-detail-layer .housing-v4-modal-body,
  .housing-v5-assignment-body {
    padding: 12px 13px;
    overflow-y: auto !important;
    -webkit-overflow-scrolling: touch;
  }
  .housing-v4-modal-actions,
  .housing-v5-assignment-actions {
    padding: 10px 13px calc(10px + env(safe-area-inset-bottom)) !important;
  }
  .housing-v4-modal-actions button,
  .housing-v5-assignment-actions button {
    min-height: 50px;
  }

  .housing-v4-form.two { grid-template-columns: 1fr; }
  .housing-field-label b { font-size: 13px; }
  .housing-field-label em { font-size: 11px; }
  .housing-v4-modal-body input,
  .housing-v4-modal-body select,
  .housing-v4-modal-body textarea,
  .housing-v5-assignment-body input,
  .housing-v5-assignment-body select,
  .housing-v5-assignment-body textarea { font-size: 16px; }

  .housing-v5-picker-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
  }
  .housing-v5-picker-head > button { max-width: 132px; white-space: normal; line-height: 1.15; }
  .housing-v5-room-choices { grid-template-columns: 1fr; }
}

@media (max-width: 430px) {
  .housing-v5 { padding-inline: 14px; }
  .housing-v5-mobile-tabs button { min-height: 48px; }
  .housing-v5-desktop-status .segmented button { font-size: 10.5px; }
  .housing-v5-person-list > button { padding-inline: 10px; }
  .housing-v5-room-panel-head {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .housing-v5-add-room { min-width: 0; padding-inline: 10px; }
}

@media (max-width: 350px) {
  .housing-v5 { padding-inline: 10px; }
  .housing-v5-desktop-status .segmented {
    grid-template-columns: 1fr;
    gap: 4px;
  }
  .housing-v5-desktop-status .segmented button { min-height: 44px; }
  .housing-v5-room-panel-head { grid-template-columns: 1fr; }
  .housing-v5-room-panel-actions,
  .housing-v5-add-room { width: 100%; }
  .housing-v5-picker-head { grid-template-columns: 1fr; }
  .housing-v5-picker-head > button { max-width: none; width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .housing-v5-room-card,
  .housing-v5-room-choice { transition: none !important; transform: none !important; }
}
'''
(ROOT / "src/housing-ux-v13.css").write_text(css)

# Load this last so it is the intentional final word on Housing's older v4/v5 compatibility styles.
main = ROOT / "src/main.jsx"
main_text = main.read_text()
if 'import "./housing-ux-v13.css";' not in main_text:
    needle = 'import "./operations-reliability-v12.css";'
    if needle not in main_text:
        raise RuntimeError("main.jsx: final reliability CSS import not found")
    main.write_text(main_text.replace(needle, needle + '\nimport "./housing-ux-v13.css";', 1))

# PWA release marker.
sw = ROOT / "public/sw.js"
sw_text = sw.read_text()
if 'fsy-kumasi-shell-v35' not in sw_text:
    if 'fsy-kumasi-shell-v34' not in sw_text:
        raise RuntimeError("sw.js: expected v34 shell")
    sw_text = sw_text.replace('fsy-kumasi-shell-v34', 'fsy-kumasi-shell-v35', 1)
    sw_text = sw_text.replace(
        '// Release marker: truthful loading, canonical check-in, Housing wayfinding and scoped operations with refined mobile and desktop workflows.',
        '// Release marker: Housing UX v13 with stable field labels, adaptive room cards, two-level mobile navigation and single-scroll sheets.',
        1,
    )
    sw.write_text(sw_text)

# Existing shell-version regressions should follow the new deployable shell.
for p in (ROOT / "tests").glob("*.mjs"):
    text = p.read_text()
    if 'fsy-kumasi-shell-v34' in text:
        p.write_text(text.replace('fsy-kumasi-shell-v34', 'fsy-kumasi-shell-v35'))

# Focused regression coverage for the audit findings.
test = r'''import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

test("Housing uses a two-object mobile information architecture", () => {
  const page = read("src/pages/HousingV5.jsx");
  const css = read("src/housing-ux-v13.css");
  assert.match(page, /<span>People<\/span>/);
  assert.match(page, /<span>Rooms<\/span>/);
  assert.doesNotMatch(page, /<span>Assigned<\/span><b>\{assignedCount\}<\/b><\/button>/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important/);
  assert.match(css, /housing-v5-desktop-status[\s\S]*display: block !important/);
});

test("Housing never presents loading counts as confirmed zeroes", () => {
  const page = read("src/pages/HousingV5.jsx");
  assert.match(page, /initialLoading \? "—" : waitingPeople\.length/);
  assert.match(page, /initialLoading \? "—" : openSpaces/);
  assert.match(page, /initialLoading \? "—" : openRooms/);
  assert.match(page, /initialLoading \? "—" : assignedCount/);
});

test("Housing field optional markers share one stable label row", () => {
  const room = read("src/pages/HousingDialogsV4.jsx");
  const assignment = read("src/pages/HousingAssignmentV5.jsx");
  const css = read("src/housing-ux-v13.css");
  assert.match(room, /housing-field-label/);
  assert.match(room, /<b>Floor \/ area<\/b><em>Optional<\/em>/);
  assert.match(assignment, /<b>Reason for room change<\/b><em>Optional · recommended<\/em>/);
  assert.match(assignment, /<b>Bed \/ key label<\/b><em>Optional<\/em>/);
  assert.match(css, /\.housing-field-label[\s\S]*display: flex !important/);
});

test("Housing room identity wraps instead of disappearing behind ellipsis", () => {
  const css = read("src/housing-ux-v13.css");
  assert.match(css, /housing-v5-room-card > span:first-child b[\s\S]*white-space: normal !important/);
  assert.match(css, /text-overflow: clip !important/);
  assert.match(css, /overflow-wrap: anywhere/);
});

test("Housing sheets use a single bounded scrolling body", () => {
  const css = read("src/housing-ux-v13.css");
  assert.match(css, /housing-v5-assignment-layer\.layer-panel[\s\S]*overflow: hidden !important/);
  assert.match(css, /housing-v5-assignment-body[\s\S]*overflow-y: auto !important/);
  assert.match(css, /housing-v4-room-editor-layer[\s\S]*housing-v4-modal-body[\s\S]*overflow-y: auto !important/);
  assert.match(css, /height: calc\(100dvh - max\(6px, env\(safe-area-inset-top\)\)\) !important/);
});

test("Housing keeps wayfinding protection and room recommendation logic", () => {
  const assignment = read("src/pages/HousingAssignmentV5.jsx");
  const dialogs = read("src/pages/HousingDialogsV4.jsx");
  assert.match(assignment, /roomHasWayfinding\(room\)/);
  assert.match(assignment, /sameGroup > 0/);
  assert.match(assignment, /sameCompany > 0/);
  assert.match(dialogs, /locationReady/);
});

test("Housing UX v13 is the final style layer and PWA shell v35", () => {
  const main = read("src/main.jsx");
  const sw = read("public/sw.js");
  assert.ok(main.indexOf('import "./housing-ux-v13.css";') > main.indexOf('import "./operations-reliability-v12.css";'));
  assert.match(sw, /fsy-kumasi-shell-v35/);
  assert.match(sw, /Housing UX v13/);
});
'''
(ROOT / "tests/housing-ux-v13.test.mjs").write_text(test)

print("Housing UX v13 applied")
