// @vitest-environment jsdom
// The KPI strip (docs/kpi-definitions.md), switched on after Peter's sign-off on 25 Nov 2026
// (src/app/shell/kpiSwitch.ts); the cash tiles (Phase 2) after his sign-off on 26 Nov 2026.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CASH_KPIS_LIVE, KPI_STRIP_LIVE } from '../../app/shell/kpiSwitch';
import { dataChanged } from '../../lib/dataEvents';
import { EntityContext } from '../entities/context';
import { CONN, ENTITY, varianceRows } from '../plan/fixtures';

const connectApi = {
  listConnections: vi.fn(async () => [{ ...CONN, actuals_through: '2026-10-01' }] as { actuals_through: string | null }[]),
  unmappedAccounts: vi.fn(async () => [] as unknown[]),
  cashPosition: vi.fn(async () => [] as unknown[]),
};
/** fpa.cash_position rows (converted), newest first: [month, cash or null]. */
const cashRows = (latest: string, months: [string, string | null][], head: Partial<{ unmapped: number; cashAccounts: number }> = {}) =>
  months.map(([month, cash]) => ({
    latestMonth: latest, monthsAvailable: months.filter(m => m[1] !== null).length, unmappedAccounts: head.unmapped ?? 0,
    cashAccounts: head.cashAccounts ?? 2, month, hasBalances: cash !== null, cash: cash === null ? null : BigInt(cash.replace('.', '')),
  }));
const FALLING = cashRows('2026-10-01', [['2026-10-01', '95400.00'], ['2026-09-01', '108000.00'], ['2026-08-01', '120150.00'], ['2026-07-01', '131850.00'], ['2026-06-01', '140000.00']]);
vi.mock('../connect/api', () => connectApi);
const planApi = { variance: vi.fn(async () => varianceRows('2026-10-01', 1, () => ({ revenue: ['50000.00', null], payroll: ['20000.00', null], premises: ['3000.00', null] }))) };
vi.mock('../plan/api', () => planApi);
vi.mock('../../lib/supabase', () => ({ fpaClient: () => { throw new Error('no db in tests'); } }));
const { LiveKpiStrip } = await import('./LiveKpiStrip');

const show = (today = new Date(2026, 10, 25)) =>
  render(<EntityContext.Provider value={{ entity: ENTITY, role: 'viewer', entities: [ENTITY] }}><LiveKpiStrip today={today} /></EntityContext.Provider>);
const tile = (label: string) => screen.getByText(label).closest('.kpi-card')?.textContent ?? '';

beforeEach(() => {
  vi.clearAllMocks();
  connectApi.listConnections.mockImplementation(async () => [{ ...CONN, actuals_through: '2026-10-01' }]);
  connectApi.unmappedAccounts.mockImplementation(async () => []);
  connectApi.cashPosition.mockImplementation(async () => []);
});
afterEach(cleanup);

describe('KPI strip', () => {
  it('is switched on (signed off by Peter, 25 Nov 2026, Phase 1 only)', () => {
    expect(KPI_STRIP_LIVE).toBe(true);
  });
  it('Revenue (month) and Net profit for the latest month, each with "actuals through"', async () => {
    show();
    await screen.findByText('€50,000.00');
    expect(planApi.variance).toHaveBeenCalledWith(ENTITY.id, null, '2026-10-01', '2026-10-01');
    expect(tile('Revenue (month)')).toContain('€50,000.00');
    expect(tile('Revenue (month)')).toContain('Actuals through Oct 2026');
    expect(tile('Net profit')).toContain('€27,000.00');
    expect(tile('Cash balance')).toContain('—');
    expect(tile('Runway (months)')).toContain('—');
    // Phase 2: with no balances imported, the cash tiles say so (they no longer show "Actuals through").
    expect(tile('Cash balance')).toContain('No balances yet');
  });
  it('with no actuals every KPI shows "—", never zero', async () => {
    connectApi.listConnections.mockImplementation(async () => [{ ...CONN, actuals_through: null }]);
    show();
    expect((await screen.findAllByText('No actuals yet'))).toHaveLength(2);
    expect(screen.getAllByText('No balances yet')).toHaveLength(2);
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText(/€0\.00/)).toBeNull();
    expect(planApi.variance).not.toHaveBeenCalled();
  });
  it('"Month may be incomplete" beside Revenue and Net profit when the latest month is this month', async () => {
    show(new Date(2026, 9, 20));
    await screen.findByText('€50,000.00');
    expect(tile('Revenue (month)')).toContain('Month may be incomplete');
    expect(tile('Net profit')).toContain('Month may be incomplete');
    expect(tile('Cash balance')).not.toContain('Month may be incomplete');
  });
  it('unmapped accounts mark the profit figures incomplete, with how many', async () => {
    connectApi.unmappedAccounts.mockImplementation(async () => [{}, {}]);
    show();
    expect((await screen.findByTestId('kpi-strip-note')).textContent).toBe('The profit figures are incomplete: 2 accounts are unmapped.');
    expect(tile('Net profit')).toContain('Incomplete: 2 accounts unmapped');
  });
  it('a failed load shows "—" and why, never a zero', async () => {
    planApi.variance.mockImplementationOnce(async () => { throw Object.assign(new Error('x'), { code: '57014' }); });
    show();
    expect((await screen.findAllByRole('alert'))[0]?.textContent).toContain('This took too long. Try again');
    expect(screen.getAllByText('—')).toHaveLength(4);
  });
});

describe('KPI strip: Cash balance, net cash burn and Runway (Phase 2)', () => {
  it('is switched on (signed off by Peter, 26 Nov 2026, for the prototype)', () => {
    expect(CASH_KPIS_LIVE).toBe(true);
  });
  it('Cash balance with "Balances through", and Runway with the net cash burn and its label', async () => {
    connectApi.cashPosition.mockImplementation(async () => FALLING);
    show();
    await screen.findByText('€95,400.00');
    expect(tile('Cash balance')).toContain('Balances through Oct 2026');
    expect(tile('Cash balance')).not.toContain('Actuals through'); // same month as the actuals
    // burn = (131,850.00 - 95,400.00) / 3 = 12,150.00; runway = 95,400 / 12,150 = 7.85 -> 7.8 (truncated)
    expect(tile('Runway (months)')).toContain('7.8');
    expect(tile('Runway (months)')).toContain('€12,150.00/month net cash burn (includes loans and owner funding)');
  });
  it('"Actuals through" as well when the actuals month differs', async () => {
    connectApi.listConnections.mockImplementation(async () => [{ ...CONN, actuals_through: '2026-09-01' }]);
    connectApi.cashPosition.mockImplementation(async () => FALLING);
    show();
    await screen.findByText('€95,400.00');
    expect(tile('Cash balance')).toContain('Actuals through Sep 2026');
  });
  it('not set up: "—" with "Map your bank accounts to Cash and bank", never 0.00 or n/a', async () => {
    connectApi.cashPosition.mockImplementation(async () => cashRows('2026-10-01', [['2026-10-01', '0.00'], ['2026-09-01', '0.00'], ['2026-08-01', '0.00'], ['2026-07-01', '0.00'], ['2026-06-01', null]], { cashAccounts: 0, unmapped: 3 }));
    show();
    await screen.findByText('€50,000.00');
    for (const label of ['Cash balance', 'Runway (months)']) {
      expect(tile(label)).toContain('—');
      expect(tile(label)).toContain('Map your bank accounts to Cash and bank');
      expect(tile(label)).not.toContain('0.00');
      expect(tile(label)).not.toContain('n/a');
    }
    expect(tile('Cash balance')).toContain('Incomplete: 3 balance accounts unmapped');
  });
  it('an unmapped balance account marks the Cash tile incomplete, with how many', async () => {
    connectApi.cashPosition.mockImplementation(async () => cashRows('2026-10-01', [['2026-10-01', '95400.00'], ['2026-09-01', null], ['2026-08-01', null], ['2026-07-01', null], ['2026-06-01', null]], { unmapped: 1 }));
    show();
    await screen.findByText('€95,400.00');
    expect(tile('Cash balance')).toContain('Incomplete: 1 balance account unmapped');
    expect(tile('Runway (months)')).toContain('—');
    expect(tile('Runway (months)')).toContain('Needs month-end balances for each month Jul 2026 to Oct 2026');
  });
  it('the cash figures failing to load shows "—" everywhere and why, never a zero', async () => {
    connectApi.cashPosition.mockImplementationOnce(async () => { throw Object.assign(new Error('x'), { code: '57014' }); });
    show();
    expect((await screen.findAllByRole('alert'))[0]?.textContent).toContain('This took too long. Try again, and if it keeps happening, tell us.');
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText(/€/)).toBeNull();
  });
  it('reloads when the entity\'s figures change (after an import or a mapping save)', async () => {
    show();
    await screen.findByText('€50,000.00');
    expect(tile('Cash balance')).toContain('No balances yet');
    connectApi.cashPosition.mockImplementation(async () => FALLING);
    act(() => dataChanged(ENTITY.id));
    await screen.findByText('€95,400.00');
    act(() => dataChanged('another-entity')); // another entity's change does not reload this one
    expect(connectApi.cashPosition).toHaveBeenCalledTimes(2);
  });
});
