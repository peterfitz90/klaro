// Scenarios engine: a hand-computed fixture (every figure below worked out by hand), the rounding
// rule (leftover cents to the last month), the driver-to-line rules and the indicative cash.
import { describe, expect, it } from 'vitest';
import { toCents } from './money';
import { applyScenario, NO_CHANGE, parsePercent, percentText, scenarioOrder, summarise, type Drivers } from './scenarios';

const twelve = (amount: string) => Array.from({ length: 12 }, () => toCents(amount));
// Stored sign: revenue negative (credit), costs positive.
const BASE = new Map<string, bigint[]>([
  ['revenue', twelve('-1000.00')], ['cost_of_sales', twelve('400.00')], ['payroll', twelve('300.00')], ['other_operating', twelve('100.03')],
  ['marketing', twelve('50.00')], ['premises', twelve('80.00')], ['interest', twelve('10.00')], ['tax', twelve('20.00')],
]);
const bp = (pct: string) => { const r = parsePercent(pct); if ('problem' in r) throw new Error(r.problem); return r.bp; };
const drivers = (rev: string, pay: string, other: string): Drivers => ({ revenue: bp(rev), payroll: bp(pay), other: bp(other) });
const sum = (a: readonly bigint[]) => a.reduce((x, y) => x + y, 0n);

describe('scenarios: hand-computed fixture', () => {
  it('Base is the budget as it is', () => {
    // revenue 12,000.00; costs 4,800 + 3,600 + 1,200.36 + 600 + 960 + 120 + 240 = 11,520.36; profit 479.64
    expect(summarise(applyScenario(BASE, NO_CHANGE), null)).toEqual({ revenue: toCents('12000.00'), costs: toCents('11520.36'), netProfit: toCents('479.64'), closingCash: null });
  });
  it('Upside: revenue +10% (cost of sales follows), payroll +5%, other costs -3.33%', () => {
    const lines = applyScenario(BASE, drivers('10', '5', '-3.33'));
    expect(sum(lines.get('revenue') ?? [])).toBe(toCents('-13200.00'));
    expect(sum(lines.get('cost_of_sales') ?? [])).toBe(toCents('5280.00'));   // moves with revenue
    expect(sum(lines.get('payroll') ?? [])).toBe(toCents('3780.00'));
    // 100.03 x 0.9667 = 96.699001 -> 96.70 for Jan..Nov; the year 1,200.36 x 0.9667 = 1,160.388012 -> 1,160.39;
    // December takes the rest: 1,160.39 - 11 x 96.70 = 96.69.
    expect(lines.get('other_operating')?.slice(0, 11)).toEqual(Array.from({ length: 11 }, () => toCents('96.70')));
    expect(lines.get('other_operating')?.[11]).toBe(toCents('96.69'));
    for (const unchanged of ['marketing', 'premises', 'interest', 'tax']) expect(lines.get(unchanged)).toEqual(BASE.get(unchanged));
    // costs 5,280 + 3,780 + 1,160.39 + 600 + 960 + 120 + 240 = 12,140.39; profit 13,200 - 12,140.39 = 1,059.61
    expect(summarise(lines, toCents('95400.00'))).toEqual({
      revenue: toCents('13200.00'), costs: toCents('12140.39'), netProfit: toCents('1059.61'), closingCash: toCents('96459.61'),
    });
  });
  it('Downside: revenue -10%, payroll unchanged, other costs +5%: a loss', () => {
    // other: 100.03 x 1.05 = 105.0315 -> 105.03 x 11 = 1,155.33; year 1,260.378 -> 1,260.38; December 105.05
    const lines = applyScenario(BASE, drivers('-10', '0', '5'));
    expect(lines.get('other_operating')?.[11]).toBe(toCents('105.05'));
    // revenue 10,800; costs 4,320 + 3,600 + 1,260.38 + 600 + 960 + 120 + 240 = 11,100.38; profit -300.38
    expect(summarise(lines, toCents('95400.00'))).toEqual({
      revenue: toCents('10800.00'), costs: toCents('11100.38'), netProfit: toCents('-300.38'), closingCash: toCents('95099.62'),
    });
  });
});

describe('scenarios: rules', () => {
  it('every scaled line adds up to its rounded annual figure (leftover cents in the last month)', () => {
    const odd = new Map([['revenue', [-33333n, -33333n, -33334n, -1n, -2n, -3n, -4n, -5n, -6n, -7n, -8n, -9n]]]);
    const out = applyScenario(odd, drivers('33.33', '0', '0')).get('revenue') ?? [];
    // annual = -100,045 cents x 1.3333 = -133,389.9985 -> -133,390
    expect(sum(out)).toBe(-133390n);
    expect(out.length).toBe(12);
  });
  it('-100% takes a line to zero; lines with no driver and unknown lines are copied', () => {
    const out = applyScenario(new Map([['revenue', twelve('-5.00')], ['marketing', twelve('7.00')], ['excluded', twelve('1.00')]]), drivers('-100', '0', '0'));
    expect(sum(out.get('revenue') ?? [])).toBe(0n);
    expect(out.get('marketing')).toEqual(twelve('7.00'));
    expect(out.get('excluded')).toEqual(twelve('1.00'));
  });
  it('the indicative closing cash is "—" (null) without a cash balance, and cash + profit with one', () => {
    expect(summarise(BASE, null).closingCash).toBeNull();
    expect(summarise(BASE, 0n).closingCash).toBe(toCents('479.64'));
    expect(summarise(BASE, toCents('-1000.00')).closingCash).toBe(toCents('-520.36'));
  });
  it('percent input: blank is 0, "%" allowed, two decimals, -100 to 1000', () => {
    expect(parsePercent('')).toEqual({ bp: 0n });
    expect(parsePercent('7.5%')).toEqual({ bp: 750n });
    expect(parsePercent('-100')).toEqual({ bp: -10000n });
    for (const bad of ['abc', '1.234', '-101', '1001', '1e2']) expect('problem' in parsePercent(bad)).toBe(true);
    expect(percentText(750n)).toBe('7.5');
    expect(percentText(-333n)).toBe('-3.33');
    expect(percentText(0n)).toBe('0');
    expect(percentText(1000n)).toBe('10');
  });
});

describe('scenarioOrder', () => {
  it('Base first, then Upside, Downside, then the others by name, whatever order they were saved in', () => {
    const saved = ['Hiring plan', 'Upside', 'Base', 'Downside', 'Expansion'].map(name => ({ name, is_base: name === 'Base' }));
    expect([...saved].sort(scenarioOrder).map(s => s.name)).toEqual(['Base', 'Upside', 'Downside', 'Expansion', 'Hiring plan']);
  });
});

