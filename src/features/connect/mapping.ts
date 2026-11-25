// The rules behind the mapping screen, as pure functions (tested on their own):
// - "Mapping complete" only when the whole account list has been read (every page) and no account
//   with actuals is unmapped (docs/ui-rules.md section 1).
// - The excluded count and net total are always worked out, even when they are 0 (section 2).
import { toCents } from '../../engine';
import type { AccountRow } from './api';

export interface Account extends Omit<AccountRow, 'total'> {
  key: string;
  /** Net total, trial-balance sign (debit positive), in cents. */
  cents: bigint;
}

export const accountKey = (connectionId: string, code: string) => `${connectionId}|${code}`;

/** Exact amounts for every row; a total that is not an exact amount is an error, not a guess. */
export function toAccounts(rows: readonly AccountRow[]): Account[] {
  return rows.map(r => {
    let cents: bigint;
    try { cents = toCents(r.total); } catch {
      throw new Error(`The total for account ${r.account_code} is not an exact amount (${String(r.total)}).`);
    }
    return {
      connection_id: r.connection_id, account_code: r.account_code, account_name: r.account_name, plan_line: r.plan_line,
      months: r.months, first_month: r.first_month, last_month: r.last_month, key: accountKey(r.connection_id, r.account_code), cents,
    };
  });
}

export interface MappingSummary {
  /** Accounts with actuals. */
  accounts: number;
  unmapped: number;
  excludedCount: number;
  excludedCents: bigint;
  complete: boolean;
}

/** From the saved mapping (not unsaved edits). `rows` must be the whole list (every page). */
export function summarise(rows: readonly Account[]): MappingSummary {
  let accounts = 0, unmapped = 0, excludedCount = 0, excludedCents = 0n;
  for (const r of rows) {
    if (r.months > 0) accounts++;
    if (r.months > 0 && r.plan_line === null) unmapped++;
    if (r.plan_line === 'excluded') { excludedCount++; excludedCents += r.cents; }
  }
  return { accounts, unmapped, excludedCount, excludedCents, complete: accounts > 0 && unmapped === 0 };
}

/** Unsaved edits grouped by connection, as set_line_map entries (null removes a mapping). */
export function editsByConnection(rows: readonly Account[], edits: ReadonlyMap<string, string | null>): Map<string, { account_code: string; plan_line: string | null }[]> {
  const out = new Map<string, { account_code: string; plan_line: string | null }[]>();
  for (const r of rows) {
    if (!edits.has(r.key)) continue;
    const line = edits.get(r.key) ?? null;
    if (line === r.plan_line) continue;
    const entry = { account_code: r.account_code, plan_line: line };
    const list = out.get(r.connection_id);
    if (list) list.push(entry); else out.set(r.connection_id, [entry]);
  }
  return out;
}
