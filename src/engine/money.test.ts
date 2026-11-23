import { describe, expect, it } from 'vitest';
import { formatMoney, sumCents, toAmount, toCents } from './money';

describe('money', () => {
  it('converts database amounts exactly', () => {
    expect(toCents('1234.5')).toBe(123450n);
    expect(toCents('-0.07')).toBe(-7n);
    expect(toCents(0.1)).toBe(10n);
    expect(toCents(999999999999.99)).toBe(99999999999999n);
    expect(sumCents([toCents(0.1), toCents(0.2)])).toBe(30n);
  });
  it('refuses anything that is not an exact two-decimal amount', () => {
    expect(() => toCents('1.005')).toThrow();
    expect(() => toCents(1.005)).toThrow();
    expect(() => toCents('1e3')).toThrow();
    expect(() => toCents(Number.NaN)).toThrow();
    expect(() => toCents('')).toThrow();
  });
  it('writes and formats', () => {
    expect(toAmount(-2000n)).toBe('-20.00');
    expect(toAmount(5n)).toBe('0.05');
    expect(() => toAmount(100_000_000_000_000n)).toThrow();
    expect(formatMoney(123450n, 'EUR')).toBe('€1,234.50');
    expect(formatMoney(-2000n, 'GBP')).toBe('-£20.00');
  });
});
