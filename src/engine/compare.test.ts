import { describe, expect, it } from 'vitest';
import { formatPct, isFavourable, sumCells, toLines, variancePct, type Cell, type VarianceRow } from './compare';

const row = (line_key: string, line_kind: VarianceRow['line_kind'], month: string, actual: string | null, budget: string | null, order = 10): VarianceRow => {
  const variance = actual !== null && budget !== null ? (Number(actual) - Number(budget)).toFixed(2) : null;
  return {
    line_key, line_label: line_key, line_kind, line_order: order, month, actual, budget, variance,
    variance_pct: variance !== null && budget !== null && Number(budget) !== 0 ? String((Number(variance) / Math.abs(Number(budget))) * 100) : null,
    favourable: null,
  };
};
const cell = (actual: bigint | null, budget: bigint | null): Cell => ({ actual, budget, variance: null, pct: null, favourable: null });

describe('favourable or not', () => {
  it('income and profit lines: at or over budget; cost lines: at or under; unmapped: neither', () => {
    expect(isFavourable('income', 1n)).toBe(true);
    expect(isFavourable('income', -1n)).toBe(false);
    expect(isFavourable('calculated', 0n)).toBe(true);
    expect(isFavourable('cost', -1n)).toBe(true);
    expect(isFavourable('cost', 1n)).toBe(false);
    expect(isFavourable('cost', 0n)).toBe(true);
    expect(isFavourable('unmapped', 5n)).toBeNull();
    expect(isFavourable('income', null)).toBeNull();
  });
});

describe('variance percent', () => {
  it('is relative to the size of the budget, and null (not zero or infinity) when there is no budget', () => {
    expect(variancePct(100n, 1000n)).toBe(10);
    expect(variancePct(100n, -1000n)).toBe(10);
    expect(variancePct(100n, 0n)).toBeNull();
    expect(variancePct(null, 100n)).toBeNull();
    expect(variancePct(5n, null)).toBeNull();
  });
  it('formats with one decimal and a sign', () => {
    expect(formatPct(12.345)).toBe('+12.3%');
    expect(formatPct(-4)).toBe('-4.0%');
    expect(formatPct(0)).toBe('0.0%');
    expect(formatPct(null)).toBe('—');
  });
});

describe('rows to lines', () => {
  it('groups by line in the database order, with exact cents', () => {
    const lines = toLines([
      row('payroll', 'cost', '2026-01-01', '100.10', '90.00', 40),
      row('revenue', 'income', '2026-01-01', '1000.00', '900.00', 10),
      row('revenue', 'income', '2026-02-01', null, '900.00', 10),
    ]);
    expect(lines.map(l => l.key)).toEqual(['revenue', 'payroll']);
    expect(lines[0]?.months.get('2026-01-01')).toMatchObject({ actual: 100000n, budget: 90000n, variance: 10000n });
    expect(lines[0]?.months.get('2026-02-01')?.actual).toBeNull();
  });
});

describe('year to date', () => {
  it('adds the months and applies the same rules', () => {
    const ytd = sumCells('cost', [cell(1000n, 900n), cell(500n, 700n)]);
    expect(ytd).toEqual({ actual: 1500n, budget: 1600n, variance: -100n, pct: -6.25, favourable: true });
  });
  it('a month without actuals makes the actual (and the variance) unknown, not a partial sum', () => {
    const ytd = sumCells('income', [cell(1000n, 900n), cell(null, 700n)]);
    expect(ytd.actual).toBeNull();
    expect(ytd.budget).toBe(1600n);
    expect(ytd.variance).toBeNull();
    expect(ytd.favourable).toBeNull();
  });
  it('a zero budget gives no percentage', () => {
    expect(sumCells('income', [cell(10n, 0n)]).pct).toBeNull();
  });
  it('no months at all is unknown', () => {
    expect(sumCells('income', []).actual).toBeNull();
  });
});
