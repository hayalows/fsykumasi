import { PersonName } from "../components/PersonPeek.jsx";
import { matchesPersonSearch, personSearchRank } from "../lib/person-search.js";
import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { DownloadSimple } from "@phosphor-icons/react/DownloadSimple";
import { FileCsv } from "@phosphor-icons/react/FileCsv";
import { FileXls } from "@phosphor-icons/react/FileXls";
import { Printer } from "@phosphor-icons/react/Printer";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { Empty, MutationFeedback, PageHead, SearchField, Status } from "../components/UI.jsx";
import { getAvailableReports, loadOperationalReport } from "../lib/reports-v53.js";
import { downloadCsv, downloadXlsx, formatReportValue, printReport } from "../lib/report-files.js";
import "../reports-v77.css";

const PARTICIPANT_REPORTS = new Set([
  "participant_master",
  "unit_arrival",
  "company_roster",
  "counselor_group",
  "badge_production",
  "badge_exceptions",
  "onsite_registrations",
  "participant_membership",
]);
const HIDDEN_DISPLAY_COLUMNS = {
  company_roster: new Set(["company_number", "group_number"]),
  counselor_group: new Set(["company_number", "group_number"]),
};
const PERSON_KEYS = ["full_name", "name", "original_name", "replacement_name"];
const ID_KEYS = ["fsy_id", "original_fsy_id", "replacement_fsy_id"];
const PAGE_SIZE = 120;

function groupedReports(reports) {
  const groups = [];
  for (const report of reports) {
    let group = groups.find((item) => item.category === report.category);
    if (!group) {
      group = { category: report.category, reports: [] };
      groups.push(group);
    }
    group.reports.push(report);
  }
  return groups;
}

function rowMatches(row, columns, query) {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  return matchesPersonSearch(row, text, columns.map(([key, , type]) => formatReportValue(row[key], type)));
}

function summaryServices(summary = {}) {
  return Array.isArray(summary.services) ? summary.services : [];
}

function summaryMembership(summary = {}) {
  return Array.isArray(summary.membership) ? summary.membership : [];
}

function displayLabel(reportKey, key, label) {
  return PARTICIPANT_REPORTS.has(reportKey) && key === "full_name" ? "Participant" : label;
}

function displayColumns(report, showNumberColumns) {
  if (!report) return [];
  const hidden = HIDDEN_DISPLAY_COLUMNS[report.key] || new Set();
  const available = report.columns.filter(([key]) => showNumberColumns || !hidden.has(key));
  if (!PARTICIPANT_REPORTS.has(report.key)) return available;
  const person = available.find(([key]) => PERSON_KEYS.includes(key));
  const id = available.find(([key]) => ID_KEYS.includes(key));
  const promoted = [person, id].filter(Boolean);
  return [...promoted, ...available.filter((column) => !promoted.includes(column))];
}

function personCell(row, key) {
  if (!PERSON_KEYS.includes(key)) return null;
  const id = row.participant_id || row.staff_id || row.person_id;
  if (!id) return null;
  return <PersonName person={{ ...row, id, fullName: row[key], name: row[key] }} kind={row.staff_id || row.person_type === "staff" ? "staff" : "participant"} />;
}

function cacheKey(sessionId, reportKey) {
  return `${sessionId || "demo"}:${reportKey || "none"}`;
}

export function Reports({ sessionId, sessionName, capabilities = [], currentRole = "", live = false }) {
  const available = useMemo(() => getAvailableReports(capabilities, currentRole), [capabilities, currentRole]);
  const groups = useMemo(() => groupedReports(available), [available]);
  const [selectedKey, setSelectedKey] = useState(available[0]?.key || "");
  const [datasets, setDatasets] = useState({});
  const [loadingByKey, setLoadingByKey] = useState({});
  const [errorsByKey, setErrorsByKey] = useState({});
  const [query, setQuery] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const [showNumberColumns, setShowNumberColumns] = useState(true);
  const [exportMode, setExportMode] = useState("all");

  useEffect(() => {
    if (selectedKey && available.some((item) => item.key === selectedKey)) return;
    setSelectedKey(available[0]?.key || "");
  }, [available, selectedKey]);

  const selected = available.find((item) => item.key === selectedKey) || null;
  const selectedCacheKey = cacheKey(sessionId, selected?.key);
  const dataset = selected ? datasets[selectedCacheKey] : null;
  const loading = Boolean(loadingByKey[selectedCacheKey]);
  const error = selected ? errorsByKey[selectedCacheKey] || "" : "";

  const load = async (reportKey, force = false) => {
    if (!reportKey || !live || !sessionId) return;
    const key = cacheKey(sessionId, reportKey);
    setErrorsByKey((current) => ({ ...current, [key]: "" }));
    if (!force && datasets[key]) return;
    setLoadingByKey((current) => ({ ...current, [key]: true }));
    try {
      const next = await loadOperationalReport(sessionId, reportKey);
      setDatasets((current) => ({ ...current, [key]: next }));
    } catch (err) {
      setErrorsByKey((current) => ({ ...current, [key]: err.message || "Unable to load this report." }));
    } finally {
      setLoadingByKey((current) => ({ ...current, [key]: false }));
    }
  };

  useEffect(() => {
    if (selected?.key) load(selected.key);
  }, [selected?.key, live, sessionId]);

  useEffect(() => {
    setQuery("");
    setVisibleLimit(PAGE_SIZE);
    setShowNumberColumns(true);
    setExportMode("all");
  }, [selectedKey, sessionId]);

  const rows = dataset?.rows || [];
  const columns = useMemo(() => displayColumns(selected, showNumberColumns), [selected, showNumberColumns]);
  const filteredRows = useMemo(() => selected
    ? rows
      .filter((row) => rowMatches(row, selected.columns, query))
      .sort((a, b) => query.trim() ? personSearchRank(a, query) - personSearchRank(b, query) : 0)
    : [], [rows, selected, query]);
  const previewRows = filteredRows.slice(0, visibleLimit);
  const exportColumns = selected?.columns || [];
  const exportRows = query.trim() && exportMode === "filtered" ? filteredRows : rows;
  const services = summaryServices(dataset?.summary);
  const membership = summaryMembership(dataset?.summary);
  const exportMeta = dataset ? { generatedBy: dataset.generatedBy, generatedAt: dataset.generatedAt, scope: dataset.scope } : {};
  const hiddenNumberCount = selected ? (HIDDEN_DISPLAY_COLUMNS[selected.key]?.size || 0) : 0;

  const setCurrentError = (message) => {
    if (!selected) return;
    setErrorsByKey((current) => ({ ...current, [selectedCacheKey]: message }));
  };

  if (!available.length) {
    return <section className="page"><PageHead title="Reports" sessionName={sessionName} description="Reports appear when an administrator gives your assignment an export responsibility." /><article className="panel"><Empty icon={FileCsv} title="No report access" text="Your current role can keep working in FSY Ops, but it does not include any export permissions." /></article></section>;
  }

  return <section className="page reports-page phase3-reports-page phase4-reports-page reports-v53 reports-v77">
    <PageHead title="Reports" sessionName={sessionName} description="Open a live report, see every defined field, search the snapshot, then export it to CSV, Excel or a print-ready PDF." />
    {error ? <MutationFeedback tone="error">{error}</MutationFeedback> : null}
    <div className="report-centre-layout">
      <aside className="report-library panel" aria-label="Report library">
        <div className="report-library-heading"><span className="kicker">Report centre</span><h2>Operational reports</h2><p>Choose a report. Each section loads on demand so the rest of FSY Ops stays responsive.</p></div>
        {groups.map((group) => <div className="report-library-group" key={group.category}>
          <span>{group.category}</span>
          {group.reports.map((report) => {
            const saved = datasets[cacheKey(sessionId, report.key)];
            return <button key={report.key} type="button" className={selectedKey === report.key ? "active" : ""} onClick={() => setSelectedKey(report.key)} aria-current={selectedKey === report.key ? "true" : undefined}>
              <span><b>{report.title}</b><small>{report.description}</small>{saved ? <small className="report-library-count">{(saved.rows?.length || 0).toLocaleString()} rows loaded</small> : null}</span>
              {report.sensitive ? <ShieldCheck size={18} weight="fill" aria-label="Restricted report" /> : null}
            </button>;
          })}
        </div>)}
      </aside>

      <div className="report-workspace">
        {selected ? <article className="panel report-preview-shell">
          <header className="report-preview-head">
            <div><span className="kicker">{selected.category}</span><h2>{selected.title}</h2><p>{selected.description}</p></div>
            <button type="button" className="secondary compact-button report-refresh" disabled={loading || !live} onClick={() => load(selected.key, true)}><ArrowClockwise size={18} />{loading ? "Refreshing…" : "Refresh"}</button>
          </header>

          {selected.sensitive ? <div className="report-sensitive-note"><ShieldCheck weight="fill" /><div><b>Restricted operational data</b><span>This dataset is separately authorized and should only be shared with people whose assignment requires it.</span></div></div> : null}

          {!live ? <div className="report-loading-state"><WarningCircle size={24} /><div><b>Live report data is unavailable in demo mode</b><span>Use the production or training workspace to exercise report exports.</span></div></div>
            : loading && !dataset ? <div className="report-loading-state"><span className="report-spinner" /><div><b>Building the live snapshot</b><span>If the data service has a short timeout, Reports retries this read once automatically.</span></div></div>
              : dataset ? <>
                <div className="report-scope-note"><ShieldCheck size={18} /><span><b>{dataset.scope || "Your current FSY scope"}</b><small>The server applies this scope before report rows reach this device.</small></span></div>
                <div className="report-freshness">
                  <span><b>{rows.length.toLocaleString()}</b><small>rows</small></span>
                  <span><b>{selected.columns.length.toLocaleString()}</b><small>fields</small></span>
                  <span><b>{formatReportValue(dataset.generatedAt, "datetime")}</b><small>generated</small></span>
                  <span><b>{dataset.generatedBy}</b><small>generated by</small></span>
                </div>

                {membership.length ? <div className="report-membership-summary-v53" aria-label="Participant membership summary">{membership.map((item) => <div key={item.key}><b>{Number(item.count || 0).toLocaleString()}</b><small>{item.label}</small></div>)}</div> : null}
                {services.length ? <div className="report-service-summary" aria-label="Meal service summary">{services.map((service) => <div key={`${service.service_date}-${service.label}`}><span><b>{service.label}</b><small>{formatReportValue(service.service_date, "date")} · {service.status}</small></span><span><b>{Number(service.served || 0).toLocaleString()} / {Number(service.expected || 0).toLocaleString()}</b><small>served</small></span></div>)}</div> : null}

                <div className="report-toolbar phase4-report-toolbar">
                  <SearchField value={query} onChange={(value) => { setQuery(value); setVisibleLimit(PAGE_SIZE); }} label={`Search ${selected.title}`} placeholder={PARTICIPANT_REPORTS.has(selected.key) ? "Participant name, FSY ID, company, group, ward or stake" : "Search this report"} />
                  <div className="report-export-actions" aria-label="Export report">
                    <button type="button" className="secondary" disabled={!exportRows.length} onClick={() => downloadCsv(selected.title, exportColumns, exportRows)}><FileCsv />CSV</button>
                    <button type="button" className="secondary" disabled={!exportRows.length} onClick={() => downloadXlsx(selected.title, exportColumns, exportRows, exportMeta)}><FileXls />Excel</button>
                    <button type="button" className="primary" disabled={!exportRows.length} onClick={() => {
                      try {
                        printReport({ sessionName, title: selected.title, generatedAt: dataset.generatedAt, generatedBy: dataset.generatedBy, scope: dataset.scope, columns: exportColumns, rows: exportRows });
                      } catch (err) {
                        setCurrentError(err.message || "Unable to open the printable report.");
                      }
                    }}><Printer />Print / PDF</button>
                  </div>
                </div>

                <div className="reports-v77-controls">
                  <div className="reports-v77-view-controls">
                    <span><b>{columns.length} of {selected.columns.length} fields shown</b><small>Blank fields stay visible so the report structure does not change while you work.</small></span>
                    {hiddenNumberCount ? <button type="button" className="secondary compact-button" onClick={() => setShowNumberColumns((value) => !value)}>{showNumberColumns ? "Hide number columns" : "Show all columns"}</button> : null}
                  </div>
                  {query.trim() ? <div className="reports-v77-export-mode" aria-label="Choose export rows">
                    <span><b>Export rows</b><small>Choose the whole live snapshot or only the current search results.</small></span>
                    <div role="group" aria-label="Export scope">
                      <button type="button" className={exportMode === "all" ? "active" : ""} onClick={() => setExportMode("all")}>All {rows.length.toLocaleString()}</button>
                      <button type="button" className={exportMode === "filtered" ? "active" : ""} onClick={() => setExportMode("filtered")}>Matching {filteredRows.length.toLocaleString()}</button>
                    </div>
                  </div> : null}
                </div>

                <div className="report-export-scope">
                  <span>{query.trim() && exportMode === "filtered"
                    ? `CSV, Excel and Print / PDF will export the ${filteredRows.length.toLocaleString()} rows matching this search.`
                    : `CSV, Excel and Print / PDF will export all ${rows.length.toLocaleString()} rows in this live snapshot.`} All {selected.columns.length} defined report fields are included in the files.</span>
                  <Status tone={query.trim() && exportMode === "filtered" ? "warn" : "good"}>{query.trim() && exportMode === "filtered" ? "Filtered export" : "Full export"}</Status>
                </div>

                {filteredRows.length ? <>
                  <div className="report-table-wrap phase3-report-table phase4-report-table"><table><thead><tr>{columns.map(([key, label], index) => <th key={key} className={PARTICIPANT_REPORTS.has(selected.key) && index < 2 ? `report-sticky-col report-sticky-${index + 1}` : ""}>{displayLabel(selected.key, key, label)}</th>)}</tr></thead><tbody>{previewRows.map((row, index) => <tr key={`${selected.key}-${row.participant_id || row.staff_id || row.fsy_id || index}`}>{columns.map(([key, label, type], columnIndex) => {
                    const person = personCell(row, key);
                    return <td key={key} data-label={displayLabel(selected.key, key, label)} className={PARTICIPANT_REPORTS.has(selected.key) && columnIndex < 2 ? `report-sticky-col report-sticky-${columnIndex + 1}` : ""}>{person || formatReportValue(row[key], type)}</td>;
                  })}</tr>)}</tbody></table></div>
                  <div className="report-preview-foot">
                    <span>Showing {previewRows.length.toLocaleString()} of {filteredRows.length.toLocaleString()}{query.trim() ? " matching" : ""} rows</span>
                    <div className="reports-v77-row-actions">
                      {filteredRows.length > visibleLimit ? <button type="button" className="secondary compact-button" onClick={() => setVisibleLimit((value) => value + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, filteredRows.length - visibleLimit).toLocaleString()} more</button> : null}
                      {filteredRows.length > visibleLimit ? <button type="button" className="secondary compact-button" onClick={() => setVisibleLimit(filteredRows.length)}>Show all {filteredRows.length.toLocaleString()}</button> : null}
                    </div>
                  </div>
                </> : <Empty icon={FileCsv} title={query.trim() ? "No rows match this search" : "No records have been captured for this report yet"} text={query.trim() ? "Clear the search or try another participant name, FSY ID, company, group, ward or stake." : "This is a valid empty report. It will populate automatically as the corresponding FSY work is recorded."} />}
              </> : null}
        </article> : null}
      </div>
    </div>
    <p className="report-footnote"><DownloadSimple size={16} /> CSV is the simplest raw export. Excel downloads a genuine .xlsx workbook with filters and a frozen header. Both exports include every defined field, even when a field is currently blank.</p>
  </section>;
}
