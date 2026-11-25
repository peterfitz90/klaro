// CSV actuals import, browser side (Phase 1, step 1B). Pure functions: the file's rows and the
// user's answers in; the rows to send, every problem found and any warnings out. The server
// (fpa.import_actuals) checks the rows again and never trusts these checks.
//
// Rules (Peter, Phase 1 prompt and docs/ui-rules.md section 3):
// - Columns: account code, account name (optional), month (YYYY-MM or a date), amount.
// - Amounts in the file are trial-balance style (debits positive, credits negative), unless the
//   user says income is positive, in which case every sign is flipped.
// - Amounts are monthly movements, or year-to-date balances that are turned into movements within
//   each financial year. A month missing inside a year is an error, never a guess.
// - At most 20,000 rows and 5 MB per import.
import type { CsvRow } from './csv';
import { isBlankRow } from './csv';
import { MAX_CENTS, toAmount } from './money';
import { addMonths, fiscalYearStart, isPeriod, period, type Period } from './period';

export const IMPORT_LIMITS = { maxRows: 20_000, maxBytes: 5 * 1024 * 1024 } as const;
/** The earliest month the database accepts. */
export const FIRST_MONTH: Period = '2000-01-01';

export const FIELDS = ['account_code', 'account_name', 'month', 'amount'] as const;
export type Field = (typeof FIELDS)[number];
export const FIELD_LABELS: Record<Field, string> = {
  account_code: 'Account code',
  account_name: 'Account name (optional)',
  month: 'Month',
  amount: 'Amount',
};
const REQUIRED: readonly Field[] = ['account_code', 'month', 'amount'];

/** For each field, the index of the file column it comes from, or null. */
export type ColumnMap = Record<Field, number | null>;

const HEADER_GUESSES: Record<Field, string[]> = {
  account_code: ['accountcode', 'code', 'accountno', 'accountnumber', 'nominalcode', 'glcode', 'acccode', 'account'],
  account_name: ['accountname', 'name', 'description', 'accountdescription', 'nominalname'],
  month: ['month', 'period', 'date', 'monthend', 'periodend', 'perioddate'],
  amount: ['amount', 'value', 'net', 'movement', 'balance', 'total'],
};
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A first guess at the column for each field from the header names. The user confirms it. */
export function guessColumns(headers: readonly string[]): ColumnMap {
  const map: ColumnMap = { account_code: null, account_name: null, month: null, amount: null };
  const taken = new Set<number>();
  const names = headers.map(norm);
  for (const f of FIELDS) {
    for (const guess of HEADER_GUESSES[f]) {
      const i = names.findIndex((n, idx) => n === guess && !taken.has(idx));
      if (i >= 0) { map[f] = i; taken.add(i); break; }
    }
  }
  return map;
}

/** What is wrong with a column choice, if anything (empty when it can be used). */
export function columnMapProblems(map: ColumnMap, columnCount: number): string[] {
  const out: string[] = [];
  for (const f of REQUIRED) if (map[f] === null) out.push(`Choose the column for ${FIELD_LABELS[f].toLowerCase()}.`);
  const used = new Map<number, Field>();
  for (const f of FIELDS) {
    const i = map[f];
    if (i === null) continue;
    if (!Number.isInteger(i) || i < 0 || i >= columnCount) { out.push(`The column for ${FIELD_LABELS[f].toLowerCase()} is not in the file.`); continue; }
    const other = used.get(i);
    if (other) out.push(`${FIELD_LABELS[f]} and ${FIELD_LABELS[other].toLowerCase()} use the same column.`);
    used.set(i, f);
  }
  return out;
}

// ── Single values ───────────────────────────────────────────────────────────────────────────

const daysIn = (y: number, m: number) => [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

/**
 * The month of a cell: "2025-01", "2025-01-31" or "31/01/2025" (day first, as in Ireland and the
 * UK). Any real day gives its month. Returns the period or the problem.
 */
export function parseMonth(text: string, currentMonth: Period): { period: Period } | { problem: string } {
  const t = text.trim();
  if (t === '') return { problem: 'the month is empty.' };
  let y: number, m: number, d: number | null = null;
  let r: RegExpExecArray | null;
  if ((r = /^(\d{4})-(\d{1,2})$/.exec(t))) { y = Number(r[1]); m = Number(r[2]); }
  else if ((r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) { y = Number(r[1]); m = Number(r[2]); d = Number(r[3]); }
  else if ((r = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) { d = Number(r[1]); m = Number(r[2]); y = Number(r[3]); }
  else return { problem: `"${clip(t)}" is not a month. Use YYYY-MM (2025-01) or a date (2025-01-31 or 31/01/2025).` };
  if (m < 1 || m > 12 || (d !== null && (d < 1 || d > (daysIn(y, m) ?? 0)))) return { problem: `"${clip(t)}" is not a real date.` };
  if (y < 2000 || y > 2999) return { problem: 'the month must be from January 2000 to this month.' };
  const p = period(y, m);
  if (p < FIRST_MONTH || p > currentMonth) return { problem: 'the month must be from January 2000 to this month.' };
  return { period: p };
}

/**
 * An amount in cents: "-1200.50", "1,200.50" or "1200". At most two decimals and 12 digits before
 * the point; a negative is written with a minus sign. No currency signs or brackets.
 */
export function parseAmount(text: string): { cents: bigint } | { problem: string } {
  const t = text.trim();
  if (t === '') return { problem: 'the amount is empty.' };
  const m = /^(-)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return { problem: `"${clip(t)}" is not an amount. Write it like -1200.50: at most two decimals, a minus sign for a negative, no currency sign.` };
  const whole = (m[2] ?? '').replace(/,/g, '');
  if (whole.replace(/^0+(?=\d)/, '').length > 12) return { problem: 'the amount has more than 12 digits before the point.' };
  const cents = BigInt(whole) * 100n + BigInt((m[3] ?? '').padEnd(2, '0'));
  return { cents: m[1] ? -cents : cents };
}

/** True if the text has a control character (U+0000 to U+001F, or U+007F). */
const hasControl = (s: string) => [...s].some(ch => { const c = ch.charCodeAt(0); return c < 32 || c === 127; });
const clip = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);

// ── The whole file ──────────────────────────────────────────────────────────────────────────

export interface ImportOptions {
  /** The amounts are year-to-date balances, not monthly movements. */
  ytd: boolean;
  /** Income is a positive number in the file (signs are flipped to trial-balance style). */
  incomePositive: boolean;
  /** The month the financial year starts (1 to 12), from the plan. */
  fiscalYearStartMonth: number;
  /** This calendar month, the latest month that can be imported. */
  currentMonth: Period;
}

/** A problem with a line of the file (line 0 means the file as a whole). */
export interface Problem { line: number; message: string }

export interface PayloadRow { account_code: string; account_name?: string; month: Period; amount: string }

export interface Prepared {
  /** Lines with data (the header and blank lines are not counted). */
  dataRows: number;
  blankRows: number;
  /** Every problem found; while there is any, nothing may be imported. */
  problems: Problem[];
  warnings: string[];
  accounts: number;
  months: Period[];
  /** Sum of positive (debit) and negative (credit) amounts after conversion, in cents. */
  debits: bigint;
  credits: bigint;
  /** The rows to send to fpa.import_actuals: empty while there are problems. */
  payload: PayloadRow[];
  /** For each payload row, the file line it came from (to translate the server's "Row n"). */
  lines: number[];
  /** Size of the payload as the database measures it (octet_length of the jsonb as text). */
  payloadBytes: number;
}

interface Parsed { line: number; code: string; name: string | null; month: Period; cents: bigint }

/**
 * Checks every data row, converts year-to-date balances and flips signs as asked, and builds the
 * rows to send. `rows` are the file's rows after the header.
 */
export function prepareImport(rows: readonly CsvRow[], map: ColumnMap, opts: ImportOptions): Prepared {
  const problems: Problem[] = [];
  const warnings: string[] = [];
  const data = rows.filter(r => !isBlankRow(r));
  const blankRows = rows.length - data.length;
  const out: Prepared = { dataRows: data.length, blankRows, problems, warnings, accounts: 0, months: [], debits: 0n, credits: 0n, payload: [], lines: [], payloadBytes: 0 };

  if (!Number.isInteger(opts.fiscalYearStartMonth) || opts.fiscalYearStartMonth < 1 || opts.fiscalYearStartMonth > 12) {
    throw new RangeError('fiscalYearStartMonth must be 1 to 12');
  }
  if (!isPeriod(opts.currentMonth)) throw new RangeError('currentMonth must be a period');
  for (const p of columnMapProblems(map, Number.MAX_SAFE_INTEGER)) problems.push({ line: 0, message: p });
  if (problems.length) return out;
  if (data.length === 0) { problems.push({ line: 0, message: 'The file has no rows of figures under the header.' }); return out; }
  if (data.length > IMPORT_LIMITS.maxRows) {
    problems.push({ line: 0, message: `The file has ${data.length.toLocaleString('en-IE')} rows; the most one import can take is 20,000. Split it into smaller files (by month, for example).` });
    return out;
  }

  const cell = (r: CsvRow, f: Field) => { const i = map[f]; return i === null ? '' : r.cells[i] ?? ''; };
  const parsed: Parsed[] = [];
  const seen = new Map<string, number>();
  const lastColumn = Math.max(...FIELDS.map(f => map[f] ?? -1));
  for (const r of data) {
    if (r.cells.length <= lastColumn) {
      problems.push({ line: r.line, message: `the line has ${r.cells.length} column${r.cells.length === 1 ? '' : 's'}; the header has more.` });
      continue;
    }
    const lineProblems: string[] = [];
    const code = cell(r, 'account_code').trim();
    if (code.length < 1 || code.length > 64) lineProblems.push(code ? 'the account code is longer than 64 characters.' : 'the account code is empty.');
    else if (hasControl(code)) lineProblems.push('the account code has a hidden control character.');
    const rawName = cell(r, 'account_name').trim();
    if (rawName.length > 200) lineProblems.push('the account name is longer than 200 characters.');
    else if (hasControl(rawName)) lineProblems.push('the account name has a hidden control character.');
    const mo = parseMonth(cell(r, 'month'), opts.currentMonth);
    if ('problem' in mo) lineProblems.push(mo.problem);
    const am = parseAmount(cell(r, 'amount'));
    if ('problem' in am) lineProblems.push(am.problem);
    if (lineProblems.length) { for (const m of lineProblems) problems.push({ line: r.line, message: m }); continue; }
    const month = (mo as { period: Period }).period;
    const key = `${code}\u0000${month}`;
    const first = seen.get(key);
    if (first !== undefined) {
      problems.push({ line: r.line, message: `account ${clip(code)} already has a figure for ${month.slice(0, 7)} (line ${first}). Each account can appear once per month.` });
      continue;
    }
    seen.set(key, r.line);
    parsed.push({ line: r.line, code, name: rawName || null, month, cents: (am as { cents: bigint }).cents });
  }

  // Sanity check on what the figures look like, before any conversion (ui-rules 3).
  const look = growthShare(parsed, opts.fiscalYearStartMonth);
  if (look.eligible > 0) {
    if (!opts.ytd && look.growing / look.eligible >= 0.6) {
      warnings.push(`${look.growing} of ${look.eligible} accounts only ever grow in one direction across the year. These look like year-to-date balances. If they are, choose "Year-to-date balances".`);
    }
    if (opts.ytd && look.growing / look.eligible < 0.4) {
      warnings.push(`Only ${look.growing} of ${look.eligible} accounts grow steadily across the year. These look like monthly movements. If they are, choose "Monthly movements".`);
    }
  }

  let movements = parsed;
  if (opts.ytd) {
    const conv = ytdToMonthly(parsed, opts.fiscalYearStartMonth);
    problems.push(...conv.problems);
    movements = conv.rows;
  }
  if (opts.incomePositive) movements = movements.map(r => ({ ...r, cents: -r.cents }));

  for (const r of movements) {
    if (r.cents > MAX_CENTS || r.cents < -MAX_CENTS) problems.push({ line: r.line, message: 'after conversion the amount has more than 12 digits before the point.' });
  }

  problems.sort((a, b) => a.line - b.line);
  out.accounts = new Set(parsed.map(r => r.code)).size;
  out.months = [...new Set(parsed.map(r => r.month))].sort();
  for (const r of movements) { if (r.cents > 0n) out.debits += r.cents; else out.credits += r.cents; }
  if (problems.length) return out;

  out.payload = movements.map(r => (r.name ? { account_code: r.code, account_name: r.name, month: r.month, amount: toAmount(r.cents) } : { account_code: r.code, month: r.month, amount: toAmount(r.cents) }));
  out.lines = movements.map(r => r.line);
  out.payloadBytes = jsonbTextBytes(out.payload);
  if (out.payloadBytes > IMPORT_LIMITS.maxBytes) {
    problems.push({ line: 0, message: `The rows come to ${(out.payloadBytes / 1048576).toFixed(1)} MB; the most one import can take is 5 MB. Split the file into smaller files.` });
    out.payload = [];
    out.lines = [];
  }
  return out;
}

/**
 * Year-to-date balances to monthly movements, within each financial year. For each account and
 * year, every month the file has for that year must be present, from the first month of the year:
 * the first month keeps its figure and each later month is its figure less the month before.
 */
export function ytdToMonthly<T extends { line: number; code: string; month: Period; cents: bigint }>(rows: readonly T[], fyStartMonth: number): { rows: T[]; problems: Problem[] } {
  const problems: Problem[] = [];
  const byYear = new Map<Period, T[]>();
  for (const r of rows) {
    const y = fiscalYearStart(r.month, fyStartMonth);
    groupPush(byYear, y, r);
  }
  const result: T[] = [];
  for (const [yearStart, yearRows] of [...byYear].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const fileMonths = [...new Set(yearRows.map(r => r.month))].sort();
    const last = fileMonths[fileMonths.length - 1] ?? yearStart;
    const needed: Period[] = [];
    for (let p = yearStart; p <= last; p = addMonths(p, 1)) needed.push(p);
    const missingInFile = needed.filter(p => !fileMonths.includes(p));
    if (missingInFile.length) {
      problems.push({ line: 0, message: `Year-to-date figures need every month from the start of the financial year (${ym(yearStart)}). The file has no ${missingInFile.map(ym).join(', ')} for that year, so the monthly movements can't be worked out.` });
      continue;
    }
    const byAccount = new Map<string, Map<Period, T>>();
    for (const r of yearRows) {
      let byMonth = byAccount.get(r.code);
      if (!byMonth) { byMonth = new Map(); byAccount.set(r.code, byMonth); }
      byMonth.set(r.month, r);
    }
    for (const [code, months] of [...byAccount].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const missing = needed.filter(p => !months.has(p));
      if (missing.length) {
        const firstLine = Math.min(...[...months.values()].map(r => r.line));
        problems.push({ line: firstLine, message: `account ${clip(code)} has no year-to-date figure for ${missing.map(ym).join(', ')}. Add a row with 0.00 for each month it had no balance.` });
        continue;
      }
      let prev = 0n;
      for (const p of needed) {
        const r = months.get(p);
        if (!r) throw new Error('unreachable: a needed month is missing');
        result.push({ ...r, cents: r.cents - prev });
        prev = r.cents;
      }
    }
  }
  result.sort((a, b) => a.line - b.line);
  return { rows: result, problems };
}

const ym = (p: Period) => p.slice(0, 7);

function groupPush<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value); else map.set(key, [value]);
}

/** How many accounts (with 3 or more months in one financial year) only grow in one direction. */
function growthShare(rows: readonly Parsed[], fyStartMonth: number): { eligible: number; growing: number } {
  const series = new Map<string, Parsed[]>();
  for (const r of rows) {
    const k = `${r.code}\u0000${fiscalYearStart(r.month, fyStartMonth)}`;
    groupPush(series, k, r);
  }
  let eligible = 0, growing = 0;
  for (const s of series.values()) {
    if (s.length < 3) continue;
    s.sort((a, b) => (a.month < b.month ? -1 : 1));
    eligible++;
    const signs = new Set(s.filter(r => r.cents !== 0n).map(r => (r.cents > 0n ? 1 : -1)));
    if (signs.size !== 1) continue;
    let up = true, strict = false, prev: bigint | null = null;
    for (const r of s) {
      const abs = r.cents < 0n ? -r.cents : r.cents;
      if (prev !== null) { if (abs < prev) up = false; if (abs > prev) strict = true; }
      prev = abs;
    }
    if (up && strict) growing++;
  }
  return { eligible, growing };
}

/** octet_length(jsonb::text) for this payload: Postgres prints ": " and ", " between items. */
export function jsonbTextBytes(payload: readonly PayloadRow[]): number {
  const json = JSON.stringify(payload);
  let extra = 0;
  for (const r of payload) { const keys = Object.keys(r).length; extra += keys + (keys - 1); }
  extra += Math.max(0, payload.length - 1);
  return new TextEncoder().encode(json).length + extra;
}

/** The current calendar month as a period, from a date's local year and month. */
export function monthOf(d: { getFullYear(): number; getMonth(): number }): Period {
  return period(d.getFullYear(), d.getMonth() + 1);
}
