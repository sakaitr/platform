import type { ImportTarget } from "./targets";

/** Ayraçlı metin ayrıştırıcı: tırnak içi ayraçları korur, BOM/CRLF temizler. */
export function parseDelimited(content: string): { headers: string[]; rows: string[][] } {
  const clean = content.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const firstLine = clean.split("\n")[0] ?? "";
  const delimiter = firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";

  const lines = clean.split("\n").filter((l) => l.trim() !== "");
  const parsed = lines.map((line) => splitLine(line, delimiter));

  const headers = (parsed[0] ?? []).map((h) => h.trim());
  return { headers, rows: parsed.slice(1) };
}

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out;
}

/** Başlık → hedef kolon eşlemesini uygular. Eşlenmemiş başlık düşer. */
export function mapRows(
  headers: string[],
  rows: string[][],
  mapping: Record<string, string>,
): Array<Record<string, string>> {
  return rows.map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, i) => {
      const targetKey = mapping[header];
      if (targetKey) record[targetKey] = row[i] ?? "";
    });
    return record;
  });
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$|^(\d{2})\.(\d{2})\.(\d{4})$/;

/**
 * Formatı VE gerçek geçerliliği kontrol eder.
 * Sadece desen eşleştirmek yetmez: "32.13.2026" desene uyar ama tarih değildir.
 */
function isValidDate(raw: string): boolean {
  const m = DATE_RE.exec(raw);
  if (!m) return false;

  const [year, month, day] = m[1]
    ? [Number(m[1]), Number(m[2]), Number(m[3])]
    : [Number(m[6]), Number(m[5]), Number(m[4])];

  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  // Ay uzunluğu ve artık yıl kontrolü
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
  );
}

export function validateRow(target: ImportTarget, values: Record<string, string>): string[] {
  const errors: string[] = [];

  for (const column of target.columns) {
    const raw = (values[column.key] ?? "").trim();

    if (column.required && raw === "") {
      errors.push(`${column.label} zorunlu.`);
      continue;
    }
    if (raw === "") continue;

    if (column.type === "number" && Number.isNaN(Number(raw.replace(",", ".")))) {
      errors.push(`${column.label} sayı olmalı.`);
    }
    if (column.type === "date" && !isValidDate(raw)) {
      errors.push(`${column.label} GG.AA.YYYY veya YYYY-AA-GG olmalı.`);
    }
  }

  return errors;
}
