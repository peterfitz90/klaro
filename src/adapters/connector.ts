// The connector interface for data sources (Phase 1). Empty in Phase 0: nothing implements it and
// nothing reads Ledgrly. A connector returns monthly balances per source account; the sync that
// writes them into fpa.actuals_monthly runs server-side through a function, never from the browser.
import type { Period } from '../engine/period';

export type SourceType = 'ledgrly' | 'accounting_package' | 'mcp' | 'csv';

export interface SourceAccount {
  code: string;
  name: string;
}

export interface MonthlyBalance {
  accountCode: string;
  period: Period;
  /** Net movement for the month in the entity's currency, as exact text ("1234.50"). */
  amount: string;
}

export interface Connector {
  readonly sourceType: SourceType;
  listAccounts(): Promise<SourceAccount[]>;
  /** Every month from `from` to `through` inclusive; must page internally and never truncate. */
  monthlyBalances(from: Period, through: Period): Promise<MonthlyBalance[]>;
}
