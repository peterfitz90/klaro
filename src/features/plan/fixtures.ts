// Made-up test data for the Plan, Compare and KPI tests (no real entities or people).
import { addMonths, type Period, type VarianceRow } from '../../engine';
import type { PlanLineDef } from '../connect/api';

export const DEFS: PlanLineDef[] = ([
  ['revenue', 'Revenue', 'income', 10, -1, true], ['cost_of_sales', 'Cost of sales', 'cost', 20, 1, true],
  ['gross_profit', 'Gross profit', 'calculated', 30, -1, false], ['payroll', 'Payroll', 'cost', 40, 1, true],
  ['marketing', 'Marketing', 'cost', 50, 1, true], ['premises', 'Rent and premises', 'cost', 60, 1, true],
  ['other_operating', 'Other operating costs', 'cost', 70, 1, true], ['operating_profit', 'Operating profit', 'calculated', 80, -1, false],
  ['interest', 'Interest', 'cost', 90, 1, true], ['tax', 'Tax', 'cost', 100, 1, true], ['net_profit', 'Net profit', 'calculated', 110, -1, false],
  ['unmapped', 'Unmapped', 'unmapped', 120, 1, false], ['excluded', 'Not in the P&L (excluded)', 'excluded', 130, 1, true],
] as const).map(([key, label, kind, sort_order, display_sign, mappable]) => ({ key, label, kind, sort_order, display_sign, mappable }));

export const ENTITY = { id: '0b483fe4-e952-4170-83b5-a79b911b8023', name: 'Acme Ltd', jurisdiction: 'IE', currency: 'EUR' } as const;
export const PLAN = { id: 'a0a0a0a0-0000-4000-8000-0000000000a1', name: 'Main plan', fiscal_year_start: 1 };
export const CONN = { id: 'c0c0c0c0-0000-4000-8000-000000000001', source_type: 'csv', status: 'active', last_synced_at: '2026-01-05T10:00:00Z', actuals_through: '2025-12-01', created_at: '' };

/** Display-sign figures per line for a month: { revenue: [actual, budget] }; lines not given are 0 / null. */
export type Figures = Partial<Record<string, [string | null, string | null]>>;

/** Rows as fpa.variance returns them, for `count` months from `from`; calculated lines are worked out. */
export function varianceRows(from: Period, count: number, perMonth: (m: Period) => Figures, opts: { actualsIn?: (m: Period) => boolean; budgetIn?: (m: Period) => boolean } = {}): VarianceRow[] {
  const rows: VarianceRow[] = [];
  for (let k = 0; k < count; k++) {
    const m = addMonths(from, k);
    const f = perMonth(m);
    const hasA = opts.actualsIn ? opts.actualsIn(m) : true;
    const hasB = opts.budgetIn ? opts.budgetIn(m) : Object.values(f).some(v => v?.[1] != null);
    const value = (key: string, i: 0 | 1): number => Number(f[key]?.[i] ?? 0);
    for (const d of DEFS.filter(x => x.kind !== 'excluded')) {
      const pick = (i: 0 | 1): number => {
        if (d.kind !== 'calculated') return value(d.key, i);
        // display sign: income adds, costs subtract
        return DEFS.filter(x => (x.kind === 'income' || x.kind === 'cost') && x.sort_order < d.sort_order)
          .reduce((s, x) => s + (x.kind === 'income' ? 1 : -1) * value(x.key, i), 0);
      };
      const a = hasA ? pick(0) : null;
      const b = hasB ? pick(1) : null;
      const v = a !== null && b !== null ? a - b : null;
      rows.push({
        line_key: d.key, line_label: d.label, line_kind: d.kind as VarianceRow['line_kind'], line_order: d.sort_order, month: m,
        actual: a === null ? null : a.toFixed(2), budget: b === null ? null : b.toFixed(2), variance: v === null ? null : v.toFixed(2),
        variance_pct: v !== null && b !== null && b !== 0 ? String((v / Math.abs(b)) * 100) : null,
        favourable: v === null ? null : d.kind === 'income' || d.kind === 'calculated' ? v >= 0 : d.kind === 'cost' ? v <= 0 : null,
      });
    }
  }
  return rows;
}
