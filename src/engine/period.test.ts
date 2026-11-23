import { describe, expect, it } from 'vitest';
import { addMonths, fiscalYearStart, isPeriod, months, period } from './period';

describe('periods', () => {
  it('validates first-of-month text', () => {
    expect(isPeriod('2027-01-01')).toBe(true);
    expect(isPeriod('2027-01-02')).toBe(false);
    expect(isPeriod('2027-13-01')).toBe(false);
    expect(() => period(2027, 0)).toThrow();
  });
  it('adds months across years both ways', () => {
    expect(addMonths('2026-11-01', 2)).toBe('2027-01-01');
    expect(addMonths('2027-01-01', -1)).toBe('2026-12-01');
    expect(addMonths('2027-03-01', -15)).toBe('2025-12-01');
    expect(months('2026-11-01', 3)).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
  });
  it('finds the fiscal year start', () => {
    expect(fiscalYearStart('2027-02-01', 4)).toBe('2026-04-01');
    expect(fiscalYearStart('2027-04-01', 4)).toBe('2027-04-01');
    expect(fiscalYearStart('2027-12-01', 1)).toBe('2027-01-01');
  });
});
