// The Cash page (Phase 4, behind CASH_PAGE_LIVE): month-end cash history and a 12-month projection.
// Pure functions, exact bigint cents. Cash now, net cash burn and Runway come from src/engine/cash.ts
// (cashKpis, the KPI strip's own rules); nothing here recalculates them.
//
// Projection ("Current trend"): cash at month k = cash now − k × the net cash burn (the burn as the
// KPI strip shows it, in cents). A scenario adds its annual net-profit difference against Base,
// spread evenly: cash at month k = Current trend at k + round(k × difference ÷ 12), the cumulative
// amount rounded once per month (half away from zero), so nothing drifts. "Runs out" is the first
// projected month below zero. Indicative only: profit as a proxy for cash.
import { formatMoney, toCents, type Currency } from './money';
import { addMonths, type Period } from './period';
import { divRound } from './rounding';

export interface CashMonth { month: Period; cash: bigint }
export interface ProjectedMonth extends CashMonth { k: number }

/** One closing balance, trial-balance sign, cents. */
export interface BalanceRow { connection_id: string; account_code: string; period: Period; cents: bigint }

/**
 * Month-end cash for the last `count` months that have balances (oldest first): the sum of the
 * closing balances of the Cash and bank accounts (display sign +1, as on the KPI strip), 0 in a month
 * with balances but no cash row. `months` are the months with balances (any account).
 */
export function cashHistory(months: readonly Period[], rows: readonly BalanceRow[], cashKeys: ReadonlySet<string>, count = 12): CashMonth[] {
  const shown = [...new Set(months)].sort().slice(-count);
  return shown.map(month => ({
    month,
    cash: rows.filter(r => r.period === month && cashKeys.has(`${r.connection_id}|${r.account_code}`)).reduce((t, r) => t + r.cents, 0n),
  }));
}

/** `months` months after `start`: cash now − k × burn, plus round(k × annualExtra ÷ 12). */
export function projectCash(start: Period, cashNow: bigint, monthlyBurn: bigint, annualExtra = 0n, months = 12): ProjectedMonth[] {
  return Array.from({ length: months }, (_, i) => {
    const k = i + 1;
    return { k, month: addMonths(start, k), cash: cashNow - BigInt(k) * monthlyBurn + divRound(BigInt(k) * annualExtra, 12n) };
  });
}

/** The first projected month below zero, or null ("does not run out within 12 months"). */
export function runsOut(points: readonly ProjectedMonth[]): ProjectedMonth | null {
  return points.find(p => p.cash < 0n) ?? null;
}

/** A typed burn ("12,150.00", "€12150", "-500") as cents, or the problem. */
export function parseBurn(text: string): { cents: bigint } | { problem: string } {
  const t = text.replace(/[€£,\s]/g, '');
  if (t === '') return { problem: 'Enter a monthly amount.' };
  try { return { cents: toCents(t) }; } catch {
    return { problem: 'Enter an amount with at most two decimals, for example 12,150.00.' };
  }
}

export interface CashQualityInput {
  /** The latest month with balances, the latest month of actuals, this calendar month. */
  balancesThrough: Period | null;
  actualsThrough: Period | null;
  currentMonth: Period;
  unmappedBalance: number;
  /** True when burn and runway are "—" because a month-end in m−3..m is missing. */
  missingMonthEnds: string | null;
}

/** The Cash page's data-quality notes, in a fixed order; empty means "None". */
export function cashQualityNotes(q: CashQualityInput, label: (p: Period) => string): string[] {
  const out: string[] = [];
  const s = (n: number, one: string) => `${n.toLocaleString('en-IE')} ${one}${n === 1 ? '' : 's'}`;
  if (q.unmappedBalance > 0) out.push(`${s(q.unmappedBalance, 'balance account')} unmapped: the Cash balance is incomplete.`);
  if (q.balancesThrough && q.actualsThrough) {
    const n = (p: Period) => Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7));
    const lag = n(q.actualsThrough) - n(q.balancesThrough);
    if (lag > 0) out.push(`Balances are ${s(lag, 'month')} older than actuals (balances through ${label(q.balancesThrough)}, actuals through ${label(q.actualsThrough)}).`);
  }
  if (q.missingMonthEnds) out.push(`${q.missingMonthEnds}: the net cash burn and Runway show "—" and no projection is drawn.`);
  if (q.balancesThrough && q.balancesThrough === q.currentMonth) {
    out.push(`${label(q.balancesThrough)} is this month: its balances may be incomplete, so the net cash burn ends at the month before.`);
  }
  return out;
}

export const CASH_FOOTNOTE = 'Figures come from the imported files; this is not a forecast or advice.';
export const SCENARIO_CASH_LABEL = 'Indicative: profit used as a proxy for cash; ignores timing, VAT, tax, capex and financing.';

/** "Aug 2026" or the "does not run out" wording. */
export function runsOutText(p: ProjectedMonth | null, label: (m: Period) => string, short = false): string {
  return p ? label(p.month) : short ? 'Not within 12 months' : 'Cash does not run out within 12 months';
}

/** CSV rows for the lines shown: month, cash, kind (history or projection), line. */
export function cashCsvRows(history: readonly CashMonth[], lines: readonly { name: string; points: readonly ProjectedMonth[] }[]): (string)[][] {
  const amt = (c: bigint) => { const neg = c < 0n; const a = neg ? -c : c; return `${neg ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`; };
  const out: string[][] = [['month', 'cash', 'kind', 'line']];
  for (const h of history) out.push([h.month.slice(0, 7), amt(h.cash), 'history', 'Month-end cash']);
  for (const l of lines) for (const p of l.points) out.push([p.month.slice(0, 7), amt(p.cash), 'projection', l.name]);
  return out;
}

export const money = (c: bigint | null, currency: Currency) => (c === null ? '—' : formatMoney(c, currency));
