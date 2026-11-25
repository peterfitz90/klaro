// @vitest-environment jsdom
// The KPI strip's wiring (docs/kpi-definitions.md). It is not switched on: the shell shows the
// placeholder strip until Peter signs the definitions off (src/app/shell/kpiSwitch.ts).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KPI_STRIP_LIVE } from '../../app/shell/kpiSwitch';
import { EntityContext } from '../entities/context';
import { CONN, ENTITY, varianceRows } from '../plan/fixtures';

const connectApi = {
  listConnections: vi.fn(async () => [{ ...CONN, actuals_through: '2026-10-01' }] as { actuals_through: string | null }[]),
  unmappedAccounts: vi.fn(async () => [] as unknown[]),
};
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
});
afterEach(cleanup);

describe('KPI strip', () => {
  it('is not switched on until the definitions are signed off', () => {
    expect(KPI_STRIP_LIVE).toBe(false);
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
    expect(tile('Cash balance')).toContain('Actuals through Oct 2026');
  });
  it('with no actuals every KPI shows "—", never zero', async () => {
    connectApi.listConnections.mockImplementation(async () => [{ ...CONN, actuals_through: null }]);
    show();
    expect((await screen.findAllByText('No actuals yet'))).toHaveLength(4);
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
