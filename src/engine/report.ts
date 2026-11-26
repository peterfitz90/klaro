// The monthly report (Phase 3, behind REPORT_LIVE): the pure parts. A chart scale for the two small
// SVG charts, and the data-quality summary. Figures themselves come from the same engine functions as
// Compare (toLines, sumCells), the KPI strip (kpiTiles, cashKpis) and Scenarios (applyScenario,
// summarise); nothing is recomputed differently here.
import { addMonths, type Period } from './period';

export interface Scale {
  /** The domain, in currency units (cents / 100), always including 0. */
  min: number;
  max: number;
  /** y coordinate for a value in cents: `top` for max, `bottom` for min. */
  y: (cents: bigint) => number;
  /** y coordinate of zero (the baseline). */
  zero: number;
}

/**
 * A linear scale for chart values in cents, mapped to SVG y coordinates between `top` and `bottom`
 * (top < bottom). The domain always includes 0, so bars start at the baseline and a loss sits below
 * it. Nulls are ignored; with no values (or all zero) the domain is 0 to 1. Display only: money
 * shown as text always uses exact cents.
 */
export function linearScale(values: readonly (bigint | null)[], top: number, bottom: number): Scale {
  const nums = values.filter((v): v is bigint => v !== null).map(v => Number(v) / 100);
  let min = Math.min(0, ...nums);
  let max = Math.max(0, ...nums);
  if (min === max) { min = 0; max = 1; }
  const span = max - min;
  const y = (cents: bigint) => bottom - ((Number(cents) / 100 - min) / span) * (bottom - top);
  return { min, max, y, zero: y(0n) };
}

/** Whole months from `from` to `to` (positive when `to` is later). */
export function monthsBetween(from: Period, to: Period): number {
  const n = (p: Period) => Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7)) - 1;
  return n(to) - n(from);
}

export interface QualityInput {
  /** The month the report is for, the latest month of actuals, this calendar month. */
  month: Period;
  actualsThrough: Period | null;
  currentMonth: Period;
  /** P&L accounts with actuals and no plan line: how many and their net total (trial-balance sign, cents). */
  unmappedPnl: { count: number; cents: bigint };
  /** Balance accounts in the latest month with balances and no mapping; null if it could not be checked. */
  unmappedBalance: number | null;
  /** The latest month with balances (null: none imported, undefined: could not be checked). */
  balancesThrough: Period | null | undefined;
}

/**
 * The report's data-quality notes, in a fixed order. An empty list means "None". `money` formats a
 * trial-balance amount (for example "€75.00 Dr"); `label` formats a month ("Dec 2025").
 */
export function qualityNotes(q: QualityInput, money: (cents: bigint) => string, label: (p: Period) => string): string[] {
  const out: string[] = [];
  const s = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-IE')} ${n === 1 ? one : many}`;
  if (q.unmappedPnl.count > 0) {
    out.push(`${s(q.unmappedPnl.count, 'P&L account')} unmapped (net ${money(q.unmappedPnl.cents)}): ${q.unmappedPnl.count === 1 ? 'its amount is' : 'their amounts are'} on the Unmapped line, not in profit.`);
  }
  if (q.unmappedBalance === null) out.push('The balance accounts could not be checked.');
  else if (q.unmappedBalance > 0) out.push(`${s(q.unmappedBalance, 'balance account')} unmapped: the Cash balance is incomplete.`);
  if (q.balancesThrough === undefined) out.push('Whether the balances are up to date could not be checked.');
  else if (q.balancesThrough && q.actualsThrough) {
    const lag = monthsBetween(q.balancesThrough, q.actualsThrough);
    if (lag > 0) out.push(`Balances are ${s(lag, 'month')} older than actuals (balances through ${label(q.balancesThrough)}, actuals through ${label(q.actualsThrough)}).`);
  }
  if (q.actualsThrough && q.month === q.actualsThrough && q.month === q.currentMonth) {
    out.push(`${label(q.month)} is this month: its actuals may be incomplete.`);
  }
  return out;
}

export const REPORT_FOOTNOTE = 'Figures come from the imported files; this report is not audited. Closing cash is indicative.';

/** The months of the financial year (starting `yearStart`) up to and including `month`. */
export function yearToMonth(yearStart: Period, month: Period): Period[] {
  const n = monthsBetween(yearStart, month);
  if (n < 0 || n > 11) return [];
  return Array.from({ length: n + 1 }, (_, k) => addMonths(yearStart, k));
}
