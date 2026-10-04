/**
 * CSV ayrıştırma ve yazma. RFC 4180: tırnak içinde ayraç, çift tırnak ve satır sonu korunur.
 * Excel'in Türkçe yerelinde `;` kullanılır, bu yüzden ayraç ilk satırdan tahmin edilir.
 */

export function detectDelimiter(firstLine: string): "," | ";" | "\t" {
  const counts = { ";": 0, ",": 0, "\t": 0 };
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch as keyof typeof counts] += 1;
  }
  if (counts[";"] >= counts[","] && counts[";"] >= counts["\t"] && counts[";"] > 0) return ";";
  if (counts["\t"] > counts[","]) return "\t";
  return ",";
}

/**
 * `lines[i]`, `rows[i]` kaydının dosyadaki 1 tabanlı satır numarasıdır (boş satırlar atlandığı ve
 * tırnak içi satır sonları kayıt yuttuğu için kayıt sırasından farklı olabilir; hata raporu bunu kullanır).
 */
export function parseCsv(content: string): { headers: string[]; rows: string[][]; lines: number[] } {
  const text = content.replace(/^﻿/, "");
  const newlineAt = text.search(/\r\n|\r|\n/);
  const delimiter = detectDelimiter(newlineAt === -1 ? text : text.slice(0, newlineAt));

  const records: string[][] = [];
  const recordLines: number[] = [];
  let line = 1;
  let recordStartLine = 1;
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  const endField = (): void => {
    record.push(field);
    field = "";
  };
  const endRecord = (): void => {
    endField();
    if (record.some((cell) => cell.trim() !== "")) {
      records.push(record.map((c) => c.trim()));
      recordLines.push(recordStartLine);
    }
    record = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n" || (ch === "\r" && text[i + 1] !== "\n")) line += 1;
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i += 1;
      endRecord();
      line += 1;
      recordStartLine = line;
    } else if (ch === "\n") {
      endRecord();
      line += 1;
      recordStartLine = line;
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0) endRecord();

  return { headers: records[0] ?? [], rows: records.slice(1), lines: recordLines.slice(1) };
}

/**
 * Formül enjeksiyonuna karşı: `=`, `+`, `-`, `@`, sekme ve satır başı ile başlayan hücrenin
 * önüne `'` konur; Excel bunu formül değil metin sayar.
 */
export function escapeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function escapeCsvCell(value: string | number | null | undefined): string {
  const s = escapeFormula(value == null ? "" : String(value));
  return /[";,\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** BOM + noktalı virgül: Excel Türkçe yerelinde doğru açılır. */
export function buildCsvText(
  headers: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  const lines = [headers.map(escapeCsvCell).join(";")];
  for (const row of rows) lines.push(row.map(escapeCsvCell).join(";"));
  return `﻿${lines.join("\r\n")}\r\n`;
}
