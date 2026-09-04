import { useMemo, useState } from "react";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { ClipboardText } from "@phosphor-icons/react/ClipboardText";
import { MapPin } from "@phosphor-icons/react/MapPin";
import { Plus } from "@phosphor-icons/react/Plus";
import { UsersThree } from "@phosphor-icons/react/UsersThree";
import { Empty, Metric, MutationFeedback, PageHead, SearchField, Status } from "../components/UI.jsx";

const PERSON_STATUS_OPTIONS = [
  ["present", "Present"],
  ["missing", "Missing"],
  ["known_elsewhere", "Known elsewhere"],
  ["at_wellness", "At Wellness"],
  ["not_expected", "Not expected"],
];

function expectedFor(company) {
  if (Number.isFinite(Number(company.expectedCount))) return Number(company.expectedCount);
  return (company.groups || []).reduce((sum, group) => sum + Number(group.memberCount || group.members?.length || 0), 0);
}

function companyStatus(saved) {
  if (!saved) return "awaiting";
  return saved.status === "exception" || Number(saved.accounted_count) < Number(saved.expected_count) ? "exception" : "reported";
}

function roundDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function Headcount({ live = false, companies = [], headcount = { round: null, rounds: [], submissions: [], personStatuses: [] }, currentRole, onOpen, onSubmit, sessionName }) {
  const [opening, setOpening] = useState(false);
  const [roundExpanded, setRoundExpanded] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState({});
  const [personDrafts, setPersonDrafts] = useState({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("awaiting");
  const [openCompanyId, setOpenCompanyId] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(20);
  const [savedNotice, setSavedNotice] = useState("");
  const canOpen = ["coordinator", "logistics_admin", "session_director"].includes(currentRole);
  const currentRound = headcount.round || headcount.rounds?.[0] || null;
  const roundSubmissions = useMemo(() => (headcount.submissions || []).filter((item) => !currentRound || item.round_id === currentRound.id), [currentRound, headcount.submissions]);
  const scopedCompanies = useMemo(() => {
    const source = headcount.companies?.length ? headcount.companies : companies;
    return source.map((company) => ({ ...company, expectedCount: expectedFor(company) }));
  }, [headcount.companies, companies]);
  const submissionMap = useMemo(() => new Map(roundSubmissions.map((item) => [item.company_id, item])), [roundSubmissions]);
  const statusMap = useMemo(() => new Map((headcount.personStatuses || []).filter((item) => !currentRound || item.round_id === currentRound.id).map((item) => [`${item.company_id}:${item.participant_id}`, item])), [currentRound, headcount.personStatuses]);
  const expected = scopedCompanies.reduce((sum, company) => sum + expectedFor(company), 0);
  const accounted = roundSubmissions.reduce((sum, row) => sum + Number(row.accounted_count || 0), 0);
  const exceptions = roundSubmissions.filter((row) => companyStatus(row) === "exception").length;
  const awaiting = Math.max(0, scopedCompanies.length - roundSubmissions.length);

  const visibleCompanies = useMemo(() => {
    const text = query.trim().toLowerCase();
    return scopedCompanies.filter((company) => {
      const status = companyStatus(submissionMap.get(company.id));
      if (filter !== "all" && status !== filter) return false;
      if (!text) return true;
      return `${company.name} ${company.displayName || ""} ${company.meetingSpot || ""}`.toLowerCase().includes(text);
    });
  }, [scopedCompanies, submissionMap, filter, query]);
  const shownCompanies = visibleCompanies.slice(0, visibleLimit);

  const openRound = async (event) => {
    event.preventDefault(); setBusy("round"); setError("");
    try { await onOpen(label); setLabel(""); setOpening(false); setRoundExpanded(true); setFilter("awaiting"); }
    catch (err) { setError(err.message || "Unable to open head count."); }
    finally { setBusy(""); }
  };

  const personStatusFor = (company, person) => personDrafts[`${company.id}:${person.id}`] || statusMap.get(`${company.id}:${person.id}`)?.status || "present";

  const submit = async (company, count, includeReconciliation = false) => {
    const expectedCount = expectedFor(company);
    const personStatuses = includeReconciliation
      ? (company.people || []).map((person) => ({ participant_id: person.id, status: personStatusFor(company, person) })).filter((item) => item.status !== "present")
      : [];
    setBusy(company.id); setError("");
    try {
      await onSubmit({ roundId: currentRound.id, companyId: company.id, accountedCount: Number(count), note: Number(count) === expectedCount ? "" : "Exception requires follow-up", personStatuses });
      setOpenCompanyId("");
      setSavedNotice(`${company.displayName || company.name} · ${Number(count) === expectedCount ? "All here" : "Exception saved"}`);
      window.setTimeout(() => setSavedNotice(""), 2600);
    } catch (err) { setError(err.message || "Unable to save this company head count."); }
    finally { setBusy(""); }
  };

  const chooseFilter = (nextFilter) => { setFilter(nextFilter); setVisibleLimit(20); setOpenCompanyId(""); };

  return (
    <section className="page headcount-page">
      <PageHead title="Head count" sessionName={sessionName} description="Round first. Open one company only when it is time to report or reconcile." action={canOpen && scopedCompanies.length ? <button className="primary" onClick={() => setOpening(true)}><Plus />New round</button> : null} />
      {error ? <div className="form-error page-error" role="alert">{error}</div> : null}
      {savedNotice ? <MutationFeedback className="headcount-save-notice"><b>Saved</b> · {savedNotice}</MutationFeedback> : null}
      {opening ? <form className="panel inline-form" onSubmit={openRound}><label>Round label<input required maxLength="80" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Lunch head count" autoFocus /></label><div><button type="button" className="secondary" onClick={() => setOpening(false)}>Cancel</button><button className="primary" disabled={busy === "round"}>{busy === "round" ? "Opening…" : "Open round"}</button></div></form> : null}

      {!currentRound ? (
        <article className="panel"><Empty icon={ClipboardText} title={scopedCompanies.length ? "No head-count round is open" : "Publish companies first"} text={scopedCompanies.length ? "A coordinator or top-level leader can open a round when a count is needed." : "Head count becomes available after the reviewed grouping plan is published."} /></article>
      ) : (
        <>
          <article className={roundExpanded ? "panel headcount-round-card open" : "panel headcount-round-card"}>
            <button className="headcount-round-summary" type="button" onClick={() => setRoundExpanded((value) => !value)} aria-expanded={roundExpanded}>
              <span className="disclosure-chevron" aria-hidden="true">{roundExpanded ? "⌄" : "›"}</span>
              <span><span className="kicker">Current round</span><b>{currentRound.label}</b><small>Opened {roundDate(currentRound.opens_at)}</small></span>
              <Status tone={currentRound.closes_at ? "muted" : "warn"}>{currentRound.closes_at ? "Closed" : "In progress"}</Status>
            </button>
            <div className="headcount-glance"><span><b>{roundSubmissions.length}/{scopedCompanies.length}</b><small>companies reported</small></span><span><b>{awaiting}</b><small>still awaiting</small></span><span><b>{exceptions}</b><small>exceptions</small></span></div>
            {!roundExpanded ? <button type="button" className="primary round-enter" onClick={() => setRoundExpanded(true)}>{awaiting ? `Continue · ${awaiting} awaiting` : "Open round details"}</button> : null}

            {roundExpanded ? <div className="headcount-round-detail">
              <div className="metrics-grid compact headcount-metrics"><Metric label="Accounted for" value={`${accounted.toLocaleString()} / ${expected.toLocaleString()}`} note="Current expected roster" /><Metric label="Companies reporting" value={`${roundSubmissions.length} / ${scopedCompanies.length}`} note={`${awaiting} awaiting`} tone="yellow" /><Metric label="Exceptions" value={exceptions} note={exceptions ? "reconcile before close" : "none reported"} tone={exceptions ? "yellow" : "green"} /></div>
              <div className="progressive-toolbar headcount-toolbar"><SearchField value={query} onChange={(value) => { setQuery(value); setVisibleLimit(20); }} label="Search head-count companies" placeholder="Search company"/><div className="filter-chips headcount-filters" role="group" aria-label="Filter head-count companies"><button type="button" className={filter === "awaiting" ? "active" : ""} onClick={() => chooseFilter("awaiting")}>Awaiting {awaiting}</button><button type="button" className={filter === "exception" ? "active" : ""} onClick={() => chooseFilter("exception")}>Exceptions {exceptions}</button><button type="button" className={filter === "reported" ? "active" : ""} onClick={() => chooseFilter("reported")}>Reported {roundSubmissions.length - exceptions}</button><button type="button" className={filter === "all" ? "active" : ""} onClick={() => chooseFilter("all")}>All</button></div></div>

              <div className="headcount-progressive-list">
                {shownCompanies.map((company) => {
                  const companyExpected = expectedFor(company);
                  const saved = submissionMap.get(company.id);
                  const draft = drafts[company.id] ?? saved?.accounted_count ?? companyExpected;
                  const status = companyStatus(saved);
                  const open = openCompanyId === company.id;
                  const people = company.people || [];
                  return <div className={open ? "headcount-company-card open" : "headcount-company-card"} key={company.id}>
                    <button className="headcount-company-summary" type="button" onClick={() => setOpenCompanyId(open ? "" : company.id)} aria-expanded={open}>
                      <span className="disclosure-chevron" aria-hidden="true">{open ? "⌄" : "›"}</span>
                      <span><b>{company.displayName || company.name}</b><small>{companyExpected} expected{company.meetingSpot ? ` · ${company.meetingSpot}` : ""}</small></span>
                      {saved ? <Status tone={status === "exception" ? "danger" : "good"}>{saved.accounted_count}/{saved.expected_count}</Status> : <Status tone="muted">Awaiting</Status>}
                    </button>
                    {open ? <div className="headcount-company-detail">
                      {saved ? <div className="saved-headcount-context"><span><small>Last report</small><b>{saved.accounted_count} of {saved.expected_count}</b></span><span><small>Status</small><b>{status === "exception" ? "Exception" : "All accounted for"}</b></span>{saved.submitted_at ? <span><small>Saved</small><b>{roundDate(saved.submitted_at)}</b></span> : null}{saved.note ? <p>{saved.note}</p> : null}</div> : <p className="form-hint">No report yet. Confirm everyone first, or enter a different total.</p>}
                      {!currentRound.closes_at && onSubmit && !saved ? <button type="button" className="primary headcount-all-here" disabled={busy === company.id} onClick={() => submit(company, companyExpected)}><CheckCircle weight="fill"/>{busy === company.id ? "Saving…" : "Report all here"}</button> : null}
                      {!currentRound.closes_at && onSubmit ? <details className="headcount-adjust-details"><summary><CaretDown size={17}/> {saved ? "Edit this report" : "Enter a different total"}</summary><div className="headcount-adjust"><label>Accounted for<input aria-label={`${company.name} accounted count`} type="number" min="0" max={companyExpected} value={draft} onChange={(event) => setDrafts((current) => ({ ...current, [company.id]: event.target.value }))}/></label><button type="button" className="secondary" disabled={busy === company.id} onClick={() => submit(company, draft, true)}>{busy === company.id ? "Saving…" : Number(draft) === companyExpected ? <><CheckCircle weight="fill"/>Save report</> : "Save exception"}</button></div></details> : null}
                      {status === "exception" && people.length ? <details className="headcount-reconcile-details"><summary><UsersThree size={17}/> Reconcile missing people <span>{people.filter((person) => personStatusFor(company, person) !== "present").length || ""}</span></summary><div className="headcount-reconcile"><p className="form-hint">Direct head-count status only. Wellness status stays separate. Save the report after choosing a reason.</p>{people.map((person) => <label className="headcount-person-row" key={person.id}><span><b>{person.name}</b><small>{[person.fsyId, person.group].filter(Boolean).join(" · ") || person.registrationId || "Roster person"}</small></span><select aria-label={`Head-count status for ${person.name}`} value={personStatusFor(company, person)} onChange={(event) => setPersonDrafts((current) => ({ ...current, [`${company.id}:${person.id}`]: event.target.value }))}>{PERSON_STATUS_OPTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>)}</div></details> : null}
                      {company.meetingSpot ? <p className="headcount-location"><MapPin size={16}/>{company.meetingSpot}</p> : null}
                    </div> : null}
                  </div>;
                })}
                {!shownCompanies.length ? <div className="empty-inline"><b>{filter === "awaiting" && !awaiting ? "Everyone has reported" : "No companies here"}</b><span>Change the filter or search to view another part of this round.</span></div> : null}
              </div>
              {visibleCompanies.length > visibleLimit ? <button type="button" className="secondary show-more" onClick={() => setVisibleLimit((value) => value + 20)}>Show 20 more · {visibleCompanies.length - visibleLimit} remaining</button> : null}
            </div> : null}
          </article>
          {(headcount.rounds || []).length > 1 ? <details className="panel headcount-history"><summary><span><span className="kicker">History</span><b>Previous rounds</b><small>Keep each count separate for audit and handover.</small></span><CaretDown size={20}/></summary><div className="headcount-history-list">{headcount.rounds.slice(1).map((round) => { const rows = (headcount.allSubmissions || []).filter((item) => item.round_id === round.id); const roundExpected = scopedCompanies.reduce((sum, company) => sum + expectedFor(company), 0); const roundAccounted = rows.reduce((sum, row) => sum + Number(row.accounted_count || 0), 0); return <div className="headcount-history-row" key={round.id}><span><b>{round.label}</b><small>{roundDate(round.opens_at)}{round.closes_at ? ` · Closed ${roundDate(round.closes_at)}` : " · In progress"}</small></span><span><b>{roundAccounted.toLocaleString()} / {roundExpected.toLocaleString()}</b><small>{rows.length}/{scopedCompanies.length} companies reported</small></span><Status tone={rows.some((row) => companyStatus(row) === "exception") ? "warn" : "good"}>{rows.some((row) => companyStatus(row) === "exception") ? "Exceptions" : "Recorded"}</Status></div>; })}</div></details> : null}
        </>
      )}
      {!live ? <div className="notice"><ClipboardText/><div><b>Prototype mode</b><p>Reports use in-memory rehearsal state and reset when the page reloads.</p></div></div> : null}
    </section>
  );
}
