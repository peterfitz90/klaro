// Balances import helpers (Phase 2): the import preview's warning for Cash and bank accounts with a
// missing month, and the suggestion for a balance account's plan line. Pure functions.
import { monthLabel } from './cash';
import type { PayloadRow } from './actualsImport';
import type { Period } from './period';

/**
 * Accounts already mapped to Cash and bank that have no row for a month that is in the file. Each
 * month in the file is replaced whole, so such an account's balance will count as 0 that month.
 * Peter's rule (26 Nov 2026): warn, never block. One warning per account and month, in order.
 */
export function missingCashRows(payload: readonly PayloadRow[], cashCodes: ReadonlySet<string>): { code: string; month: Period }[] {
  if (cashCodes.size === 0 || payload.length === 0) return [];
  const months = [...new Set(payload.map(r => r.month))].sort();
  const present = new Set(payload.map(r => `${r.account_code}|${r.month}`));
  const out: { code: string; month: Period }[] = [];
  for (const code of [...cashCodes].sort()) {
    for (const month of months) if (!present.has(`${code}|${month}`)) out.push({ code, month });
  }
  return out;
}

export const missingCashText = (m: { code: string; month: Period }) =>
  `Account ${m.code} has no row for ${monthLabel(m.month)}; its balance will count as 0.`;

export type BalanceLine = 'cash_bank' | 'excluded';

/**
 * A suggested line for a balance account, from its name; only a suggestion (shown labelled "Suggested",
 * used only when the person says so). Bank, cash, deposit and overdraft accounts: Cash and bank.
 * Other balance-sheet accounts (debtors, creditors, VAT, loans, fixed assets…): left out (excluded).
 * Null when nothing fits clearly.
 */
export function suggestBalanceLine(name: string | null | undefined): BalanceLine | null {
  const n = (name ?? '').trim();
  if (!n) return null;
  if (/\b(bank charges|bank fees|bank loan|bank interest|interest)\b/i.test(n)) return 'excluded';
  if (/\b(bank|cash|current account|deposit account|deposit|savings|overdraft|petty cash)\b/i.test(n)) return 'cash_bank';
  if (/\b(debtors?|creditors?|receivables?|payables?|vat|paye|prsi|accruals?|prepayments?|loans?|fixed assets?|depreciation|share capital|retained|reserves?|stock|inventory|control|suspense|directors?)\b/i.test(n)) return 'excluded';
  return null;
}
