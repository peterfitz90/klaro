// Scenarios (Phase 3 slice, behind SCENARIOS_LIVE). A scenario is the selected budget with three
// drivers applied to every month:
//   revenue change %      Revenue, and Cost of sales (which moves with revenue)
//   payroll change %      Payroll
//   other costs change %  Other operating costs
// Marketing, Rent and premises, Interest and Tax are unchanged. Base is the budget as it is.
// Exact cents; each line is rounded as budgets are (src/engine/rounding.ts: every month rounded on
// its own, half away from zero, and the last month takes the leftover cents, so the months add up
// to the rounded annual figure). Amounts are in stored (trial-balance) sign; the summary is in
// display sign (revenue, costs and profit as positive numbers; a loss negative).
import { budgetFromActuals, upliftBasisPoints } from './rounding';

export type DriverKey = 'revenue' | 'payroll' | 'other';
export const DRIVER_KEYS: readonly DriverKey[] = ['revenue', 'payroll', 'other'];
/** The fpa.drivers rows the slice uses (one per plan), unit percent, kind input. */
export const DRIVER_DEFS: Record<DriverKey, { key: string; label: string }> = {
  revenue: { key: 'scn_revenue_change', label: 'Revenue change' },
  payroll: { key: 'scn_payroll_change', label: 'Payroll change' },
  other: { key: 'scn_other_costs_change', label: 'Other costs change' },
};
/** Which driver moves which budget line (null: unchanged). */
export const LINE_DRIVER: Readonly<Record<string, DriverKey | null>> = {
  revenue: 'revenue', cost_of_sales: 'revenue', payroll: 'payroll', other_operating: 'other',
  marketing: null, premises: null, interest: null, tax: null,
};
const INCOME = new Set(['revenue']);
const COSTS = new Set(['cost_of_sales', 'payroll', 'marketing', 'premises', 'other_operating', 'interest', 'tax']);

/** Basis points per driver (hundredths of a percent). */
export type Drivers = Record<DriverKey, bigint>;
export const NO_CHANGE: Drivers = { revenue: 0n, payroll: 0n, other: 0n };

/** A typed percentage ("5", "-2.5") as basis points, or the problem. Same limits as budget uplifts: -100% to 1000%, two decimals. */
export function parsePercent(text: string): { bp: bigint } | { problem: string } {
  const t = text.trim() === '' ? '0' : text.trim().replace(/%$/, '').trim();
  try { return { bp: upliftBasisPoints(t) }; } catch {
    return { problem: 'Enter a percentage from -100 to 1000, with at most two decimals.' };
  }
}

/** Basis points back to the text shown ("7.5", "-10", "0"). */
export function percentText(bp: bigint): string {
  const neg = bp < 0n;
  const a = neg ? -bp : bp;
  const frac = a % 100n;
  return `${neg ? '-' : ''}${a / 100n}${frac === 0n ? '' : `.${frac.toString().padStart(2, '0').replace(/0$/, '')}`}`;
}

/**
 * The scenario's lines: each budget line (months in order, stored sign, cents) times (1 + its
 * driver), rounded as budgets are. Lines with no driver, and lines not listed, are copied unchanged.
 */
export function applyScenario(base: ReadonlyMap<string, readonly bigint[]>, drivers: Drivers): Map<string, bigint[]> {
  const out = new Map<string, bigint[]>();
  for (const [line, months] of base) {
    const d = LINE_DRIVER[line] ?? null;
    out.set(line, d && drivers[d] !== 0n ? budgetFromActuals(months, drivers[d]) : [...months]);
  }
  return out;
}

export interface ScenarioSummary {
  /** Display sign: revenue and costs positive; profit positive, a loss negative. */
  revenue: bigint;
  costs: bigint;
  netProfit: bigint;
  /**
   * INDICATIVE closing cash at month 12 = latest cash balance + the year's net profit. Profit is
   * used as a proxy for cash; it ignores timing, VAT, tax, capex and financing. Null when there is
   * no cash balance (no balances, or nothing mapped to Cash and bank).
   */
  closingCash: bigint | null;
}

export const INDICATIVE_LABEL = 'indicative: profit used as a proxy for cash; ignores timing, VAT, tax, capex and financing';

export function summarise(lines: ReadonlyMap<string, readonly bigint[]>, cashBalance: bigint | null): ScenarioSummary {
  let revenue = 0n, costs = 0n;
  for (const [line, months] of lines) {
    const total = months.reduce((a, b) => a + b, 0n);
    if (INCOME.has(line)) revenue += -total; // income is stored negative (credit)
    else if (COSTS.has(line)) costs += total;
  }
  const netProfit = revenue - costs;
  return { revenue, costs, netProfit, closingCash: cashBalance === null ? null : cashBalance + netProfit };
}

/** Display order: Base first, then Upside, Downside, then the others by name (the Report's table). */
export function scenarioOrder(a: { name: string; is_base: boolean }, b: { name: string; is_base: boolean }): number {
  const rank = (s: { name: string; is_base: boolean }) => (s.is_base ? 0 : s.name === 'Upside' ? 1 : s.name === 'Downside' ? 2 : 3);
  return rank(a) - rank(b) || a.name.localeCompare(b.name, 'en-IE');
}
