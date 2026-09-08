import ExcelJS from "exceljs";
import type { ReportResult } from "./catalog";

function escapeCsv(value: string | number): string {
  const s = String(value);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Excel'in Türkçe yerelinde doğru açılması için BOM + noktalı virgül. */
export function buildCsv(result: ReportResult): string {
  const lines: string[] = [];
  lines.push(result.columns.map((c) => escapeCsv(c.label)).join(";"));

  for (const row of result.rows) {
    lines.push(result.columns.map((c) => escapeCsv(row[c.key] ?? "")).join(";"));
  }

  if (result.summary) {
    lines.push("");
    for (const [label, value] of Object.entries(result.summary)) {
      lines.push(`${escapeCsv(label)};${escapeCsv(value)}`);
    }
  }

  return `﻿${lines.join("\n")}`;
}

export async function buildXlsx(title: string, result: ReportResult): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Agno Platform";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(title.slice(0, 31) || "Rapor");

  sheet.columns = result.columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: Math.max(12, Math.min(40, c.label.length + 6)),
    style: { alignment: { horizontal: c.align ?? "left" } },
  }));

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };

  for (const row of result.rows) {
    sheet.addRow(row);
  }

  if (result.summary) {
    sheet.addRow({});
    for (const [label, value] of Object.entries(result.summary)) {
      const added = sheet.addRow({
        [result.columns[0]!.key]: label,
        [result.columns[1]?.key ?? "_"]: value,
      });
      added.font = { bold: true };
    }
  }

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: result.columns.length },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

const TR_ASCII: Record<string, string> = {
  ç: "c", Ç: "c", ğ: "g", Ğ: "g", ı: "i", İ: "i",
  ö: "o", Ö: "o", ş: "s", Ş: "s", ü: "u", Ü: "u",
};

/**
 * HTTP başlıkları ByteString (0-255) kabul eder; "ı" (U+0131) gibi karakterler
 * 500'e düşürür. ASCII fallback + RFC 5987 filename* ile ikisini de veriyoruz.
 */
export function contentDisposition(name: string, ext: string, mode: "attachment" | "inline" = "attachment"): string {
  const slug = name
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, (ch) => TR_ASCII[ch] ?? ch)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const suffix = ext.length > 0 ? `.${ext}` : "";
  const ascii = (slug.length > 0 ? slug : "dosya") + suffix;
  const utf8 = encodeURIComponent(name.replace(/[/\\]/g, "-") + suffix);
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
