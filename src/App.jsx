import { useMemo, useRef, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react/ArrowRight";
import { Bell } from "@phosphor-icons/react/Bell";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { Check } from "@phosphor-icons/react/Check";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { ClipboardText } from "@phosphor-icons/react/ClipboardText";
import { CloudArrowUp } from "@phosphor-icons/react/CloudArrowUp";
import { IdentificationCard } from "@phosphor-icons/react/IdentificationCard";
import { List } from "@phosphor-icons/react/List";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { SignOut } from "@phosphor-icons/react/SignOut";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { SquaresFour } from "@phosphor-icons/react/SquaresFour";
import { Users } from "@phosphor-icons/react/Users";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { createDemoParticipants, demoHeadcountRows, demoUsers, setupSteps } from "./data/demo.js";
import { buildBalancedAssignments } from "./lib/grouping.js";
import { downloadCsvTemplate, parseParticipantFile } from "./lib/import.js";
import { isSupabaseConfigured, supabase } from "./lib/supabase.js";

const nav = [
  ["overview", "Overview", SquaresFour], ["registration", "Registration", IdentificationCard],
  ["groups", "Groups & companies", Buildings], ["checkin", "Check-in", CheckCircle],
  ["headcount", "Head count", ClipboardText], ["access", "Access", Users],
];

const titles = {
  overview: ["Overview", "Your conference setup at a glance."],
  registration: ["Registration", "Bring approved participant records into the operations system."],
  groups: ["Groups & companies", "Create diverse counselor groups and review every proposed assignment."],
  checkin: ["Check-in", "Record arrivals quickly and surface anyone needing attention."],
  headcount: ["Head count", "See which companies have reported and where follow-up is needed."],
  access: ["People & access", "Give each leader only the information needed for their assignment."],
};

function Metric({ label, value, note, tone = "green" }) {
  return <article className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function Status({ children, tone = "good" }) {
  return <span className={`status ${tone}`}><i />{children}</span>;
}

function Empty({ icon: Icon, title, text, action }) {
  return <div className="empty"><span className="empty-icon"><Icon size={25} /></span><h3>{title}</h3><p>{text}</p>{action}</div>;
}

function AppShell({ active, setActive, children }) {
  const [menu, setMenu] = useState(false);
  const navigate = (id) => { setActive(id); setMenu(false); };
  return <div className="app-shell">
    <aside className={menu ? "sidebar open" : "sidebar"}>
      <div className="brand"><span className="brand-mark">F</span><div><b>FSY Kumasi</b><small>Operations</small></div><button className="icon-button sidebar-close" onClick={() => setMenu(false)} aria-label="Close menu"><X /></button></div>
      <nav>{nav.map(([id, label, Icon]) => <button key={id} className={active === id ? "active" : ""} onClick={() => navigate(id)}><Icon size={20} weight={active === id ? "fill" : "regular"} /><span>{label}</span></button>)}</nav>
      <div className="sidebar-foot"><span className="avatar">EO</span><div><b>Esi Owusu</b><small>Logistics administrator</small></div><SignOut size={18} /></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><button className="icon-button menu-button" onClick={() => setMenu(true)} aria-label="Open menu"><List /></button><div className="session"><span>FSY Kumasi 2026</span><small>Planning workspace</small></div><div className="top-actions"><span className={`connection ${isSupabaseConfigured ? "live" : "demo"}`}>{isSupabaseConfigured ? "Live" : "Demo data"}</span><button className="icon-button" aria-label="Notifications"><Bell /></button><span className="avatar small">EO</span></div></header>
      {children}
      <nav className="mobile-nav">{nav.slice(0, 5).map(([id, label, Icon]) => <button key={id} className={active === id ? "active" : ""} onClick={() => navigate(id)}><Icon size={21} weight={active === id ? "fill" : "regular"}/><span>{label.replace(" & companies", "")}</span></button>)}</nav>
    </main>
  </div>;
}

function PageHead({ active, action }) {
  return <div className="page-head"><div><p className="eyebrow">FSY Kumasi 2026</p><h1>{titles[active][0]}</h1><p>{titles[active][1]}</p></div>{action}</div>;
}

function Overview({ setActive, imported, assignment }) {
  const complete = imported.length ? 3 : 1;
  return <section className="page">
    <PageHead active="overview" action={<button className="primary" onClick={() => setActive(imported.length ? "groups" : "registration")}>{imported.length ? "Build groups" : "Continue setup"}<ArrowRight /></button>} />
    <div className="journey-card">
      <div className="section-title"><div><span className="kicker">Conference readiness</span><h2>{complete} of 7 setup steps complete</h2></div><strong>{Math.round(complete / 7 * 100)}%</strong></div>
      <div className="journey-track">{setupSteps.map((step, index) => <button key={step.id} className={index < complete ? "done" : index === complete ? "current" : ""} onClick={() => index === 1 ? setActive("registration") : index >= 3 ? setActive("groups") : undefined}><span>{index < complete ? <Check weight="bold" /> : index + 1}</span><small>{step.short}</small></button>)}</div>
    </div>
    <div className="metrics-grid"><Metric label="Participants" value={imported.length || 724} note={imported.length ? "validated import" : "synthetic planning data"}/><Metric label="Counselor groups" value={assignment?.groups?.length || "—"} note={assignment ? "proposed, not published" : "ready to generate"} tone="gold"/><Metric label="Companies" value={assignment?.companies?.length || "—"} note={assignment ? "balanced proposal" : "after groups are reviewed"} tone="blue"/><Metric label="Access" value="5" note="leaders and committee viewers" tone="slate"/></div>
    <div className="overview-grid">
      <article className="panel attention"><div className="panel-head"><div><span className="kicker">Attention</span><h2>What needs you next</h2></div><span className="count">3</span></div>
        <button onClick={() => setActive("registration")}><span className="alert-icon"><CloudArrowUp /></span><span><b>{imported.length ? "Participant data is ready" : "Import participant data"}</b><small>{imported.length ? `${imported.length} records passed the first review` : "Upload the approved CSV or Excel file"}</small></span><ArrowRight /></button>
        <button onClick={() => setActive("groups")}><span className="alert-icon amber"><Buildings /></span><span><b>Review group rules</b><small>8–10 youth, no same unit inside a group</small></span><ArrowRight /></button>
        <button onClick={() => setActive("access")}><span className="alert-icon blue"><Users /></span><span><b>Confirm leadership access</b><small>Check scopes before invitations go out</small></span><ArrowRight /></button>
      </article>
      <article className="panel"><div className="panel-head"><div><span className="kicker">Readiness summary</span><h2>Built for a calm conference</h2></div></div>
        <div className="readiness"><div><span>Registration data</span><Status tone={imported.length ? "good" : "warn"}>{imported.length ? "Imported" : "Not started"}</Status></div><div><span>Group assignments</span><Status tone={assignment ? "good" : "muted"}>{assignment ? "Draft ready" : "Waiting"}</Status></div><div><span>Leadership access</span><Status>Configured</Status></div><div><span>Check-in workspace</span><Status tone="muted">Unlocks later</Status></div></div>
      </article>
    </div>
    <article className="panel principle"><Sparkle size={22} weight="fill"/><div><b>Less screen time. More time with the youth.</b><p>Every workflow is designed to be completed in a few taps, then get the phone out of the way.</p></div></article>
  </section>;
}

function Registration({ imported, setImported }) {
  const input = useRef();
  const [result, setResult] = useState(imported.length ? { participants: imported, errors: [] } : null);
  const [busy, setBusy] = useState(false);
  const choose = async (file) => { if (!file) return; setBusy(true); try { setResult(await parseParticipantFile(file)); } catch (error) { setResult({ participants: [], errors: [{ row: "File", message: error.message }] }); } finally { setBusy(false); } };
  const hasBlockingErrors = result?.errors?.some((error) => error.severity === "blocking") ?? false;
  const apply = () => { if (result?.participants?.length && !hasBlockingErrors) setImported(result.participants); };
  return <section className="page"><PageHead active="registration" action={<button className="secondary" onClick={downloadCsvTemplate}>Download template</button>}/>
    <div className="notice"><WarningCircle size={21}/><div><b>Use approved registration exports only</b><p>Do not place participant files in chat or source control. Import them here after authorized leaders sign in.</p></div></div>
    <article className="panel import-card"><div className="step-badge">Step 1</div><h2>Upload participant list</h2><p>CSV and Excel files are supported. Nothing is applied until you review the preview.</p>
      <button className="dropzone" onClick={() => input.current?.click()}><CloudArrowUp size={32}/><b>{busy ? "Reading file…" : "Choose CSV or Excel file"}</b><span>Required: name, sex, age, ward or branch</span></button><input ref={input} hidden type="file" accept=".csv,.xlsx,.xls" onChange={(e) => choose(e.target.files?.[0])}/>
    </article>
    {result && <article className="panel"><div className="panel-head"><div><span className="kicker">Step 2</span><h2>Review before applying</h2></div><Status tone={result.errors.length ? "danger" : "good"}>{result.errors.length ? `${result.errors.length} issues` : `${result.participants.length} valid rows`}</Status></div>
      {result.errors.length ? <div className="error-list">{result.errors.slice(0, 8).map((error, i) => <p key={i}><b>Row {error.row}:</b> {error.message}</p>)}</div> : <div className="table-wrap"><table><thead><tr><th>Name</th><th>Sex</th><th>Age</th><th>Unit</th></tr></thead><tbody>{result.participants.slice(0, 6).map(p => <tr key={p.id}><td><b>{p.fullName}</b></td><td>{p.sex}</td><td>{p.age}</td><td>{p.unit}</td></tr>)}</tbody></table></div>}
      <div className="panel-actions"><span>{result.participants.length > 6 ? `Showing 6 of ${result.participants.length}` : "Review every issue before continuing"}</span><button className="primary" disabled={hasBlockingErrors} onClick={apply}>{imported.length ? "Imported" : "Apply validated records"}<Check /></button></div>
    </article>}
  </section>;
}

function Groups({ participants, assignment, setAssignment }) {
  const generate = () => setAssignment(buildBalancedAssignments(participants));
  return <section className="page"><PageHead active="groups" action={<button className="primary" onClick={generate}><Sparkle />{assignment ? "Regenerate proposal" : "Generate proposal"}</button>}/>
    <div className="rules"><div><CheckCircle weight="fill"/><span><b>8–10 per group</b><small>Small enough to know each youth</small></span></div><div><CheckCircle weight="fill"/><span><b>No same unit</b><small>Ward or branch diversity is mandatory</small></span></div><div><CheckCircle weight="fill"/><span><b>YM / YW groups</b><small>Kept separate, paired in companies</small></span></div></div>
    {!assignment ? <article className="panel"><Empty icon={Buildings} title="Ready to create a balanced draft" text={`The builder will arrange ${participants.length} participants. Nothing is published automatically.`} action={<button className="primary" onClick={generate}>Build draft groups</button>}/></article> : <>
      <div className="metrics-grid"><Metric label="Proposed groups" value={assignment.groups.length} note="target size 8–10"/><Metric label="Companies" value={assignment.companies.length} note="YM and YW groups paired" tone="blue"/><Metric label="Rule conflicts" value={assignment.issues.length} note={assignment.issues.length ? "needs manual review" : "all checks passed"} tone={assignment.issues.length ? "gold" : "green"}/><Metric label="Participants" value={participants.length} note="included in this draft" tone="slate"/></div>
      <article className="panel"><div className="panel-head"><div><span className="kicker">Draft proposal</span><h2>First groups to review</h2></div><Status tone={assignment.issues.length ? "warn" : "good"}>{assignment.issues.length ? "Review needed" : "Rules passed"}</Status></div><div className="group-grid">{assignment.groups.slice(0, 8).map(group => <div className="group-card" key={group.id}><div><span>{group.sex === "Female" ? "YW" : "YM"}</span><Status tone={group.conflicts.length ? "warn" : "good"}>{group.members.length}/{group.capacity}</Status></div><h3>{group.name}</h3><p>{group.members.slice(0, 3).map(x => x.unit.replace(" Ward", "").replace(" Branch", "")).join(" · ")}{group.members.length > 3 ? " · …" : ""}</p></div>)}</div><div className="panel-actions"><span>Human review is required before publishing.</span><button className="secondary">Review all groups</button></div></article>
    </>}
  </section>;
}

function Checkin({ participants }) {
  const [query, setQuery] = useState(""); const [checked, setChecked] = useState(new Set());
  const results = useMemo(() => query.trim().length < 2 ? participants.slice(0, 6) : participants.filter(p => `${p.fullName} ${p.registrationId} ${p.unit}`.toLowerCase().includes(query.toLowerCase())).slice(0, 10), [participants, query]);
  const toggle = (id) => setChecked(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  return <section className="page"><PageHead active="checkin"/><div className="metrics-grid compact"><Metric label="Expected" value={participants.length} note="approved participant list"/><Metric label="Checked in" value={checked.size} note="recorded on this device" tone="blue"/><Metric label="Need attention" value="0" note="no unresolved arrivals" tone="gold"/></div>
    <article className="panel"><div className="search"><MagnifyingGlass/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, registration ID or unit"/></div><div className="check-list">{results.map(person => <button key={person.id} onClick={() => toggle(person.id)} className={checked.has(person.id) ? "checked" : ""}><span className="person-avatar">{person.firstName[0]}{person.lastName[0]}</span><span><b>{person.fullName}</b><small>{person.registrationId} · {person.unit}</small></span><span className="check-action">{checked.has(person.id) ? <><CheckCircle weight="fill"/>Arrived</> : "Check in"}</span></button>)}</div></article>
  </section>;
}

function Headcount() {
  return <section className="page"><PageHead active="headcount" action={<button className="primary">Open new round</button>}/><div className="metrics-grid compact"><Metric label="Accounted for" value="694 / 698" note="99.4% of checked-in youth"/><Metric label="Companies reporting" value="8 / 12" note="4 still awaiting" tone="gold"/><Metric label="Unresolved" value="4" note="leadership follow-up" tone="blue"/></div>
    <article className="panel"><div className="panel-head"><div><span className="kicker">Lunch head count · 12:35</span><h2>Company reporting</h2></div><Status tone="warn">In progress</Status></div><div className="table-wrap"><table><thead><tr><th>Company</th><th>Assistant coordinator</th><th>Count</th><th>Status</th></tr></thead><tbody>{demoHeadcountRows.map(row => <tr key={row.company}><td><b>{row.company}</b></td><td>{row.assistantCoordinator}</td><td>{row.accounted ? `${row.accounted} / ${row.expected}` : "—"}</td><td><Status tone={row.status === "Reported" ? "good" : row.status === "Exception" ? "danger" : "muted"}>{row.status}</Status></td></tr>)}</tbody></table></div></article>
  </section>;
}

function Access() {
  const [show, setShow] = useState(false); const [email, setEmail] = useState(""); const [sent, setSent] = useState(false);
  const invite = async (event) => { event.preventDefault(); if (isSupabaseConfigured && supabase) await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } }); setSent(true); };
  return <section className="page"><PageHead active="access" action={<button className="primary" onClick={() => setShow(true)}>Invite leader</button>}/><div className="notice green"><CheckCircle weight="fill"/><div><b>Access follows responsibility</b><p>Assistant coordinators see assigned companies. Logistics administrators and the session directing couple see the whole session.</p></div></div>
    <article className="panel"><div className="table-wrap"><table><thead><tr><th>Leader</th><th>Role</th><th>Scope</th><th>Status</th></tr></thead><tbody>{demoUsers.map(user => <tr key={user.email}><td><b>{user.name}</b><small className="cell-sub">{user.email}</small></td><td>{user.role}</td><td>{user.scope}</td><td><Status tone={user.status === "Active" ? "good" : "warn"}>{user.status}</Status></td></tr>)}</tbody></table></div></article>
    {show && <div className="modal-backdrop" onMouseDown={() => setShow(false)}><form className="modal" onMouseDown={e => e.stopPropagation()} onSubmit={invite}><button type="button" className="icon-button modal-close" onClick={() => setShow(false)}><X/></button>{sent ? <Empty icon={CheckCircle} title="Invitation prepared" text={isSupabaseConfigured ? `A secure sign-in link was sent to ${email}.` : "Demo mode confirmed the flow. Connect Supabase to send real invitations."} action={<button type="button" className="primary" onClick={() => setShow(false)}>Done</button>}/> : <><span className="kicker">Secure access</span><h2>Invite a leader</h2><p>Only existing, pre-authorized users can receive a sign-in link.</p><label>Email address<input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="leader@example.org"/></label><label>Role<select><option>Assistant coordinator</option><option>Coordinator</option><option>Committee viewer</option><option>Logistical administrator</option><option>Session directing couple</option></select></label><button className="primary full">Send secure invitation</button></>}</form></div>}
  </section>;
}

export function App() {
  const [active, setActive] = useState("overview");
  const [imported, setImported] = useState([]);
  const [assignment, setAssignment] = useState(null);
  const demoParticipants = useMemo(() => createDemoParticipants(), []);
  const participants = imported.length ? imported : demoParticipants;
  const content = active === "overview" ? <Overview setActive={setActive} imported={imported} assignment={assignment}/> : active === "registration" ? <Registration imported={imported} setImported={setImported}/> : active === "groups" ? <Groups participants={participants} assignment={assignment} setAssignment={setAssignment}/> : active === "checkin" ? <Checkin participants={participants}/> : active === "headcount" ? <Headcount/> : <Access/>;
  return <AppShell active={active} setActive={setActive}>{content}</AppShell>;
}
