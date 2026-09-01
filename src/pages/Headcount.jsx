import { useMemo, useState } from "react";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { ClipboardText } from "@phosphor-icons/react/ClipboardText";
import { Plus } from "@phosphor-icons/react/Plus";
import { Empty, Metric, PageHead, Status } from "../components/UI.jsx";

function expectedFor(company) {
  return (company.groups || []).reduce((sum, group) => sum + Number(group.memberCount || group.members?.length || 0), 0);
}

export function Headcount({ live = false, companies = [], headcount = { round: null, submissions: [] }, currentRole, onOpen, onSubmit }) {
  const [opening, setOpening] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState({});
  const canOpen = ["coordinator", "logistics_admin", "session_director"].includes(currentRole);
  const submissionMap = useMemo(() => new Map(headcount.submissions.map((item) => [item.company_id, item])), [headcount.submissions]);
  const expected = companies.reduce((sum, company) => sum + expectedFor(company), 0);
  const accounted = headcount.submissions.reduce((sum, row) => sum + row.accounted_count, 0);
  const exceptions = headcount.submissions.filter((row) => row.status === "exception").length;

  const openRound = async (event) => {
    event.preventDefault();
    setBusy("round");
    setError("");
    try {
      await onOpen(label);
      setLabel("");
      setOpening(false);
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
    } catch (err) {
      setError(err.message || "Unable to save this company head count.");
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="page">
      <PageHead title="Head count" description="Submit each company in seconds. Leadership sees incomplete reporting separately from genuine participant exceptions." action={canOpen && companies.length ? <button className="primary" onClick={() => setOpening(true)}><Plus />Open new round</button> : null} />
      {error ? <div className="form-error page-error" role="alert">{error}</div> : null}
      {opening ? <form className="panel inline-form" onSubmit={openRound}><label>Round label<input required maxLength="80" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Lunch head count" autoFocus /></label><div><button type="button" className="secondary" onClick={() => setOpening(false)}>Cancel</button><button className="primary" disabled={busy === "round"}>{busy === "round" ? "Opening…" : "Open round"}</button></div></form> : null}

      {!headcount.round ? (
        <article className="panel"><Empty icon={ClipboardText} title={companies.length ? "No head-count round is open" : "Publish companies first"} text={companies.length ? "A coordinator or top-level leader can open the first round when a count is needed." : "Head count becomes available after the reviewed grouping plan is published."} /></article>
      ) : (
        <>
          <div className="metrics-grid compact">
            <Metric label="Accounted for" value={`${accounted.toLocaleString()} / ${expected.toLocaleString()}`} note={headcount.round.label} />
            <Metric label="Companies reporting" value={`${headcount.submissions.length} / ${companies.length}`} note={`${Math.max(0, companies.length - headcount.submissions.length)} awaiting`} tone="yellow" />
            <Metric label="Exceptions" value={exceptions} note={exceptions ? "requires follow-up" : "none reported"} tone={exceptions ? "yellow" : "green"} />
          </div>
          <article className="panel">
            <div className="panel-head"><div><span className="kicker">Opened {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(headcount.round.opens_at))}</span><h2>{headcount.round.label}</h2></div><Status tone={headcount.round.closes_at ? "muted" : "warn"}>{headcount.round.closes_at ? "Closed" : "In progress"}</Status></div>
            <div className="headcount-list">
              {companies.map((company) => {
                const companyExpected = expectedFor(company);
                const saved = submissionMap.get(company.id);
                const draft = drafts[company.id] ?? saved?.accounted_count ?? companyExpected;
                return <div className="headcount-row" key={company.id}>
                  <div><b>{company.name}</b><small>{companyExpected} expected</small></div>
                  {saved ? <Status tone={saved.status === "submitted" ? "good" : "danger"}>{saved.accounted_count} / {saved.expected_count}</Status> : <Status tone="muted">Awaiting</Status>}
                  {!headcount.round.closes_at && onSubmit ? <div className="headcount-actions"><input aria-label={`${company.name} accounted count`} type="number" min="0" max={companyExpected} value={draft} onChange={(event) => setDrafts((current) => ({ ...current, [company.id]: event.target.value }))}/><button className="secondary" disabled={busy === company.id} onClick={() => submit(company, draft)}>{busy === company.id ? "Saving…" : Number(draft) === companyExpected ? <><CheckCircle weight="fill"/>All here</> : "Save exception"}</button></div> : null}
                </div>;
              })}
            </div>
          </article>
        </>
      )}
      {!live ? <div className="notice"><ClipboardText/><div><b>Prototype mode</b><p>Connect Supabase to record real head-count rounds.</p></div></div> : null}
    </section>
  );
}
