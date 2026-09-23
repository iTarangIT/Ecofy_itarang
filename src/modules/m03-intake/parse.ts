import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";

export type ParsedSheet = { headers: string[]; rows: Array<Record<string, string>>; sheetName?: string };

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    const dd = String(v.getUTCDate()).padStart(2, "0"), mm = String(v.getUTCMonth() + 1).padStart(2, "0");
    return `${dd}-${mm}-${v.getUTCFullYear()}`; // template date format
  }
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return String(v.text);
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    if ("hyperlink" in v) { const hv = v as { text?: unknown; hyperlink?: unknown }; return String(hv.text ?? hv.hyperlink ?? ""); }
    return String(v);
  }
  return String(v);
}

/**
 * Parses an .xlsx (sheet "Leads" or "Systems", else the first sheet) or .csv into header + rows of strings.
 * Row limit is enforced by the caller (intake.max_rows).
 */
export async function parseUpload(buffer: Buffer, fileName: string, preferredSheets: string[] = ["Leads", "Systems"], maxRows = 5001): Promise<ParsedSheet> {
  if (/\.csv$/i.test(fileName)) {
    const records = parseCsv(buffer.toString("utf8").replace(/^﻿/, ""), { bom: true, skip_empty_lines: true, relax_column_count: true, trim: true }) as string[][];
    const headers = (records[0] ?? []).map((h) => String(h).trim());
    const rows = records.slice(1, 1 + maxRows).map((r) => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? "").trim()])));
    return { headers, rows };
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = preferredSheets.map((n) => wb.getWorksheet(n)).find(Boolean) ?? wb.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => { headers[col - 1] = cellText(cell.value).trim(); });
  const rows: Array<Record<string, string>> = [];
  for (let r = 2; r <= sheet.rowCount && rows.length < maxRows; r++) {
    const row = sheet.getRow(r);
    const obj: Record<string, string> = {};
    let any = false;
    headers.forEach((h, i) => {
      if (!h) return;
      const t = cellText(row.getCell(i + 1).value).trim();
      if (t) any = true;
      obj[h] = t;
    });
    if (any) rows.push(obj);
  }
  return { headers: headers.filter(Boolean), rows, sheetName: sheet.name };
}
