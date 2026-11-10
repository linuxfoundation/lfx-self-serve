// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** First characters a spreadsheet treats as the start of a formula. */
const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Makes one value safe to open in a spreadsheet: a cell that starts with `=`, `+`, `-`, `@`, tab or CR gets a
 * leading `'` so it is read as text, not as a formula (CSV injection).
 */
export function neutralizeCsvFormula(value: string): string {
  return CSV_FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

/** Quotes a cell when it holds a comma, quote or line break; doubles embedded quotes. Formula-neutralizes first. */
export function escapeCsvCell(value: string | number | null | undefined): string {
  const text = neutralizeCsvFormula(value === null || value === undefined ? '' : String(value));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Builds CSV text (CRLF line endings) from a header row and data rows. */
export function buildCsv(header: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return [header, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}
