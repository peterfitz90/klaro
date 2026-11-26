// @vitest-environment jsdom
// The Scenarios panel (Phase 3 slice, behind SCENARIOS_LIVE) with the data layer replaced by fakes.
// Figures are the hand-computed fixture of src/engine/scenarios.test.ts.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCENARIOS_LIVE } from '../../app/shell/kpiSwitch';
import type { BudgetLine, Version } from './api';

const api = {
  listScenarios: vi.fn(async () => [] as { id: string; name: string; is_base: boolean }[]),
  listDrivers: vi.fn(async () => [] as { id: string; key: string }[]),
  listValues: vi.fn(async () => [] as { id: string; driver_id: string; scenario_id: string; period: string; value: number | string }[]),
  ensureDrivers: vi.fn(async () => ({ revenue: 'd-rev', payroll: 'd-pay', other: 'd-oth' })),
  addScenarios: vi.fn(async (_v: string, names: string[]) => names.map(n => ({ id: `id-${n}`, name: n, is_base: false }))),
  renameScenario: vi.fn(async () => undefined),
  deleteScenario: vi.fn(async () => undefined),
  insertValues: vi.fn(async () => undefined),
  updateValue: vi.fn(async () => undefined),
  MAX_SCENARIOS: 5,
};
vi.mock('./scenariosApi', () => api);
const connectApi = { cashPosition: vi.fn(async () => [] as unknown[]) };
vi.mock('../connect/api', () => connectApi);
vi.mock('../../lib/supabase', () => ({ fpaClient: () => { throw new Error('no db in tests'); } }));
const { ScenariosPanel } = await import('./ScenariosPanel');

const ENTITY = { id: '0b483fe4-e952-4170-83b5-a79b911b8023', name: 'Acme Ltd', jurisdiction: 'IE', currency: 'EUR' } as const;
const PLAN = { id: 'plan-1', name: 'Plan', fiscal_year_start: 1 };
const V: Version = { id: 'v1', name: 'Budget 2026', kind: 'budget', locked_at: null, unlocked_at: null, created_at: '2026-01-01T00:00:00Z' };
const MONTHS = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}-01`);
const AMOUNTS: Record<string, string> = { revenue: '-1000.00', cost_of_sales: '400.00', payroll: '300.00', other_operating: '100.03', marketing: '50.00', premises: '80.00', interest: '10.00', tax: '20.00' };
const LINES: BudgetLine[] = Object.entries(AMOUNTS).flatMap(([plan_line, amount]) => MONTHS.map(period => ({ id: `${plan_line}-${period}`, plan_line, period, amount, origin: 'from_actuals' }) as BudgetLine));
const CASH = [
  ['2025-12-01', '95400.00'], ['2025-11-01', '100000.00'], ['2025-10-01', '110000.00'], ['2025-09-01', '120000.00'], ['2025-08-01', '125000.00'],
].map(([month, cash]) => ({ latestMonth: '2025-12-01', monthsAvailable: 12, unmappedAccounts: 0, cashAccounts: 2, month, hasBalances: true, cash: BigInt((cash ?? '0').replace('.', '')) }));

function show(opts: { role?: 'owner' | 'editor' | 'viewer'; version?: Version } = {}) {
  return render(<ScenariosPanel entity={ENTITY} plan={PLAN} version={opts.version ?? V} role={opts.role ?? 'editor'} lines={LINES} months={MONTHS} today={new Date(2026, 10, 26)} />);
}
const row = (name: string) => within(screen.getByTestId(`scenario-${name}`));
const rowText = (name: string) => screen.getByTestId(`scenario-${name}`).textContent ?? '';
const type = (name: string, driver: string, value: string) => fireEvent.change(screen.getByLabelText(`${name}: ${driver} %`), { target: { value } });

beforeEach(() => {
  vi.clearAllMocks();
  api.listScenarios.mockImplementation(async () => [{ id: 'base-1', name: 'Base', is_base: true }]);
  api.listDrivers.mockImplementation(async () => []);
  api.listValues.mockImplementation(async () => []);
  connectApi.cashPosition.mockImplementation(async () => CASH);
});
afterEach(cleanup);

describe('Scenarios panel', () => {
  it('is switched off until its own walk-through passes', () => {
    expect(SCENARIOS_LIVE).toBe(false);
  });
  it('Base plus Upside and Downside by default (not saved yet); opening it writes nothing', async () => {
    show();
    await screen.findByTestId('scenario-Base');
    expect(rowText('Base')).toContain('the budget as it is');
    expect(rowText('Upside')).toContain('not saved yet');
    expect(rowText('Downside')).toContain('not saved yet');
    expect(rowText('Base')).toContain('€12,000.00');
    expect(rowText('Base')).toContain('€11,520.36');
    expect(rowText('Base')).toContain('€479.64');
    expect(rowText('Base')).toContain('€95,879.64'); // 95,400.00 + 479.64
    for (const f of [api.ensureDrivers, api.addScenarios, api.insertValues, api.updateValue, api.renameScenario, api.deleteScenario]) expect(f).not.toHaveBeenCalled();
  });
  it('the drivers change the figures (hand-computed Upside and Downside)', async () => {
    show();
    await screen.findByTestId('scenario-Upside');
    type('Upside', 'Revenue change', '10'); type('Upside', 'Payroll change', '5'); type('Upside', 'Other costs change', '-3.33');
    expect(rowText('Upside')).toContain('€13,200.00');
    expect(rowText('Upside')).toContain('€12,140.39');
    expect(rowText('Upside')).toContain('€1,059.61');
    expect(rowText('Upside')).toContain('€96,459.61');
    type('Downside', 'Revenue change', '-10'); type('Downside', 'Other costs change', '5');
    expect(rowText('Downside')).toContain('-€300.38');
    expect(rowText('Downside')).toContain('€95,099.62');
  });
  it('the closing cash is labelled indicative, with the exact caveat', async () => {
    show();
    expect((await screen.findByTestId('indicative-note')).textContent).toContain('indicative: profit used as a proxy for cash; ignores timing, VAT, tax, capex and financing');
    expect(screen.getByTestId('indicative-note').textContent).toContain('€95,400.00, at the end of Dec 2025');
  });
  it('no cash balance: the closing cash shows "—" and says why', async () => {
    connectApi.cashPosition.mockImplementation(async () => []);
    show();
    await screen.findByTestId('scenario-Base');
    expect(rowText('Base')).toContain('—');
    expect(rowText('Base')).toContain('€479.64');
    expect(screen.getByTestId('indicative-note').textContent).toContain('there is no cash balance');
  });
  it('the cash balance failing to load shows "—" and why; the rest still works', async () => {
    connectApi.cashPosition.mockImplementation(async () => { throw Object.assign(new Error('x'), { code: '57014' }); });
    show();
    await screen.findByTestId('scenario-Base');
    expect(rowText('Base')).toContain('—');
    expect(screen.getByTestId('indicative-note').textContent).toContain('could not be loaded');
  });
  it('Save creates the drivers, the two scenarios and their six values (at the year\'s first month)', async () => {
    show();
    await screen.findByTestId('scenario-Upside');
    type('Upside', 'Revenue change', '7.5');
    fireEvent.click(screen.getByRole('button', { name: 'Save scenarios' }));
    expect(await screen.findByText('Scenarios saved.')).toBeTruthy();
    expect(api.ensureDrivers).toHaveBeenCalledWith('plan-1');
    expect(api.addScenarios).toHaveBeenCalledWith('v1', ['Upside', 'Downside']);
    expect(api.insertValues).toHaveBeenCalledTimes(1);
    const rows = (api.insertValues.mock.calls[0] as unknown as [{ driver_id: string; scenario_id: string; period: string; value: string }[]])[0];
    expect(rows).toHaveLength(6);
    expect(rows).toContainEqual({ driver_id: 'd-rev', scenario_id: 'id-Upside', period: '2026-01-01', value: '7.5' });
    expect(rows.every(r => r.period === '2026-01-01')).toBe(true);
    expect(api.updateValue).not.toHaveBeenCalled();
  });
  it('saved scenarios load with their values; a change is an update of the value only; a rename is saved', async () => {
    api.listScenarios.mockImplementation(async () => [{ id: 'base-1', name: 'Base', is_base: true }, { id: 's-up', name: 'Upside', is_base: false }]);
    api.listDrivers.mockImplementation(async () => [{ id: 'd-rev', key: 'scn_revenue_change' }, { id: 'd-pay', key: 'scn_payroll_change' }, { id: 'd-oth', key: 'scn_other_costs_change' }]);
    const VALUES = [
      { id: 'x1', driver_id: 'd-rev', scenario_id: 's-up', period: '2026-01-01', value: '10.00' },
      { id: 'x2', driver_id: 'd-pay', scenario_id: 's-up', period: '2026-01-01', value: 5 },
      { id: 'x3', driver_id: 'd-oth', scenario_id: 's-up', period: '2026-01-01', value: '-3.33' },
    ];
    api.listValues.mockImplementation(async () => VALUES);
    show();
    await screen.findByTestId('scenario-Upside');
    expect(screen.queryByTestId('scenario-Downside')).toBeNull(); // defaults only when nothing is saved
    expect((screen.getByLabelText('Upside: Revenue change %') as HTMLInputElement).value).toBe('10');
    expect(rowText('Upside')).toContain('€1,059.61');
    type('Upside', 'Revenue change', '12.5');
    fireEvent.change(screen.getByLabelText('Name of Upside'), { target: { value: 'Best case' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save scenarios' }));
    expect(await screen.findByText('Scenarios saved.')).toBeTruthy();
    expect(api.renameScenario).toHaveBeenCalledWith('s-up', 'Best case');
    expect(api.updateValue).toHaveBeenCalledTimes(1);
    expect(api.updateValue).toHaveBeenCalledWith('x1', '12.5');
    expect(api.addScenarios).toHaveBeenCalledWith('v1', []);
    expect(api.insertValues).toHaveBeenCalledWith([]);
  });
  it('a bad percentage shows the problem in the row and saves nothing', async () => {
    show();
    await screen.findByTestId('scenario-Upside');
    type('Upside', 'Revenue change', '1.234');
    expect(rowText('Upside')).toContain('Revenue change: Enter a percentage from -100 to 1000');
    fireEvent.click(screen.getByRole('button', { name: 'Save scenarios' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Nothing was saved. Fix these first');
    expect(api.ensureDrivers).not.toHaveBeenCalled();
  });
  it('two scenarios with the same name are refused before saving', async () => {
    show();
    await screen.findByTestId('scenario-Upside');
    fireEvent.change(screen.getByLabelText('Name of Downside'), { target: { value: 'upside' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save scenarios' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Two scenarios are called "upside"');
    expect(api.addScenarios).not.toHaveBeenCalled();
  });
  it('at most five scenarios, Base included', async () => {
    show();
    await screen.findByTestId('scenario-Upside');
    fireEvent.click(screen.getByRole('button', { name: 'Add a scenario' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a scenario' }));
    expect(screen.getAllByRole('row')).toHaveLength(6); // header + 5
    expect((screen.getByRole('button', { name: 'Add a scenario' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('At most 5 scenarios, Base included.')).toBeTruthy();
  });
  it('a save that fails partway says so and reloads what is saved', async () => {
    api.insertValues.mockImplementationOnce(async () => { throw Object.assign(new Error('save the scenario drivers: boom'), { code: 'XX000' }); });
    show();
    await screen.findByTestId('scenario-Upside');
    type('Upside', 'Revenue change', '3');
    const loadsBefore = api.listScenarios.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Save scenarios' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Not everything was saved');
    await waitFor(() => expect(api.listScenarios.mock.calls.length).toBeGreaterThan(loadsBefore));
  });
  it('a budget locked meanwhile (PT423) says the scenarios cannot be changed', async () => {
    api.ensureDrivers.mockImplementationOnce(async () => { throw Object.assign(new Error('locked'), { code: 'PT423' }); });
    show();
    await screen.findByTestId('scenario-Upside');
    type('Upside', 'Revenue change', '3');
    fireEvent.click(screen.getByRole('button', { name: 'Save scenarios' }));
    expect((await screen.findByRole('alert')).textContent).toContain('This budget is locked, so its scenarios cannot be changed.');
  });
  it('a locked budget can be viewed but not changed or saved', async () => {
    show({ version: { ...V, locked_at: '2026-02-01T10:00:00Z' } });
    await screen.findByTestId('scenario-Base');
    expect(screen.getByText(/This budget is locked: you can see its scenarios/)).toBeTruthy();
    expect((screen.getByLabelText('Upside: Revenue change %') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save scenarios' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a scenario' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull();
  });
  it('a viewer sees the scenarios but cannot change them', async () => {
    show({ role: 'viewer' });
    await screen.findByTestId('scenario-Base');
    expect(screen.getByText(/Changing them needs editor or owner access/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save scenarios' })).toBeNull();
  });
  it('deleting a saved scenario asks first, then deletes it', async () => {
    api.listScenarios.mockImplementation(async () => [{ id: 'base-1', name: 'Base', is_base: true }, { id: 's-up', name: 'Upside', is_base: false }]);
    show();
    await screen.findByTestId('scenario-Upside');
    fireEvent.click(row('Upside').getByRole('button', { name: 'Delete Upside' }));
    expect(api.deleteScenario).not.toHaveBeenCalled();
    fireEvent.click(row('Upside').getByRole('button', { name: 'Delete it' }));
    await waitFor(() => expect(api.deleteScenario).toHaveBeenCalledWith('s-up'));
  });
});
