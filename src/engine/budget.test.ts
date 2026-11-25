import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseUplift, previewLine, storedFromTyped } from './budget';
import { toAmount, toCents } from './money';

describe('uplift as typed', () => {
  it('reads a percentage, blank as none', () => {
    expect(parseUplift('5')).toEqual({ bp: 500n });
    expect(parseUplift('-2.5%')).toEqual({ bp: -250n });
    expect(parseUplift('')).toEqual({ bp: 0n });
    expect(parseUplift('1000')).toEqual({ bp: 100000n });
  });
  it('refuses what the server refuses', () => {
    for (const bad of ['abc', '1.234', '-101', '1001', '5,5']) expect(parseUplift(bad)).toHaveProperty('problem');
  });
});

describe('budget preview', () => {
  it('rounds each month, the last takes the rest, and the months add up to the rounded annual figure', () => {
    const p = previewLine(Array.from({ length: 12 }, () => 1000n), 333n);   // €10.00 a month, +3.33%
    expect(p.budget.slice(0, 11).every(c => c === 1033n)).toBe(true);
    expect(p.budget[11]).toBe(1037n);   // 12 x 1033.3 = 12399.6 -> 12400; 12400 - 11 x 1033
    expect(p.budgetTotal).toBe(12400n);
    expect(p.actualTotal).toBe(12000n);
  });
  it('gives the same cents in display sign as the server in stored sign (rounding is symmetric)', () => {
    const months = [1001n, -2003n, 3005n, 7n, 0n, 12345n, -1n, 999n, 5n, 5n, 5n, 15n];
    const pos = previewLine(months, 1250n);
    const neg = previewLine(months.map(c => -c), 1250n);
    expect(neg.budget).toEqual(pos.budget.map(c => -c));
  });
  it('matches the shared rounding fixture used by the database tests', () => {
    const fixture = JSON.parse(readFileSync(resolve(process.cwd(), 'db/tests/fixtures/rounding_cases.json'), 'utf8')) as {
      cases: { uplift: string; actuals: string[]; expected: string[] }[];
    };
    expect(fixture.cases.length).toBeGreaterThan(0);
    for (const c of fixture.cases) {
      const bp = parseUplift(c.uplift);
      if (!('bp' in bp)) throw new Error(`bad uplift ${c.uplift}`);
      const got = previewLine(c.actuals.map(toCents), bp.bp).budget.map(toAmount);
      expect(got).toEqual(c.expected.map(e => toAmount(toCents(e))));
    }
  });
  it('needs exactly 12 months', () => {
    expect(() => previewLine([1n], 0n)).toThrow();
  });
});

describe('typed amounts (revenue typed positive)', () => {
  it('stores display sign × typed', () => {
    expect(storedFromTyped('12,000.50', -1, 'EUR')).toEqual({ amount: '-12000.50' });   // revenue
    expect(storedFromTyped('300', 1, 'EUR')).toEqual({ amount: '300.00' });             // a cost
    expect(storedFromTyped('(50)', -1, 'EUR')).toEqual({ amount: '50.00' });            // negative revenue
    expect(storedFromTyped('€20', 1, 'EUR')).toEqual({ amount: '20.00' });
  });
  it('refuses what is not an amount', () => {
    expect(storedFromTyped('abc', 1, 'EUR')).toHaveProperty('problem');
    expect(storedFromTyped('£5', 1, 'EUR')).toHaveProperty('problem');
    expect(storedFromTyped('', 1, 'EUR')).toEqual({ problem: 'The amount is empty.' });
  });
});
