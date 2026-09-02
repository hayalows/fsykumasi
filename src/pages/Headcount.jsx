import { useMemo, useState } from "react";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { ClipboardText } from "@phosphor-icons/react/ClipboardText";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { Plus } from "@phosphor-icons/react/Plus";
import { Empty, Metric, PageHead, Status } from "../components/UI.jsx";

function expectedFor(company) {
  return (company.groups || []).reduce((sum, group) => sum + Number(group.memberCount || group.members?.length || 0), 0);
}

function companyStatus(saved) {
  if (!saved) return "awaiting";
  return saved.status === "exception" ? "exception" : "reported";
}

export function Headcount({ live = false, companies = [], headcount = { round: null, submissions: [] }, currentRole, onOpen, onSubmit, sessionName }) {
  const [opening, setOpening] = useState(false);
  const [roundExpanded, setRoundExpanded] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("awaiting");
  const [openCompanyId, setOpenCompanyId] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(20);
  const [savedNotice, setSavedNotice] = useState("");
  const canOpen = ["coordinator", "logistics_admin", "session_director"].includes(currentRole);
  const submissionMap = useMemo(() => new Map(headcount.submissions.map((item) => [item.company_id, item])), [headcount.submissions]);
  const expected = companies.reduce((sum, company) => sum + expectedFor(company), 0);
  const accounted = headcount.submissions.reduce((sum, row) => sum + Number(row.accounted_count || 0), 0);
  const exceptions = headcount.submissions.filter((row) => row.status === "exception").length;
  const awaiting = Math.max(0, companies.length - headcount.submissions.length);

  const visibleCompanies = useMemo(() => {
    const text = query.trim().toLowerCase();
    return companies.filter((company) => {
      const status = companyStatus(submissionMap.get(company.id));
      if (filter !== "all" && status !== filter) return false;
      if (!text) return true;
      return `${company.name} ${company.displayName || ""} ${company.meetingSpot || ""}`.toLowerCase().includes(text);
    });
  }, [companies, submissionMap, filter, query]);
  const shownCompanies = visibleCompanies.slice(0, visibleLimit);

  const openRound = async (event) => {
    event.preventDefault();
    setBusy("round");
    setError("");
    try {
      await onOpen(label);
      setLabel("");
      setOpening(false);
      setRoundExpanded(true);
      setFilter("awaiting");
    } catch (err) {
      setError(err.message || "Unable to open head count.");
    } finally {
      setBusy("");
    }
  };

  const submit = async (company, count) => {
    const expectedCount = expectedFor(company);
    setBusy(company.id);
    setError("");
    try {
      await onSubmit({
        roundId: headcount.round.id,
        companyId: company.id,
        accountedCount: Number(count),
        note: Number(count) === expectedCount ? "" : "Exception requires follow-up",
      });
      setOpenCompanyId("");
      setSavedNotice(`${company.displayName || company.name} · ${Number(count) === expectedCount ? "All here" : "Exception saved"}`);
      window.setTimeout(() => setSavedNotice(""), 2600);
    } catch (err) {
      setError(err.message || "Unable to save this company head count.");
    } finally {
      setBusy("");
    }
  };

  const quickAllHere = async (company) => {
    setDrafts((current) => ({ ...current, [company.id]: expectedFor(company) }));
    await submit(company, expectedFor(company));
  };

  const chooseFilter = (nextFilter) => {
    setFilter(nextFilter);
    setVisibleLimit(20);
    setOpenCompanyId("");
  };

  return (
    <section className="page headcount-page">
      <PageHead title="Head count" sessionName={sessionName} description="See the round first. Open the detail only when you need to report, correct, or investigate a company." action={canOpen && companies.length ? <button className="primary" onClick={() => setOpening(true)}><Plus />New round</button> : null} />
      {error ? <div className="form-error page-error" role="alert">{error}</div> : null}
      {savedNotice ? <div className="auth-success headcount-save-notice" role="status"><CheckCircle weight="fill" /><span><b>Saved</b> · {savedNotice}</span></div> : null}
      {opening ? <form className="panel inline-form" onSubmit={openRound}><label>Round label<input required maxLength="80" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Lunch head count" autoFocus /></label><div><button type="button" className="secondary" onClick={() => setOpening(false)}>Cancel</button><button className="primary" disabled={busy === "round"}>{busy === "round" ? "Opening…" : "Open round"}</button></div></form> : null}

      {!headcount.round ? (
        <article className="panel"><Empty icon={ClipboardText} title={companies.length ? "No head-count round is open" : "Publish companies first"} text={companies.length ? "A coordinator or top-level leader can open the first round when a count is needed." : "Head count becomes available after the reviewed grouping plan is published."} /></article>
      ) : (
        <>
          <article className={roundExpanded ? "panel headcount-round-card open" : "panel headcount-round-card"}>
            <button className="headcount-round-summary" onClick={() => setRoundExpanded((value) => !value)} aria-expanded={roundExpanded}>
              <span className="disclosure-chevron" aria-hidden="true">{roundExpanded ? "⌄" : "›"}</span>
              <span><span className="kicker">Current head count</span><b>{headcount.round.label}</b><small>Opened {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(headcount.round.opens_at))}</small></span>
              <Status tone={headcount.round.closes_at ? "muted" : "warn"}>{headcount.round.closes_at ? "Closed" : "In progress"}</Status>
            </button>
            <div className="headcount-glance"><span><b>{headcount.submissions.length}/{companies.length}</b><small>companies reported</small></span><span><b>{awaiting}</b><small>still awaiting</small></span><span><b>{exceptions}</b><small>exceptions</small></span></div>
            {!roundExpanded ? <button className="primary round-enter" onClick={() => setRoundExpanded(true)}>{awaiting ? `Continue · ${awaiting} awaiting` : "Open round details"}</button> : null}

            {roundExpanded ? <div className="headcount-round-detail">
              <div className="metrics-grid compact headcount-metrics"><Metric label="Accounted for" value={`${accounted.toLocaleString()} / ${expected.toLocaleString()}`} note={headcount.round.label} /><Metric label="Companies reporting" value={`${headcount.submissions.length} / ${companies.length}`} note={`${awaiting} awaiting`} tone="yellow" /><Metric label="Exceptions" value={exceptions} note={exceptions ? "requires follow-up" : "none reported"} tone={exceptions ? "yellow" : "green"} /></div>
              <div className="progressive-toolbar headcount-toolbar"><div className="search"><MagnifyingGlass/><input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleLimit(20); }} placeholder="Search company"/></div><div className="filter-chips headcount-filters" role="group" aria-label="Filter head-count companies"><button className={filter === "awaiting" ? "active" : ""} onClick={() => chooseFilter("awaiting")}>Awaiting {awaiting}</button><button className={filter === "exception" ? "active" : ""} onClick={() => chooseFilter("exception")}>Exceptions {exceptions}</button><button className={filter === "reported" ? "active" : ""} onClick={() => chooseFilter("reported")}>Reported {headcount.submissions.length - exceptions}</button><button className={filter === "all" ? "active" : ""} onClick={() => chooseFilter("all")}>All</button></div></div>

              <div className="headcount-progressive-list">
                {shownCompanies.map((company) => {
                  const companyExpected = expectedFor(company);
                  const saved = submissionMap.get(company.id);
                  const draft = drafts[company.id] ?? saved?.accounted_count ?? companyExpected;
                  const status = companyStatus(saved);
                  const open = openCompanyId === company.id;
                  return <div className={open ? "headcount-company-card open" : "headcount-company-card"} key={company.id}>
                    <div className="headcount-company-main">
                      <button className="headcount-company-summary" onClick={() => setOpenCompanyId(open ? "" : company.id)} aria-expanded={open}><span className="disclosure-chevron" aria-hidden="true">{open ? "⌄" : "›"}</span><span><b>{company.displayName || company.name}</b><small>{companyExpected} expected</small></span>{saved ? <Status tone={saved.status === "exception" ? "danger" : "good"}>{saved.accounted_count}/{saved.expected_count}</Status> : <Status tone="muted">Awaiting</Status>}</button>
                      {!open && !saved && !headcount.round.closes_at && onSubmit ? <button className="quick-all-here" disabled={busy === company.id} onClick={() => quickAllHere(company)}><CheckCircle weight="fill"/>{busy === company.id ? "Saving…" : "All here"}</button> : null}
                    </div>
                    {open ? <div className="headcount-company-detail">{saved ? <div className="saved-headcount-context"><span><small>Last report</small><b>{saved.accounted_count} of {saved.expected_count}</b></span><span><small>Status</small><b>{saved.status === "exception" ? "Exception" : "All accounted for"}</b></span>{saved.note ? <p>{saved.note}</p> : null}</div> : <p className="form-hint">No report has been submitted for this company yet.</p>}{!headcount.round.closes_at && onSubmit ? <div className="headcount-adjust"><label>Accounted for<input aria-label={`${company.name} accounted count`} type="number" min="0" max={companyExpected} value={draft} onChange={(event) => setDrafts((current) => ({ ...current, [company.id]: event.target.value }))}/></label><button className="secondary" disabled={busy === company.id} onClick={() => submit(company, draft)}>{busy === company.id ? "Saving…" : Number(draft) === companyExpected ? <><CheckCircle weight="fill"/>Save all here</> : "Save exception"}</button></div> : null}</div> : null}
                  </div>;
                })}
                {!shownCompanies.length ? <div className="empty-inline"><b>{filter === "awaiting" && !awaiting ? "Everyone has reported" : "No companies here"}</b><span>Change the filter or search to view another part of this round.</span></div> : null}
              </div>
              {visibleCompanies.length > visibleLimit ? <button className="secondary show-more" onClick={() => setVisibleLimit((value) => value + 20)}>Show 20 more · {visibleCompanies.length - visibleLimit} remaining</button> : null}
            </div> : null}
          </article>
        </>
      )}
      {!live ? <div className="notice"><ClipboardText/><div><b>Prototype mode</b><p>Connect Supabase to record real head-count rounds.</p></div></div> : null}
    </section>
  );
}

