import { strToU8, zipSync } from "fflate";
import {
  AccountingEngine,
  type AccountingRepository,
  parsePeriod,
} from "../../../core/index.ts";

export interface ExportSheet {
  name: string;
  rows: Array<Array<string | number | null>>;
}

export interface PdfSection {
  title: string;
  subtitle?: string;
  rows: Array<{ label: string; value?: string; kind?: string }>;
}

function moneyIdr(value: number): string {
  const number = Math.round(Number(value) || 0);
  return `Rp${number.toLocaleString("id-ID")}`;
}

/**
 * Neutralizes spreadsheet formula injection (=, +, -, @, tab, CR) on string cells.
 */
export function sanitizeSpreadsheetCell(value: string | number | null): string | number | null {
  if (typeof value !== "string") return value;
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

export async function buildVerifiedExportData(
  repo: AccountingRepository,
  tenantId: string,
  requestedPeriod?: string,
) {
  const engine = new AccountingEngine(repo);
  const workspace = await engine.getWorkspace(tenantId);
  const period = requestedPeriod || workspace.profile.activePeriod;
  const info = parsePeriod(period);
  const [fin, tb] = await Promise.all([
    engine.getFinancialStatements(tenantId, period),
    engine.getTrialBalance(tenantId, period, true, false),
  ]);

  const accMap = Object.fromEntries(workspace.accounts.map((a) => [a.code, a]));
  const periodEntries = workspace.journalEntries
    .filter((e) => e.date >= info.start && e.date <= info.end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));

  const journalRows = periodEntries.flatMap((e) =>
    e.lines.map((l) => [
      sanitizeSpreadsheetCell(e.documentNumber),
      e.date,
      sanitizeSpreadsheetCell(e.description),
      e.status,
      l.accountCode,
      sanitizeSpreadsheetCell(accMap[l.accountCode]?.name || l.accountCode),
      l.debit,
      l.credit,
    ]),
  );

  const trialRows = tb.rows.map((r) => [
    r.accountCode,
    sanitizeSpreadsheetCell(r.accountName),
    r.debit,
    r.credit,
  ]);

  const assetRows = workspace.accounts
    .filter((a) => ["asset", "contra_asset"].includes(a.group) && (fin.cumulativeBalances[a.code] || 0) !== 0)
    .map((a) => [a.name, fin.cumulativeBalances[a.code] || 0] as const);

  const liabRows = workspace.accounts
    .filter((a) => a.group === "liability" && (fin.cumulativeBalances[a.code] || 0) !== 0)
    .map((a) => [a.name, -(fin.cumulativeBalances[a.code] || 0)] as const);

  const sheets: ExportSheet[] = [
    {
      name: "Jurnal Umum",
      rows: [
        ["No. Dokumen", "Tanggal", "Keterangan", "Status", "No. Akun", "Nama Akun", "Debit", "Kredit"],
        ...journalRows,
      ],
    },
    {
      name: "Neraca Saldo",
      rows: [["No. Akun", "Nama Akun", "Debit", "Kredit"], ...trialRows],
    },
    {
      name: "Laba Rugi",
      rows: [
        ["Uraian", "Jumlah"],
        ["Pendapatan", fin.revenue],
        ["HPP", fin.cogs],
        ["Laba Kotor", fin.grossProfit],
        ["Beban Operasional", fin.operatingExpenses],
        ["Laba Bersih", fin.netIncome],
      ],
    },
    {
      name: "Perubahan Modal",
      rows: [
        ["Uraian", "Jumlah"],
        ["Modal Awal", fin.openingCapital],
        ["Tambahan Modal", fin.capitalAdditions],
        ["Laba Bersih", fin.netIncome],
        ["Prive", fin.drawings],
        ["Modal Akhir", fin.endingCapital],
      ],
    },
    {
      name: "Posisi Keuangan",
      rows: [
        ["Uraian", "Jumlah"],
        ...assetRows.map(([n, v]) => [sanitizeSpreadsheetCell(n), v]),
        ["Total Aset", fin.totalAssets],
        ...liabRows.map(([n, v]) => [sanitizeSpreadsheetCell(n), v]),
        ["Total Liabilitas", fin.totalLiabilities],
        ["Modal Akhir", fin.endingCapital],
        ["Total Liabilitas & Ekuitas", fin.totalLiabilities + fin.totalEquity],
      ],
    },
  ];

  const sections: PdfSection[] = [
    {
      title: "Laporan Laba Rugi",
      subtitle: `Untuk bulan yang berakhir ${info.endLabel}`,
      rows: [
        { label: "Pendapatan", value: moneyIdr(fin.revenue), kind: "detail" },
        { label: "Harga Pokok Penjualan (HPP)", value: moneyIdr(fin.cogs), kind: "detail" },
        { label: "Laba Kotor", value: moneyIdr(fin.grossProfit), kind: "total" },
        { label: "Beban Operasional", value: moneyIdr(fin.operatingExpenses), kind: "detail" },
        { label: "Laba Bersih", value: moneyIdr(fin.netIncome), kind: "final" },
      ],
    },
    {
      title: "Laporan Perubahan Modal",
      subtitle: `Untuk bulan yang berakhir ${info.endLabel}`,
      rows: [
        { label: "Modal Awal Periode", value: moneyIdr(fin.openingCapital), kind: "detail" },
        { label: "Tambahan Modal", value: moneyIdr(fin.capitalAdditions), kind: "detail" },
        { label: "Laba Bersih", value: moneyIdr(fin.netIncome), kind: "detail" },
        { label: "Prive", value: moneyIdr(fin.drawings), kind: "detail" },
        { label: "Modal Akhir", value: moneyIdr(fin.endingCapital), kind: "final" },
      ],
    },
    {
      title: "Laporan Posisi Keuangan",
      subtitle: `Per ${info.endLabel}`,
      rows: [
        { label: "ASET", kind: "section" },
        ...assetRows.map(([label, value]) => ({ label, value: moneyIdr(value), kind: "detail" })),
        { label: "Total Aset", value: moneyIdr(fin.totalAssets), kind: "final" },
        { label: "LIABILITAS & EKUITAS", kind: "section" },
        ...liabRows.map(([label, value]) => ({ label, value: moneyIdr(value), kind: "detail" })),
        { label: "Total Liabilitas", value: moneyIdr(fin.totalLiabilities), kind: "total" },
        { label: "Modal Akhir", value: moneyIdr(fin.endingCapital), kind: "detail" },
        { label: "Total Liabilitas dan Ekuitas", value: moneyIdr(fin.totalLiabilities + fin.totalEquity), kind: "final" },
      ],
    },
  ];

  return {
    period: info.value,
    businessName: workspace.profile.businessName,
    xlsxFilename: `laporan-${info.value}.xlsx`,
    pdfFilename: `laporan-${info.value}.pdf`,
    sheets,
    sections,
  };
}

function xmlEscape(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char] ?? char));
}

function colName(index: number) {
  let value = index + 1;
  let result = "";
  while (value) { value--; result = String.fromCharCode(65 + (value % 26)) + result; value = Math.floor(value / 26); }
  return result;
}

function sheetXml(sheet: ExportSheet) {
  const rows = sheet.rows.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => {
      const ref = `${colName(colIndex)}${rowIndex + 1}`;
      if (typeof value === "number") return `<c r="${ref}" s="${rowIndex === 0 ? 1 : 2}"><v>${Number.isFinite(value) ? value : 0}</v></c>`;
      return `<c r="${ref}" t="inlineStr" s="${rowIndex === 0 ? 1 : 0}"><is><t>${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
}

export function buildXlsxBytes(sheets: ExportSheet[]) {
  const safeNames = sheets.map((sheet, index) => (sheet.name || `Sheet ${index + 1}`).replace(/[\\/*?:[\]]/g, " ").slice(0, 31));
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-package.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-package.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-package.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${safeNames.map((name, i) => `<sheet name="${xmlEscape(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="[$Rp-421] #,##0"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf fontId="0" fillId="0" borderId="0"/><xf fontId="1" fillId="0" borderId="0" applyFont="1"/><xf fontId="0" fillId="0" borderId="0" numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>`),
  };
  sheets.forEach((sheet, index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheetXml(sheet)); });
  return zipSync(files, { level: 6 });
}

function pdfText(value: unknown) {
  return String(value ?? "").normalize("NFKD").replace(/[^\x20-\x7E]/g, "").replace(/([\\()])/g, "\\$1");
}

export function buildPdfBytes(businessName: string, sections: PdfSection[]) {
  const objects: string[] = [];
  const pages: number[] = [];
  const add = (value: string) => { objects.push(value); return objects.length; };
  const catalog = add("");
  const pagesRoot = add("");
  const fontRegular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const fontBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  const startPageCommands = (section: PdfSection, continued: boolean) => [
    "BT",
    "/F2 12 Tf",
    `1 0 0 1 56 790 Tm (${pdfText(businessName.toUpperCase())}) Tj`,
    "/F2 13 Tf",
    `1 0 0 1 56 770 Tm (${pdfText(section.title.toUpperCase() + (continued ? " (LANJUTAN)" : ""))}) Tj`,
    "/F1 9 Tf",
    `1 0 0 1 56 754 Tm (${pdfText(section.subtitle || "")}) Tj`,
  ];

  const flushPage = (commands: string[]) => {
    commands.push("ET");
    const stream = commands.join("\n");
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pages.push(add(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${content} 0 R >>`));
  };

  for (const section of sections) {
    let commands = startPageCommands(section, false);
    let y = 724;
    for (const row of section.rows) {
      if (y < 70) {
        flushPage(commands);
        commands = startPageCommands(section, true);
        y = 724;
      }
      const bold = row.kind === "section" || row.kind === "total" || row.kind === "final";
      const indent = row.kind === "detail" ? 68 : 56;
      commands.push(`/${bold ? "F2" : "F1"} ${bold ? 9.5 : 9} Tf`, `1 0 0 1 ${indent} ${y} Tm (${pdfText(row.label)}) Tj`);
      if (row.value) commands.push(`1 0 0 1 420 ${y} Tm (${pdfText(row.value)}) Tj`);
      if (row.kind === "final") commands.push(`420 ${y - 3} m 535 ${y - 3} l S`, `420 ${y - 6} m 535 ${y - 6} l S`);
      y -= row.kind === "section" ? 20 : 16;
    }
    flushPage(commands);
  }

  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesRoot} 0 R >>`;
  objects[pagesRoot - 1] = `<< /Type /Pages /Kids [${pages.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(output.length); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(output);
}
