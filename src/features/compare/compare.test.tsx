// @vitest-environment jsdom
// Compare (step 1E) with the data layer replaced by fakes. Covers docs/ui-rules.md sections 2, 5 and 6
// and the 1E rules in the Phase 1 prompt.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CsvCell } from '../../design/downloadCSV';
import type { AccountRow } from '../connect/api';
import { EntityContext } from '../entities/context';
import { CONN, ENTITY, PLAN, varianceRows } from '../plan/fixtures';

const V1 = { id: 'b0b0b0b0-0000-4000-8000-0000000000b1', name: 'Budget 2026', kind: 'budget', locked_at: null, unlocked_at: null, created_at: '' };
// 2026: budget every month; actuals Jan–Mar. March: revenue over budget, payroll over budget.
const FIG = varianceRows('2026-01-01', 12, m => ({
  revenue: ['1100.00', '1000.00'], payroll: ['450.00', '400.00'], premises: ['100.00', '100.00'],
  ...(m === '2026-02-01' ? { revenue: ['900.00', '1000.00'] as [string, string] } : {}),
}), { actualsIn: m => m <= '2026-03-01', budgetIn: () => true });
let accounts: AccountRow[] = [];
const acc = (code: string, line: string | null, total: string): AccountRow =>
  ({ connection_id: CONN.id, account_code: code, account_name: code, plan_line: line, months: 3, first_month: '2026-01-01', last_month: '2026-03-01', total });

const planApi = {
  getPlan: vi.fn(async () => PLAN),
  listBudgets: vi.fn(async () => [V1]),
  variance: vi.fn(async () => FIG),
};
vi.mock('../plan/api', () => planApi);
const connectApi = {
  listConnections: vi.fn(async () => [{ ...CONN, actuals_through: '2026-03-01' }]),
  accountMap: vi.fn(async () => accounts),
};
vi.mock('../connect/api', () => connectApi);
const exported: CsvCell[][][] = [];
vi.mock('../../design/downloadCSV', () => ({ downloadCSV: (_n: string, rows: CsvCell[][]) => { exported.push(rows); } }));
vi.mock('../../lib/supabase', () => ({ fpaClient: () => { throw new Error('no db in tests'); } }));
const { ComparePage } = await import('./ComparePage');

function show(today = new Date(2026, 10, 25)) {
  return render(<MemoryRouter><EntityContext.Provider value={{ entity: ENTITY, role: 'viewer', entities: [ENTITY] }}><ComparePage today={today} /></EntityContext.Provider></MemoryRouter>);
}
const monthTable = () => screen.findByRole('table', { name: 'Month and year to date' });
const cells = (table: HTMLElement, line: string) =>
  [...(within(table).getByRole('rowheader', { name: line }).closest('tr')?.querySelectorAll('td') ?? [])].map(td => td.textContent ?? '');

beforeEach(() => {
  vi.clearAllMocks();
  exported.length = 0;
  accounts = [acc('4000', 'revenue', '-3100.00'), acc('1200', 'excluded', '500.00'), acc('2200', 'excluded', '-200.00')];
  planApi.variance.mockImplementation(async () => FIG);
  connectApi.listConnections.mockImplementation(async () => [{ ...CONN, actuals_through: '2026-03-01' }]);
});
afterEach(cleanup);

describe('month and year to date', () => {
  it('shows budget, actual, variance and variance % for the latest month and the year to date', async () => {
    show();
    const t = await monthTable();
    expect(planApi.variance).toHaveBeenCalledWith(ENTITY.id, V1.id, '2026-01-01', '2026-12-01');
    // Mar 2026: budget, actual, variance, %, fav | YTD Jan–Mar
    expect(cells(t, 'Revenue')).toEqual(['€1,000.00', '€1,100.00', '€100.00', '+10.0%', '▲ Favourable', '€3,000.00', '€3,100.00', '€100.00', '+3.3%', '▲ Favourable']);
    expect(cells(t, 'Payroll')).toEqual(['€400.00', '€450.00', '€50.00', '+12.5%', '▼ Unfavourable', '€1,200.00', '€1,350.00', '€150.00', '+12.5%', '▼ Unfavourable']);
    expect(cells(t, 'Net profit').slice(0, 5)).toEqual(['€500.00', '€550.00', '€50.00', '+10.0%', '▲ Favourable']);
  });
  it('favourable and unfavourable carry a symbol and a word, not only colour', async () => {
    show();
    const t = await monthTable();
    const good = within(t).getAllByTitle('Favourable')[0];
    const bad = within(t).getAllByTitle('Unfavourable')[0];
    expect(good?.textContent).toBe('▲ Favourable');
    expect(bad?.textContent).toBe('▼ Unfavourable');
  });
  it('a month with no actuals shows "—", and so does the year to date that includes it', async () => {
    show();
    fireEvent.change(await screen.findByLabelText('Month'), { target: { value: '2026-05-01' } });
    const t = await monthTable();
    expect(cells(t, 'Revenue').slice(0, 4)).toEqual(['€1,000.00', '—', '—', '—']);
    expect(cells(t, 'Revenue').slice(5, 9)).toEqual(['€5,000.00', '—', '—', '—']);
  });
  it('the unmapped line is shown without favourable or not', async () => {
    show();
    const t = await monthTable();
    expect(cells(t, 'Unmapped')[4]).toBe('');
  });
});

describe('actuals through and last synced (Phase 1 decision)', () => {
  it('Compare shows "Actuals through [month], last synced [date]"', async () => {
    show();
    expect((await screen.findByTestId('actuals-through')).textContent).toMatch(/^Actuals through Mar 2026, last synced 5 Jan 2026, \d{2}:\d{2}\./);
  });
});

describe('every month', () => {
  it('shows one figure per month, with the year to date', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Every month' }));
    const grid = screen.getByRole('table', { name: 'Variance by month' });
    const rev = cells(grid, 'Revenue');
    expect(rev[0]).toBe('€100.00 ▲ Favourable');
    expect(rev[1]).toBe('-€100.00 ▼ Unfavourable');
    expect(rev[3]).toBe('—');
    expect(rev[12]).toBe('€100.00 ▲ Favourable');   // YTD to Mar 2026
    fireEvent.change(screen.getByLabelText('Figure'), { target: { value: 'actual' } });
    expect(cells(screen.getByRole('table', { name: 'Actual by month' }), 'Revenue')[0]).toBe('€1,100.00');
  });
});

describe('excluded accounts always visible (ui-rules 2)', () => {
  it('shows the count and net total', async () => {
    show();
    expect((await screen.findByTestId('excluded-summary')).textContent).toContain('2 accounts, net total €300.00 Dr');
  });
  it('shows them when there are none', async () => {
    accounts = [acc('4000', 'revenue', '-1.00')];
    show();
    expect((await screen.findByTestId('excluded-summary')).textContent).toContain('0 accounts, net total €0.00');
  });
});

describe('a month that may be incomplete (ui-rules 5)', () => {
  it('when the latest month of actuals is this month, Compare says so on that month', async () => {
    show(new Date(2026, 2, 15));   // March 2026, the latest month of actuals
    await monthTable();
    expect(screen.getByTestId('incomplete-note').textContent).toBe('Mar 2026 is this month: its actuals may be incomplete.');
    fireEvent.click(screen.getByRole('button', { name: 'Every month' }));
    expect(screen.getAllByTitle('Month may be incomplete')).toHaveLength(1);
  });
  it('not when the latest month is an earlier month', async () => {
    show(new Date(2026, 10, 25));
    await monthTable();
    expect(screen.queryByTestId('incomplete-note')).toBeNull();
  });
});

describe('timeouts and errors (ui-rules 6)', () => {
  it('a timeout says "Try a shorter date range" and shows no figures', async () => {
    planApi.variance.mockImplementation(async () => { throw Object.assign(new Error('load the figures: canceling statement due to statement timeout'), { code: '57014' }); });
    show();
    expect((await screen.findByRole('alert')).textContent).toContain('This took too long. Try a shorter date range.');
    expect(screen.queryByRole('table')).toBeNull();
  });
  it('a failed load is an error, not an empty Compare', async () => {
    connectApi.listConnections.mockImplementation(async () => { throw Object.assign(new Error('list connections: boom'), { code: 'XX000' }); });
    show();
    expect((await screen.findByRole('alert')).textContent).toContain('Compare could not be loaded');
    expect(screen.queryByText('Nothing to compare yet')).toBeNull();
  });
});

describe('export and no budget', () => {
  it('exports every line and month, and the year to date, as CSV', async () => {
    show();
    await monthTable();
    fireEvent.click(screen.getByRole('button', { name: 'Export ▾' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download CSV' }));
    const rows = exported[0] ?? [];
    expect(rows[0]).toEqual(['line', 'period', 'budget', 'actual', 'variance', 'variance_pct', 'favourable', 'note']);
    expect(rows).toContainEqual(['Revenue', '2026-03', '1000.00', '1100.00', '100.00', '10.0', 'favourable', '']);
    expect(rows).toContainEqual(['Revenue', 'YTD to 2026-03', '3000.00', '3100.00', '100.00', '3.3', 'favourable', '']);
    expect(rows).toHaveLength(1 + 12 * 13);
  });
  it('with no budget chosen, the budget figures are "—" and it says so', async () => {
    planApi.variance.mockImplementation(async () => varianceRows('2026-01-01', 12, () => ({ revenue: ['1100.00', null] }), { actualsIn: m => m <= '2026-03-01', budgetIn: () => false }));
    show();
    fireEvent.change(await screen.findByLabelText('Budget'), { target: { value: '' } });
    await waitFor(() => expect(planApi.variance).toHaveBeenLastCalledWith(ENTITY.id, null, '2026-01-01', '2026-12-01'));
    expect(await screen.findByText(/No budget chosen: the Budget figures show "—"/)).toBeTruthy();
  });
});
