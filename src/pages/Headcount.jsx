import { demoHeadcountRows } from "../data/demo.js";
import { Metric, PageHead, Status } from "../components/UI.jsx";

export function Headcount() {
  const reported = demoHeadcountRows.filter((row) => row.status === "Reported").length;
  const exceptions = demoHeadcountRows.filter((row) => row.status === "Exception").length;
  const expected = demoHeadcountRows.reduce((sum, row) => sum + row.expected, 0);
  const accounted = demoHeadcountRows.reduce((sum, row) => sum + row.accounted, 0);

  return (
    <section className="page">
      <PageHead title="Head count" description="Leadership sees reporting completeness and real exceptions separately, so an unfinished count never looks like a missing-person emergency." action={<button className="primary">Open new round</button>} />
      <div className="metrics-grid compact">
        <Metric label="Accounted for" value={`${accounted.toLocaleString()} / ${expected.toLocaleString()}`} note="current synthetic round" />
        <Metric label="Companies reporting" value={`${reported + exceptions} / ${demoHeadcountRows.length}`} note={`${demoHeadcountRows.length - reported - exceptions} still awaiting`} tone="yellow" />
        <Metric label="Exceptions" value={exceptions} note="requires leadership follow-up" tone="green" />
      </div>
      <article className="panel">
        <div className="panel-head"><div><span className="kicker">Lunch head count · 12:35</span><h2>Company reporting</h2></div><Status tone="warn">In progress</Status></div>
        <div className="table-wrap"><table><thead><tr><th>Company</th><th>Assistant coordinator</th><th>Count</th><th>Status</th></tr></thead><tbody>{demoHeadcountRows.slice(0, 14).map((row) => <tr key={row.company}><td><b>{row.company}</b></td><td>{row.assistantCoordinator}</td><td>{row.accounted ? `${row.accounted} / ${row.expected}` : "—"}</td><td><Status tone={row.status === "Reported" ? "good" : row.status === "Exception" ? "danger" : "muted"}>{row.status}</Status></td></tr>)}</tbody></table></div>
        <div className="panel-actions"><span>Showing 14 of {demoHeadcountRows.length} companies.</span><button className="secondary">View all companies</button></div>
      </article>
    </section>
  );
}
