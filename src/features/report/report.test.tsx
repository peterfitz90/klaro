// @vitest-environment jsdom
// The monthly report (Phase 3, behind REPORT_LIVE) with the data layer replaced by fakes: each
// section, no budget, no balances, no scenarios, a failed call, a viewer, and Section 2 against
// Compare's own figures for the same inputs.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REPORT_LIVE } from '../../app/shell/kpiSwitch';
import type { CsvCell } from '../../design/downloadCSV';
import type { AccountRow } from '../connect/api';
import { EntityContext, type CurrentEntity } from '../entities/context';
import type { BudgetLine } from '../plan/api';
import { CONN, ENTITY, PLAN, varianceRows } from '../plan/fixtures';

const V1 = { id: 'b0b0b0b0-0000-4000-8000-0000000000b1', name: 'Budget 2026', kind: 'budget', locked_at: null, unlocked_at: null, created_at: '' };
const V0 = { id: 'b0b0b0b0-0000-4000-8000-0000000000b0', name: 'Old 2025', kind: 'budget', locked_at: null, unlocked_at: null, created_at: '' };
const FIG = varianceRows('2026-01-01', 12, m => ({
  revenue: ['1100.00', '1000.00'], payroll: ['450.00', '400.00'], premises: ['100.00', '100.00'],
  ...(m === '2026-02-01' ? { revenue: ['900.00', '1000.00'] as [string, string] } : {}),
}), { actualsIn: m => m <= '2026-03-01', budgetIn: () => true });
const FIG_NO_BUDGET = varianceRows('2026-01-01', 12, () => ({ revenue: ['1100.00', null], payroll: ['450.00', null], premises: ['100.00', null] }), { actualsIn: m => m <= '2026-03-01', budgetIn: () => false });
const MONTHS_2026 = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}-01`);
const AMOUNTS: Record<string, string> = { revenue: '-1000.00', cost_of_sales: '400.00', payroll: '300.00', other_operating: '100.03', marketing: '50.00', premises: '80.00', interest: '10.00', tax: '20.00' };
const LINES_2026: BudgetLine[] = Object.entries(AMOUNTS).flatMap(([plan_line, amount]) => MONTHS_2026.map(period => ({ id: `${plan_line}-${period}`, plan_line, period, amount, origin: 'from_actuals' }) as BudgetLine));
const LINES_2025: BudgetLine[] = [{ id: 'x', plan_line: 'revenue', period: '2025-06-01', amount: '-5.00', origin: 'from_actuals' } as BudgetLine];
const cashRows = (latest: string, months: [string, string | null][], head: Partial<{ unmapped: number; cashAccounts: number }> = {}) =>
  months.map(([month, cash]) => ({
    latestMonth: latest, monthsAvailable: 12, unmappedAccounts: head.unmapped ?? 0, cashAccounts: head.cashAccounts ?? 2,
    month, hasBalances: cash !== null, cash: cash === null ? null : BigInt(cash.replace('.', '')),
  }));
const CASH = cashRows('2026-03-01', [['2026-03-01', '95400.00'], ['2026-02-01', '108000.00'], ['2026-01-01', '120150.00'], ['2025-12-01', '131850.00'], ['2025-11-01', '140000.00']]);
let accounts: AccountRow[] = [];
const acc = (code: string, line: string | null, total: string): AccountRow =>
  ({ connection_id: CONN.id, account_code: code, account_name: code, plan_line: line, months: 3, first_month: '2026-01-01', last_month: '2026-03-01', total });

const planApi = {
  getPlan: vi.fn(async () => PLAN),
  listBudgets: vi.fn(async () => [V1, V0]),
  variance: vi.fn(async (_e: string, v: string | null, _from?: string, _to?: string) => (v ? FIG : FIG_NO_BUDGET)),
  budgetLines: vi.fn(async (id: string) => (id === V1.id ? LINES_2026 : LINES_2025)),
};
vi.mock('../plan/api', () => planApi);
const connectApi = {
  listConnections: vi.fn(async () => [{ ...CONN, actuals_through: '2026-03-01', last_synced_at: '2026-04-02T09:00:00Z' }]),
  accountMap: vi.fn(async () => accounts),
  unmappedAccounts: vi.fn(async () => [] as unknown[]),
  cashPosition: vi.fn(async () => CASH as unknown[]),
};
vi.mock('../connect/api', () => connectApi);
const scenApi = {
  listScenarios: vi.fn(async () => [{ id: 'base', name: 'Base', is_base: true }] as { id: string; name: string; is_base: boolean }[]),
  listDrivers: vi.fn(async () => [{ id: 'd-rev', key: 'scn_revenue_change' }, { id: 'd-pay', key: 'scn_payroll_change' }, { id: 'd-oth', key: 'scn_other_costs_change' }]),
  listValues: vi.fn(async () => [] as { driver_id: string; scenario_id: string; value: number | string }[]),
  ensureDrivers: vi.fn(), addScenarios: vi.fn(), renameScenario: vi.fn(), deleteScenario: vi.fn(), insertValues: vi.fn(), updateValue: vi.fn(),
  MAX_SCENARIOS: 5,
};
vi.mock('../plan/scenariosApi', () => scenApi);
const exported: CsvCell[][][] = [];
vi.mock('../../design/downloadCSV', () => ({ downloadCSV: (_n: string, rows: CsvCell[][]) => { exported.push(rows); } }));
vi.mock('@clerk/clerk-react', () => ({ useUser: () => ({ user: null }) }));
vi.mock('../../lib/supabase', () => ({ fpaClient: () => { throw new Error('no db in tests'); } }));
const { MonthlyReport, ReportPage } = await import('./ReportPage');
const { ComparePage, compareCsvRows } = await import('../compare/ComparePage');
const { toLines } = await import('../../engine');

const TODAY = new Date(2026, 10, 26);
const NOW = new Date('2026-11-26T10:15:00Z');
function show(role: CurrentEntity['role'] = 'owner') {
  return render(<MemoryRouter><EntityContext.Provider value={{ entity: ENTITY, role, entities: [ENTITY] }}>
    <MonthlyReport generatedBy="Report Tester" today={TODAY} now={NOW} /></EntityContext.Provider></MemoryRouter>);
}
const bvaCells = (table: HTMLElement, line: string) =>
  [...(within(table).getByRole('rowheader', { name: line }).closest('tr')?.querySelectorAll('td') ?? [])].map(td => td.textContent ?? '');
const timeout = () => Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
const WRITES = [scenApi.ensureDrivers, scenApi.addScenarios, scenApi.renameScenario, scenApi.deleteScenario, scenApi.insertValues, scenApi.updateValue];

beforeEach(() => {
  vi.clearAllMocks();
  exported.length = 0;
  accounts = [acc('4000', 'revenue', '-3100.00'), acc('1200', 'excluded', '500.00'), acc('2200', 'excluded', '-200.00')];
  planApi.listBudgets.mockImplementation(async () => [V1, V0]);
  planApi.variance.mockImplementation(async (_e: string, v: string | null) => (v ? FIG : FIG_NO_BUDGET));
  connectApi.cashPosition.mockImplementation(async () => CASH);
  scenApi.listScenarios.mockImplementation(async () => [{ id: 'base', name: 'Base', is_base: true }]);
  scenApi.listValues.mockImplementation(async () => []);
});
afterEach(cleanup);

describe('Report: switch and header', () => {
  it('is off until its own walk-through passes; off shows the placeholder', () => {
    expect(REPORT_LIVE).toBe(false);
    render(<MemoryRouter><EntityContext.Provider value={{ entity: ENTITY, role: 'owner', entities: [ENTITY] }}><ReportPage /></EntityContext.Provider></MemoryRouter>);
    expect(screen.getByText('No reports yet')).toBeTruthy();
  });
  it('header: entity, month, who and when, and the sources line', async () => {
    show();
    expect(await screen.findByRole('heading', { name: 'Monthly report: Mar 2026' })).toBeTruthy();
    expect(screen.getByText('Acme Ltd')).toBeTruthy();
    expect(screen.getByTestId('report-generated').textContent).toMatch(/^Generated .*2026.* by Report Tester\.$/);
    await waitFor(() => expect(screen.getByTestId('report-sources').textContent).toMatch(/^Actuals through Mar 2026, last synced .*\. Balances through Mar 2026\.$/));
  });
  it('the sources line says when balances are missing', async () => {
    connectApi.cashPosition.mockImplementation(async () => []);
    show();
    await waitFor(() => expect(screen.getByTestId('report-sources').textContent).toContain('No month-end balances imported yet.'));
  });
  it('defaults: the latest month of actuals and the latest budget covering it (not a later one that does not)', async () => {
    show();
    await screen.findByTestId('report-bva');
    expect((screen.getByLabelText('Month') as HTMLSelectElement).value).toBe('2026-03-01');
    await waitFor(() => expect((screen.getByLabelText('Budget') as HTMLSelectElement).value).toBe(V1.id));
    expect(planApi.variance).toHaveBeenLastCalledWith(ENTITY.id, V1.id, '2026-01-01', '2026-12-01');
    // One full-year load, with the right budget: never first with another budget.
    expect(planApi.variance.mock.calls.filter(c => c[2] !== c[3]).map(c => c[1])).toEqual([V1.id]);
  });
  it('opening the report writes nothing, and a viewer sees every section', async () => {
    show('viewer');
    await screen.findByTestId('report-bva');
    await screen.findByTestId('report-quality');
    for (const h of ['1. Headlines', '3. Trend', '5. Data quality and notes']) expect(screen.getByRole('heading', { name: h })).toBeTruthy();
    for (const w of WRITES) expect(w).not.toHaveBeenCalled();
  });
});

describe('Report: Section 2 is exactly Compare', () => {
  it('every line, month and year to date, has the same figures and words as Compare for the same inputs', async () => {
    render(<MemoryRouter><EntityContext.Provider value={{ entity: ENTITY, role: 'viewer', entities: [ENTITY] }}><ComparePage today={TODAY} /></EntityContext.Provider></MemoryRouter>);
    const ct = await screen.findByRole('table', { name: 'Month and year to date' });
    const labels = within(ct).getAllByRole('rowheader').map(r => r.textContent ?? '');
    const compare = labels.map(l => bvaCells(ct, l));
    cleanup();
    show();
    const rt = await screen.findByTestId('report-bva');
    await waitFor(() => expect((screen.getByLabelText('Budget') as HTMLSelectElement).value).toBe(V1.id));
    expect(within(rt).getAllByRole('rowheader').map(r => r.textContent ?? '')).toEqual(labels);
    expect(labels.map(l => bvaCells(rt, l))).toEqual(compare);
    expect(bvaCells(rt, 'Revenue')).toEqual(['€1,000.00', '€1,100.00', '€100.00', '+10.0%', '▲ Favourable', '€3,000.00', '€3,100.00', '€100.00', '+3.3%', '▲ Favourable']);
  });
  it('the CSV is Compare\'s export for the same figures', async () => {
    show();
    await screen.findByTestId('report-bva');
    await waitFor(() => expect((screen.getByLabelText('Budget') as HTMLSelectElement).value).toBe(V1.id));
    fireEvent.click(await screen.findByRole('button', { name: 'Download CSV (budget against actual)' }));
    expect(exported[0]).toEqual(compareCsvRows(toLines(FIG), MONTHS_2026, '2026-03-01', () => false));
  });
  it('no budget: the budget figures show "—" and say why', async () => {
    show();
    await screen.findByTestId('report-bva');
    fireEvent.change(screen.getByLabelText('Budget'), { target: { value: '' } });
    await waitFor(() => expect(screen.getByText(/No budget chosen: the Budget figures show "—"/)).toBeTruthy());
    expect(bvaCells(screen.getByTestId('report-bva'), 'Revenue').slice(0, 2)).toEqual(['—', '€1,100.00']);
    expect(screen.getByText('No budget chosen, so there are no scenarios to show.')).toBeTruthy();
  });
  it('a failed figures call shows its own error; the other sections still render', async () => {
    // Only the report's full-year call fails (the headlines use their own one-month call).
    planApi.variance.mockImplementation(async (_e: string, v: string | null, from?: string, to?: string) => { if (from !== to) throw timeout(); return v ? FIG : FIG_NO_BUDGET; });
    show();
    expect((await screen.findAllByText('This took too long. Try a shorter date range.')).length).toBeGreaterThan(0);
    expect(await screen.findByTestId('report-headlines')).toBeTruthy();
    expect(await screen.findByTestId('report-quality')).toBeTruthy();
  });
});

describe('Report: Headlines', () => {
  it('the four KPI figures as the strip shows them', async () => {
    show();
    const h = await screen.findByTestId('report-headlines');
    expect(h.textContent).toContain('Revenue (month)€1,100.00Actuals through Mar 2026');
    expect(h.textContent).toContain('Cash balance€95,400.00Balances through Mar 2026');
    expect(h.textContent).toContain('Runway (months)7.8');
  });
  it('a failed headline load says so; the rest still renders', async () => {
    connectApi.unmappedAccounts.mockImplementationOnce(async () => { throw timeout(); });
    show();
    expect(await screen.findByText(/The headlines could not be loaded/)).toBeTruthy();
    expect(await screen.findByTestId('report-bva')).toBeTruthy();
  });
});

describe('Report: Trend', () => {
  it('revenue and net profit by month, with the budget dashed, and a text alternative', async () => {
    show();
    const svg = await screen.findByRole('img', { name: /^Revenue and net profit by month/ });
    expect(svg.getAttribute('aria-label')).toContain('Revenue: Jan 2026 €1,100.00, Feb 2026 €900.00, Mar 2026 €1,100.00');
    expect(screen.getByText('Revenue budget (dashed)')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Revenue and net profit by month' })).toBeTruthy();
  });
  it('month-end cash with runway and burn beside it', async () => {
    show();
    const svg = await screen.findByRole('img', { name: /^Month-end cash/ });
    expect(svg.getAttribute('aria-label')).toBe('Month-end cash: Nov 2025 €140,000.00, Dec 2025 €131,850.00, Jan 2026 €120,150.00, Feb 2026 €108,000.00, Mar 2026 €95,400.00.');
    const cash = screen.getByTestId('report-cash').textContent ?? '';
    expect(cash).toContain('7.8');
    expect(cash).toContain('€12,150.00/month net cash burn (includes loans and owner funding)');
  });
  it('cash not set up: "—" with the mapping text, no chart', async () => {
    connectApi.cashPosition.mockImplementation(async () => cashRows('2026-03-01', [['2026-03-01', '0.00'], ['2026-02-01', null], ['2026-01-01', null], ['2025-12-01', null], ['2025-11-01', null]], { cashAccounts: 0, unmapped: 3 }));
    show();
    const cash = await screen.findByTestId('report-cash');
    expect(cash.textContent).toContain('—');
    expect(cash.textContent).toContain('Map your bank accounts to Cash and bank');
    expect(screen.queryByRole('img', { name: /^Month-end cash/ })).toBeNull();
  });
  it('a failed cash call: its own error; Section 2 still renders', async () => {
    connectApi.cashPosition.mockImplementation(async () => { throw timeout(); });
    show();
    expect(await screen.findByText(/The cash figures could not be loaded/)).toBeTruthy();
    expect(await screen.findByTestId('report-bva')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('report-sources').textContent).toContain('The balances could not be checked.'));
  });
});

describe('Report: Scenarios', () => {
  it('none saved for the budget', async () => {
    show();
    expect(await screen.findByTestId('report-no-scenarios')).toBeTruthy();
    expect(screen.getByText('No scenarios saved for this budget.')).toBeTruthy();
  });
  it('the saved scenarios, read-only, with the indicative closing cash and its caveat', async () => {
    scenApi.listScenarios.mockImplementation(async () => [{ id: 'base', name: 'Base', is_base: true }, { id: 's-up', name: 'Upside', is_base: false }]);
    scenApi.listValues.mockImplementation(async () => [
      { driver_id: 'd-rev', scenario_id: 's-up', value: 10 }, { driver_id: 'd-pay', scenario_id: 's-up', value: '5.000000' }, { driver_id: 'd-oth', scenario_id: 's-up', value: -3.33 },
    ]);
    show();
    const t = await screen.findByTestId('report-scenarios');
    const row = (name: string) => within(t).getByRole('rowheader', { name: new RegExp(`^${name}`) }).closest('tr')?.textContent ?? '';
    // Hand-computed (src/engine/scenarios.test.ts): Base profit 479.64; Upside 13,200.00 / 12,140.39 / 1,059.61; cash 95,400.00 + profit.
    expect(row('Base')).toContain('€479.64');
    expect(row('Base')).toContain('€95,879.64');
    expect(row('Upside')).toContain('€13,200.00€12,140.39€1,059.61€96,459.61');
    expect(screen.getByText(/indicative: profit used as a proxy for cash; ignores timing, VAT, tax, capex and financing/)).toBeTruthy();
    expect(within(t).queryByRole('textbox')).toBeNull();
    for (const w of WRITES) expect(w).not.toHaveBeenCalled();
  });
  it('a failed scenarios call: its own error', async () => {
    scenApi.listScenarios.mockImplementation(async () => { throw timeout(); });
    show();
    expect(await screen.findByText(/The scenarios could not be loaded/)).toBeTruthy();
    expect(await screen.findByTestId('report-bva')).toBeTruthy();
  });
});

describe('Report: Data quality and notes', () => {
  it('clean: "None", the excluded total, and the fixed line', async () => {
    show();
    const q = await screen.findByTestId('report-quality');
    expect(within(q).getByText('None')).toBeTruthy();
    expect(q.textContent).toContain('Not in the P&L (excluded): 2 accounts, net total €300.00 Dr across all imported months.');
    expect(q.textContent).toContain('Figures come from the imported files; this report is not audited. Closing cash is indicative.');
  });
  it('lists unmapped P&L accounts, unmapped balance accounts and balances older than actuals', async () => {
    accounts = [...accounts, acc('9900', null, '75.00')];
    connectApi.cashPosition.mockImplementation(async () => cashRows('2025-12-01', [['2025-12-01', '95400.00'], ['2025-11-01', '1.00'], ['2025-10-01', '1.00'], ['2025-09-01', '1.00'], ['2025-08-01', '1.00']], { unmapped: 1 }));
    show();
    const q = await screen.findByTestId('report-quality');
    await waitFor(() => expect(q.textContent).toContain('1 P&L account unmapped (net €75.00 Dr)'));
    expect(q.textContent).toContain('1 balance account unmapped: the Cash balance is incomplete.');
    expect(q.textContent).toContain('Balances are 3 months older than actuals (balances through Dec 2025, actuals through Mar 2026).');
  });
});

describe('Report: print', () => {
  it('Print / save as PDF calls the browser print', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Print / save as PDF' }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });
});
