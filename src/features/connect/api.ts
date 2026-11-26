// Data access for Connect (CSV import, step 1B) and the account mapping (step 1C). Everything goes
// through src/lib/db.ts under row security; every error is thrown to the caller. Lists that can be
// long (accounts) are read a page at a time until a short page (docs/ui-rules.md section 1).
import { assertComplete, db, DbError, must, pageAll, page } from '../../lib/db';
import { toCents, type CashRow, type PayloadRow, type Period } from '../../engine';

/** What a file holds: P&L movements (fpa.import_actuals) or month-end balances (fpa.import_balances, 0004). */
export type ImportKind = 'actuals' | 'balances';

export interface Connection {
  id: string;
  source_type: 'ledgrly' | 'accounting_package' | 'mcp' | 'csv';
  status: 'pending' | 'active' | 'error' | 'disabled';
  last_synced_at: string | null;
  actuals_through: Period | null;
  created_at: string;
}
const CONNECTION_COLUMNS = 'id,source_type,status,last_synced_at,actuals_through,created_at';
/** An entity has a handful of connections; 100 is far above any real list. */
const CONNECTION_LIST = 100;

export async function listConnections(entityId: string): Promise<Connection[]> {
  const [from, to] = page(0, CONNECTION_LIST);
  const rows = await must(
    db().from('connections').select(CONNECTION_COLUMNS).eq('entity_id', entityId)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to),
    'list connections',
  );
  return assertComplete(rows as Connection[], CONNECTION_LIST, 'list connections');
}

/** Adds a CSV connection (owners only; row security refuses anyone else). */
export async function addCsvConnection(entityId: string): Promise<Connection> {
  const row = await must(
    db().from('connections').insert({ entity_id: entityId, source_type: 'csv' }).select(CONNECTION_COLUMNS).single(),
    'add the CSV connection',
  );
  return row as unknown as Connection;
}

/** The month the financial year starts (1 to 12), from the entity's first plan. */
export async function fiscalYearStartMonth(entityId: string): Promise<number> {
  const rows = await must(
    db().from('plans').select('fiscal_year_start').eq('entity_id', entityId)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(0, 0),
    'load the plan',
  );
  const m = (rows as { fiscal_year_start: number }[])[0]?.fiscal_year_start;
  if (m === undefined || !Number.isInteger(m) || m < 1 || m > 12) throw new DbError('load the plan', { message: 'this entity has no plan with a financial year start' });
  return m;
}

export interface SyncRun {
  id: string;
  source_name: string;
  months_replaced: Period[];
  rows_removed: number;
  rows_added: number;
  status: 'succeeded' | 'failed';
  created_at: string;
  kind: ImportKind;
}
const RUN_COLUMNS = 'id,source_name,months_replaced,rows_removed,rows_added,status,created_at,kind';

/** The latest imports into a connection, newest first (an explicit, labelled page of 10), P&L and balances. */
export async function recentImports(connectionId: string, count = 10): Promise<SyncRun[]> {
  const [from, to] = page(0, count);
  const rows = await must(
    db().from('sync_runs').select(RUN_COLUMNS).eq('connection_id', connectionId)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to),
    'list recent imports',
  );
  return rows as SyncRun[];
}

/** Every month already imported into a connection for one kind of file (from its whole import log, paged). */
export async function importedMonths(connectionId: string, kind: ImportKind = 'actuals'): Promise<Set<Period>> {
  const runs = await pageAll<{ months_replaced: Period[]; status: string }>(
    (from, to) => db().from('sync_runs').select('months_replaced,status').eq('connection_id', connectionId).eq('kind', kind)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to),
    'read the import log',
  );
  const out = new Set<Period>();
  for (const r of runs) if (r.status === 'succeeded') for (const m of r.months_replaced) out.add(m);
  return out;
}

export interface ImportResult {
  sync_run_id: string;
  months_replaced: Period[];
  rows_removed: number;
  rows_added: number;
  actuals_through: Period;
  last_synced_at: string;
}

/**
 * Sends the checked rows to fpa.import_actuals: one transaction that replaces every month in the
 * file for this connection, or changes nothing. A result without the expected fields is an error.
 */
export async function importActuals(entityId: string, connectionId: string, rows: PayloadRow[], sourceName: string): Promise<ImportResult> {
  const res = await must(
    db().rpc('import_actuals', { p_entity_id: entityId, p_connection_id: connectionId, p_rows: rows, p_source_name: sourceName }),
    'import actuals',
  );
  const r = res as Partial<ImportResult> | null;
  if (!r || typeof r.sync_run_id !== 'string' || !Array.isArray(r.months_replaced) || typeof r.rows_added !== 'number' || typeof r.rows_removed !== 'number') {
    throw new DbError('import actuals', { message: 'the database did not confirm the import' });
  }
  return r as ImportResult;
}

export interface BalanceImportResult {
  sync_run_id: string;
  months_replaced: Period[];
  rows_removed: number;
  rows_added: number;
  balances_through: Period;
  imported_at: string;
}

/**
 * Sends checked month-end balances to fpa.import_balances (0004): one transaction that replaces every
 * month in the file for this connection, or changes nothing. Rows use the same shape as actuals
 * (amount = the closing balance, trial-balance sign).
 */
export async function importBalances(entityId: string, connectionId: string, rows: PayloadRow[], sourceName: string): Promise<BalanceImportResult> {
  const res = await must(
    db().rpc('import_balances', { p_entity_id: entityId, p_connection_id: connectionId, p_rows: rows, p_source_name: sourceName }),
    'import balances',
  );
  const r = res as Partial<BalanceImportResult> | null;
  if (!r || typeof r.sync_run_id !== 'string' || !Array.isArray(r.months_replaced) || typeof r.rows_added !== 'number' || typeof r.rows_removed !== 'number') {
    throw new DbError('import balances', { message: 'the database did not confirm the import' });
  }
  return r as BalanceImportResult;
}

// ── Mapping ─────────────────────────────────────────────────────────────────────────────────

export interface PlanLineDef {
  key: string;
  label: string;
  kind: 'income' | 'cost' | 'calculated' | 'unmapped' | 'excluded' | 'balance';
  sort_order: number;
  display_sign: 1 | -1;
  mappable: boolean;
}

export async function listPlanLineDefs(): Promise<PlanLineDef[]> {
  const [from, to] = page(0, 100);
  const rows = await must(
    db().from('plan_line_defs').select('key,label,kind,sort_order,display_sign,mappable').order('sort_order', { ascending: true }).range(from, to),
    'load the plan lines',
  );
  return assertComplete(rows as PlanLineDef[], 100, 'load the plan lines');
}

export interface AccountRow {
  connection_id: string;
  account_code: string;
  account_name: string | null;
  plan_line: string | null;
  months: number;
  first_month: Period | null;
  last_month: Period | null;
  /** Net total of all months, trial-balance sign (debit positive). Number or exact text. */
  total: number | string;
}

/** Every account of the entity, unmapped first, read a page at a time (ui-rules 1). */
export function accountMap(entityId: string): Promise<AccountRow[]> {
  return pageAll<AccountRow>((from, to) => db().rpc('account_map', { p_entity_id: entityId }).range(from, to), 'load the accounts');
}

export interface UnmappedRow {
  connection_id: string;
  account_code: string;
  account_name: string | null;
  months: number;
  last_month: Period | null;
  total: number | string;
}

/** Accounts with actuals but no plan line, read a page at a time (ui-rules 1). */
export function unmappedAccounts(entityId: string): Promise<UnmappedRow[]> {
  return pageAll<UnmappedRow>((from, to) => db().rpc('unmapped_accounts', { p_entity_id: entityId }).range(from, to), 'load the unmapped accounts');
}

export interface BalanceAccountRow {
  connection_id: string;
  account_code: string;
  account_name: string | null;
  plan_line: string | null;
  months: number;
  first_month: Period | null;
  last_month: Period | null;
  /** The latest closing balance, trial-balance sign. Number or exact text. */
  last_balance: number | string;
}

/** Every account with balances (fpa.balance_accounts), unmapped first, read a page at a time. */
export function balanceAccounts(entityId: string): Promise<BalanceAccountRow[]> {
  return pageAll<BalanceAccountRow>((from, to) => db().rpc('balance_accounts', { p_entity_id: entityId }).range(from, to), 'load the balance accounts');
}

interface CashPositionRow {
  latest_month: Period; months_available: number; unmapped_accounts: number; cash_accounts: number;
  month: Period; has_balances: boolean; cash: number | string | null;
}

/** fpa.cash_position (0004): the latest month with balances and the four before it (none if no balances). */
export async function cashPosition(entityId: string): Promise<CashRow[]> {
  const rows = await pageAll<CashPositionRow>((from, to) => db().rpc('cash_position', { p_entity_id: entityId }).range(from, to), 'load the cash position');
  if (rows.length > 5) throw new DbError('load the cash position', { message: `expected at most 5 months, got ${rows.length}` });
  return rows.map(r => ({
    latestMonth: r.latest_month, monthsAvailable: r.months_available, unmappedAccounts: r.unmapped_accounts, cashAccounts: r.cash_accounts,
    month: r.month, hasBalances: r.has_balances, cash: r.cash === null ? null : toCents(r.cash),
  }));
}

/** Saves mappings for one connection in one transaction. plan_line null removes a mapping. */
export async function setLineMap(connectionId: string, entries: { account_code: string; plan_line: string | null }[]): Promise<number> {
  const n = await must(db().rpc('set_line_map', { p_connection_id: connectionId, p_entries: entries }), 'save the mapping');
  if (typeof n !== 'number') throw new DbError('save the mapping', { message: 'the database did not confirm the change' });
  return n;
}
