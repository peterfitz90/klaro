// A small CSV reader (RFC 4180): commas, double-quoted fields with "" for a quote, CRLF or LF line
// ends, an optional UTF-8 byte-order mark. Pure: text in, rows of cells out, with the file line
// each row started on (so errors can name the line a person sees in a spreadsheet or editor).

export interface CsvRow {
  /** 1-based line in the file where this row starts. */
  line: number;
  cells: string[];
}

export class CsvSyntaxError extends Error {
  override name = 'CsvSyntaxError';
  constructor(readonly line: number, message: string) {
    super(`Line ${line}: ${message}`);
  }
}

/** Splits CSV text into rows. Throws CsvSyntaxError on a quote that is never closed or is misplaced. */
export function parseCsv(text: string): CsvRow[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = '';
  let line = 1;
  let rowLine = 1;
  let i = 0;
  let quoted = false;      // inside a quoted field
  let wasQuoted = false;   // the current field was quoted (only a comma or line end may follow)

  const endCell = () => { cells.push(cell); cell = ''; wasQuoted = false; };
  const endRow = () => { endCell(); rows.push({ line: rowLine, cells }); cells = []; };

  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false; wasQuoted = true; i++; continue;
      }
      if (ch === '\n') line++;
      cell += ch; i++; continue;
    }
    if (ch === '"') {
      if (cell !== '' || wasQuoted) throw new CsvSyntaxError(line, 'a quote mark must start the field, or be doubled ("") inside a quoted field.');
      quoted = true; i++; continue;
    }
    if (ch === ',') { endCell(); i++; continue; }
    if (ch === '\r' || ch === '\n') {
      endRow();
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1;
      line++; rowLine = line;
      continue;
    }
    if (wasQuoted) throw new CsvSyntaxError(line, 'only a comma or a line end may follow a closing quote.');
    cell += ch; i++;
  }
  if (quoted) throw new CsvSyntaxError(rowLine, 'a quoted field is never closed.');
  // The last line has no line end: keep it unless the file simply ended with one.
  if (cell !== '' || cells.length > 0 || wasQuoted) endRow();
  return rows;
}

/** A row with no content in any cell (a blank line, or only commas). */
export function isBlankRow(row: CsvRow): boolean {
  return row.cells.every(c => c.trim() === '');
}
