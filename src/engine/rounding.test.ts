import { describe, expect, it } from 'vitest';
import fixture from '../../db/tests/fixtures/rounding_cases.json';
import { toAmount, toCents } from './money';
import { budgetFromActuals, divRound, spreadAnnual, upliftBasisPoints } from './rounding';

describe('divRound: half away from zero', () => {
  it.each([
    [5n, 10n, 1n], [-5n, 10n, -1n], [4n, 10n, 0n], [-4n, 10n, 0n], [15n, 10n, 2n], [-15n, 10n, -2n],
    [14n, 10n, 1n], [0n, 7n, 0n], [10n, 3n, 3n], [-10n, 3n, -3n], [11n, 2n, 6n],
  ])('%s / %s = %s', (n, d, q) => expect(divRound(n, d)).toBe(q));
  it('refuses a divisor that is not positive', () => {
    expect(() => divRound(1n, 0n)).toThrow();
    expect(() => divRound(1n, -2n)).toThrow();
  });
});

describe('upliftBasisPoints', () => {
  it.each([['0', 0n], ['3.5', 350n], ['3.33', 333n], ['-10', -1000n], ['-100', -10000n], ['1000', 100000n], [' 2.50 ', 250n]])('%s', (t, bp) =>
    expect(upliftBasisPoints(t)).toBe(bp));
  it.each(['', 'abc', '1.234', '-100.01', '1000.01', '1e2', '5%'])('refuses %j', t => expect(() => upliftBasisPoints(t)).toThrow());
});

describe('budgetFromActuals: the shared cases (also run in SQL)', () => {
  it.each(fixture.cases.map(c => [c.plan_line, c]))('%s', (_line, c) => {
    const got = budgetFromActuals(c.actuals.map(toCents), upliftBasisPoints(c.uplift));
    expect(got.map(toAmount)).toEqual(c.expected);
    expect(toAmount(got.reduce((a, b) => a + b, 0n))).toBe(c.annual);
  });
  it('covers a month that goes negative to absorb the leftover', () => {
    expect(fixture.cases.some(c => (c.expected[11] ?? '').startsWith('-') && !(c.actuals[11] ?? '').startsWith('-'))).toBe(true);
  });
});

describe('spreadAnnual', () => {
  it('splits evenly, the last month takes the rest, and the months sum exactly', () => {
    expect(spreadAnnual(100_000n).map(toAmount)).toEqual([...Array(11).fill('83.33'), '83.37']);
    expect(spreadAnnual(-100n, 3).map(toAmount)).toEqual(['-0.33', '-0.33', '-0.34']);
    expect(spreadAnnual(5n, 2)).toEqual([3n, 2n]);
    for (const total of [0n, 1n, -1n, 99_999_999_999_99n, 12_345n, -7n]) {
      for (const n of [1, 5, 12, 13]) expect(spreadAnnual(total, n).reduce((a, b) => a + b, 0n)).toBe(total);
    }
  });
  it('refuses a bad month count', () => {
    expect(() => spreadAnnual(1n, 0)).toThrow();
    expect(() => spreadAnnual(1n, 1.5)).toThrow();
  });
});
