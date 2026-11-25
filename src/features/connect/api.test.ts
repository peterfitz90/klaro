// Paging past the API's 1,000-row cap (docs/ui-rules.md section 1), against a fake API that serves a
// fixed, ordered list of 1,234 made-up accounts the way PostgREST does (at most 1,000 per request).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TOTAL = 1234;
const accounts = Array.from({ length: TOTAL }, (_, i) => ({
  connection_id: 'c1', account_code: String(10000 + i), account_name: `Account ${i}`,
  plan_line: i === TOTAL - 1 ? null : 'payroll', months: 12, first_month: '2025-01-01', last_month: '2025-12-01', total: '10.00',
}));
const calls: { fn: string; from: number; to: number }[] = [];
const fail = { onPage: -1 };

vi.mock('../../lib/supabase', () => ({
  fpaClient: () => ({
    rpc: (fn: string) => ({
      range: (from: number, to: number) => {
        calls.push({ fn, from, to });
        const pageNo = from / 1000;
        if (pageNo === fail.onPage) return Promise.resolve({ data: null, error: { message: 'canceling statement due to statement timeout', code: '57014' } });
        // The API never returns more than 1,000 rows, whatever was asked.
        const end = Math.min(to + 1, from + 1000);
        return Promise.resolve({ data: accounts.slice(from, end), error: null });
      },
    }),
  }),
}));
const { accountMap, unmappedAccounts } = await import('./api');
const { pageAll, DbError } = await import('../../lib/db');

beforeEach(() => { calls.length = 0; fail.onPage = -1; });

describe('paging every list (ui-rules 1)', () => {
  it('reads all 1,234 accounts once each, in order, with ranges of 1,000', async () => {
    const rows = await accountMap('e1');
    expect(rows).toHaveLength(TOTAL);
    expect(rows.map(r => r.account_code)).toEqual(accounts.map(a => a.account_code));
    expect(calls).toEqual([{ fn: 'account_map', from: 0, to: 999 }, { fn: 'account_map', from: 1000, to: 1999 }]);
  });
  it('the unmapped account on the last page arrives (so it can block "mapping complete")', async () => {
    const rows = await accountMap('e1');
    expect(rows.filter(r => r.plan_line === null).map(r => r.account_code)).toEqual([String(10000 + TOTAL - 1)]);
  });
  it('a failed page is an error, never a partial list', async () => {
    fail.onPage = 1;
    await expect(accountMap('e1')).rejects.toMatchObject({ name: 'DbError', code: '57014' });
  });
  it('unmapped_accounts is paged the same way', async () => {
    await unmappedAccounts('e1');
    expect(calls.map(c => [c.fn, c.from, c.to])).toEqual([['unmapped_accounts', 0, 999], ['unmapped_accounts', 1000, 1999]]);
  });
  it('an exact multiple of 1,000 needs one more (empty) page to know the list has ended', async () => {
    const pages: number[] = [];
    const rows = await pageAll<number>((from, to) => {
      pages.push(from);
      return Promise.resolve({ data: Array.from({ length: Math.max(0, Math.min(to + 1, 2000) - from) }, (_, i) => from + i), error: null });
    }, 'x');
    expect(rows).toHaveLength(2000);
    expect(pages).toEqual([0, 1000, 2000]);
  });
  it('a page larger than asked for is refused (the list could not be trusted)', async () => {
    await expect(pageAll<number>(() => Promise.resolve({ data: [1, 2, 3], error: null }), 'x', 2)).rejects.toBeInstanceOf(DbError);
  });
});
