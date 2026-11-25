import { describe, expect, it } from 'vitest';
import {
  columnMapProblems, guessColumns, IMPORT_LIMITS, jsonbTextBytes, parseAmount, parseMonth, prepareImport,
  type ColumnMap, type ImportOptions,
} from './actualsImport';
import { parseCsv } from './csv';

const NOW = '2026-11-01';
const MAP: ColumnMap = { account_code: 0, account_name: 1, month: 2, amount: 3 };
const OPTS: ImportOptions = { ytd: false, incomePositive: false, fiscalYearStartMonth: 1, currentMonth: NOW, currency: 'EUR' };
const body = (text: string) => parseCsv(text).slice(1);
const HEAD = 'account_code,account_name,month,amount\n';

describe('columns', () => {
  it('guesses the four columns from common header names', () => {
    expect(guessColumns(['Account Code', 'Account Name', 'Period', 'Amount'])).toEqual(MAP);
    expect(guessColumns(['Date', 'Nominal code', 'Description', 'Net'])).toEqual({ account_code: 1, account_name: 2, month: 0, amount: 3 });
    expect(guessColumns(['x', 'y'])).toEqual({ account_code: null, account_name: null, month: null, amount: null });
  });
  it('requires code, month and amount, and one column per field', () => {
    expect(columnMapProblems(MAP, 4)).toEqual([]);
    expect(columnMapProblems({ ...MAP, account_name: null }, 4)).toEqual([]);
    expect(columnMapProblems({ ...MAP, amount: null }, 4)).toEqual(['Choose the column for amount.']);
    expect(columnMapProblems({ ...MAP, amount: 2 }, 4)).toEqual(['Amount and month use the same column.']);
    expect(columnMapProblems({ ...MAP, amount: 9 }, 4)).toEqual(['The column for amount is not in the file.']);
  });
});

describe('single values', () => {
  it('reads a month as YYYY-MM or a date, day first', () => {
    expect(parseMonth('2025-01', NOW)).toEqual({ period: '2025-01-01' });
    expect(parseMonth('2025-02-28', NOW)).toEqual({ period: '2025-02-01' });
    expect(parseMonth('31/12/2025', NOW)).toEqual({ period: '2025-12-01' });
    expect(parseMonth('1/3/2024', NOW)).toEqual({ period: '2024-03-01' });
    expect(parseMonth('2026-11', NOW)).toEqual({ period: '2026-11-01' });
  });
  it('refuses a month that is not real, too early, in the future or not a month', () => {
    for (const bad of ['2025-13', '2025-02-30', '30/02/2024', '1999-12', '2026-12', 'Jan 2025', '', '12/31/2025']) {
      expect(parseMonth(bad, NOW)).toHaveProperty('problem');
    }
  });
  const plain = (cents: bigint) => ({ cents, signRemoved: false, bracketed: false });
  it('reads an amount exactly in cents', () => {
    expect(parseAmount('-1200.50')).toEqual(plain(-120050n));
    expect(parseAmount('1,234,567.8')).toEqual(plain(123456780n));
    expect(parseAmount(' 0 ')).toEqual(plain(0n));
    expect(parseAmount('999999999999.99')).toEqual(plain(99999999999999n));
  });
  it('removes a € or £ sign and reads brackets as negative (Peter, 25 Nov 2026)', () => {
    expect(parseAmount('€1,200.50', 'EUR')).toEqual({ cents: 120050n, signRemoved: true, bracketed: false });
    expect(parseAmount('-€80', 'EUR')).toEqual({ cents: -8000n, signRemoved: true, bracketed: false });
    expect(parseAmount('€-80', 'EUR')).toEqual({ cents: -8000n, signRemoved: true, bracketed: false });
    expect(parseAmount('€ 80.5', 'EUR')).toEqual({ cents: 8050n, signRemoved: true, bracketed: false });
    expect(parseAmount('£80', 'GBP')).toEqual({ cents: 8000n, signRemoved: true, bracketed: false });
    expect(parseAmount('(1,200.50)', 'EUR')).toEqual({ cents: -120050n, signRemoved: false, bracketed: true });
    expect(parseAmount('(€1,200.50)', 'EUR')).toEqual({ cents: -120050n, signRemoved: true, bracketed: true });
    expect(parseAmount('€(1,200.50)', 'EUR')).toEqual({ cents: -120050n, signRemoved: true, bracketed: true });
    expect(parseAmount('(0.00)', 'EUR')).toEqual({ cents: 0n, signRemoved: false, bracketed: true });
  });
  it('refuses other signs, ambiguous forms, too many decimals or digits', () => {
    for (const bad of ['$100', 'US$100', '100€', '100 €', 'EUR 100', '¥100', '€€100', '€£100', '(-100)', '-(100)', '((100))', '(100', '100)',
      '€  100', '1.234', '1,23', '1e5', '', '-', '€', '()', '1000000000000', '12,34,567', '1 000', '1.200,50', '--100']) {
      expect(parseAmount(bad, 'EUR'), bad).toHaveProperty('problem');
    }
    expect(parseAmount('(-100)', 'EUR')).toEqual({ problem: '"(-100)" has both brackets and a minus sign, so it is not clear whether it is negative.' });
  });
  it('refuses a sign that is not the entity’s currency', () => {
    expect(parseAmount('£100', 'EUR')).toEqual({ problem: '"£100" is in sterling, but this entity\'s currency is EUR.' });
    expect(parseAmount('(€100)', 'GBP')).toEqual({ problem: '"(€100)" is in euro, but this entity\'s currency is GBP.' });
  });
});

describe('prepareImport', () => {
  it('builds the rows to send, with counts and totals', () => {
    const p = prepareImport(body(HEAD + '4000,Sales,2025-01,-1000.00\n\n5000,Rent,2025-01,250.5\n4000,Sales,2025-02,-900\n'), MAP, OPTS);
    expect(p.problems).toEqual([]);
    expect(p.dataRows).toBe(3);
    expect(p.blankRows).toBe(1);
    expect(p.accounts).toBe(2);
    expect(p.months).toEqual(['2025-01-01', '2025-02-01']);
    expect(p.debits).toBe(25050n);
    expect(p.credits).toBe(-190000n);
    expect(p.payload).toEqual([
      { account_code: '4000', account_name: 'Sales', month: '2025-01-01', amount: '-1000.00' },
      { account_code: '5000', account_name: 'Rent', month: '2025-01-01', amount: '250.50' },
      { account_code: '4000', account_name: 'Sales', month: '2025-02-01', amount: '-900.00' },
    ]);
    expect(p.payloadBytes).toBe(jsonbTextBytes(p.payload));
  });

  it('lists every problem with its file line, and sends nothing while there is any', () => {
    const p = prepareImport(body(HEAD + '4000,Sales,2025-01,-10\n,No code,2025-01,5\n4000,Sales,2025-01,3\n5000,Rent,Jan 25,abc\n6000,Short\n'), MAP, OPTS);
    expect(p.payload).toEqual([]);
    expect(p.problems.map(x => x.line)).toEqual([3, 4, 5, 5, 6]);
    expect(p.problems[0]?.message).toBe('the account code is empty.');
    expect(p.problems[1]?.message).toContain('already has a figure for 2025-01 (line 2)');
    expect(p.problems[4]?.message).toContain('the line has 2 columns');
  });

  it('works without an account name column', () => {
    const p = prepareImport(body('code,month,amount\n4000,2025-01,-1\n'), { account_code: 0, account_name: null, month: 1, amount: 2 }, OPTS);
    expect(p.payload).toEqual([{ account_code: '4000', month: '2025-01-01', amount: '-1.00' }]);
  });

  it('refuses an empty file and a file over 20,000 rows before checking rows', () => {
    expect(prepareImport(body(HEAD), MAP, OPTS).problems[0]?.message).toContain('no rows of figures');
    const big = HEAD + Array.from({ length: IMPORT_LIMITS.maxRows + 1 }, (_, i) => `A${i},,2025-01,1`).join('\n');
    const p = prepareImport(body(big), MAP, OPTS);
    expect(p.problems).toHaveLength(1);
    expect(p.problems[0]?.message).toContain('20,001 rows; the most one import can take is 20,000');
    expect(p.payload).toEqual([]);
  });

  it('refuses rows that come to more than 5 MB as the database measures them', () => {
    const name = 'N'.repeat(200);
    const text = HEAD + Array.from({ length: 19_000 }, (_, i) => `ACC${i},${name},2025-01,1`).join('\n');
    const p = prepareImport(body(text), MAP, OPTS);
    expect(p.problems).toHaveLength(1);
    expect(p.problems[0]?.message).toMatch(/come to 4\.\d MB|come to 5\.\d MB/);
    expect(p.payload).toEqual([]);
  });

  it('a file shaped like the paging test (1,250 accounts x 12 months, 200-character names) passes, under 5 MB', () => {
    const name = 'N'.repeat(186);
    const lines = [];
    for (let m = 1; m <= 12; m++) for (let a = 1; a <= 1250; a++) lines.push(`${10000 + a},Account ${10000 + a} ${name},2025-${String(m).padStart(2, '0')},-1100.25`);
    const p = prepareImport(body(HEAD + lines.join('\n')), MAP, OPTS);
    expect(p.problems).toEqual([]);
    expect(p.accounts).toBe(1250);
    expect(p.payload).toHaveLength(15_000);
    expect(p.payloadBytes).toBeLessThan(IMPORT_LIMITS.maxBytes);
  });

  it('flips every sign when income is positive in the file (ui-rules 3.2)', () => {
    const p = prepareImport(body(HEAD + '4000,Sales,2025-01,1000\n5000,Rent,2025-01,-250\n'), MAP, { ...OPTS, incomePositive: true });
    expect(p.payload.map(r => r.amount)).toEqual(['-1000.00', '250.00']);
  });
});

describe('amounts with a currency sign or brackets', () => {
  it('converts them and says how many were converted', () => {
    const p = prepareImport(body(HEAD + '4000,Sales,2025-01,"(1,200.50)"\n5000,Rent,2025-01,€300\n6000,Fees,2025-01,(€20.00)\n7000,Other,2025-01,5\n'), MAP, OPTS);
    expect(p.problems).toEqual([]);
    expect(p.payload.map(r => r.amount)).toEqual(['-1200.50', '300.00', '-20.00', '5.00']);
    expect(p.warnings).toEqual(['3 amounts were converted: 2 had a € sign, which was removed; 2 in brackets were read as negative, so (1,200.50) is -1,200.50. Check the debits and credits below before importing.']);
  });
  it('one converted amount is counted as one', () => {
    const p = prepareImport(body(HEAD + '4000,Sales,2025-01,(10)\n'), MAP, OPTS);
    expect(p.warnings[0]).toBe('1 amount was converted: 1 in brackets were read as negative, so (1,200.50) is -1,200.50. Check the debits and credits below before importing.');
  });
  it('no warning when nothing was converted', () => {
    expect(prepareImport(body(HEAD + '4000,Sales,2025-01,-10\n'), MAP, OPTS).warnings).toEqual([]);
  });
  it('$ and a sign in the wrong currency stay problems', () => {
    const p = prepareImport(body(HEAD + '4000,Sales,2025-01,$10\n5000,Rent,2025-01,£10\n'), MAP, OPTS);
    expect(p.problems.map(x => x.line)).toEqual([2, 3]);
    expect(p.payload).toEqual([]);
  });
});

describe('year-to-date balances (ui-rules 3.1)', () => {
  const ytd = { ...OPTS, ytd: true };
  it('turns them into monthly movements within each financial year', () => {
    // Financial year starts in April: March 2025 belongs to the year from April 2024.
    const text = HEAD + [
      '4000,Sales,2024-04,-100', '4000,Sales,2024-05,-250', '4000,Sales,2024-06,-300',
      '4000,Sales,2025-04,-80', '4000,Sales,2025-05,-200',
    ].join('\n');
    const p = prepareImport(body(text), MAP, { ...ytd, fiscalYearStartMonth: 4 });
    expect(p.problems).toEqual([]);
    expect(p.payload.map(r => [r.month, r.amount])).toEqual([
      ['2024-04-01', '-100.00'], ['2024-05-01', '-150.00'], ['2024-06-01', '-50.00'],
      ['2025-04-01', '-80.00'], ['2025-05-01', '-120.00'],
    ]);
  });
  it('a year that does not start at the first month of the financial year is an error, not a guess', () => {
    const p = prepareImport(body(HEAD + '4000,Sales,2025-02,-100\n4000,Sales,2025-03,-150\n'), MAP, ytd);
    expect(p.payload).toEqual([]);
    expect(p.problems[0]).toMatchObject({ line: 0 });
    expect(p.problems[0]?.message).toContain('The file has no 2025-01');
  });
  it('a month missing inside the year is an error', () => {
    const p = prepareImport(body(HEAD + '4000,Sales,2025-01,-100\n4000,Sales,2025-03,-150\n'), MAP, ytd);
    expect(p.problems[0]?.message).toContain('no 2025-02');
  });
  it('an account missing a month the file has is an error that says how to fix it', () => {
    const p = prepareImport(body(HEAD + '4000,Sales,2025-01,-100\n5000,Rent,2025-01,10\n4000,Sales,2025-02,-150\n'), MAP, ytd);
    expect(p.problems).toEqual([{ line: 3, message: 'account 5000 has no year-to-date figure for 2025-02. Add a row with 0.00 for each month it had no balance.' }]);
  });
  it('converts first, then flips signs, when both answers apply', () => {
    const p = prepareImport(body(HEAD + '4000,Sales,2025-01,100\n4000,Sales,2025-02,250\n'), MAP, { ...ytd, incomePositive: true });
    expect(p.payload.map(r => r.amount)).toEqual(['-100.00', '-150.00']);
  });
});

describe('sanity warning (ui-rules 3.1)', () => {
  const growing = HEAD + ['4000,Sales', '5000,Rent', '6000,Wages'].flatMap((a, k) =>
    [1, 2, 3, 4].map(m => `${a},2025-0${m},${(k === 0 ? -1 : 1) * m * 100}`)).join('\n');
  const flat = HEAD + ['4000,Sales', '5000,Rent', '6000,Wages'].flatMap(a =>
    [1, 2, 3, 4].map(m => `${a},2025-0${m},${m % 2 ? 100 : 80}`)).join('\n');
  it('warns when "monthly" figures only grow across the year', () => {
    expect(prepareImport(body(growing), MAP, OPTS).warnings[0]).toContain('look like year-to-date balances');
    expect(prepareImport(body(flat), MAP, OPTS).warnings).toEqual([]);
  });
  it('warns when "year-to-date" figures do not grow', () => {
    expect(prepareImport(body(flat), MAP, { ...OPTS, ytd: true }).warnings[0]).toContain('look like monthly movements');
    expect(prepareImport(body(growing), MAP, { ...OPTS, ytd: true }).warnings).toEqual([]);
  });
});

describe('jsonbTextBytes', () => {
  it('matches how Postgres prints jsonb as text', () => {
    const rows = [{ account_code: '1', month: '2025-01-01', amount: '1.00' }];
    // [{"month": "2025-01-01", "amount": "1.00", "account_code": "1"}]
    expect(jsonbTextBytes(rows)).toBe('[{"month": "2025-01-01", "amount": "1.00", "account_code": "1"}]'.length);
  });
  it('matches octet_length(jsonb::text) measured on the project (25 Nov 2026: 157 bytes)', () => {
    expect(jsonbTextBytes([
      { account_code: '1', account_name: 'Café é', month: '2025-01-01', amount: '1.00' },
      { account_code: '2', month: '2025-01-01', amount: '-1.00' },
    ])).toBe(157);
  });
});
