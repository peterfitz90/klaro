// Copied from Ledgrly src/App.jsx downloadCSV (see PROVENANCE.md), typed. Quotes every cell and
// adds a UTF-8 BOM so Excel opens accented names correctly.

export type CsvCell = string | number | null | undefined;

export function toCsv(rows: CsvCell[][]): string {
  return rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

export function downloadCSV(filename: string, rows: CsvCell[][]): void {
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
