import { describe, expect, it } from 'vitest';
import { missingCashRows, missingCashText, suggestBalanceLine } from './balances';

const row = (account_code: string, month: string) => ({ account_code, month, amount: '1.00' });

describe('missingCashRows: the import preview warning (warn, never block)', () => {
  it('lists each Cash and bank account with no row for a month in the file', () => {
    const payload = [row('1210', '2025-10-01'), row('1220', '2025-10-01'), row('1100', '2025-10-01'), row('1210', '2025-11-01'), row('1100', '2025-11-01')];
    expect(missingCashRows(payload, new Set(['1210', '1220']))).toEqual([{ code: '1220', month: '2025-11-01' }]);
  });
  it('the wording Peter set', () => {
    expect(missingCashText({ code: '1200', month: '2025-11-01' })).toBe('Account 1200 has no row for Nov 2025; its balance will count as 0.');
  });
  it('an account mapped to Cash and bank but absent from the whole file is missing in every month of the file', () => {
    expect(missingCashRows([row('1100', '2025-01-01'), row('1100', '2025-02-01')], new Set(['1210']))).toEqual([
      { code: '1210', month: '2025-01-01' }, { code: '1210', month: '2025-02-01' }]);
  });
  it('nothing to say when no account is mapped to Cash and bank, or every month has its row', () => {
    expect(missingCashRows([row('1210', '2025-01-01')], new Set())).toEqual([]);
    expect(missingCashRows([row('1210', '2025-01-01')], new Set(['1210']))).toEqual([]);
  });
});

describe('suggestBalanceLine', () => {
  it.each([
    ['Bank current account', 'cash_bank'], ['Deposit account', 'cash_bank'], ['Bank overdraft', 'cash_bank'], ['Petty cash', 'cash_bank'],
    ['Trade debtors', 'excluded'], ['VAT control', 'excluded'], ['Bank loan', 'excluded'], ['Bank charges', 'excluded'], ['Directors loan account', 'excluded'],
    ['Misc', null], ['', null], [null, null],
  ])('%s -> %s', (name, line) => expect(suggestBalanceLine(name)).toBe(line));
});
