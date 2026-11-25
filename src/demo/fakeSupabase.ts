// DEMO ONLY (npm run dev:demo). Stands in for @supabase/supabase-js with two made-up entities held
// in memory. Creating an entity, adding a CSV connection, importing and mapping all work until the
// page reloads; "Fail" in an entity name returns the database's cap error so the error path can be
// seen. Nothing leaves the browser. The import and mapping here are much simpler than the real
// functions (no checks): they exist only to look at the screens.
type Row = { id: string; name: string; jurisdiction: string; currency: string };
type Res = { data: unknown; error: { code: string; message: string } | null };
type Actual = { connection_id: string; entity_id: string; account_code: string; account_name: string | null; period: string; amount: number };

const entities: Row[] = [
  { id: '0b483fe4-e952-4170-83b5-a79b911b8023', name: 'Demo Trading Ltd', jurisdiction: 'IE', currency: 'EUR' },
  { id: '11111111-2222-4333-8444-555555555555', name: 'Demo Services UK', jurisdiction: 'UK', currency: 'GBP' },
];
const connections: Record<string, unknown>[] = [];
const syncRuns: Record<string, unknown>[] = [];
const actuals: Actual[] = [];
const lineMap = new Map<string, string>();   // `${connection}|${code}` -> plan line
const DEFS = [
  ['revenue', 'Revenue', 'income', 10, -1], ['cost_of_sales', 'Cost of sales', 'cost', 20, 1], ['gross_profit', 'Gross profit', 'calculated', 30, -1],
  ['payroll', 'Payroll', 'cost', 40, 1], ['marketing', 'Marketing', 'cost', 50, 1], ['premises', 'Rent and premises', 'cost', 60, 1],
  ['other_operating', 'Other operating costs', 'cost', 70, 1], ['operating_profit', 'Operating profit', 'calculated', 80, -1],
  ['interest', 'Interest', 'cost', 90, 1], ['tax', 'Tax', 'cost', 100, 1], ['net_profit', 'Net profit', 'calculated', 110, -1],
  ['unmapped', 'Unmapped', 'unmapped', 120, 1], ['excluded', 'Not in the P&L (excluded)', 'excluded', 130, 1],
].map(([key, label, kind, sort_order, display_sign]) => ({ key, label, kind, sort_order, display_sign, mappable: ['income', 'cost', 'excluded'].includes(kind as string) }));

const banner = document.createElement('div');
banner.textContent = 'DEMO: fake sign-in and made-up data. Nothing here is saved or real.';
banner.setAttribute('role', 'note');
banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99;padding:6px 12px;text-align:center;font:600 12px Inter,sans-serif;background:#fbbf24;color:#0c1210';
document.body.appendChild(banner);
document.body.style.paddingBottom = '32px';

const ok = (data: unknown): Res => ({ data, error: null });
const slice = (rows: unknown[], r: [number, number] | null) => (r ? rows.slice(r[0], r[1] + 1) : rows);

function query(table: string) {
  const filters: Record<string, unknown> = {};
  let single = false;
  let range: [number, number] | null = null;
  let inserted: Record<string, unknown> | null = null;
  const b = {
    select: () => b, order: () => b,
    range: (from: number, to: number) => { range = [from, to]; return b; },
    eq: (col: string, v: unknown) => { filters[col] = v; return b; },
    maybeSingle: () => { single = true; return b; },
    single: () => { single = true; return b; },
    insert: (row: Record<string, unknown>) => {
      inserted = { id: crypto.randomUUID(), status: 'pending', last_synced_at: null, actuals_through: null, created_at: new Date().toISOString(), ...row };
      connections.push(inserted);
      return b;
    },
    then: (resolve: (r: Res) => unknown, reject?: (e: unknown) => unknown) => {
      let data: unknown;
      if (inserted) data = inserted;
      else if (table === 'entities') {
        const rows = [...entities].sort((a, c) => a.name.localeCompare(c.name));
        data = single ? rows.find(r => r.id === filters.id) ?? null : rows;
      } else if (table === 'entity_members') {
        data = entities.some(e => e.id === filters.entity_id) ? { role: 'owner' } : null;
      } else if (table === 'connections') {
        data = connections.filter(c => c.entity_id === filters.entity_id);
      } else if (table === 'plans') {
        data = [{ fiscal_year_start: 1 }];
      } else if (table === 'plan_line_defs') {
        data = DEFS;
      } else if (table === 'sync_runs') {
        data = slice(syncRuns.filter(r => r.connection_id === filters.connection_id).reverse(), range);
      } else {
        data = [];
      }
      return Promise.resolve(ok(data)).then(resolve, reject);
    },
  };
  return b;
}

function accountMap(entityId: string) {
  const byKey = new Map<string, { connection_id: string; account_code: string; account_name: string | null; months: number; first_month: string; last_month: string; total: number }>();
  for (const a of actuals.filter(x => x.entity_id === entityId)) {
    const k = `${a.connection_id}|${a.account_code}`;
    const r = byKey.get(k) ?? { connection_id: a.connection_id, account_code: a.account_code, account_name: a.account_name, months: 0, first_month: a.period, last_month: a.period, total: 0 };
    r.months++; r.total = Math.round((r.total + a.amount) * 100) / 100;
    if (a.period < r.first_month) r.first_month = a.period;
    if (a.period > r.last_month) r.last_month = a.period;
    byKey.set(k, r);
  }
  return [...byKey.values()].map(r => ({ ...r, plan_line: lineMap.get(`${r.connection_id}|${r.account_code}`) ?? null, total: r.total.toFixed(2) }))
    .sort((a, b) => Number(a.plan_line !== null) - Number(b.plan_line !== null) || a.account_code.localeCompare(b.account_code));
}

function rpc(fn: string, args: Record<string, unknown>) {
  let range: [number, number] | null = null;
  const run = async (): Promise<Res> => {
    if (fn === 'create_entity') {
      if (/fail/i.test(String(args.p_name))) return { data: null, error: { code: 'PT429', message: 'You already own 10 entities, which is the most allowed.' } };
      const id = crypto.randomUUID();
      entities.push({ id, name: String(args.p_name), jurisdiction: String(args.p_jurisdiction), currency: String(args.p_currency) });
      return ok(id);
    }
    if (fn === 'import_actuals') {
      await new Promise(r => setTimeout(r, 600));
      const rows = args.p_rows as { account_code: string; account_name?: string; month: string; amount: string }[];
      const conn = String(args.p_connection_id);
      const months = [...new Set(rows.map(r => r.month))].sort();
      const before = actuals.length;
      for (let i = actuals.length - 1; i >= 0; i--) if (actuals[i]?.connection_id === conn && months.includes(actuals[i]?.period ?? '')) actuals.splice(i, 1);
      const removed = before - actuals.length;
      for (const r of rows) actuals.push({ connection_id: conn, entity_id: String(args.p_entity_id), account_code: r.account_code, account_name: r.account_name ?? null, period: r.month, amount: Number(r.amount) });
      const through = actuals.filter(a => a.connection_id === conn).map(a => a.period).sort().pop();
      const now = new Date().toISOString();
      const c = connections.find(x => x.id === conn);
      if (c) Object.assign(c, { status: 'active', actuals_through: through, last_synced_at: now });
      const run = { id: crypto.randomUUID(), connection_id: conn, source_name: args.p_source_name, months_replaced: months, rows_removed: removed, rows_added: rows.length, status: 'succeeded', created_at: now };
      syncRuns.push(run);
      return ok({ sync_run_id: run.id, months_replaced: months, rows_removed: removed, rows_added: rows.length, actuals_through: through, last_synced_at: now });
    }
    if (fn === 'account_map') return ok(slice(accountMap(String(args.p_entity_id)), range));
    if (fn === 'unmapped_accounts') return ok(slice(accountMap(String(args.p_entity_id)).filter(r => r.plan_line === null), range));
    if (fn === 'set_line_map') {
      const entries = args.p_entries as { account_code: string; plan_line: string | null }[];
      for (const e of entries) {
        const k = `${String(args.p_connection_id)}|${e.account_code}`;
        if (e.plan_line) lineMap.set(k, e.plan_line); else lineMap.delete(k);
      }
      return ok(entries.length);
    }
    return { data: null, error: { code: '42883', message: `demo: no function ${fn}` } };
  };
  const b = {
    range: (from: number, to: number) => { range = [from, to]; return b; },
    then: (resolve: (r: Res) => unknown, reject?: (e: unknown) => unknown) => run().then(resolve, reject),
  };
  return b;
}

export function createClient() {
  return {
    from: (table: string) => query(table),
    rpc: (fn: string, args: Record<string, unknown>) => rpc(fn, args),
  };
}
