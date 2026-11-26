import { describe, expect, it } from 'vitest';
import { linearScale, monthsBetween, qualityNotes, yearToMonth, type QualityInput } from './report';

const money = (c: bigint) => `€${(Number(c) / 100).toFixed(2)} ${c < 0n ? 'Cr' : 'Dr'}`;
const label = (p: string) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
const CLEAN: QualityInput = {
  month: '2025-12-01', actualsThrough: '2025-12-01', currentMonth: '2026-11-01',
  unmappedPnl: { count: 0, cents: 0n }, unmappedBalance: 0, balancesThrough: '2025-12-01',
};

describe('linearScale', () => {
  it('maps max to top and min to bottom, with 0 always in the domain', () => {
    const s = linearScale([10000n, 50000n], 10, 110); // 100.00 and 500.00
    expect([s.min, s.max]).toEqual([0, 500]);
    expect(s.y(50000n)).toBe(10);
    expect(s.y(0n)).toBe(110);
    expect(s.zero).toBe(110);
    expect(s.y(25000n)).toBe(60);
  });
  it('a loss sits below the baseline', () => {
    const s = linearScale([-10000n, 30000n], 0, 100); // -100 .. 300
    expect(s.zero).toBe(75);
    expect(s.y(-10000n)).toBe(100);
  });
  it('ignores nulls; no values (or all zero) gives a flat 0..1 domain', () => {
    expect(linearScale([null, null], 0, 100).max).toBe(1);
    expect(linearScale([0n], 0, 100).zero).toBe(100);
    expect(linearScale([null, 20000n], 0, 100).max).toBe(200);
  });
});

describe('qualityNotes', () => {
  it('a clean entity has no notes ("None")', () => {
    expect(qualityNotes(CLEAN, money, label)).toEqual([]);
  });
  it('unmapped P&L accounts, with their net total', () => {
    expect(qualityNotes({ ...CLEAN, unmappedPnl: { count: 2, cents: 7500n } }, money, label))
      .toEqual(['2 P&L accounts unmapped (net €75.00 Dr): their amounts are on the Unmapped line, not in profit.']);
    expect(qualityNotes({ ...CLEAN, unmappedPnl: { count: 1, cents: -100n } }, money, label)[0]).toContain('1 P&L account unmapped (net €-1.00 Cr): its amount is');
  });
  it('unmapped balance accounts; or that they could not be checked', () => {
    expect(qualityNotes({ ...CLEAN, unmappedBalance: 1 }, money, label)).toEqual(['1 balance account unmapped: the Cash balance is incomplete.']);
    expect(qualityNotes({ ...CLEAN, unmappedBalance: null }, money, label)).toEqual(['The balance accounts could not be checked.']);
  });
  it('balances older than actuals, by how many months', () => {
    expect(qualityNotes({ ...CLEAN, balancesThrough: '2025-09-01' }, money, label))
      .toEqual(['Balances are 3 months older than actuals (balances through Sep 2025, actuals through Dec 2025).']);
    expect(qualityNotes({ ...CLEAN, balancesThrough: '2025-11-01' }, money, label)[0]).toContain('1 month older');
    expect(qualityNotes({ ...CLEAN, balancesThrough: null }, money, label)).toEqual([]); // none imported: the headlines say so
    expect(qualityNotes({ ...CLEAN, balancesThrough: undefined }, money, label)).toEqual(['Whether the balances are up to date could not be checked.']);
  });
  it('a month that may be incomplete (the latest month is this month)', () => {
    expect(qualityNotes({ ...CLEAN, month: '2026-11-01', actualsThrough: '2026-11-01', balancesThrough: '2026-11-01' }, money, label))
      .toEqual(['Nov 2026 is this month: its actuals may be incomplete.']);
    expect(qualityNotes({ ...CLEAN, month: '2026-10-01', actualsThrough: '2026-11-01', balancesThrough: '2026-11-01' }, money, label)).toEqual([]);
  });
});

describe('month helpers', () => {
  it('monthsBetween and yearToMonth', () => {
    expect(monthsBetween('2025-09-01', '2025-12-01')).toBe(3);
    expect(monthsBetween('2025-12-01', '2026-01-01')).toBe(1);
    expect(yearToMonth('2025-01-01', '2025-03-01')).toEqual(['2025-01-01', '2025-02-01', '2025-03-01']);
    expect(yearToMonth('2025-04-01', '2026-03-01')).toHaveLength(12);
    expect(yearToMonth('2025-01-01', '2024-12-01')).toEqual([]);
  });
});
