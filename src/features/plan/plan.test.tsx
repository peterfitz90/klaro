// @vitest-environment jsdom
// Plan: budget from actuals (step 1D), with the data layer replaced by fakes. Covers docs/ui-rules.md
// sections 4 and 6 and the 1D rules in the Phase 1 prompt.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addMonths } from '../../engine';
import { EntityContext, type CurrentEntity } from '../entities/context';
import { CONN, DEFS, ENTITY, PLAN, varianceRows } from './fixtures';
import type { BudgetLine, Version } from './api';

const V1: Version = { id: 'b0b0b0b0-0000-4000-8000-0000000000b1', name: 'Budget 2026', kind: 'budget', locked_at: null, unlocked_at: null, created_at: '2026-01-06T09:00:00Z' };
let versions: Version[] = [];
let lines: BudgetLine[] = [];
const ACTUALS = varianceRows('2025-01-01', 12, () => ({ revenue: ['1000.00', null], payroll: ['400.00', null], premises: ['100.00', null] }));
const timeout = () => Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });

const planApi = {
  getPlan: vi.fn(async () => PLAN),
  listBudgets: vi.fn(async () => versions),
  budgetLines: vi.fn(async () => lines),
  baseScenario: vi.fn(async () => 's1'),
  linesToReplace: vi.fn(async () => ({ total: 108, manual: 3 })),
  createBudget: vi.fn(async () => V1.id),
  setLocked: vi.fn(async (_id: string, locked: boolean) => ({ ...V1, locked_at: locked ? '2026-01-07T10:00:00Z' : null })),
  editLine: vi.fn(async () => undefined),
  variance: vi.fn(async () => ACTUALS),
};
vi.mock('./api', () => planApi);
const connectApi = { listConnections: vi.fn(async () => [CONN]), listPlanLineDefs: vi.fn(async () => DEFS) };
vi.mock('../connect/api', () => connectApi);
vi.mock('../../lib/supabase', () => ({ fpaClient: () => { throw new Error('no db in tests'); } }));
const { PlanPage } = await import('./PlanPage');

function show(role: CurrentEntity['role'] = 'editor') {
  return render(<MemoryRouter><EntityContext.Provider value={{ entity: ENTITY, role, entities: [ENTITY] }}><PlanPage /></EntityContext.Provider></MemoryRouter>);
}
/** 108 lines: 9 budgetable lines x 12 months of 2026, stored sign; revenue 1050/month. */
function budget2026(manual: string[] = []): BudgetLine[] {
  const out: BudgetLine[] = [];
  for (let k = 0; k < 12; k++) {
    const p = addMonths('2026-01-01', k);
    for (const d of DEFS.filter(x => x.kind === 'income' || x.kind === 'cost')) {
      const amount = d.key === 'revenue' ? '-1050.00' : d.key === 'payroll' ? '400.00' : '0.00';
      const id = `${d.key}-${p}`;
      out.push({ id, plan_line: d.key, period: p, amount, origin: manual.includes(id) ? 'manual' : 'from_actuals' });
    }
  }
  return out;
}
const field = (name: RegExp | string) => screen.getByLabelText(name) as HTMLInputElement;
const row = (label: string) => within(screen.getByRole('table', { name: 'Budget by line' })).getByRole('rowheader', { name: label }).closest('tr') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  versions = [];
  lines = [];
  planApi.variance.mockImplementation(async () => ACTUALS);
  planApi.createBudget.mockImplementation(async () => V1.id);
  planApi.editLine.mockImplementation(async () => undefined);
});
afterEach(cleanup);

describe('new budget from actuals', () => {
  it('previews each line with its uplift, then creates the budget with exactly what was chosen', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'New budget from actuals' }));
    await screen.findByRole('table', { name: 'Budget by line' });
    expect(planApi.variance).toHaveBeenCalledWith(ENTITY.id, null, '2025-01-01', '2025-12-01');
    expect(row('Revenue').textContent).toContain('€12,000.00');
    fireEvent.change(field('Uplift for Revenue, percent'), { target: { value: '5' } });
    fireEvent.change(field('Uplift for Payroll, percent'), { target: { value: '2.5' } });
    expect(row('Revenue').textContent).toContain('€12,600.00');
    expect(row('Payroll').textContent).toContain('€4,920.00');
    expect(row('Net profit').textContent).toContain('€6,480.00');   // 12,600 - 4,920 - 1,200
    fireEvent.click(screen.getByRole('button', { name: 'Create the budget' }));
    await waitFor(() => expect(planApi.createBudget).toHaveBeenCalledWith({
      planId: PLAN.id, versionId: null, name: 'Budget Jan 2026 to Dec 2026', actualsFrom: '2025-01-01', budgetFrom: '2026-01-01',
      uplifts: { revenue: '5.00', payroll: '2.50' },
    }));
  });
  it('a window with a month of no actuals cannot be used', async () => {
    planApi.variance.mockImplementation(async () => varianceRows('2025-01-01', 12, () => ({ revenue: ['1000.00', null] }), { actualsIn: m => m !== '2025-03-01' }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'New budget from actuals' }));
    expect(await screen.findByText(/No actuals for Mar 2025/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create the budget' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('unmapped actuals in the window block it until they are mapped', async () => {
    planApi.variance.mockImplementation(async () => varianceRows('2025-01-01', 12, m => ({ revenue: ['1000.00', null], unmapped: [m === '2025-06-01' ? '75.00' : '0', null] })));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'New budget from actuals' }));
    expect(await screen.findByText(/not mapped to a plan line \(net €75.00\)/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create the budget' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('an uplift outside -100% to 1000% is refused before anything is sent', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'New budget from actuals' }));
    await screen.findByRole('table', { name: 'Budget by line' });
    fireEvent.change(field('Uplift for Revenue, percent'), { target: { value: '2000' } });
    expect(screen.getByText('Enter a percentage from -100 to 1000, with at most two decimals.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create the budget' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('a timeout says the budget wording, and nothing is shown as created (ui-rules 6)', async () => {
    planApi.createBudget.mockImplementationOnce(async () => { throw timeout(); });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'New budget from actuals' }));
    await screen.findByRole('table', { name: 'Budget by line' });
    fireEvent.click(screen.getByRole('button', { name: 'Create the budget' }));
    expect(await screen.findByText('This took too long. Nothing was changed. Try again, and if it keeps happening, tell us.')).toBeTruthy();
    expect(planApi.listBudgets).toHaveBeenCalledTimes(1);   // nothing reloaded as if it had worked
  });
  it('a viewer sees budgets but cannot build one', async () => {
    show('viewer');
    expect(await screen.findByText(/Building or changing one needs editor or owner access/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New budget from actuals' })).toBeNull();
  });
});

describe('rebuilding an existing budget (ui-rules 4)', () => {
  beforeEach(() => { versions = [V1]; lines = budget2026(['revenue-2026-03-01', 'payroll-2026-03-01', 'tax-2026-12-01']); });
  async function openRebuild() {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Rebuild from actuals…' }));
    await screen.findByRole('table', { name: 'Budget by line' });
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild…' }));
    return screen.findByRole('alertdialog');
  }
  it('says how many lines will be replaced and how many were edited by hand, before anything changes', async () => {
    const dialog = await openRebuild();
    expect(planApi.linesToReplace).toHaveBeenCalledWith(V1.id, '2026-01-01', '2026-12-01');
    expect(dialog.textContent).toContain('Rebuilding replaces 108 lines in Jan 2026 to Dec 2026, including 3 lines edited by hand.');
    expect(planApi.createBudget).not.toHaveBeenCalled();
  });
  it('Cancel changes nothing', async () => {
    await openRebuild();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(planApi.createBudget).not.toHaveBeenCalled();
  });
  it('only the explicit yes rebuilds, into the same version', async () => {
    await openRebuild();
    fireEvent.click(screen.getByRole('button', { name: 'Replace 108 lines' }));
    await waitFor(() => expect(planApi.createBudget).toHaveBeenCalledWith(expect.objectContaining({ versionId: V1.id, name: null, budgetFrom: '2026-01-01' })));
  });
  it('a locked version cannot be rebuilt: the screen says to unlock first', async () => {
    versions = [{ ...V1, locked_at: '2026-01-07T10:00:00Z' }];
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Rebuild from actuals…' }));
    expect((await screen.findAllByText('This version is locked. Unlock it first.')).length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: 'Rebuild…' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('if the database says the version is locked (PT423), the screen says to unlock first', async () => {
    planApi.createBudget.mockImplementationOnce(async () => { throw Object.assign(new Error('build the budget: This version is locked. Unlock it first.'), { code: 'PT423' }); });
    await openRebuild();
    fireEvent.click(screen.getByRole('button', { name: 'Replace 108 lines' }));
    expect(await screen.findByText('This version is locked. Unlock it first.')).toBeTruthy();
  });
});

describe('locking', () => {
  it('an editor can lock, but not unlock', async () => {
    versions = [V1]; lines = budget2026();
    show('editor');
    fireEvent.click(await screen.findByRole('button', { name: 'Lock this budget' }));
    await waitFor(() => expect(planApi.setLocked).toHaveBeenCalledWith(V1.id, true));
    expect(await screen.findByText(/Only an owner can unlock it/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Unlock' })).toBeNull();
  });
  it('an owner can unlock', async () => {
    versions = [{ ...V1, locked_at: '2026-01-07T10:00:00Z' }]; lines = budget2026();
    show('owner');
    fireEvent.click(await screen.findByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(planApi.setLocked).toHaveBeenCalledWith(V1.id, false));
  });
  it('a locked budget cannot be edited', async () => {
    versions = [{ ...V1, locked_at: '2026-01-07T10:00:00Z' }]; lines = budget2026();
    show('owner');
    await screen.findByRole('table', { name: /Budget 2026/ });
    expect(screen.queryByLabelText('Revenue, Jan 2026')).toBeNull();
  });
});

describe('editing lines by hand', () => {
  beforeEach(() => { versions = [V1]; lines = budget2026(['payroll-2026-03-01']); });
  it('revenue is shown and typed as a positive number and stored with the stored sign', async () => {
    show();
    const cell = await screen.findByLabelText('Revenue, Jan 2026') as HTMLInputElement;
    expect(cell.value).toBe('1,050.00');
    fireEvent.change(cell, { target: { value: '1,500' } });
    fireEvent.change(screen.getByLabelText('Payroll, Feb 2026'), { target: { value: '450' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save 2 changes' }));
    await waitFor(() => expect(planApi.editLine).toHaveBeenCalledTimes(2));
    expect(planApi.editLine).toHaveBeenCalledWith('revenue-2026-01-01', '-1500.00');
    expect(planApi.editLine).toHaveBeenCalledWith('payroll-2026-02-01', '450.00');
    expect(await screen.findByText('Saved 2 changes.')).toBeTruthy();
  });
  it('lines edited by hand are marked', async () => {
    show();
    await screen.findByLabelText('Payroll, Mar 2026');
    expect(screen.getAllByTitle('Edited by hand')).toHaveLength(1);
  });
  it('an amount that is not an amount saves nothing and says which cell', async () => {
    show();
    fireEvent.change(await screen.findByLabelText('Revenue, Jan 2026'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 change' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Revenue, Jan 2026:');
    expect(planApi.editLine).not.toHaveBeenCalled();
  });
  it('a timeout while saving says the budget wording', async () => {
    planApi.editLine.mockImplementationOnce(async () => { throw timeout(); });
    show();
    fireEvent.change(await screen.findByLabelText('Revenue, Jan 2026'), { target: { value: '1,500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 change' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This took too long. Nothing was changed. Try again, and if it keeps happening, tell us.');
  });
  it('the calculated lines follow the edits (display sign: revenue less costs)', async () => {
    show();
    const net = () => within(screen.getByRole('table', { name: /Budget 2026/ })).getByRole('rowheader', { name: 'Net profit' }).closest('tr')?.querySelectorAll('td')[0]?.textContent;
    await screen.findByLabelText('Revenue, Jan 2026');
    expect(net()).toBe('650.00');
    fireEvent.change(screen.getByLabelText('Revenue, Jan 2026'), { target: { value: '1,500' } });
    expect(net()).toBe('1,100.00');
  });
});
