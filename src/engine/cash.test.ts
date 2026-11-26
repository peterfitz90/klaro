// Cash balance, net cash burn and Runway, rule by rule (docs/kpi-definitions.md, Phase 2), and the
// fixture shared with the database test (db/tests/fixtures/cash_position_cases.json).
import { describe, expect, it } from 'vitest';
import fixture from '../../db/tests/fixtures/cash_position_cases.json';
import { BURN_LABEL, cashKpis, NOT_SET_UP, type CashRow } from './cash';
import { toCents } from './money';

const opts = { currentMonth: '2026-11-01', actualsThrough: null as string | null, currency: 'EUR' as const };

function rows(head: { latest: string; available: number; unmapped: number; cashAccounts: number }, months: readonly (readonly [string, boolean, string | null])[]): CashRow[] {
  return months.map(([month, hasBalances, cash]) => ({
    latestMonth: head.latest, monthsAvailable: head.available, unmappedAccounts: head.unmapped, cashAccounts: head.cashAccounts,
    month, hasBalances, cash: cash === null ? null : toCents(cash),
  }));
}
/** Five month-ends ending at `latest`, newest first, from the given closing balances (newest first). */
function series(latest: string, cash: (string | null)[], extra: Partial<{ unmapped: number; cashAccounts: number }> = {}): CashRow[] {
  const [y, m] = latest.split('-').map(Number) as [number, number];
  const months = cash.map((c, k) => {
    const idx = y * 12 + (m - 1) - k;
    const p = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`;
    return [p, c !== null, c] as const;
  });
  return rows({ latest, available: cash.filter(c => c !== null).length, unmapped: extra.unmapped ?? 0, cashAccounts: extra.cashAccounts ?? 1 }, months);
}

describe('cash KPIs: the shared fixture (same rows as the 0004 database test)', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const k = cashKpis(rows(c.head, c.months as [string, boolean, string | null][]), { ...opts, currentMonth: fixture.currentMonth });
      expect(k.cash.cents).toBe(c.expect.cash === null ? null : toCents(c.expect.cash));
      expect(k.burnCents).toBe(c.expect.burn === null ? null : toCents(c.expect.burn));
      expect(k.runway.text).toBe(c.expect.runway);
    });
  }
});

describe('cash KPI rules', () => {
  it('no balances at all: both "—" with "No balances yet", never zero', () => {
    const k = cashKpis([], opts);
    expect([k.cash.cents, k.cash.text, k.runway.cents, k.runway.text]).toEqual([null, null, null, null]);
    expect(k.cash.notes).toEqual(['No balances yet']);
  });
  it('not set up (cash_accounts 0): both "—" with the mapping prompt, never 0.00 or n/a, even though cash reads 0', () => {
    const k = cashKpis(series('2025-12-01', ['0', '0', '0', '0', '0'], { cashAccounts: 0, unmapped: 2 }), opts);
    expect(k.cash.cents).toBeNull();
    expect(k.runway.text).toBeNull();
    expect(k.cash.notes[0]).toBe(NOT_SET_UP);
    expect(k.runway.notes[0]).toBe(NOT_SET_UP);
    expect(k.cash.notes).toContain('Incomplete: 2 balance accounts unmapped');
  });
  it('labels: "Balances through", plus "Actuals through" only when it differs', () => {
    const s = series('2025-12-01', ['100.00', '200.00', '300.00', '400.00', '500.00']);
    expect(cashKpis(s, { ...opts, actualsThrough: '2025-12-01' }).cash.notes).toEqual(['Balances through Dec 2025']);
    expect(cashKpis(s, { ...opts, actualsThrough: '2025-11-01' }).cash.notes).toEqual(['Balances through Dec 2025', 'Actuals through Nov 2025']);
  });
  it('one unmapped balance account: singular wording, on the Cash tile', () => {
    const k = cashKpis(series('2025-12-01', ['1.00', '2.00', '3.00', '4.00', null], { unmapped: 1 }), opts);
    expect(k.cash.notes).toContain('Incomplete: 1 balance account unmapped');
  });
  it('burn and runway: the burn label says it includes loans and owner funding', () => {
    // cash 9,000 now, 12,000 three months before: burn 1,000/month, runway 9.0
    const k = cashKpis(series('2025-12-01', ['9000.00', '10000.00', '11000.00', '12000.00', null]), opts);
    expect(k.burnCents).toBe(100000n);
    expect(k.runway.text).toBe('9.0');
    expect(k.runway.notes[0]).toBe(`€1,000.00/month ${BURN_LABEL}`);
  });
  it('runway is truncated, never rounded up (8.99 shows 8.9)', () => {
    // fall 3,000.00 over three months -> burn 1,000.00; cash 8,999.99 -> 8.99999 -> 8.9
    const k = cashKpis(series('2025-12-01', ['8999.99', '9000.00', '10000.00', '11999.99', null]), opts);
    expect(k.runway.text).toBe('8.9');
  });
  it('runway uses the exact burn, not the rounded one (burn 33.33⅓ a month)', () => {
    // fall 100.00 -> burn 33.333…; cash 300.00 -> runway exactly 9.0 (with the rounded 33.33 it would be 9.0009)
    const k = cashKpis(series('2025-12-01', ['300.00', '320.00', '350.00', '400.00', null]), opts);
    expect(k.burnCents).toBe(3333n);
    expect(k.runway.text).toBe('9.0');
    const k2 = cashKpis(series('2025-12-01', ['299.99', '320.00', '350.00', '399.99', null]), opts);
    expect(k2.runway.text).toBe('8.9'); // 299.99 / 33.333… = 8.9997
  });
  it('when the latest month is the current calendar month, the burn ends at the month before', () => {
    // latest Nov 2026 (= current month): m = Oct, window Jul..Oct. Nov's 1.00 is the cash balance.
    const k = cashKpis(series('2026-11-01', ['1.00', '6000.00', '7000.00', '8000.00', '9000.00']), opts);
    expect(k.burnMonth).toBe('2026-10-01');
    expect(k.burnCents).toBe(100000n);
    expect(k.cash.cents).toBe(100n);
    expect(k.runway.text).toBe('0.0'); // 1.00 / 1,000.00 = 0.001
  });
  it('the shifted window needs m−3 too: four month-ends ending this month are not enough', () => {
    // balances Aug..Nov 2026 with Nov = this month: m = Oct needs Jul, which is missing.
    const k = cashKpis(series('2026-11-01', ['1.00', '2.00', '3.00', '4.00', null]), opts);
    expect(k.runway.text).toBeNull();
    expect(k.runway.notes[0]).toBe('Needs month-end balances for each month Jul 2026 to Oct 2026');
  });
  it('a gap anywhere in m−3..m gives "—"', () => {
    const k = cashKpis(series('2025-12-01', ['100.00', '200.00', null, '400.00', '500.00']), opts);
    expect(k.runway.text).toBeNull();
    expect(k.cash.cents).toBe(10000n);
  });
  it('not burning: zero or positive change gives "n/a (not burning cash)"', () => {
    expect(cashKpis(series('2025-12-01', ['500.00', '1.00', '1.00', '500.00', null]), opts).runway.text).toBe('n/a (not burning cash)');
    expect(cashKpis(series('2025-12-01', ['600.00', '1.00', '1.00', '500.00', null]), opts).runway.text).toBe('n/a (not burning cash)');
  });
  it('burning with cash at or below zero: "0.0" and "Cash is zero or overdrawn"', () => {
    for (const now of ['0.00', '-250.00']) {
      const k = cashKpis(series('2025-12-01', [now, '100.00', '200.00', '300.00', null]), opts);
      expect(k.runway.text).toBe('0.0');
      expect(k.runway.notes[0]).toBe('Cash is zero or overdrawn');
      expect(k.cash.cents).toBe(toCents(now));
    }
  });
  it('a real zero cash balance with an account mapped is shown as 0.00, not "—"', () => {
    const k = cashKpis(series('2025-12-01', ['0.00', '0.00', '0.00', '0.00', null]), opts);
    expect(k.cash.cents).toBe(0n);
    expect(k.runway.text).toBe('n/a (not burning cash)');
  });
});
