// @vitest-environment jsdom
// The Cash page (Phase 4, behind CASH_PAGE_LIVE) with the data layer replaced by fakes. Cash figures
// are Walkthrough Test 2's (made-up sample): €95,400.00 at Dec 2025, burn €12,150.00, runway 7.8.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CASH_PAGE_LIVE } from '../../app/shell/kpiSwitch';
import type { CsvCell } from '../../design/downloadCSV';
import { EntityContext, type CurrentEntity } from '../entities/context';
import type { BudgetLine } from '../plan/api';
import { CONN, ENTITY, PLAN, varianceRows } from '../plan/fixtures';

const MONTHS_2025 = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}-01`);
const HIST = ['106670.15', '112560.60', '118124.22', '123252.90', '127890.33', '132365.70', '135230.45', '133562.08', '131850.00', '121095.37', '108180.12', '95400.00'];
const cents = (s: string) => BigInt(s.replace('.', ''));
const cashRows = (latest: string, months: [string, string | null][], head: Partial<{ unmapped: number; cashAccounts: number }> = {}) =>
  months.map(([month, cash]) => ({
    latestMonth: latest, monthsAvailable: 12, unmappedAccounts: head.unmapped ?? 0, cashAccounts: head.cashAccounts ?? 2,
    month, hasBalances: cash !== null, cash: cash === null ? null : cents(cash),
  }));
const POSITION = cashRows('2025-12-01', [['2025-12-01', '95400.00'], ['2025-11-01', '108180.12'], ['2025-10-01', '121095.37'], ['2025-09-01', '131850.00'], ['2025-08-01', '133562.08']]);
const V1 = { id: 'v-stretch', name: 'Budget 2025 (stretch)', kind: 'budget', locked_at: null, unlocked_at: null, created_at: '' };
const V0 = { id: 'v-empty', name: 'Plain 2025', kind: 'budget', locked_at: '2026-01-01T00:00:00Z', unlocked_at: null, created_at: '' };
const AMOUNTS: Record<string, string> = { revenue: '-1000.00', cost_of_sales: '400.00', payroll: '300.00', other_operating: '100.03', marketing: '50.00', premises: '80.00', interest: '10.00', tax: '20.00' };
const LINES: BudgetLine[] = Object.entries(AMOUNTS).flatMap(([plan_line, amount]) => MONTHS_2025.map(period => ({ id: `${plan_line}-${period}`, plan_line, period, amount, origin: 'from_actuals' }) as BudgetLine));

const connectApi = {
  cashPosition: vi.fn(async () => POSITION as unknown[]),
  listConnections: vi.fn(async () => [{ ...CONN, actuals_through: '2025-12-01' }]),
  unmappedAccounts: vi.fn(async () => [] as unknown[]),
};
vi.mock('../connect/api', () => connectApi);
const cashApi = {
  cashHistoryData: vi.fn(async () => ({
    months: MONTHS_2025,
    rows: MONTHS_2025.map((period, i) => ({ connection_id: CONN.id, account_code: '1210', period, cents: cents(HIST[i] ?? '0') })),
    cashKeys: new Set([`${CONN.id}|1210`]),
  })),
};
vi.mock('./api', () => cashApi);
const planApi = {
  getPlan: vi.fn(async () => PLAN),
  listBudgets: vi.fn(async () => [V0, V1]),
  budgetLines: vi.fn(async () => LINES),
  variance: vi.fn(async () => varianceRows('2025-12-01', 1, () => ({ revenue: ['65024.39', null] }))),
};
vi.mock('../plan/api', () => planApi);
const scenApi = {
  listScenarios: vi.fn(async (v: string) => (v === V1.id
    ? [{ id: 'up', name: 'Upside', is_base: false }, { id: 'base', name: 'Base', is_base: true }, { id: 'down', name: 'Downside', is_base: false }]
    : [{ id: 'b0', name: 'Base', is_base: true }])),
  listDrivers: vi.fn(async () => [{ id: 'd-rev', key: 'scn_revenue_change' }, { id: 'd-pay', key: 'scn_payroll_change' }, { id: 'd-oth', key: 'scn_other_costs_change' }]),
  listValues: vi.fn(async () => [
    { driver_id: 'd-rev', scenario_id: 'up', value: 10 }, { driver_id: 'd-pay', scenario_id: 'up', value: '5.000000' }, { driver_id: 'd-oth', scenario_id: 'up', value: -3.33 },
    { driver_id: 'd-rev', scenario_id: 'down', value: -10 }, { driver_id: 'd-oth', scenario_id: 'down', value: 5 },
  ] as { driver_id: string; scenario_id: string; value: number | string }[]),
  ensureDrivers: vi.fn(), addScenarios: vi.fn(), renameScenario: vi.fn(), deleteScenario: vi.fn(), insertValues: vi.fn(), updateValue: vi.fn(),
  MAX_SCENARIOS: 5,
};
vi.mock('../plan/scenariosApi', () => scenApi);
const exported: CsvCell[][][] = [];
vi.mock('../../design/downloadCSV', () => ({ downloadCSV: (_n: string, rows: CsvCell[][]) => { exported.push(rows); } }));
vi.mock('@clerk/clerk-react', () => ({ useUser: () => ({ user: null }) }));
vi.mock('../../lib/supabase', () => ({ fpaClient: () => { throw new Error('no db in tests'); } }));
const { CashView, CashPage } = await import('./CashPage');
const { LiveKpiStrip } = await import('../kpi/LiveKpiStrip');

const TODAY = new Date(2026, 10, 26);
const WRITES = [scenApi.ensureDrivers, scenApi.addScenarios, scenApi.renameScenario, scenApi.deleteScenario, scenApi.insertValues, scenApi.updateValue];
function show(role: CurrentEntity['role'] = 'owner') {
  return render(<MemoryRouter><EntityContext.Provider value={{ entity: ENTITY, role, entities: [ENTITY] }}>
    <CashView generatedBy="Cash Tester" today={TODAY} now={new Date('2026-11-26T20:00:00Z')} /></EntityContext.Provider></MemoryRouter>);
}
const tile = (label: string) => within(screen.getByTestId('cash-now')).getByText(label).closest('.kpi-card')?.textContent ?? '';
const timeout = () => Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });

beforeEach(() => {
  vi.clearAllMocks();
  exported.length = 0;
  connectApi.cashPosition.mockImplementation(async () => POSITION);
  planApi.listBudgets.mockImplementation(async () => [V0, V1]);
});
afterEach(cleanup);

describe('Cash page: switch, header and Cash now', () => {
  it('is off until its own walk-through passes; off shows the placeholder', () => {
    expect(CASH_PAGE_LIVE).toBe(false);
    render(<MemoryRouter><EntityContext.Provider value={{ entity: ENTITY, role: 'owner', entities: [ENTITY] }}><CashPage /></EntityContext.Provider></MemoryRouter>);
    expect(screen.getByText('No cash forecast yet')).toBeTruthy();
  });
  it('header: entity, "Cash: [month] to [month]", who and when, and the sources', async () => {
    show();
    expect(await screen.findByRole('heading', { name: 'Cash: Jan 2025 to Dec 2026' })).toBeTruthy();
    expect(screen.getByTestId('cash-generated').textContent).toMatch(/^Generated .* by Cash Tester\.$/);
    expect(screen.getByTestId('cash-sources').textContent).toBe('Balances through Dec 2025. Actuals through Dec 2025.');
  });
  it('Cash now: cash, net cash burn (labelled) and runway', async () => {
    show();
    await screen.findByTestId('cash-now');
    expect(tile('Cash balance')).toContain('€95,400.00');
    expect(tile('Net cash burn (a month)')).toContain('€12,150.00');
    expect(tile('Net cash burn (a month)')).toContain('net cash burn (includes loans and owner funding)');
    expect(tile('Runway (months)')).toContain('7.8');
  });
  it('the cash figures equal the KPI strip\'s for the same inputs', async () => {
    render(<MemoryRouter><EntityContext.Provider value={{ entity: ENTITY, role: 'owner', entities: [ENTITY] }}><LiveKpiStrip today={TODAY} /></EntityContext.Provider></MemoryRouter>);
    await screen.findByText('€95,400.00');
    const strip = (label: string) => screen.getByText(label).closest('.kpi-card')?.textContent ?? '';
    const stripCash = strip('Cash balance'), stripRunway = strip('Runway (months)');
    cleanup();
    show();
    await screen.findByTestId('cash-now');
    expect(stripCash).toContain('€95,400.00');
    expect(tile('Cash balance')).toContain('€95,400.00');
    expect(stripRunway).toContain('7.8');
    expect(stripRunway).toContain('€12,150.00/month');
    expect(tile('Runway (months)')).toContain('7.8');
    expect(tile('Net cash burn (a month)')).toContain('€12,150.00');
  });
  it('not set up: only "Map your bank accounts to Cash and bank" with a link, never 0.00', async () => {
    connectApi.cashPosition.mockImplementation(async () => cashRows('2025-12-01', [['2025-12-01', '0.00']], { cashAccounts: 0, unmapped: 3 }));
    show();
    const box = await screen.findByTestId('cash-not-set-up');
    expect(box.textContent).toContain('Map your bank accounts to Cash and bank');
    expect(within(box).getByRole('link', { name: 'Map accounts' }).getAttribute('href')).toContain('/connect/map');
    expect(screen.queryByText(/0\.00/)).toBeNull();
    expect(screen.queryByTestId('cash-now')).toBeNull();
  });
  it('no balances at all: says so, with a link to Connect', async () => {
    connectApi.cashPosition.mockImplementation(async () => []);
    show();
    expect((await screen.findByTestId('cash-not-set-up')).textContent).toContain('No month-end balances imported yet');
  });
});

describe('Cash page: history and projection', () => {
  it('the Current trend runs out in Aug 2026 (month 8); the table has 12 history and 12 projected months', async () => {
    show();
    expect((await screen.findByTestId('runs-out')).textContent).toContain('cash runs out in Aug 2026 (month 8)');
    const t = await screen.findByTestId('cash-table');
    const rows = within(t).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(24);
    expect(rows[11]?.textContent).toContain('Dec 2025€95,400.00');
    const jun = rows.find(r => r.textContent?.startsWith('Jun 2026'));
    expect(jun?.textContent).toContain('€22,500.00');
    expect(rows[23]?.textContent).toContain('-€50,400.00');
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Current trend: Jan 2026 €83,250.00');
    expect(screen.getByText('Month-end cash (history)')).toBeTruthy();
  });
  it('fewer than four month-ends: no burn, no runway, no projection, and why', async () => {
    connectApi.cashPosition.mockImplementation(async () => cashRows('2025-12-01', [['2025-12-01', '95400.00'], ['2025-11-01', '1.00'], ['2025-10-01', null], ['2025-09-01', '1.00'], ['2025-08-01', null]]));
    show();
    await screen.findByTestId('cash-now');
    expect(tile('Runway (months)')).toContain('—');
    expect(await screen.findByText(/No projection: Needs month-end balances for each month Sep 2025 to Dec 2025/)).toBeTruthy();
    expect((await screen.findByTestId('cash-no-scenarios')).textContent).toContain('there is no projection to adjust');
    expect(screen.getByTestId('cash-quality').textContent).toContain('no projection is drawn');
  });
  it('a failed history call shows its own error; Cash now still renders', async () => {
    cashApi.cashHistoryData.mockImplementationOnce(async () => { throw timeout(); });
    show();
    expect(await screen.findByText(/The month-end cash could not be loaded/)).toBeTruthy();
    expect(tile('Cash balance')).toContain('€95,400.00');
  });
});

describe('Cash page: scenarios and what-if', () => {
  it('defaults to the latest budget with saved scenarios; Base, Upside, Downside, with month 6, month 12 and when cash runs out', async () => {
    show();
    const t = await screen.findByTestId('cash-scenarios');
    expect((screen.getByLabelText('Budget') as HTMLSelectElement).value).toBe(V1.id);
    const row = (name: string) => within(t).getByRole('rowheader', { name: new RegExp(`^${name}`) }).closest('tr')?.textContent ?? '';
    expect(within(t).getAllByRole('rowheader').map(r => r.textContent?.split(' (')[0])).toEqual(['Base', 'Upside', 'Downside']);
    expect(row('Base')).toContain('€22,500.00-€50,400.00Aug 2026');
    // Upside: profit 1,059.61 vs Base 479.64 = +579.97 a year. Month 6: 22,500.00 + round(289.985) = 22,789.99.
    expect(row('Upside')).toContain('+€579.97€22,789.99-€49,820.03Aug 2026');
    // Downside: profit -300.38 vs 479.64 = -780.02. Month 6: 22,500.00 - 390.01 = 22,109.99.
    expect(row('Downside')).toContain('-€780.02€22,109.99-€51,180.02Aug 2026');
    expect(screen.getByText(/Indicative: profit used as a proxy for cash; ignores timing, VAT, tax, capex and financing\./)).toBeTruthy();
  });
  it('a budget without saved scenarios, or no budget: "—" and why', async () => {
    show();
    await screen.findByTestId('cash-scenarios');
    fireEvent.change(screen.getByLabelText('Budget'), { target: { value: V0.id } });
    expect((await screen.findByTestId('cash-no-scenarios')).textContent).toBe('—: this budget has no saved scenarios.');
    fireEvent.change(screen.getByLabelText('Budget'), { target: { value: '' } });
    expect((await screen.findByTestId('cash-no-scenarios')).textContent).toBe('—: no budget chosen.');
  });
  it('no budget has saved scenarios: none is chosen, and it says so', async () => {
    planApi.listBudgets.mockImplementation(async () => [V0]);
    show();
    expect((await screen.findByTestId('cash-no-scenarios')).textContent).toBe('—: no budget chosen (no budget has saved scenarios).');
  });
  it('the what-if redraws the line in the browser only; Reset brings back the real burn; nothing is saved', async () => {
    show();
    const input = await screen.findByLabelText('Monthly net cash burn') as HTMLInputElement;
    expect(input.value).toBe('12150.00');
    fireEvent.change(input, { target: { value: '8,000' } });
    expect((await screen.findByTestId('runs-out')).textContent).toContain('What-if (not saved): runs out in Dec 2026');
    expect(within(screen.getByTestId('cash-table')).getByRole('columnheader', { name: 'What-if (not saved)' })).toBeTruthy();
    fireEvent.change(input, { target: { value: '12.345' } });
    expect((await screen.findByRole('alert')).textContent).toContain('at most two decimals');
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect((screen.getByLabelText('Monthly net cash burn') as HTMLInputElement).value).toBe('12150.00');
    expect(screen.getByTestId('runs-out').textContent).not.toContain('What-if');
    for (const w of WRITES) expect(w).not.toHaveBeenCalled();
  });
  it('a failed budgets call: its own error; the rest renders', async () => {
    planApi.listBudgets.mockImplementationOnce(async () => { throw timeout(); });
    show();
    expect(await screen.findByText(/The budgets could not be loaded/)).toBeTruthy();
    expect(await screen.findByTestId('cash-table')).toBeTruthy();
  });
});

describe('Cash page: data quality, CSV, viewer', () => {
  it('clean: "None", and the fixed line', async () => {
    show();
    const q = await screen.findByTestId('cash-quality');
    expect(within(q).getByText('None')).toBeTruthy();
    expect(q.textContent).toContain('Figures come from the imported files; this is not a forecast or advice.');
  });
  it('unmapped balance accounts and balances older than actuals', async () => {
    connectApi.cashPosition.mockImplementation(async () => cashRows('2025-12-01', [['2025-12-01', '95400.00'], ['2025-11-01', '108180.12'], ['2025-10-01', '121095.37'], ['2025-09-01', '131850.00'], ['2025-08-01', null]], { unmapped: 1 }));
    connectApi.listConnections.mockImplementationOnce(async () => [{ ...CONN, actuals_through: '2026-02-01' }]);
    show();
    const q = await screen.findByTestId('cash-quality');
    expect(q.textContent).toContain('1 balance account unmapped: the Cash balance is incomplete.');
    expect(q.textContent).toContain('Balances are 2 months older than actuals');
  });
  it('Download CSV: month, cash, kind and line, for the history and each line shown', async () => {
    show();
    await screen.findByTestId('cash-scenarios');
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    const rows = exported[0] ?? [];
    expect(rows[0]).toEqual(['month', 'cash', 'kind', 'line']);
    expect(rows).toContainEqual(['2025-12', '95400.00', 'history', 'Month-end cash']);
    expect(rows).toContainEqual(['2026-08', '-1800.00', 'projection', 'Current trend']);
    expect(rows.some(r => r[3] === 'Upside')).toBe(true);
  });
  it('a viewer sees the same page read-only; opening it writes nothing', async () => {
    show('viewer');
    expect(await screen.findByTestId('cash-scenarios')).toBeTruthy();
    expect(screen.getByTestId('runs-out').textContent).toContain('Aug 2026');
    for (const w of WRITES) expect(w).not.toHaveBeenCalled();
  });
});
