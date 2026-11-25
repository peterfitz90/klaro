// @vitest-environment jsdom
// CSV import screen (step 1B) with the data layer replaced by fakes. Covers docs/ui-rules.md
// sections 3 and 6 and the import items of docs/p1c-review-checklist.md.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityContext, type CurrentEntity } from '../entities/context';

const CONN = { id: 'c0c0c0c0-0000-4000-8000-000000000001', source_type: 'csv', status: 'active', last_synced_at: null, actuals_through: null, created_at: '2026-11-25T09:00:00Z' };
const api = {
  listConnections: vi.fn(async () => [CONN]),
  addCsvConnection: vi.fn(async () => CONN),
  fiscalYearStartMonth: vi.fn(async () => 1),
  recentImports: vi.fn(async () => [] as unknown[]),
  importedMonths: vi.fn(async () => new Set<string>()),
  importActuals: vi.fn(async (_e: string, _c: string, rows: { account_code: string; month: string; amount: string }[], _name: string) => ({
    sync_run_id: 'r1', months_replaced: [...new Set(rows.map(r => r.month))].sort(), rows_removed: 0, rows_added: rows.length,
    actuals_through: '2025-12-01', last_synced_at: '2026-11-25T09:30:00Z',
  })),
};
vi.mock('./api', () => api);
vi.mock('../../lib/supabase', () => ({ fpaClient: () => { throw new Error('no db in tests'); } }));
const { ConnectPage } = await import('./ConnectPage');

const SAMPLE = readFileSync(resolve(process.cwd(), 'public/samples/sample-actuals.csv'), 'utf8');
const BROKEN = readFileSync(resolve(process.cwd(), 'public/samples/sample-actuals-broken.csv'), 'utf8');
const ENTITY = { id: '0b483fe4-e952-4170-83b5-a79b911b8023', name: 'Acme Ltd', jurisdiction: 'IE', currency: 'EUR' } as const;

function show(role: CurrentEntity['role'] = 'owner') {
  return render(
    <MemoryRouter>
      <EntityContext.Provider value={{ entity: ENTITY, role, entities: [ENTITY] }}><ConnectPage /></EntityContext.Provider>
    </MemoryRouter>,
  );
}
function file(text: string, name = 'actuals.csv') {
  const f = new File([text], name, { type: 'text/csv' });
  // jsdom's File may lack text(); give it one that reads the same bytes as UTF-8.
  Object.defineProperty(f, 'text', { value: async () => new TextDecoder().decode(new TextEncoder().encode(text)) });
  return f;
}
async function choose(f: File) {
  fireEvent.change(await screen.findByLabelText('CSV file to import'), { target: { files: [f] } });
}
async function toPreview(text: string, answers: { ytd?: boolean; incomePositive?: boolean } = {}) {
  await choose(file(text));
  await screen.findByText(/Match the columns/);
  if (answers.ytd) fireEvent.click(screen.getByLabelText(/Year-to-date balances/));
  if (answers.incomePositive) fireEvent.click(screen.getByLabelText(/Yes: income is positive/));
  fireEvent.click(screen.getByRole('button', { name: 'Check the file' }));
  await screen.findByText(/Check before importing/);
}
const fact = (label: string) => {
  const dt = screen.getAllByText(label).find(e => e.tagName === 'DT');
  return dt?.nextElementSibling?.textContent ?? '';
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listConnections.mockImplementation(async () => [CONN]);
  api.importedMonths.mockImplementation(async () => new Set<string>());
});
afterEach(cleanup);

describe('connection and roles', () => {
  it('an owner with no CSV connection can add one', async () => {
    api.listConnections.mockImplementation(async () => []);
    show('owner');
    fireEvent.click(await screen.findByRole('button', { name: 'Add a CSV connection' }));
    await waitFor(() => expect(api.addCsvConnection).toHaveBeenCalledWith(ENTITY.id));
  });
  it('an editor cannot add a connection, and is told who can', async () => {
    api.listConnections.mockImplementation(async () => []);
    show('editor');
    expect(await screen.findByText(/Only an owner of Acme Ltd can add a CSV connection/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add a CSV connection' })).toBeNull();
  });
  it('a viewer sees the status but cannot import', async () => {
    show('viewer');
    expect(await screen.findByText(/Importing needs editor or owner access/)).toBeTruthy();
    expect(screen.queryByLabelText('CSV file to import')).toBeNull();
  });
  it('a failed load is shown as an error, not as "no connection"', async () => {
    api.listConnections.mockImplementation(async () => { throw Object.assign(new Error('list connections: boom'), { code: 'XX000' }); });
    show();
    expect((await screen.findByRole('alert')).textContent).toContain('The connections could not be loaded');
    expect(screen.queryByRole('button', { name: 'Add a CSV connection' })).toBeNull();
  });
});

describe('import with the sample file', () => {
  it('guesses the columns, previews the counts and answers, imports, and shows the result', async () => {
    show();
    await choose(file(SAMPLE, 'sample-actuals.csv'));
    expect((await screen.findByLabelText('Account code') as HTMLSelectElement).value).toBe('0');
    expect((screen.getByLabelText('Amount') as HTMLSelectElement).value).toBe('3');
    fireEvent.click(screen.getByRole('button', { name: 'Check the file' }));
    await screen.findByText(/Check before importing/);
    expect(fact('Rows read')).toBe('193');
    expect(fact('Rows with problems')).toBe('0');
    expect(fact('Rows to import')).toBe('193');
    expect(fact('Accounts')).toBe('17');
    expect(fact('Months')).toBe('Jan 2025 to Dec 2025 (12 months)');
    expect(fact('Your answers')).toContain('Amounts are monthly movements.');
    expect(fact('Your answers')).toContain('trial-balance style, used as it is');
    expect(api.importActuals).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Import 193 rows' }));
    expect(await screen.findByText(/sample-actuals.csv is imported: 193 rows added/)).toBeTruthy();
    const [entityId, connId, rows, name] = api.importActuals.mock.calls[0] ?? [];
    expect([entityId, connId, name]).toEqual([ENTITY.id, CONN.id, 'sample-actuals.csv']);
    expect(rows).toHaveLength(193);
    expect(rows?.[0]).toEqual({ account_code: '4000', account_name: 'Sales - products', month: '2025-01-01', amount: '-39058.45' });
    expect(fact('Months replaced')).toBe('Jan 2025 to Dec 2025 (12 months)');
    expect(fact('Actuals through')).toBe('Dec 2025');
    expect(fact('Your answers')).toContain('Amounts are monthly movements.');
    expect(screen.getByRole('link', { name: 'Map the accounts' }).getAttribute('href')).toBe(`/e/${ENTITY.id}/connect/map`);
    // The status and recent imports are read again after the import.
    await waitFor(() => expect(api.recentImports).toHaveBeenCalledTimes(2));
  });

  it('warns which months were imported before and will be replaced completely', async () => {
    api.importedMonths.mockImplementation(async () => new Set(['2025-11-01', '2025-12-01', '2026-01-01']));
    show();
    await toPreview(SAMPLE);
    expect(screen.getByText(/Already imported, and will be replaced completely: Nov 2025 to Dec 2025 \(2 months\)/)).toBeTruthy();
  });
});

describe('a file with mistakes (fails closed)', () => {
  it('lists every problem with its line, and Import stays disabled', async () => {
    show();
    await toPreview(BROKEN);
    const table = screen.getByRole('table', { name: 'Problems in the file' });
    const lines = within(table).getAllByRole('row').slice(1).map(r => r.querySelector('td')?.textContent);
    expect(lines).toEqual(['4', '6', '9', '11', '21']);
    expect(table.textContent).toContain('"2025-13" is not a real date.');
    expect(table.textContent).toContain('"$120.00" is not an amount');
    expect(table.textContent).toContain('The account code is empty.');
    expect(table.textContent).toContain('already has a figure for 2025-01 (line 10)');
    expect(table.textContent).toContain('"1.234" is not an amount');
    expect(screen.getByText(/5 problems found. Nothing can be imported/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.importActuals).not.toHaveBeenCalled();
  });
  it('€ signs and brackets are converted with a warning that counts them; $ stays a problem', async () => {
    show();
    await toPreview('account_code,month,amount\n4000,2025-01,"(1,200.50)"\n5000,2025-01,€300\n6000,2025-01,-5\n');
    expect(screen.getByText(/^2 amounts were converted: 1 had a € sign, which was removed; 1 in brackets were read as negative/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Import 3 rows' }));
    await screen.findByText(/is imported/);
    expect((api.importActuals.mock.calls[0]?.[2] ?? []).map(r => r.amount)).toEqual(['-1200.50', '300.00', '-5.00']);
    cleanup();
    show();
    await toPreview('account_code,month,amount\n4000,2025-01,$300\n');
    expect(screen.getByRole('table', { name: 'Problems in the file' }).textContent).toContain('"$300" is not an amount');
  });
  it('refuses a file over 5 MB before reading it', async () => {
    show();
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.csv');
    await choose(big);
    expect((await screen.findByRole('alert')).textContent).toContain('the most one import can take is 5 MB');
  });
  it('refuses a file that is not UTF-8 text', async () => {
    show();
    await choose(file('account_code,month,amount\n4000,2025-01,�1\n'));
    expect((await screen.findByRole('alert')).textContent).toContain('CSV UTF-8');
  });
  it('refuses a broken quote with the line number', async () => {
    show();
    await choose(file('account_code,month,amount\n"4000,2025-01,1\n'));
    expect((await screen.findByRole('alert')).textContent).toContain('Line 2');
  });
  it('needs a column for code, month and amount', async () => {
    show();
    await choose(file('a,b,c\n1,2,3\n'));
    fireEvent.click(await screen.findByRole('button', { name: 'Check the file' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Choose the column for account code.');
  });
});

describe('when the server refuses (nothing is shown as success)', () => {
  it('a refused row is shown with the file line, and nothing was imported', async () => {
    api.importActuals.mockImplementationOnce(async () => {
      throw Object.assign(new Error('import actuals: Row 3: the month must be from January 2000 to this month.'), { code: 'PT400', what: 'import actuals' });
    });
    show();
    await toPreview('account_code,month,amount\n\n4000,2025-01,-1\n5000,2025-01,1\n6000,2025-01,1\n');
    fireEvent.click(screen.getByRole('button', { name: 'Import 3 rows' }));
    const alert = await screen.findByText(/Nothing was imported\./);
    expect(alert.parentElement?.textContent).toContain('Line 5: the month must be');
    expect(screen.queryByText(/is imported/)).toBeNull();
  });
  it('a timeout says "Try a smaller file" (ui-rules 6) and shows no result figures', async () => {
    api.importActuals.mockImplementationOnce(async () => { throw Object.assign(new Error('import actuals: canceling statement due to statement timeout'), { code: '57014' }); });
    show();
    await toPreview(SAMPLE);
    fireEvent.click(screen.getByRole('button', { name: 'Import 193 rows' }));
    const msg = await screen.findByText(/This took too long. Try a smaller file./);
    expect(msg.parentElement?.textContent).toContain('Nothing was imported.');
    expect(screen.queryByText('Months replaced')).toBeNull();
    expect(screen.queryByText(/is imported/)).toBeNull();
  });
  it('an unknown outcome (network or gateway) says Klaro could not confirm it', async () => {
    api.importActuals.mockImplementationOnce(async () => { throw new Error('import actuals: TypeError: Failed to fetch'); });
    show();
    await toPreview(SAMPLE);
    fireEvent.click(screen.getByRole('button', { name: 'Import 193 rows' }));
    const msg = await screen.findByText(/could not confirm whether the import finished/);
    expect(msg.parentElement?.textContent).toContain('Check "Recent imports" below');
    expect(screen.queryByText(/Nothing was imported/)).toBeNull();
  });
});

describe('the two questions about the numbers (ui-rules 3)', () => {
  const YTD = 'account_code,account_name,month,amount\n' + [
    '4000,Sales,2025-01,1000', '4000,Sales,2025-02,2500', '4000,Sales,2025-03,4000',
    '5000,Rent,2025-01,-300', '5000,Rent,2025-02,-600', '5000,Rent,2025-03,-900',
    '6000,Wages,2025-01,-200', '6000,Wages,2025-02,-500', '6000,Wages,2025-03,-700',
  ].join('\n');
  it('year-to-date with income positive: converted then flipped, and both answers shown before and after', async () => {
    show();
    await toPreview(YTD, { ytd: true, incomePositive: true });
    expect(fact('Your answers')).toContain('year-to-date balances (turned into monthly movements)');
    expect(fact('Your answers')).toContain('every sign was flipped');
    expect(screen.queryByText(/These look like/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Import 9 rows' }));
    await screen.findByText(/is imported/);
    const rows = api.importActuals.mock.calls[0]?.[2] ?? [];
    expect(rows.filter(r => r.account_code === '4000').map(r => r.amount)).toEqual(['-1000.00', '-1500.00', '-1500.00']);
    expect(rows.filter(r => r.account_code === '5000').map(r => r.amount)).toEqual(['300.00', '300.00', '300.00']);
    expect(fact('Your answers')).toContain('year-to-date balances');
  });
  it('warns when the figures look like the other kind', async () => {
    show();
    await toPreview(YTD);
    expect(screen.getByText(/These look like year-to-date balances/)).toBeTruthy();
  });
  it('a year-to-date file missing a month is an error, not a guess', async () => {
    show();
    await toPreview('account_code,month,amount\n4000,2025-01,-1\n4000,2025-03,-3\n', { ytd: true });
    expect(screen.getByRole('table', { name: 'Problems in the file' }).textContent).toContain('The file has no 2025-02');
    expect((screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
