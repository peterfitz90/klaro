// @vitest-environment jsdom
// Account mapping screen (step 1C) with the data layer replaced by fakes. Covers docs/ui-rules.md
// sections 1, 2 and 6 and the mapping items of docs/p1c-review-checklist.md.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { onDataChanged } from '../../lib/dataEvents';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityContext, type CurrentEntity } from '../entities/context';
import type { AccountRow, BalanceAccountRow, PlanLineDef } from './api';

const C1 = 'c0c0c0c0-0000-4000-8000-000000000001';
const DEFS: PlanLineDef[] = [
  ['revenue', 'Revenue', 'income', 10, -1, true], ['cost_of_sales', 'Cost of sales', 'cost', 20, 1, true],
  ['gross_profit', 'Gross profit', 'calculated', 30, -1, false], ['payroll', 'Payroll', 'cost', 40, 1, true],
  ['marketing', 'Marketing', 'cost', 50, 1, true], ['premises', 'Rent and premises', 'cost', 60, 1, true],
  ['other_operating', 'Other operating costs', 'cost', 70, 1, true], ['operating_profit', 'Operating profit', 'calculated', 80, -1, false],
  ['interest', 'Interest', 'cost', 90, 1, true], ['tax', 'Tax', 'cost', 100, 1, true], ['net_profit', 'Net profit', 'calculated', 110, -1, false],
  ['unmapped', 'Unmapped', 'unmapped', 120, 1, false], ['excluded', 'Not in the P&L (excluded)', 'excluded', 130, 1, true],
  ['cash_bank', 'Cash and bank', 'balance', 140, 1, true],
].map(([key, label, kind, sort_order, display_sign, mappable]) => ({ key, label, kind, sort_order, display_sign, mappable }) as PlanLineDef);

const acc = (code: string, name: string | null, line: string | null, total: string, months = 12): AccountRow =>
  ({ connection_id: C1, account_code: code, account_name: name, plan_line: line, months, first_month: '2025-01-01', last_month: '2025-12-01', total });

let ROWS: AccountRow[] = [];
let BAL: BalanceAccountRow[] = [];
const bal = (code: string, name: string | null, line: string | null, last: string): BalanceAccountRow =>
  ({ connection_id: C1, account_code: code, account_name: name, plan_line: line, months: 12, first_month: '2025-01-01', last_month: '2025-12-01', last_balance: last });
const api = {
  listPlanLineDefs: vi.fn(async () => DEFS),
  accountMap: vi.fn(async () => ROWS),
  listConnections: vi.fn(async () => [{ id: C1, source_type: 'csv', status: 'active', last_synced_at: null, actuals_through: null, created_at: '' }]),
  setLineMap: vi.fn(async (_c: string, entries: unknown[]) => entries.length),
  balanceAccounts: vi.fn(async () => BAL),
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
  BAL = [];
  api.balanceAccounts.mockImplementation(async () => BAL);
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

describe('the P&L list and balance-only accounts (pre-demo fix)', () => {
  it('a mapped account that only has balances is not in the P&L list, only in the balance section', async () => {
    ROWS = [...ROWS, acc('1210', null, 'cash_bank', '0.00', 0)];   // account_map lists it (mapped, no actuals)
    BAL = [bal('1210', 'Bank current account', 'cash_bank', '87150.00')];
    show();
    await screen.findByTestId('balance-status');
    const pnl = within(screen.getByRole('table', { name: 'Accounts and their plan lines' }));
    expect(pnl.queryByText('1210')).toBeNull();
    expect(screen.queryByText('No actuals now; the mapping is kept.')).toBeNull();
    expect(within(screen.getByRole('table', { name: 'Balance accounts and their plan lines' })).getByText('1210')).toBeTruthy();
  });
  it('a P&L account whose actuals were removed (no balances) still shows, with its mapping kept', async () => {
    ROWS = [...ROWS, acc('6100', 'Advertising', 'marketing', '0.00', 0)];
    BAL = [];
    show();
    await status();
    const pnl = within(screen.getByRole('table', { name: 'Accounts and their plan lines' }));
    expect(pnl.getByText('6100')).toBeTruthy();
    expect(screen.getByText('No actuals now; the mapping is kept.')).toBeTruthy();
  });
});

describe('balance accounts (Phase 2)', () => {
  beforeEach(() => {
    BAL = [bal('1100', 'Trade debtors', null, '31240.85'), bal('1210', 'Bank current account', null, '87150.00'), bal('1220', 'Bank deposit account', null, '8250.00')];
  });
  const balSelect = (code: string) => screen.getByLabelText(`Plan line for balance account ${code}`) as HTMLSelectElement;
  it('Cash and bank is offered for balance accounts only, never for P&L accounts', async () => {
    show();
    await screen.findByTestId('balance-status');
    expect([...select('6000').options].map(o => o.textContent)).not.toContain('Cash and bank');
    expect([...balSelect('1210').options].map(o => o.textContent)).toEqual(['Unmapped', 'Cash and bank', 'Not cash (left out)']);
  });
  it('says how many are unmapped and that the cash tiles show "—" until one is on Cash and bank', async () => {
    show();
    const s = (await screen.findByTestId('balance-status')).textContent ?? '';
    expect(s).toContain('3 of 3 balance accounts unmapped');
    expect(s).toContain('No account is on Cash and bank yet');
  });
  it('suggestions are labelled and only used when asked; nothing is saved until Save', async () => {
    show();
    await screen.findByTestId('balance-status');
    const t = within(screen.getByRole('table', { name: 'Balance accounts and their plan lines' }));
    expect(t.getAllByText(/Suggested: Cash and bank/)).toHaveLength(2);
    expect(t.getByText(/Suggested: Not cash \(left out\)/)).toBeTruthy();
    expect(balSelect('1210').value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Use all 3 suggestions' }));
    expect(balSelect('1210').value).toBe('cash_bank');
    expect(balSelect('1100').value).toBe('excluded');
    expect(api.setLineMap).not.toHaveBeenCalled();
  });
  it('Save sends the balance mappings in one call per source and tells the KPI strip to reload', async () => {
    const changed = vi.fn();
    const off = onDataChanged(ENTITY.id, changed);
    show();
    await screen.findByTestId('balance-status');
    fireEvent.change(balSelect('1210'), { target: { value: 'cash_bank' } });
    fireEvent.change(balSelect('1220'), { target: { value: 'cash_bank' } });
    fireEvent.change(balSelect('1100'), { target: { value: 'excluded' } });
    BAL = [bal('1100', 'Trade debtors', 'excluded', '31240.85'), bal('1210', 'Bank current account', 'cash_bank', '87150.00'), bal('1220', 'Bank deposit account', 'cash_bank', '8250.00')];
    fireEvent.click(within(screen.getByTestId('balance-mapping')).getByRole('button', { name: 'Save 3 changes' }));
    await waitFor(() => expect(api.setLineMap).toHaveBeenCalledTimes(1));
    expect(api.setLineMap).toHaveBeenCalledWith(C1, [
      { account_code: '1100', plan_line: 'excluded' }, { account_code: '1210', plan_line: 'cash_bank' }, { account_code: '1220', plan_line: 'cash_bank' }]);
    expect((await screen.findByTestId('balance-status')).textContent).toContain('All 3 balance accounts are mapped; 2 accounts on Cash and bank');
    expect(changed).toHaveBeenCalled();
    off();
  });
  it('a timeout while saving keeps the choices and says nothing was changed', async () => {
    api.setLineMap.mockImplementationOnce(async () => { throw timeout(); });
    show();
    await screen.findByTestId('balance-status');
    fireEvent.change(balSelect('1210'), { target: { value: 'cash_bank' } });
    fireEvent.click(within(screen.getByTestId('balance-mapping')).getByRole('button', { name: 'Save 1 change' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Nothing was changed');
    expect(balSelect('1210').value).toBe('cash_bank');
  });
  it('with no balances imported, says how to add them', async () => {
    BAL = [];
    show();
    expect(await screen.findByText(/No month-end balances imported yet/)).toBeTruthy();
  });
});
