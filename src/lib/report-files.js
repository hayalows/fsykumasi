const encoder = new TextEncoder();

export function formatReportValue(value, type = "text") {
  if (value === null || value === undefined || value === "") return "";
  if (type === "boolean") return value === true || value === "true" ? "Yes" : "No";
  if (type === "number") return Number.isFinite(Number(value)) ? String(Number(value)) : String(value);
  if (type === "date") {
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(date) : String(value);
  }
  if (type === "datetime") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date) : String(value);
  }
  return String(value);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsvText(columns, rows) {
  const header = columns.map((column) => csvCell(column[1])).join(",");
  const body = rows.map((row) => columns.map(([key, , type]) => csvCell(formatReportValue(row[key], type))).join(","));
  return `\ufeff${[header, ...body].join("\r\n")}`;
}

function safeFilename(value) {
  return String(value || "report").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "report";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadCsv(title, columns, rows) {
  const blob = new Blob([buildCsvText(columns, rows)], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `${safeFilename(title)}-${new Date().toISOString().slice(0, 10)}.csv`);
}

function escapeXml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function columnName(index) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function excelSerial(value, dateOnly = false) {
  const date = dateOnly ? new Date(`${String(value).slice(0, 10)}T00:00:00Z`) : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.getTime() / 86400000 + 25569;
}

function cellXml(value, type, ref, header = false) {
  if (header) return `<c r="${ref}" t="inlineStr" s="1"><is><t>${escapeXml(value)}</t></is></c>`;
  if (value === null || value === undefined || value === "") return `<c r="${ref}"/>`;
  if (type === "number" && Number.isFinite(Number(value))) return `<c r="${ref}" t="n"><v>${Number(value)}</v></c>`;
  if (type === "boolean") return `<c r="${ref}" t="b"><v>${value === true || value === "true" ? 1 : 0}</v></c>`;
  if (type === "date" || type === "datetime") {
    const serial = excelSerial(value, type === "date");
    if (serial !== null) return `<c r="${ref}" t="n" s="${type === "date" ? 2 : 3}"><v>${serial}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function worksheetXml(columns, rows) {
  const lastColumn = columnName(Math.max(0, columns.length - 1));
  const lastRow = Math.max(1, rows.length + 1);
  const widths = columns.map(([key, label], index) => {
    let max = Math.max(10, String(label).length + 2);
    for (const row of rows.slice(0, 200)) max = Math.max(max, Math.min(42, String(row[key] ?? "").length + 2));
    return `<col min="${index + 1}" max="${index + 1}" width="${Math.min(42, max)}" customWidth="1"/>`;
  }).join("");
  const header = columns.map(([, label], index) => cellXml(label, "text", `${columnName(index)}1`, true)).join("");
  const body = rows.map((row, rowIndex) => `<row r="${rowIndex + 2}">${columns.map(([key, , type], columnIndex) => cellXml(row[key], type, `${columnName(columnIndex)}${rowIndex + 2}`)).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${widths}</cols>
  <sheetData><row r="1">${header}</row>${body}</sheetData>
  <autoFilter ref="A1:${lastColumn}${lastRow}"/>
</worksheet>`;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function u16(value) { const out = new Uint8Array(2); new DataView(out.buffer).setUint16(0, value, true); return out; }
function u32(value) { const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, value >>> 0, true); return out; }

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const stamp = dosDateTime();
  for (const [name, content] of files) {
    const nameBytes = encoder.encode(name);
    const data = typeof content === "string" ? encoder.encode(content) : content;
    const crc = crc32(data);
    const local = concatBytes([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.date),
      u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes, data,
    ]);
    const central = concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.date),
      u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes,
    ]);
    locals.push(local); centrals.push(central); offset += local.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  return concatBytes([
    ...locals,
    ...centrals,
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralSize), u32(offset), u16(0),
  ]);
}

export function buildXlsxBlob(columns, rows, metadata = {}) {
  const created = new Date().toISOString();
  const files = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`],
    ["docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>FSY Kumasi Operations</Application></Properties>`],
    ["docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(metadata.title || "FSY Kumasi report")}</dc:title><dc:creator>${escapeXml(metadata.generatedBy || "FSY Kumasi Operations")}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created></cp:coreProperties>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFF3F8"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`],
    ["xl/worksheets/sheet1.xml", worksheetXml(columns, rows)],
  ];
  const bytes = zipStore(files);
  return new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function downloadXlsx(title, columns, rows, metadata = {}) {
  downloadBlob(buildXlsxBlob(columns, rows, { ...metadata, title }), `${safeFilename(title)}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function printReport({ sessionName, title, generatedAt, generatedBy, scope, columns, rows }) {
  const popup = window.open("", "_blank", "noopener,noreferrer");
  if (!popup) throw new Error("Allow pop-ups for FSY Ops to open the printable report.");
  const landscape = columns.length > 7;
  const head = columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("");
  const body = rows.map((row) => `<tr>${columns.map(([key, , type]) => `<td>${escapeHtml(formatReportValue(row[key], type))}</td>`).join("")}</tr>`).join("");
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page{size:A4 ${landscape ? "landscape" : "portrait"};margin:12mm}
    *{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;font-size:9pt}header{display:flex;justify-content:space-between;gap:18px;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:7mm;margin-bottom:5mm}h1{font-size:17pt;margin:0 0 2mm}p{margin:0;color:#444}.meta{text-align:right;font-size:8pt;line-height:1.5}table{border-collapse:collapse;width:100%;table-layout:auto}thead{display:table-header-group}th{background:#eef2f6;text-align:left;font-size:8pt;padding:5px;border:1px solid #ccd3da;white-space:nowrap}td{padding:4px 5px;border:1px solid #d8dde2;vertical-align:top;overflow-wrap:anywhere}tr{break-inside:avoid}footer{margin-top:5mm;padding-top:3mm;border-top:1px solid #bbb;font-size:8pt;color:#555;display:flex;justify-content:space-between}.private{font-weight:700;color:#7b1d1d}@media print{button{display:none}}
  </style></head><body><header><div><p>FSY Kumasi Operations</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(sessionName || "FSY Kumasi")}</p></div><div class="meta"><div>${escapeHtml(scope || "Whole session")}</div><div>Generated ${escapeHtml(formatReportValue(generatedAt, "datetime"))}</div><div>By ${escapeHtml(generatedBy || "FSY leader")}</div></div></header><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table><footer><span>${rows.length.toLocaleString()} row${rows.length === 1 ? "" : "s"}</span><span>Generated from live FSY Ops data</span></footer><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),120));<\/script></body></html>`);
  popup.document.close();
}
