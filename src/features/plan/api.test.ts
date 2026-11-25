// What the Plan data layer sends to the API: a hand edit sets origin "manual"; the counts before a
// rebuild are exact database counts (not rows under the cap) of the base scenario's 12 months; locks
// send locked_at; variance is read a page at a time.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { table?: string; rpc?: string; ops: [string, ...unknown[]][] };
const calls: Call[] = [];
const results: unknown[] = [];

function builder(call: Call) {
  const b: Record<string, unknown> = {};
  for (const op of ['select', 'eq', 'gte', 'lte', 'order', 'range', 'update', 'single', 'insert']) {
    b[op] = (...args: unknown[]) => { call.ops.push([op, ...args]); return b; };
  }
  b.then = (ok: (r: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(results.shift()).then(ok, fail);
  return b;
}
vi.mock('../../lib/supabase', () => ({
  fpaClient: () => ({
    from: (table: string) => { const c: Call = { table, ops: [] }; calls.push(c); return builder(c); },
    rpc: (fn: string, args: unknown) => { const c: Call = { rpc: fn, ops: [['args', args]] }; calls.push(c); return builder(c); },
  }),
}));
const api = await import('./api');

beforeEach(() => { calls.length = 0; results.length = 0; });

describe('plan data layer', () => {
  it('a hand edit stores the amount with origin "manual"', async () => {
    results.push({ data: { id: 'l1' }, error: null });
    await api.editLine('l1', '-1500.00');
    expect(calls[0]?.table).toBe('plan_lines');
    expect(calls[0]?.ops).toContainEqual(['update', { amount: '-1500.00', origin: 'manual' }]);
    expect(calls[0]?.ops).toContainEqual(['eq', 'id', 'l1']);
  });
  it('the rebuild counts are exact counts of the base scenario in the 12 months, all and edited by hand', async () => {
    results.push({ data: [{ id: 's1' }], error: null }, { count: 108, error: null }, { count: 3, error: null });
    expect(await api.linesToReplace('v1', '2026-01-01', '2026-12-01')).toEqual({ total: 108, manual: 3 });
    const counts = calls.filter(c => c.table === 'plan_lines');
    expect(counts).toHaveLength(2);
    for (const c of counts) {
      expect(c.ops).toContainEqual(['select', 'id', { count: 'exact', head: true }]);
      expect(c.ops).toContainEqual(['eq', 'scenario_id', 's1']);
      expect(c.ops).toContainEqual(['gte', 'period', '2026-01-01']);
      expect(c.ops).toContainEqual(['lte', 'period', '2026-12-01']);
    }
    expect(counts[1]?.ops).toContainEqual(['eq', 'origin', 'manual']);
  });
  it('a missing count is an error, not zero', async () => {
    results.push({ data: [{ id: 's1' }], error: null }, { count: null, error: null }, { count: 0, error: null });
    await expect(api.linesToReplace('v1', '2026-01-01', '2026-12-01')).rejects.toMatchObject({ name: 'DbError' });
  });
  it('lock and unlock send locked_at, and the result must agree', async () => {
    results.push({ data: { id: 'v1', locked_at: '2026-01-07T10:00:00Z' }, error: null });
    await api.setLocked('v1', true);
    expect(calls[0]?.ops.find(o => o[0] === 'update')?.[1]).toEqual({ locked_at: expect.any(String) });
    results.push({ data: { id: 'v1', locked_at: null }, error: null });
    await api.setLocked('v1', false);
    expect(calls[1]?.ops).toContainEqual(['update', { locked_at: null }]);
    results.push({ data: { id: 'v1', locked_at: null }, error: null });
    await expect(api.setLocked('v1', true)).rejects.toMatchObject({ name: 'DbError' });
  });
  it('variance is read a page at a time', async () => {
    results.push({ data: Array.from({ length: 1000 }, () => ({})), error: null }, { data: [{}], error: null });
    expect(await api.variance('e1', null, '2025-01-01', '2025-12-01')).toHaveLength(1001);
    expect(calls.map(c => c.ops.find(o => o[0] === 'range')?.slice(1))).toEqual([[0, 999], [1000, 1999]]);
  });
});
