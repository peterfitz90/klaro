import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ fpaClient: () => { throw new Error('not used'); } }));
const { assertComplete, DbError, must, mustMaybe, page } = await import('./db');

describe('db wrapper', () => {
  it('returns data, throws on any error', async () => {
    await expect(must(Promise.resolve({ data: [1], error: null }), 'x')).resolves.toEqual([1]);
    await expect(must(Promise.resolve({ data: null, error: { message: 'permission denied', code: '42501' } }), 'read plans'))
      .rejects.toMatchObject({ name: 'DbError', code: '42501', message: 'read plans: permission denied' });
  });
  it('a missing result is an error, unless the lookup may find nothing', async () => {
    await expect(must(Promise.resolve({ data: null, error: null }), 'x')).rejects.toBeInstanceOf(DbError);
    await expect(mustMaybe(Promise.resolve({ data: null, error: null }), 'x')).resolves.toBeNull();
    await expect(mustMaybe(Promise.resolve({ data: null, error: { message: 'boom' } }), 'x')).rejects.toBeInstanceOf(DbError);
  });
  it('pages are explicit and capped', () => {
    expect(page(0)).toEqual([0, 99]);
    expect(page(2, 50)).toEqual([100, 149]);
    expect(() => page(0, 1000)).toThrow();
    expect(() => page(-1)).toThrow();
  });
  it('a full page is not treated as the whole list', () => {
    expect(assertComplete([1, 2], 3, 'x')).toEqual([1, 2]);
    expect(() => assertComplete([1, 2, 3], 3, 'x')).toThrow(DbError);
  });
});
