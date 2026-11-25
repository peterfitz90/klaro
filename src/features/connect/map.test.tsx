// @vitest-environment jsdom
// Account mapping screen (step 1C) with the data layer replaced by fakes. Covers docs/ui-rules.md
// sections 1, 2 and 6 and the mapping items of docs/p1c-review-checklist.md.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityContext, type CurrentEntity } from '../entities/context';
import type { AccountRow, PlanLineDef } from './api';

const C1 = 'c0c0c0c0-0000-4000-8000-000000000001';
const DEFS: PlanLineDef[] = [
  ['revenue', 'Revenue', 'income', 10, -1, true], ['cost_of_sales', 'Cost of sales', 'cost', 20, 1, true],
  ['gross_profit', 'Gross profit', 'calculated', 30, -1, false], ['payroll', 'Payroll', 'cost', 40, 1, true],
  ['marketing', 'Marketing', 'cost', 50, 1, true], ['premises', 'Rent and premises', 'cost', 60, 1, true],
  ['other_operating', 'Other operating costs', 'cost', 70, 1, true], ['operating_profit', 'Operating profit', 'calculated', 80, -1, false],
  ['interest', 'Interest', 'cost', 90, 1, true], ['tax', 'Tax', 'cost', 100, 1, true], ['net_profit', 'Net profit', 'calculated', 110, -1, false],
  ['unmapped', 'Unmapped', 'unmapped', 120, 1, false], ['excluded', 'Not in the P&L (excluded)', 'excluded', 130, 1, true],
].map(([key, label, kind, sort_order, display_sign, mappable]) => ({ key, label, kind, sort_order, display_sign, mappable }) as PlanLineDef);

const acc = (code: string, name: string | null, line: string | null, total: string, months = 12): AccountRow =>
  ({ connection_id: C1, account_code: code, account_name: name, plan_line: line, months, first_month: '2025-01-01', last_month: '2025-12-01', total });

let ROWS: AccountRow[] = [];
const api = {
  listPlanLineDefs: vi.fn(async () => DEFS),
  accountMap: vi.fn(async () => ROWS),
  listConnections: vi.fn(async () => [{ id: C1, source_type: 'csv', status: 'active', last_synced_at: null, actuals_through: null, created_at: '' }]),
  setLineMap: vi.fn(async (_c: string, entries: unknown[]) => entries.length),
};
vi.mock('./api', () => api);
vi.mock('../../lib/supabase', () => ({ fpaClient: () => { throw new Error('no db in tests'); } }));
const { MapPage } = await import('./MapPage');

const ENTITY = { id: '0b483fe4-e952-4170-83b5-a79b911b8023', name: 'Acme Ltd', jurisdiction: 'IE', currency: 'EUR' } as const;
function show(role: CurrentEntity['role'] = 'editor') {
  return render(
    <MemoryRouter>
      <EntityContext.Provider value={{ entity: ENTITY, role, entities: [ENTITY] }}><MapPage /></EntityContext.Provider>
    </MemoryRouter>,
  );
}
const status = async () => (await screen.findByTestId('mapping-status')).textContent ?? '';
const excluded = () => screen.getByTestId('excluded-summary').textContent ?? '';
const select = (code: string) => screen.getByLabelText(`Plan line for ${code}`) as HTMLSelectElement;
const timeout = () => Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });

beforeEach(() => {
  vi.clearAllMocks();
  ROWS = [
    acc('9900', 'Clearing 7', null, '75.00'),
    acc('6000', 'Wages and salaries', null, '252000.00'),
    acc('4000', 'Sales - products', 'revenue', '-504000.00'),
    acc('1200', 'Bank current account', 'excluded', '31200.00'),
    acc('2200', 'VAT control', 'excluded', '-22800.00'),
  ];
  api.accountMap.mockImplementation(async () => ROWS);
  api.setLineMap.mockImplementation(async (_c: string, entries: unknown[]) => entries.length);
});
afterEach(cleanup);

describe('mapping complete (ui-rules 1)', () => {
  it('unmapped accounts come first, and block "mapping complete"', async () => {
    show();
    expect(await status()).toContain('Mapping not complete: 2 of 5 accounts unmapped');
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows.slice(0, 2).map(r => r.textContent)).toEqual([expect.stringContaining('9900'), expect.stringContaining('6000')]);
    expect(screen.queryByText(/Mapping complete/)).toBeNull();
  });
  it('one unmapped account at the end of 1,234 still blocks it', async () => {
    ROWS = Array.from({ length: 1234 }, (_, i) => acc(String(10000 + i), `Account ${i}`, i === 1233 ? null : 'payroll', '1.00'));
    show();
    expect(await status()).toContain('Mapping not complete: 1 of 1,234 accounts unmapped');
  });
  it('says "Mapping complete" only when every account with actuals is mapped', async () => {
    ROWS = [acc('4000', 'Sales', 'revenue', '-1.00'), acc('5000', 'Old', null, '0.00', 0)];
    show();
    expect(await status()).toContain('Mapping complete: all 1 account with actuals are mapped');
  });
  it('with no accounts, says so (never "complete")', async () => {
    ROWS = [];
    show();
    expect(await status()).toContain('No accounts yet');
  });
  it('a failed page shows an error and no list', async () => {
    api.accountMap.mockImplementation(async () => { throw Object.assign(new Error('load the accounts: boom'), { code: 'XX000' }); });
    show();
    expect((await screen.findByRole('alert')).textContent).toContain('The accounts could not be loaded');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByTestId('mapping-status')).toBeNull();
  });
});

describe('excluded accounts are always visible (ui-rules 2)', () => {
  // Gate 1 fix 4: an account mapped to excluded but with no actuals is not counted.
  it('counts only excluded accounts that have actuals', async () => {
    ROWS = [...ROWS, acc('1210', 'Closed bank account', 'excluded', '0.00', 0)];
    show();
    await status();
    expect(excluded()).toContain('Not in the P&L (excluded): 2 accounts, net total €8,400.00 Dr');
  });
  it('shows the excluded count and net total', async () => {
    show();
    await status();
    expect(excluded()).toContain('Not in the P&L (excluded): 2 accounts, net total €8,400.00 Dr');
  });
  it('shows them even when there are none', async () => {
    ROWS = [acc('4000', 'Sales', 'revenue', '-1.00')];
    show();
    await status();
    expect(excluded()).toContain('0 accounts, net total €0.00');
  });
});

describe('suggestions are never applied silently', () => {
  it('a suggestion is shown, and nothing changes until it is used and saved', async () => {
    show();
    await status();
    expect(screen.getByText(/Suggested: Payroll/)).toBeTruthy();
    expect(select('6000').value).toBe('');
    expect(api.setLineMap).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Use the suggestion Payroll for 6000' }));
    expect(select('6000').value).toBe('payroll');
    expect(screen.getByText(/1 unsaved change\./)).toBeTruthy();
    expect(await status()).toContain('2 of 5 accounts unmapped');   // the saved state
    expect(api.setLineMap).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save 1 change' }));
    await waitFor(() => expect(api.setLineMap).toHaveBeenCalledWith(C1, [{ account_code: '6000', plan_line: 'payroll' }]));
    expect(await screen.findByText('Saved 1 change.')).toBeTruthy();
    expect(api.accountMap).toHaveBeenCalledTimes(2);   // the saved mapping is read again
  });
  it('"Use all suggestions" fills in only the accounts with one, and still saves nothing', async () => {
    show();
    await status();
    fireEvent.click(screen.getByRole('button', { name: 'Use all 1 suggestion' }));
    expect(select('6000').value).toBe('payroll');
    expect(select('9900').value).toBe('');   // "Clearing 7" has no suggestion
    expect(api.setLineMap).not.toHaveBeenCalled();
  });
  it('a mapping can be set by hand, removed, and discarded', async () => {
    show();
    await status();
    fireEvent.change(select('9900'), { target: { value: 'other_operating' } });
    fireEvent.change(select('4000'), { target: { value: '' } });
    expect(screen.getByText(/2 unsaved changes/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(select('9900').value).toBe('');
    expect(select('4000').value).toBe('revenue');
    fireEvent.change(select('9900'), { target: { value: 'excluded' } });
    fireEvent.change(select('4000'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save 2 changes' }));
    await waitFor(() => expect(api.setLineMap).toHaveBeenCalledWith(C1, [
      { account_code: '9900', plan_line: 'excluded' }, { account_code: '4000', plan_line: null },
    ]));
  });
  it('only lines an account can be mapped to are offered (no calculated lines)', async () => {
    show();
    await status();
    const options = [...select('9900').options].map(o => o.textContent);
    expect(options).toEqual(['Unmapped', 'Revenue', 'Cost of sales', 'Payroll', 'Marketing', 'Rent and premises', 'Other operating costs', 'Interest', 'Tax', 'Not in the P&L (excluded)']);
  });
});

describe('timeouts (ui-rules 6) and roles', () => {
  const MSG = 'This took too long. Nothing was changed. Try again, and if it keeps happening, tell us.';
  it('a timeout while saving shows the mapping message and keeps the unsaved choices', async () => {
    api.setLineMap.mockImplementationOnce(async () => { throw timeout(); });
    show();
    await status();
    fireEvent.change(select('9900'), { target: { value: 'excluded' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 change' }));
    expect((await screen.findByRole('alert')).textContent).toBe(MSG);
    expect(select('9900').value).toBe('excluded');
    expect(screen.queryByText(/Saved/)).toBeNull();
  });
  it('a timeout while loading shows the mapping message and no figures', async () => {
    api.accountMap.mockImplementation(async () => { throw timeout(); });
    show();
    expect((await screen.findByRole('alert')).textContent).toContain(MSG);
    expect(screen.queryByText(/€/)).toBeNull();
  });
  it('a viewer sees the mapping but cannot change it', async () => {
    show('viewer');
    await status();
    expect(select('6000').disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
    expect(screen.queryByText(/Suggested:/)).toBeNull();
    expect(screen.getByText(/Changing it needs editor or owner access/)).toBeTruthy();
  });
});

describe('finding accounts', () => {
  it('filters to unmapped or excluded, and by code or name', async () => {
    show();
    await status();
    const codes = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map(r => r.querySelector('.mono')?.textContent);
    fireEvent.click(screen.getByRole('button', { name: 'Unmapped' }));
    expect(codes()).toEqual(['9900', '6000']);
    fireEvent.click(screen.getByRole('button', { name: 'Excluded' }));
    expect(codes()).toEqual(['1200', '2200']);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.change(screen.getByLabelText('Find an account'), { target: { value: 'wages' } });
    expect(codes()).toEqual(['6000']);
  });
});
