import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { DownloadSimple } from "@phosphor-icons/react/DownloadSimple";
import { FileCsv } from "@phosphor-icons/react/FileCsv";
import { FileXls } from "@phosphor-icons/react/FileXls";
import { Printer } from "@phosphor-icons/react/Printer";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { Empty, MutationFeedback, PageHead, SearchField, Status } from "../components/UI.jsx";
import { getAvailableReports, loadOperationalReport } from "../lib/reports.js";
import { downloadCsv, downloadXlsx, formatReportValue, printReport } from "../lib/report-files.js";

function groupedReports(reports) {
  const groups = [];
  for (const report of reports) {
    let group = groups.find((item) => item.category === report.category);
    if (!group) { group = { category: report.category, reports: [] }; groups.push(group); }
    group.reports.push(report);
  }
  return groups;
}

function rowMatches(row, columns, query) {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  return columns.some(([key, , type]) => formatReportValue(row[key], type).toLowerCase().includes(text));
}

function summaryServices(summary = {}) {
  return Array.isArray(summary.services) ? summary.services : [];
}

export function Reports({ sessionId, sessionName, capabilities = [], live = false }) {
  const available = useMemo(() => getAvailableReports(capabilities), [capabilities]);
  const groups = useMemo(() => groupedReports(available), [available]);
  const [selectedKey, setSelectedKey] = useState(available[0]?.key || "");
  const [datasets, setDatasets] = useState({});
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(120);

  useEffect(() => {
    if (selectedKey && available.some((item) => item.key === selectedKey)) return;
    setSelectedKey(available[0]?.key || "");
  }, [available, selectedKey]);

  const selected = available.find((item) => item.key === selectedKey) || null;
  const dataset = selected ? datasets[selected.key] : null;

  const load = async (reportKey, force = false) => {
    if (!reportKey || !live || !sessionId) return;
    if (!force && datasets[reportKey]) return;
    setLoading(reportKey); setError("");
    try {
      const next = await loadOperationalReport(sessionId, reportKey);
      setDatasets((current) => ({ ...current, [reportKey]: next }));
    } catch (err) {
      setError(err.message || "Unable to load this report.");
    } finally {
      setLoading("");
    }
  };

  useEffect(() => { if (selected?.key) load(selected.key); }, [selected?.key, live, sessionId]);
  useEffect(() => { setQuery(""); setVisibleLimit(120); }, [selectedKey]);

  const rows = dataset?.rows || [];
  const filteredRows = useMemo(() => selected ? rows.filter((row) => rowMatches(row, selected.columns, query)) : [], [rows, selected, query]);
  const previewRows = filteredRows.slice(0, visibleLimit);
  const exportRows = query.trim() ? filteredRows : rows;
  const services = summaryServices(dataset?.summary);

  const exportMeta = dataset ? { generatedBy: dataset.generatedBy, generatedAt: dataset.generatedAt, scope: dataset.scope } : {};
  const exportLabel = query.trim() ? `${exportRows.length} filtered` : `${rows.length}`;

  if (!available.length) return <section className="page"><PageHead title="Reports" sessionName={sessionName} description="Reports appear when an administrator gives your assignment an export responsibility."/><article className="panel"><Empty icon={FileCsv} title="No report access" text="Your current role can keep working in FSY Ops, but it does not include any export permissions."/></article></section>;

  return <section className="page reports-page phase3-reports-page">
    <PageHead title="Reports" sessionName={sessionName} description="Choose the job you need to support, review the live snapshot, then export it in the format that fits the work." />
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}

    <div className="report-centre-layout">
      <aside className="report-library panel" aria-label="Report library">
        <div className="report-library-heading"><span className="kicker">Report centre</span><h2>Operational reports</h2><p>Only reports allowed by your current assignment are shown.</p></div>
        {groups.map((group) => <div className="report-library-group" key={group.category}><span>{group.category}</span>{group.reports.map((report) => <button key={report.key} type="button" className={selectedKey === report.key ? "active" : ""} onClick={() => setSelectedKey(report.key)} aria-current={selectedKey === report.key ? "true" : undefined}><span><b>{report.title}</b><small>{report.description}</small></span>{report.sensitive ? <ShieldCheck size={18} weight="fill" aria-label="Restricted report"/> : null}</button>)}</div>)}
      </aside>

      <div className="report-workspace">
        {selected ? <article className="panel report-preview-shell">
          <header className="report-preview-head">
            <div><span className="kicker">{selected.category}</span><h2>{selected.title}</h2><p>{selected.description}</p></div>
            <button type="button" className="secondary compact-button report-refresh" disabled={loading === selected.key || !live} onClick={() => load(selected.key, true)}><ArrowClockwise size={18}/>{loading === selected.key ? "Refreshing…" : "Refresh"}</button>
          </header>

          {selected.sensitive ? <div className="report-sensitive-note"><ShieldCheck weight="fill"/><div><b>Restricted operational data</b><span>This dataset is separately authorized and should only be shared with people whose assignment requires it.</span></div></div> : null}

          {!live ? <div className="report-loading-state"><WarningCircle size={24}/><div><b>Live report data is unavailable in demo mode</b><span>Use the production or training workspace to exercise report exports.</span></div></div> : loading === selected.key && !dataset ? <div className="report-loading-state"><span className="report-spinner"/><div><b>Building the live snapshot</b><span>The rest of FSY Ops remains available while this report loads.</span></div></div> : dataset ? <>
            <div className="report-freshness"><span><b>{rows.length.toLocaleString()}</b><small>rows in snapshot</small></span><span><b>{formatReportValue(dataset.generatedAt, "datetime")}</b><small>generated</small></span><span><b>{dataset.generatedBy}</b><small>generated by</small></span></div>

            {services.length ? <div className="report-service-summary" aria-label="Meal service summary">{services.map((service) => <div key={`${service.service_date}-${service.label}`}><span><b>{service.label}</b><small>{formatReportValue(service.service_date, "date")} · {service.status}</small></span><span><b>{Number(service.served || 0).toLocaleString()} / {Number(service.expected || 0).toLocaleString()}</b><small>served</small></span></div>)}</div> : null}

            <div className="report-toolbar">
              <SearchField value={query} onChange={(value) => { setQuery(value); setVisibleLimit(120); }} label={`Search ${selected.title}`} placeholder="Search this report"/>
              <div className="report-export-actions" aria-label="Export report">
                <button type="button" className="secondary" disabled={!exportRows.length} onClick={() => downloadCsv(selected.title, selected.columns, exportRows)}><FileCsv/>CSV</button>
                <button type="button" className="secondary" disabled={!exportRows.length} onClick={() => downloadXlsx(selected.title, selected.columns, exportRows, exportMeta)}><FileXls/>Excel</button>
                <button type="button" className="primary" disabled={!exportRows.length} onClick={() => { try { printReport({ sessionName, title: selected.title, generatedAt: dataset.generatedAt, generatedBy: dataset.generatedBy, scope: dataset.scope, columns: selected.columns, rows: exportRows }); } catch (err) { setError(err.message || "Unable to open the printable report."); } }}><Printer/>Print / PDF</button>
              </div>
            </div>
            <div className="report-export-scope"><span>{query.trim() ? `Exporting ${exportLabel} rows matching this search.` : `Exports include all ${exportLabel} rows in this live snapshot.`}</span><Status tone={query.trim() ? "warn" : "good"}>{query.trim() ? "Filtered" : "Full snapshot"}</Status></div>

            {filteredRows.length ? <>
              <div className="report-table-wrap phase3-report-table"><table><thead><tr>{selected.columns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead><tbody>{previewRows.map((row, index) => <tr key={`${selected.key}-${index}`}>{selected.columns.map(([key, label, type]) => <td key={key} data-label={label}>{formatReportValue(row[key], type)}</td>)}</tr>)}</tbody></table></div>
              <div className="report-preview-foot"><span>Showing {previewRows.length.toLocaleString()} of {filteredRows.length.toLocaleString()}{query.trim() ? " matching" : ""} rows</span>{filteredRows.length > visibleLimit ? <button type="button" className="secondary compact-button" onClick={() => setVisibleLimit((value) => value + 120)}>Show 120 more</button> : null}</div>
            </> : <Empty icon={FileCsv} title={query.trim() ? "No rows match this search" : "No rows in this report yet"} text={query.trim() ? "Clear the search or try another name, ID, unit or status." : "The report will populate as the corresponding operational work is recorded."}/>}          
          </> : null}
        </article> : null}
      </div>
    </div>
    <p className="report-footnote"><DownloadSimple size={16}/> CSV is the simplest raw export. Excel downloads a genuine .xlsx workbook with filters and a frozen header. Print / PDF opens a print-ready report so the browser can print or save it as PDF without losing Ghanaian names.</p>
  </section>;
}
