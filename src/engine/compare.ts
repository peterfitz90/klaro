// Compare (Phase 1, step 1E): the rows from fpa.variance turned into cells, and the year-to-date
// figures added up from the months. Pure functions.
//
// fpa.variance returns, per line and month, in display sign (revenue and profit positive):
//   actual   NULL when the entity has no actuals at all that month;
//   budget   NULL when the version has no budget lines that month;
//   variance actual - budget; variance_pct variance / |budget| * 100, NULL when budget is NULL or 0;
//   favourable  income and profit lines: variance >= 0; cost lines: variance <= 0; Unmapped: NULL.
// Year to date uses the same rules. A year-to-date figure needs every month in it: if any month has
// no actuals (or no budget), that figure is NULL rather than a partial sum that looks complete.
import { toCents } from './money';
import type { Period } from './period';

export type LineKind = 'income' | 'cost' | 'calculated' | 'unmapped';

export interface VarianceRow {
  line_key: string;
  line_label: string;
  line_kind: LineKind;
  line_order: number;
  month: Period;
  actual: number | string | null;
  budget: number | string | null;
  variance: number | string | null;
  variance_pct: number | string | null;
  favourable: boolean | null;
}

export interface Cell {
  actual: bigint | null;
  budget: bigint | null;
  variance: bigint | null;
  /** Percent, full precision (display rounds it). */
  pct: number | null;
  favourable: boolean | null;
}

export interface Line {
  key: string;
  label: string;
  kind: LineKind;
  order: number;
  months: Map<Period, Cell>;
}

const cents = (v: number | string | null): bigint | null => (v === null ? null : toCents(v));

/** Favourable or not, by the kind of line (the same rule as fpa.variance). */
export function isFavourable(kind: LineKind, variance: bigint | null): boolean | null {
  if (variance === null) return null;
  if (kind === 'income' || kind === 'calculated') return variance >= 0n;
  if (kind === 'cost') return variance <= 0n;
  return null;
}

/** Percent of the budget, NULL (not zero or infinity) when there is no budget or it is zero. */
export function variancePct(variance: bigint | null, budget: bigint | null): number | null {
  if (variance === null || budget === null || budget === 0n) return null;
  const abs = budget < 0n ? -budget : budget;
  return (Number(variance) / Number(abs)) * 100;
}

/** Groups the rows by line, in the database's order. Amounts that are not exact cents are an error. */
export function toLines(rows: readonly VarianceRow[]): Line[] {
  const byKey = new Map<string, Line>();
  for (const r of rows) {
    let line = byKey.get(r.line_key);
    if (!line) {
      line = { key: r.line_key, label: r.line_label, kind: r.line_kind, order: r.line_order, months: new Map() };
      byKey.set(r.line_key, line);
    }
    const pct = r.variance_pct === null ? null : Number(r.variance_pct);
    if (pct !== null && !Number.isFinite(pct)) throw new RangeError(`Bad variance percent for ${r.line_key}`);
    line.months.set(r.month, { actual: cents(r.actual), budget: cents(r.budget), variance: cents(r.variance), pct, favourable: r.favourable });
  }
  return [...byKey.values()].sort((a, b) => a.order - b.order);
}

/** The cell for a run of months (year to date): each figure only if every month has it. */
export function sumCells(kind: LineKind, cells: readonly (Cell | undefined)[]): Cell {
  const total = (pick: (c: Cell) => bigint | null): bigint | null => {
    if (cells.length === 0) return null;
    let sum = 0n;
    for (const c of cells) {
      const v = c ? pick(c) : null;
      if (v === null) return null;
      sum += v;
    }
    return sum;
  };
  const actual = total(c => c.actual);
  const budget = total(c => c.budget);
  const variance = actual !== null && budget !== null ? actual - budget : null;
  return { actual, budget, variance, pct: variancePct(variance, budget), favourable: isFavourable(kind, variance) };
}

/** "+12.3%", "-4.0%", or "—" when there is no percentage. */
export function formatPct(pct: number | null): string {
  if (pct === null) return '—';
  const r = Math.round(pct * 10) / 10;
  return `${r > 0 ? '+' : r < 0 ? '-' : ''}${Math.abs(r).toFixed(1)}%`;
}
