import { useMemo, useState } from "react";
import { DownloadSimple } from "@phosphor-icons/react/DownloadSimple";
import { FileCsv } from "@phosphor-icons/react/FileCsv";
import { Printer } from "@phosphor-icons/react/Printer";
import { PageHead, SegmentedControl } from "../components/UI.jsx";
import { hasCapability } from "../lib/field-operations.js";
import "./field-operations.css";

const REPORTS = [
  ["companies","Company assignments"],
  ["headcount","Head count"],
  ["housing","Housing list"],
  ["birthdays","Birthdays"],
  ["dietary","Dietary needs"],
];

function csvCell(value) { const text=String(value ?? ""); return /[",\n]/.test(text) ? `"${text.replace(/"/g,'""')}"` : text; }
function downloadCsv(name, rows) {
  if (!rows.length) return;
  const headers=Object.keys(rows[0]);
  const csv=[headers.map(csvCell).join(","),...rows.map((row)=>headers.map((key)=>csvCell(row[key])).join(","))].join("\r\n");
  const blob=new Blob(["\ufeff",csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
function stamp(sessionName) { return `${sessionName || "FSY"} · generated ${new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(new Date())}`; }

export function Reports({ sessionName, capabilities=[], companies=[], headcount={round:null,submissions:[]}, housingAssignments=[], birthdays=[], staffBirthdays=[], foodNeeds=[] }) {
  const [report,setReport]=useState("companies");
  const canExport=hasCapability(capabilities,"reports_export") || capabilities.includes("access_admin");
  const rows=useMemo(()=>{
    if(report==="companies") return companies.flatMap((company)=> (company.groups||[]).map((group)=>({ Company:company.displayName||company.name, "Counselor group":group.displayName||group.name, Sex:group.sex||"", Youth:Number(group.memberCount||group.members?.length||0), Counselor:group.counselorName||"", "Meeting spot":company.meetingSpot||"" })));
    if(report==="headcount") return companies.map((company)=>{ const s=(headcount.submissions||[]).find((item)=>item.company_id===company.id); return { Round:headcount.round?.label||"No open round", Company:company.displayName||company.name, Expected:s?.expected_count??"", Accounted:s?.accounted_count??"", Status:s?.status||"Awaiting", Note:s?.note||"", Submitted:s?.submitted_at||"" }; });
    if(report==="housing") return housingAssignments.map((item)=>({ Room:item.roomName, Name:item.name, Type:item.personType, Sex:item.sex||"", Company:item.company||"", Group:item.group||"", "Bed / key":item.bedLabel||"", Assigned:item.assignedAt||"" }));
    if(report==="birthdays") return [...birthdays.map((item)=>({ Date:item.date, Name:item.name, Type:"Youth", Context:[item.company,item.group].filter(Boolean).join(" · "), Acknowledged:item.acknowledged?"Yes":"No" })),...staffBirthdays.map((item)=>({ Date:item.date, Name:item.name, Type:"Counselor", Context:item.company||"", Acknowledged:item.acknowledged?"Yes":"No" }))].sort((a,b)=>String(a.Date).localeCompare(String(b.Date)));
    if(report==="dietary") return foodNeeds.map((item)=>({ Name:item.name, Type:item.personType, Company:item.company||"", Group:item.group||"", "Dietary need":item.dietaryInformation, Acknowledged:item.acknowledged?"Yes":"No" }));
    return [];
  },[report,companies,headcount,housingAssignments,birthdays,staffBirthdays,foodNeeds]);
  const title=REPORTS.find(([key])=>key===report)?.[1]||"Report";
  const restricted=report==="dietary" && !hasCapability(capabilities,"food_export");

  return <section className="page reports-page">
    <PageHead title="Reports" sessionName={sessionName} description="Generate a current operational snapshot. Printed copies include a generated-at marker so stale lists are easier to spot." action={!restricted && canExport && rows.length ? <div className="report-actions"><button className="secondary" onClick={()=>window.print()}><Printer/>Print / Save PDF</button><button className="primary" onClick={()=>downloadCsv(`${report}-${new Date().toISOString().slice(0,10)}.csv`,rows)}><DownloadSimple/>Open in Excel</button></div> : null}/>
    <SegmentedControl label="Report type" value={report} onChange={setReport} options={REPORTS.filter(([key])=>key!=="dietary"||hasCapability(capabilities,"food_view")).map(([value,label])=>({value,label}))}/>
    <article className="panel report-sheet"><header><div><span className="kicker">Operational report</span><h2>{title}</h2><p>{stamp(sessionName)}</p></div><FileCsv size={28}/></header>
      {restricted ? <div className="field-no-access"><h3>Dietary export is restricted</h3><p>Your role can work with other reports but does not have Food export permission.</p></div> : rows.length ? <div className="report-table-wrap"><table><thead><tr>{Object.keys(rows[0]).map((key)=><th key={key}>{key}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={index}>{Object.keys(rows[0]).map((key)=><td key={key}>{String(row[key]??"")}</td>)}</tr>)}</tbody></table></div> : <div className="empty-inline"><b>No rows in this report yet</b><span>The report will populate as the corresponding operations data is created.</span></div>}
      <footer><span>{rows.length} row{rows.length===1?"":"s"}</span><span>{stamp(sessionName)}</span></footer>
    </article>
    <p className="form-hint">The Excel action downloads an Excel-compatible CSV so coordinators can sort and filter it without adding a heavy spreadsheet dependency to the field app.</p>
  </section>;
}
