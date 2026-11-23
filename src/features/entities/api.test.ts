import { beforeEach, describe, expect, it, vi } from 'vitest';

// A fake query builder that records every call and resolves to whatever the test sets.
let result: { data: unknown; error: unknown } = { data: null, error: null };
const calls: string[] = [];
function builder(): unknown {
  const b: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'order', 'range', 'eq', 'maybeSingle', 'rpc']) {
    b[m] = (...args: unknown[]) => { calls.push(`${m}(${JSON.stringify(args)})`); return b; };
  }
  b.then = (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(result).then(ok, fail);
  return b;
}
vi.mock('../../lib/supabase', () => ({ fpaClient: () => builder() }));
const { createEntity, getEntity, listEntities, myRole } = await import('./api');

const ID = '0b483fe4-e952-4170-83b5-a79b911b8023';

beforeEach(() => { calls.length = 0; result = { data: null, error: null }; });

describe('entity data access', () => {
  it('create_entity gets exactly the four named arguments and returns the new id', async () => {
    result = { data: ID, error: null };
    await expect(createEntity({ name: 'Acme', jurisdiction: 'IE', currency: 'EUR', fiscalYearStart: 4 })).resolves.toBe(ID);
    expect(calls).toEqual([`rpc(["create_entity",{"p_name":"Acme","p_jurisdiction":"IE","p_currency":"EUR","p_fiscal_year_start":4}])`]);
  });
  it('create_entity errors reach the caller, with the database’s message and code', async () => {
    result = { data: null, error: { code: 'PT429', message: 'You already own 10 entities, which is the most allowed.' } };
    await expect(createEntity({ name: 'Acme', jurisdiction: 'IE', currency: 'EUR', fiscalYearStart: 1 }))
      .rejects.toMatchObject({ code: 'PT429', message: 'create entity: You already own 10 entities, which is the most allowed.' });
  });
  it('a create that returns no id is an error, not a success', async () => {
    result = { data: 'not-a-uuid', error: null };
    await expect(createEntity({ name: 'Acme', jurisdiction: 'IE', currency: 'EUR', fiscalYearStart: 1 })).rejects.toThrow(/did not return/);
  });
  it('the entity list asks for an explicit range and refuses a full page', async () => {
    result = { data: [{ id: ID, name: 'Acme', jurisdiction: 'IE', currency: 'EUR' }], error: null };
    await expect(listEntities()).resolves.toHaveLength(1);
    expect(calls).toContain('range([0,199])');
    result = { data: Array.from({ length: 200 }, () => ({})), error: null };
    await expect(listEntities()).rejects.toThrow(/page through them/);
    result = { data: null, error: { code: '42501', message: 'permission denied for schema fpa' } };
    await expect(listEntities()).rejects.toMatchObject({ code: '42501' });
  });
  it('a malformed id from the URL never reaches the database', async () => {
    await expect(getEntity('nope')).resolves.toBeNull();
    await expect(myRole('nope', 'user_x')).resolves.toBeNull();
    expect(calls).toEqual([]);
  });
  it('role lookup is the caller’s own active membership', async () => {
    result = { data: { role: 'editor' }, error: null };
    await expect(myRole(ID, 'user_abc')).resolves.toBe('editor');
    expect(calls).toEqual(expect.arrayContaining([`eq(["entity_id","${ID}"])`, 'eq(["clerk_user_id","user_abc"])', 'eq(["is_active",true])']));
  });
});
