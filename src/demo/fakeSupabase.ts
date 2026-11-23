// DEMO ONLY (npm run dev:demo). Stands in for @supabase/supabase-js with two made-up entities held
// in memory. Creating an entity works until the page reloads; "Fail" in a name returns the
// database's cap error so the error path can be seen. Nothing leaves the browser.
type Row = { id: string; name: string; jurisdiction: string; currency: string };
type Res = { data: unknown; error: { code: string; message: string } | null };

const entities: Row[] = [
  { id: '0b483fe4-e952-4170-83b5-a79b911b8023', name: 'Demo Trading Ltd', jurisdiction: 'IE', currency: 'EUR' },
  { id: '11111111-2222-4333-8444-555555555555', name: 'Demo Services UK', jurisdiction: 'UK', currency: 'GBP' },
];

const banner = document.createElement('div');
banner.textContent = 'DEMO: fake sign-in and made-up data. Nothing here is saved or real.';
banner.setAttribute('role', 'note');
banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99;padding:6px 12px;text-align:center;font:600 12px Inter,sans-serif;background:#fbbf24;color:#0c1210';
document.body.appendChild(banner);
document.body.style.paddingBottom = '32px';

function query(table: string) {
  const filters: Record<string, unknown> = {};
  let single = false;
  const b = {
    select: () => b, order: () => b, range: () => b,
    eq: (col: string, v: unknown) => { filters[col] = v; return b; },
    maybeSingle: () => { single = true; return b; },
    then: (ok: (r: Res) => unknown, fail?: (e: unknown) => unknown) => {
      let data: unknown;
      if (table === 'entities') {
        const rows = [...entities].sort((a, c) => a.name.localeCompare(c.name));
        data = single ? rows.find(r => r.id === filters.id) ?? null : rows;
      } else if (table === 'entity_members') {
        data = entities.some(e => e.id === filters.entity_id) ? { role: 'owner' } : null;
      } else {
        data = [];
      }
      return Promise.resolve<Res>({ data, error: null }).then(ok, fail);
    },
  };
  return b;
}

export function createClient() {
  return {
    from: (table: string) => query(table),
    rpc: async (_fn: string, args: { p_name: string; p_jurisdiction: string; p_currency: string }): Promise<Res> => {
      if (/fail/i.test(args.p_name)) return { data: null, error: { code: 'PT429', message: 'You already own 10 entities, which is the most allowed.' } };
      const id = crypto.randomUUID();
      entities.push({ id, name: args.p_name, jurisdiction: args.p_jurisdiction, currency: args.p_currency });
      return { data: id, error: null };
    },
  };
}
