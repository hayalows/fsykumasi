import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("Phase 4 reports promote participant identity and hide empty or technical columns",async()=>{
 const reports=await read("src/pages/Reports.jsx");
 assert.match(reports,/PARTICIPANT_REPORTS/);
 assert.match(reports,/HIDDEN_DISPLAY_COLUMNS/);
 assert.match(reports,/company_roster:new Set\(\["company_number","group_number"\]\)/);
 assert.match(reports,/const promoted=\[person,id\]\.filter\(Boolean\)/);
 assert.match(reports,/rows\.some\(row=>!isBlank\(row\[key\]\)\)/);
 assert.match(reports,/Participant name, FSY ID, company, group, ward or stake/);
 assert.match(reports,/report-sticky-col/);
});

test("Phase 4 report exports follow the useful visible column set",async()=>{
 const reports=await read("src/pages/Reports.jsx");
 assert.match(reports,/const exportColumns=columns\.length\?columns:selected\?\.columns\|\|\[\]/);
 assert.match(reports,/downloadCsv\(selected\.title,exportColumns,exportRows\)/);
 assert.match(reports,/downloadXlsx\(selected\.title,exportColumns,exportRows,exportMeta\)/);
 assert.match(reports,/columns:exportColumns/);
});

test("FSY IDs use one compact work surface instead of metric-card stacks",async()=>{
 const identity=await read("src/pages/RegistrationIdentityV31.jsx");
 assert.match(identity,/identity-v31-summary/);
 assert.match(identity,/identity-v31-table/);
 assert.match(identity,/Participant name, FSY ID, ward, stake, company or group/);
 assert.match(identity,/Prepare IDs/);
 assert.match(identity,/Finalize/);
 assert.doesNotMatch(identity,/ops-metrics identity-metrics-v5/);
});

test("Staff readiness opens the exact Staff member in Assignments",async()=>{
 const staff=await read("src/pages/StaffReadinessV31.jsx");
 assert.match(staff,/staffId:person\.id/);
 assert.match(staff,/Review all in Assignments/);
 assert.match(staff,/Staff member/);
 assert.match(staff,/Responsibility/);
 assert.match(staff,/Readiness/);
 assert.match(staff,/Next action/);
});

test("Final roster keeps safety logic but reveals only the current stage",async()=>{
 const finalRoster=await read("src/pages/RegistrationFinalBaselineV22.jsx");
 assert.match(finalRoster,/\[\[1,"Upload"\],\[2,"Validate"\],\[3,"Identity matches"\],\[4,"Impact"\],\[5,"Apply"\]\]/);
 assert.match(finalRoster,/currentStep===1/);
 assert.match(finalRoster,/currentStep===2/);
 assert.match(finalRoster,/currentStep===3/);
 assert.match(finalRoster,/currentStep===4/);
 assert.match(finalRoster,/currentStep===5/);
 assert.match(finalRoster,/previewFinalRegistrationBaseline/);
 assert.match(finalRoster,/applyFinalRegistrationBaseline/);
 assert.match(finalRoster,/one database transaction/i);
});

test("Readiness uses the Phase 4 tools while preserving Phase 2 component contracts",async()=>{
 const readiness=await read("src/pages/RegistrationReadinessV30.jsx");
 assert.match(readiness,/IdentityFoundationV31 as IdentityFoundationV28/);
 assert.match(readiness,/RegistrationFinalBaselineV22 as RegistrationFinalBaselineV21/);
 assert.match(readiness,/StaffReadinessV31 as StaffReadiness/);
 assert.match(readiness,/One exception queue/);
});

test("Phase 4 mobile styles remove the horizontal report picker and stack operational rows",async()=>{
 const css=await read("src/phase4-operations-v32.css");
 assert.match(css,/@media\(max-width:820px\)/);
 assert.match(css,/phase4-reports-page \.report-library-group\{display:block;overflow:visible/);
 assert.match(css,/identity-v31-row,.staff-readiness-v31-row\{display:grid;grid-template-columns:1fr 1fr/);
 assert.match(css,/@media\(max-width:520px\)/);
 const main=await read("src/main.jsx");
 assert.match(main,/phase4-operations-v32\.css/);
});
