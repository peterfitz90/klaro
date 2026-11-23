// Periods are calendar months, written as the first day of the month in 'YYYY-MM-01' text, the
// same as the database's period columns. Pure string and integer arithmetic: no Date objects, so no
// time-zone shift (Ledgrly once lost a day turning local dates into UTC strings).

export type Period = string; // 'YYYY-MM-01'

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])-01$/;

export function isPeriod(text: string): text is Period {
  return PERIOD_RE.test(text);
}

function parts(p: Period): [number, number] {
  const m = PERIOD_RE.exec(p);
  if (!m) throw new RangeError(`Not a period (first of a month, YYYY-MM-01): ${p}`);
  return [Number(m[1]), Number(m[2])];
}

export function period(year: number, month: number): Period {
  if (!Number.isInteger(year) || year < 1900 || year > 2999) throw new RangeError(`Bad year: ${year}`);
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError(`Bad month: ${month}`);
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

export function addMonths(p: Period, n: number): Period {
  const [y, m] = parts(p);
  const index = y * 12 + (m - 1) + n;
  return period(Math.floor(index / 12), (index % 12) + 1);
}

/** The months from start, `count` of them. */
export function months(start: Period, count: number): Period[] {
  if (!Number.isInteger(count) || count < 0 || count > 120) throw new RangeError(`Bad month count: ${count}`);
  return Array.from({ length: count }, (_, i) => addMonths(start, i));
}

/** The first period of the fiscal year containing p, for a fiscal year starting in month startMonth. */
export function fiscalYearStart(p: Period, startMonth: number): Period {
  const [y, m] = parts(p);
  return period(m >= startMonth ? y : y - 1, startMonth);
}
