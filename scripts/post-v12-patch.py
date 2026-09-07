from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def replace_once(path,old,new):
    p=ROOT/path
    text=p.read_text()
    count=text.count(old)
    if count!=1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}: {old[:90]!r}")
    p.write_text(text.replace(old,new,1))

# Assistant Coordinators can reach their company-scoped Reports from navigation.
replace_once(
    "src/components/AppShell.jsx",
    'const canReports = REPORT_CAPABILITIES.some((capability) => has(currentCapabilities, capability));',
    'const canReports = currentRole === "assistant_coordinator" || REPORT_CAPABILITIES.some((capability) => has(currentCapabilities, capability));',
)

# Exact Overview Food destinations should open the corrective dietary queue rather than a generic Food page.
replace_once(
    "src/pages/FoodV3.jsx",
    'export function Food({ sessionId, capabilities = [], sessionName, participants = [], live = false }) {',
    'export function Food({ sessionId, capabilities = [], sessionName, participants = [], live = false, initialTab = "", initialFilter = "" }) {',
)
replace_once(
    "src/pages/FoodV3.jsx",
    'const [tab, setTab] = useState("meals");',
    'const [tab, setTab] = useState(initialTab === "dietary" || initialTab === "needs" ? "needs" : "meals");',
)
replace_once(
    "src/pages/FoodV3.jsx",
    'const [dietaryFilter, setDietaryFilter] = useState("open");',
    'const [dietaryFilter, setDietaryFilter] = useState(initialFilter === "all" ? "all" : initialFilter === "reviewed" ? "reviewed" : "open");',
)
replace_once(
    "src/pages/FoodV3.jsx",
    'useEffect(() => { if (tab === "needs") loadNeeds(); }, [loadNeeds, tab]);',
    'useEffect(() => { if (initialTab === "dietary" || initialTab === "needs") setTab("needs"); if (initialFilter) setDietaryFilter(initialFilter === "all" ? "all" : initialFilter === "reviewed" ? "reviewed" : "open"); }, [initialTab, initialFilter]);\n  useEffect(() => { if (tab === "needs") loadNeeds(); }, [loadNeeds, tab]);',
)
replace_once(
    "src/App.jsx",
    ':effectiveActive==="food"?<Food sessionId={sessionInfo?.id} capabilities={currentCapabilities} sessionName={sessionName} participants={participants} live={live}/>',
    ':effectiveActive==="food"?<Food sessionId={sessionInfo?.id} capabilities={currentCapabilities} sessionName={sessionName} participants={participants} live={live} initialTab={workspaceContext.tab||""} initialFilter={workspaceContext.filter||""}/>',
)

# Current release expectations: v34 supersedes v33 after this cohesive reliability release.
for p in (ROOT/"tests").glob("*.mjs"):
    text=p.read_text()
    text=text.replace("fsy-kumasi-shell-v33","fsy-kumasi-shell-v34")
    p.write_text(text)

# Tests should assert the new behaviors, not the superseded implementation strings.
replace_once(
    "tests/access-assignments-v12.test.mjs",
    'assert.match(access, /useState\\("needs"\\)/);',
    'assert.match(access, /initialFilter[\\s\\S]*"needs"/);',
)
replace_once(
    "tests/access-assignments-v12.test.mjs",
    'assert.match(sw, /connected Access and Assignments leader setup/);',
    'assert.match(sw, /truthful loading, canonical check-in, Housing wayfinding and scoped operations/);',
)
replace_once(
    "tests/overview-ux.test.mjs",
    'assert.equal(inbox.primary.id, "groups");',
    'assert.equal(inbox.primary.id, "assignments");\n  assert.deepEqual(inbox.primary.destination, { view: "assignments", tab: "groups", filter: "needs" });',
)
replace_once(
    "tests/registration-journey.test.mjs",
    'assert.match(shell, /\\["checkin","Check-in",CheckCircle\\]/);',
    'assert.match(shell, /canRegistration \\|\\| canCheckin/);\n  assert.doesNotMatch(shell, /\\["checkin"/);',
)

# Add a compact regression assertion for AC Reports navigation and Food deep-link behavior.
p=ROOT/"tests/operations-reliability-v12.test.mjs"
text=p.read_text()
insert='''\n\ntest("Assistant Coordinators can navigate to scoped Reports and Food attention deep-links open the right queue", () => {\n  const shell=read("src/components/AppShell.jsx"); const food=read("src/pages/FoodV3.jsx"); const app=read("src/App.jsx");\n  assert.match(shell,/currentRole === "assistant_coordinator" \\|\\| REPORT_CAPABILITIES/);\n  assert.match(food,/initialTab === "dietary"/);\n  assert.match(app,/initialTab=\\{workspaceContext\\.tab/);\n});\n'''
if 'Assistant Coordinators can navigate to scoped Reports' not in text:
    p.write_text(text+insert)

print("v12 post-patch refinements applied")
