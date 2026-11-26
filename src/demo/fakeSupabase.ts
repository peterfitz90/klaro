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
// Phase 2: month-end balances (trial-balance sign), for the balances import, mapping and cash tiles.
const balances: Actual[] = [];
const lineMap = new Map<string, string>();   // `${connection}|${code}` -> plan line
type PlanLineRow = { id: string; version_id: string; scenario_id: string; plan_line: string; period: string; amount: string; origin: string };
const versions: Record<string, unknown>[] = [];
const planLines: PlanLineRow[] = [];
const PLAN_ID = 'a0a0a0a0-0000-4000-8000-0000000000a1';
const DEFS = [
  ['revenue', 'Revenue', 'income', 10, -1], ['cost_of_sales', 'Cost of sales', 'cost', 20, 1], ['gross_profit', 'Gross profit', 'calculated', 30, -1],
  ['payroll', 'Payroll', 'cost', 40, 1], ['marketing', 'Marketing', 'cost', 50, 1], ['premises', 'Rent and premises', 'cost', 60, 1],
  ['other_operating', 'Other operating costs', 'cost', 70, 1], ['operating_profit', 'Operating profit', 'calculated', 80, -1],
  ['interest', 'Interest', 'cost', 90, 1], ['tax', 'Tax', 'cost', 100, 1], ['net_profit', 'Net profit', 'calculated', 110, -1],
  ['unmapped', 'Unmapped', 'unmapped', 120, 1], ['excluded', 'Not in the P&L (excluded)', 'excluded', 130, 1],
  ['cash_bank', 'Cash and bank', 'balance', 140, 1],
].map(([key, label, kind, sort_order, display_sign]) => ({ key, label, kind, sort_order, display_sign, mappable: ['income', 'cost', 'excluded', 'balance'].includes(kind as string) }));

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
  const gte: Record<string, string> = {};
  const lte: Record<string, string> = {};
  let single = false;
  let head = false;
  let range: [number, number] | null = null;
  let inserted: Record<string, unknown> | null = null;
  let patch: Record<string, unknown> | null = null;
  const match = (r: Record<string, unknown>) => Object.entries(filters).every(([k, v]) => r[k] === v)
    && Object.entries(gte).every(([k, v]) => String(r[k]) >= v) && Object.entries(lte).every(([k, v]) => String(r[k]) <= v);
  const b = {
    select: (_cols?: string, o?: { head?: boolean }) => { if (o?.head) head = true; return b; },
    order: () => b,
    range: (from: number, to: number) => { range = [from, to]; return b; },
    eq: (col: string, v: unknown) => { filters[col] = v; return b; },
    gte: (col: string, v: string) => { gte[col] = v; return b; },
    lte: (col: string, v: string) => { lte[col] = v; return b; },
    update: (row: Record<string, unknown>) => { patch = row; return b; },
    maybeSingle: () => { single = true; return b; },
    single: () => { single = true; return b; },
    insert: (row: Record<string, unknown>) => {
      inserted = { id: crypto.randomUUID(), status: 'pending', last_synced_at: null, actuals_through: null, created_at: new Date().toISOString(), ...row };
      connections.push(inserted);
      return b;
    },
    then: (resolve: (r: Res & { count?: number }) => unknown, reject?: (e: unknown) => unknown) => {
      let data: unknown;
      if (table === 'plan_versions' || table === 'plan_lines') {
        const rows = (table === 'plan_versions' ? versions : planLines) as Record<string, unknown>[];
        const hits = rows.filter(match);
        if (patch) {
          if (table === 'plan_versions' && 'locked_at' in patch) {
            for (const h of hits) Object.assign(h, { locked_at: patch.locked_at ? new Date().toISOString() : null, unlocked_at: patch.locked_at ? h.unlocked_at : new Date().toISOString() });
          } else for (const h of hits) Object.assign(h, patch);
          return Promise.resolve(ok(single ? hits[0] ?? null : hits)).then(resolve, reject);
        }
        if (head) return Promise.resolve({ data: null, error: null, count: hits.length }).then(resolve, reject);
        return Promise.resolve(ok(slice(hits, range))).then(resolve, reject);
      }
      if (table === 'scenarios') {
        return Promise.resolve(ok(versions.some(v => v.id === filters.version_id) ? [{ id: `scn-${String(filters.version_id)}` }] : [])).then(resolve, reject);
      }
      if (inserted) data = inserted;
      else if (table === 'entities') {
        const rows = [...entities].sort((a, c) => a.name.localeCompare(c.name));
        data = single ? rows.find(r => r.id === filters.id) ?? null : rows;
      } else if (table === 'entity_members') {
        data = entities.some(e => e.id === filters.entity_id) ? { role: 'owner' } : null;
      } else if (table === 'connections') {
        data = connections.filter(c => c.entity_id === filters.entity_id);
      } else if (table === 'plans') {
        data = [{ id: PLAN_ID, name: 'Main plan', fiscal_year_start: 1 }];
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
      const run = { id: crypto.randomUUID(), connection_id: conn, source_name: args.p_source_name, months_replaced: months, rows_removed: removed, rows_added: rows.length, status: 'succeeded', created_at: now, kind: 'actuals' };
      syncRuns.push(run);
      return ok({ sync_run_id: run.id, months_replaced: months, rows_removed: removed, rows_added: rows.length, actuals_through: through, last_synced_at: now });
    }
    if (fn === 'import_balances') {
      await new Promise(r => setTimeout(r, 400));
      const rows = args.p_rows as { account_code: string; account_name?: string; month: string; amount: string }[];
      const conn = String(args.p_connection_id);
      const months = [...new Set(rows.map(r => r.month))].sort();
      const before = balances.length;
      for (let i = balances.length - 1; i >= 0; i--) if (balances[i]?.connection_id === conn && months.includes(balances[i]?.period ?? '')) balances.splice(i, 1);
      const removed = before - balances.length;
      for (const r of rows) balances.push({ connection_id: conn, entity_id: String(args.p_entity_id), account_code: r.account_code, account_name: r.account_name ?? null, period: r.month, amount: Number(r.amount) });
      const through = balances.filter(a => a.connection_id === conn).map(a => a.period).sort().pop();
      const now = new Date().toISOString();
      const run = { id: crypto.randomUUID(), connection_id: conn, source_name: args.p_source_name, months_replaced: months, rows_removed: removed, rows_added: rows.length, status: 'succeeded', created_at: now, kind: 'balances' };
      syncRuns.push(run);
      return ok({ sync_run_id: run.id, months_replaced: months, rows_removed: removed, rows_added: rows.length, balances_through: through, imported_at: now });
    }
    if (fn === 'balance_accounts') {
      const byKey = new Map<string, { connection_id: string; account_code: string; account_name: string | null; months: number; first_month: string; last_month: string; last_balance: string }>();
      for (const b of balances.filter(x => x.entity_id === String(args.p_entity_id))) {
        const k = `${b.connection_id}|${b.account_code}`;
        const r = byKey.get(k) ?? { connection_id: b.connection_id, account_code: b.account_code, account_name: b.account_name, months: 0, first_month: b.period, last_month: b.period, last_balance: b.amount.toFixed(2) };
        r.months++;
        if (b.period < r.first_month) r.first_month = b.period;
        if (b.period >= r.last_month) { r.last_month = b.period; r.last_balance = b.amount.toFixed(2); }
        byKey.set(k, r);
      }
      const out = [...byKey.values()].map(r => ({ ...r, plan_line: lineMap.get(`${r.connection_id}|${r.account_code}`) ?? null }))
        .sort((a, b) => Number(a.plan_line !== null) - Number(b.plan_line !== null) || a.account_code.localeCompare(b.account_code));
      return ok(slice(out, range));
    }
    if (fn === 'cash_position') {
      const mine = balances.filter(x => x.entity_id === String(args.p_entity_id));
      if (mine.length === 0) return ok([]);
      const latest = mine.map(b => b.period).sort().pop() ?? '';
      const withMonths = new Set(mine.map(b => b.period));
      const isCash = (b: Actual) => lineMap.get(`${b.connection_id}|${b.account_code}`) === 'cash_bank';
      const atLatest = mine.filter(b => b.period === latest);
      const unmapped = atLatest.filter(b => !lineMap.has(`${b.connection_id}|${b.account_code}`)).length;
      const cashAccounts = atLatest.filter(isCash).length;
      const out = Array.from({ length: 5 }, (_, k) => addM(latest, -k)).map(p => ({
        latest_month: latest, months_available: withMonths.size, unmapped_accounts: unmapped, cash_accounts: cashAccounts, month: p,
        has_balances: withMonths.has(p),
        cash: withMonths.has(p) ? mine.filter(b => b.period === p && isCash(b)).reduce((t, b) => t + Math.round(b.amount * 100), 0) / 100 : null,
      })).map(r => ({ ...r, cash: r.cash === null ? null : r.cash.toFixed(2) }));
      return ok(slice(out, range));
    }
    if (fn === 'save_budget_lines') {
      const v = versions.find(x => x.id === args.p_version_id);
      if (v?.locked_at) return { data: null, error: { code: 'PT423', message: 'This version is locked. Unlock it first.' } };
      const lines = args.p_lines as { id: string; amount: string }[];
      if (lines.some(l => !planLines.find(p => p.id === l.id && p.version_id === args.p_version_id))) return { data: null, error: { code: 'PT400', message: 'Line 1: that line is not a budget line of this version.' } };
      for (const l of lines) { const p = planLines.find(x => x.id === l.id); if (p) { p.amount = l.amount; p.origin = 'manual'; } }
      return ok(lines.length);
    }
    if (fn === 'account_map') return ok(slice(accountMap(String(args.p_entity_id)), range));
    if (fn === 'variance') return ok(slice(demoVariance(String(args.p_entity_id), (args.p_version_id as string | null) ?? null, String(args.p_from), String(args.p_to)), range));
    if (fn === 'create_budget_from_actuals') {
      await new Promise(r => setTimeout(r, 400));
      let id = args.p_version_id as string | null;
      if (id && versions.find(v => v.id === id)?.locked_at) return { data: null, error: { code: 'PT423', message: 'This version is locked. Unlock it first.' } };
      if (!id) {
        id = crypto.randomUUID();
        versions.push({ id, plan_id: PLAN_ID, name: String(args.p_name), kind: 'budget', locked_at: null, unlocked_at: null, created_at: new Date().toISOString() });
      }
      const from = String(args.p_actuals_from), bFrom = String(args.p_budget_from);
      const ups = (args.p_uplifts ?? {}) as Record<string, string>;
      const budgetMonths = Array.from({ length: 12 }, (_, k) => addM(bFrom, k));
      for (let i = planLines.length - 1; i >= 0; i--) if (planLines[i]?.version_id === id && budgetMonths.includes(planLines[i]?.period ?? '')) planLines.splice(i, 1);
      for (const d of DEFS.filter(x => x.kind === 'income' || x.kind === 'cost')) {
        for (let k = 0; k < 12; k++) {
          const src = addM(from, k);
          const sum = actuals.filter(a => a.period === src && lineMap.get(`${a.connection_id}|${a.account_code}`) === d.key).reduce((t, a) => t + a.amount, 0);
          const amt = sum * (1 + Number(ups[d.key as string] ?? 0) / 100);
          planLines.push({ id: crypto.randomUUID(), version_id: id, scenario_id: `scn-${id}`, plan_line: String(d.key), period: budgetMonths[k] ?? '', amount: amt.toFixed(2), origin: 'from_actuals' });
        }
      }
      return ok(id);
    }
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

function addM(p: string, n: number): string {
  const y = Number(p.slice(0, 4)), m = Number(p.slice(5, 7)) - 1 + n;
  return `${y + Math.floor(m / 12)}-${String((m % 12 + 12) % 12 + 1).padStart(2, '0')}-01`;
}

/** A simplified fpa.variance for the demo: display sign, calculated lines, NULL where no data. */
function demoVariance(entityId: string, versionId: string | null, from: string, to: string) {
  const out: Record<string, unknown>[] = [];
  const mapped = (a: Actual) => lineMap.get(`${a.connection_id}|${a.account_code}`) ?? 'unmapped';
  for (let p = from; p <= to; p = addM(p, 1)) {
    const acts = actuals.filter(a => a.entity_id === entityId && a.period === p);
    const buds = planLines.filter(l => l.version_id === versionId && l.period === p);
    const a = (k: string) => acts.filter(x => mapped(x) === k).reduce((t, x) => t + x.amount, 0);
    const bu = (k: string) => buds.filter(x => x.plan_line === k).reduce((t, x) => t + Number(x.amount), 0);
    for (const d of DEFS.filter(x => x.kind !== 'excluded' && x.kind !== 'balance')) {
      const parts = d.kind === 'calculated' ? DEFS.filter(x => (x.kind === 'income' || x.kind === 'cost') && (x.sort_order as number) < (d.sort_order as number)).map(x => String(x.key)) : [String(d.key)];
      const sign = d.display_sign as number;
      const av = acts.length ? sign * parts.reduce((t, k) => t + a(k), 0) : null;
      const bv = buds.length ? sign * parts.reduce((t, k) => t + bu(k), 0) : null;
      const v = av !== null && bv !== null ? av - bv : null;
      out.push({
        line_key: d.key, line_label: d.label, line_kind: d.kind, line_order: d.sort_order, month: p,
        actual: av === null ? null : av.toFixed(2), budget: bv === null ? null : bv.toFixed(2), variance: v === null ? null : v.toFixed(2),
        variance_pct: v !== null && bv ? String(v / Math.abs(bv) * 100) : null,
        favourable: v === null ? null : d.kind === 'cost' ? v <= 0 : d.kind === 'unmapped' ? null : v >= 0,
      });
    }
  }
  return out;
}

export function createClient() {
  return {
    from: (table: string) => query(table),
    rpc: (fn: string, args: Record<string, unknown>) => rpc(fn, args),
  };
}
