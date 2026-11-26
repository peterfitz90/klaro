// The Cash page's projection, hand-computed (Walkthrough Test 2's figures: cash €95,400.00 at the
// end of Dec 2025, net cash burn €12,150.00/month; its scenarios' net-profit differences against
// Base on "Budget 2025 (stretch)"). Every figure below was worked out by hand.
import { describe, expect, it } from 'vitest';
import { cashKpis, type CashRow } from './cash';
import { cashCsvRows, cashHistory, cashQualityNotes, parseBurn, projectCash, runsOut, runsOutText } from './cashProjection';
import { toCents } from './money';

const label = (p: string) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
const NOW = toCents('95400.00'), BURN = toCents('12150.00');
const at = (pts: { k: number; cash: bigint }[], k: number) => pts.find(p => p.k === k)?.cash;

describe('Current trend projection', () => {
  const pts = projectCash('2025-12-01', NOW, BURN);
  it('12 months from the month after the latest balances, each one burn lower', () => {
    expect(pts.map(p => p.month)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01']);
    expect(at(pts, 1)).toBe(toCents('83250.00'));
    expect(at(pts, 6)).toBe(toCents('22500.00'));
    expect(at(pts, 7)).toBe(toCents('10350.00'));
    expect(at(pts, 8)).toBe(toCents('-1800.00'));
    expect(at(pts, 12)).toBe(toCents('-50400.00')); // 95,400 − 12 × 12,150
  });
  it('runs out in the first month below zero: Aug 2026 (month 8)', () => {
    expect(runsOut(pts)?.month).toBe('2026-08-01');
    expect(runsOutText(runsOut(pts), label)).toBe('Aug 2026');
  });
});

describe('Scenario adjustment: + round(k × (scenario profit − Base profit) ÷ 12)', () => {
  it('a positive difference (Upside: +27,930.61) runs out later, in Oct 2026', () => {
    const pts = projectCash('2025-12-01', NOW, BURN, toCents('27930.61'));
    // month 6: 22,500.00 + round(6 × 27,930.61 ÷ 12 = 13,965.305) = 22,500.00 + 13,965.31
    expect(at(pts, 6)).toBe(toCents('36465.31'));
    expect(at(pts, 12)).toBe(toCents('-22469.39')); // −50,400.00 + 27,930.61
    expect(at(pts, 9)).toBe(toCents('6997.96'));   // 95,400 − 109,350 + 20,947.96 (20,947.9575)
    expect(runsOut(pts)?.month).toBe('2026-10-01'); // 95,400 − 121,500 + 23,275.51 = −2,824.49
  });
  it('a negative difference (Downside: −59,565.24) runs out sooner, in Jun 2026', () => {
    const pts = projectCash('2025-12-01', NOW, BURN, toCents('-59565.24'));
    expect(at(pts, 5)).toBe(toCents('9831.15'));   // 34,650.00 + round(5 × −59,565.24 ÷ 12 = −24,818.85)
    expect(at(pts, 6)).toBe(toCents('-7282.62'));  // 22,500.00 − 29,782.62
    expect(at(pts, 12)).toBe(toCents('-109965.24'));
    expect(runsOut(pts)?.month).toBe('2026-06-01');
  });
  it('Hiring plan (+16,009.98) runs out in Sep 2026', () => {
    const pts = projectCash('2025-12-01', NOW, BURN, toCents('16009.98'));
    expect(at(pts, 6)).toBe(toCents('30504.99'));  // 22,500.00 + 8,004.99
    expect(at(pts, 8)).toBe(toCents('8873.32'));   // −1,800.00 + 10,673.32
    expect(at(pts, 9)).toBe(toCents('-1942.51'));  // −13,950.00 + 12,007.49 (12,007.485)
    expect(at(pts, 12)).toBe(toCents('-34390.02'));
    expect(runsOut(pts)?.month).toBe('2026-09-01');
  });
  it('rounding: the cumulative amount is rounded once per month, so month 12 carries the whole difference to the cent', () => {
    const pts = projectCash('2025-12-01', 0n, 0n, 100n); // €1.00 over a year: 0.0833… a month
    expect(pts.map(p => p.cash)).toEqual([8n, 17n, 25n, 33n, 42n, 50n, 58n, 67n, 75n, 83n, 92n, 100n]);
  });
});

describe('edge cases', () => {
  it('the what-if: a different burn redraws the line', () => {
    const pts = projectCash('2025-12-01', NOW, toCents('8000.00'));
    expect(at(pts, 12)).toBe(toCents('-600.00'));
    expect(runsOut(pts)?.month).toBe('2026-12-01');
    expect(runsOut(projectCash('2025-12-01', NOW, toCents('7000.00')))).toBeNull();
  });
  it('not burning cash (a negative or zero burn): the line rises and cash does not run out', () => {
    const pts = projectCash('2025-12-01', NOW, toCents('-500.00'));
    expect(at(pts, 12)).toBe(toCents('101400.00'));
    expect(runsOutText(runsOut(pts), label)).toBe('Cash does not run out within 12 months');
    expect(runsOutText(runsOut(pts), label, true)).toBe('Not within 12 months');
  });
  it('cash at or below zero while burning runs out in month 1', () => {
    expect(runsOut(projectCash('2025-12-01', 0n, toCents('1.00')))?.k).toBe(1);
    expect(runsOut(projectCash('2025-12-01', toCents('-50.00'), toCents('1.00')))?.k).toBe(1);
  });
  it('fewer than four month-ends: the shared engine gives no burn, so there is nothing to project', () => {
    const rows: CashRow[] = [['2025-12-01', '95400.00'], ['2025-11-01', '100000.00'], ['2025-10-01', null], ['2025-09-01', '120000.00'], ['2025-08-01', null]]
      .map(([month, cash]) => ({ latestMonth: '2025-12-01', monthsAvailable: 3, unmappedAccounts: 0, cashAccounts: 2, month: month as string, hasBalances: cash !== null, cash: cash === null ? null : toCents(cash as string) }));
    const k = cashKpis(rows, { currentMonth: '2026-11-01', actualsThrough: '2025-12-01', currency: 'EUR' });
    expect(k.burnCents).toBeNull();
    expect(k.runway.notes[0]).toBe('Needs month-end balances for each month Sep 2025 to Dec 2025');
  });
  it('parseBurn accepts the strip\'s format and refuses anything else', () => {
    expect(parseBurn('12,150.00')).toEqual({ cents: 1215000n });
    expect(parseBurn('€ 8000')).toEqual({ cents: 800000n });
    expect(parseBurn('-500')).toEqual({ cents: -50000n });
    expect('problem' in parseBurn('')).toBe(true);
    expect('problem' in parseBurn('12.345')).toBe(true);
    expect('problem' in parseBurn('abc')).toBe(true);
  });
});

describe('history and notes', () => {
  it('month-end cash: Cash and bank accounts only, 0 in a month with balances but no cash row, the last 12 months', () => {
    const rows = [
      { connection_id: 'c', account_code: '1210', period: '2025-11-01', cents: 10000n },
      { connection_id: 'c', account_code: '1220', period: '2025-11-01', cents: 500n },
      { connection_id: 'c', account_code: '1100', period: '2025-11-01', cents: 999n }, // not cash
      { connection_id: 'c', account_code: '1210', period: '2025-12-01', cents: 9000n },
    ];
    const months = Array.from({ length: 14 }, (_, i) => `${2024 + Math.floor((i + 10) / 12)}-${String(((i + 10) % 12) + 1).padStart(2, '0')}-01`); // Nov 2024 .. Dec 2025
    const h = cashHistory(['2025-10-01', ...months], rows, new Set(['c|1210', 'c|1220']));
    expect(h).toHaveLength(12);
    expect(h[0]?.month).toBe('2025-01-01');
    expect(h.find(x => x.month === '2025-11-01')?.cash).toBe(10500n);
    expect(h.find(x => x.month === '2025-12-01')?.cash).toBe(9000n);
    expect(h.find(x => x.month === '2025-10-01')?.cash).toBe(0n);
  });
  it('data-quality notes, and none when clean', () => {
    const base = { balancesThrough: '2025-12-01', actualsThrough: '2025-12-01', currentMonth: '2026-11-01', unmappedBalance: 0, missingMonthEnds: null };
    expect(cashQualityNotes(base, label)).toEqual([]);
    expect(cashQualityNotes({ ...base, unmappedBalance: 2, balancesThrough: '2025-10-01', missingMonthEnds: 'Needs month-end balances for each month Jul 2025 to Oct 2025', currentMonth: '2025-10-01' }, label)).toEqual([
      '2 balance accounts unmapped: the Cash balance is incomplete.',
      'Balances are 2 months older than actuals (balances through Oct 2025, actuals through Dec 2025).',
      'Needs month-end balances for each month Jul 2025 to Oct 2025: the net cash burn and Runway show "—" and no projection is drawn.',
      'Oct 2025 is this month: its balances may be incomplete, so the net cash burn ends at the month before.',
    ]);
  });
  it('CSV: month, cash, kind, line, for the history and each projection line', () => {
    const rows = cashCsvRows([{ month: '2025-12-01', cash: NOW }], [{ name: 'Current trend', points: projectCash('2025-12-01', NOW, BURN, 0n, 2) }]);
    expect(rows).toEqual([['month', 'cash', 'kind', 'line'], ['2025-12', '95400.00', 'history', 'Month-end cash'], ['2026-01', '83250.00', 'projection', 'Current trend'], ['2026-02', '71100.00', 'projection', 'Current trend']]);
  });
});
