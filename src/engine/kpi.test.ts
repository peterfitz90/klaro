// docs/kpi-definitions.md, rule by rule.
import { describe, expect, it } from 'vitest';
import { kpiTiles, type KpiInput } from './kpi';

const base: KpiInput = { latestMonth: '2026-10-01', currentMonth: '2026-11-01', revenue: 5000000n, netProfit: 120000n, unmappedAccounts: 0 };
const tile = (input: KpiInput, label: string) => kpiTiles(input).tiles.find(t => t.label === label);

describe('KPI rules', () => {
  it('the four KPIs, in order', () => {
    expect(kpiTiles(base).tiles.map(t => t.label)).toEqual(['Revenue (month)', 'Net profit', 'Cash balance', 'Runway (months)']);
  });
  it('Revenue (month) and Net profit are the latest month’s figures', () => {
    expect(tile(base, 'Revenue (month)')?.cents).toBe(5000000n);
    expect(tile(base, 'Net profit')?.cents).toBe(120000n);
  });
  it('every KPI says "actuals through [month]"', () => {
    for (const t of kpiTiles(base).tiles) expect(t.notes).toContain('Actuals through Oct 2026');
  });
  it('with no data every KPI shows "—" (null), never zero', () => {
    const none = kpiTiles({ ...base, latestMonth: null, revenue: 0n, netProfit: 0n });
    for (const t of none.tiles) {
      expect(t.cents).toBeNull();
      expect(t.notes).toContain('No actuals yet');
    }
  });
  it('a real zero with data is shown as zero', () => {
    expect(tile({ ...base, netProfit: 0n }, 'Net profit')?.cents).toBe(0n);
  });
  it('Cash balance and Runway are "—" in Phase 1', () => {
    expect(tile(base, 'Cash balance')?.cents).toBeNull();
    expect(tile(base, 'Runway (months)')?.cents).toBeNull();
  });
  it('"month may be incomplete" beside Revenue and Net profit when the latest month is this month', () => {
    const now = { ...base, latestMonth: '2026-11-01' };
    expect(tile(now, 'Revenue (month)')?.notes).toContain('Month may be incomplete');
    expect(tile(now, 'Net profit')?.notes).toContain('Month may be incomplete');
    expect(tile(now, 'Cash balance')?.notes).not.toContain('Month may be incomplete');
    expect(tile(base, 'Revenue (month)')?.notes).not.toContain('Month may be incomplete');
  });
  it('while any account is unmapped, the profit figures are marked incomplete, with how many', () => {
    const u = kpiTiles({ ...base, unmappedAccounts: 3 });
    expect(u.stripNote).toBe('The profit figures are incomplete: 3 accounts are unmapped.');
    expect(u.tiles.find(t => t.label === 'Net profit')?.notes).toContain('Incomplete: 3 accounts unmapped');
    expect(kpiTiles(base).stripNote).toBeNull();
  });
});
