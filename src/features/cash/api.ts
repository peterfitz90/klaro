// Data for the Cash page's history (docs/reports/P4-0.md): no new database function. Under the user's
// own row security it reads which accounts are Cash and bank (fpa.balance_accounts), which months
// have balances (the balances import log), and the closing balances of only those cash accounts for
// the last 12 of those months (fpa.balances_monthly, a page at a time). Sums are in src/engine.
import { toCents, type BalanceRow, type Period } from '../../engine';
import { db, pageAll } from '../../lib/db';
import { balanceAccounts, importedMonths, listConnections } from '../connect/api';

export interface CashHistoryData { months: Period[]; rows: BalanceRow[]; cashKeys: Set<string> }

export async function cashHistoryData(entityId: string, count = 12): Promise<CashHistoryData> {
  const [accounts, connections] = await Promise.all([balanceAccounts(entityId), listConnections(entityId)]);
  const cash = accounts.filter(a => a.plan_line === 'cash_bank');
  const cashKeys = new Set(cash.map(a => `${a.connection_id}|${a.account_code}`));
  const monthSets = await Promise.all(connections.filter(c => c.source_type === 'csv').map(c => importedMonths(c.id, 'balances')));
  const months = [...new Set(monthSets.flatMap(s => [...s]))].sort().slice(-count);
  const from = months[0];
  const rows: BalanceRow[] = [];
  if (from) {
    const byConnection = new Map<string, string[]>();
    for (const a of cash) byConnection.set(a.connection_id, [...(byConnection.get(a.connection_id) ?? []), a.account_code]);
    for (const [connectionId, codes] of byConnection) {
      const got = await pageAll<{ connection_id: string; account_code: string; period: Period; closing_balance: number | string }>(
        (f, t) => db().from('balances_monthly').select('connection_id,account_code,period,closing_balance')
          .eq('connection_id', connectionId).in('account_code', codes).gte('period', from)
          .order('period', { ascending: true }).order('account_code', { ascending: true }).range(f, t),
        'load the month-end cash',
      );
      for (const r of got) rows.push({ connection_id: r.connection_id, account_code: r.account_code, period: r.period, cents: toCents(r.closing_balance) });
    }
  }
  return { months, rows, cashKeys };
}
