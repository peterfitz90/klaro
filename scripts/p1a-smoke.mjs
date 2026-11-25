// P1-A smoke test after applying 0003: anonymous-key calls to every new fpa function must be refused.
// Keys come from the environment (K_ANON, K_PUB) and are never printed. Calls carry valid-looking
// arguments so a refusal is about access, not input. Nothing here can change data: anon has no
// USAGE on fpa, and every call is expected to fail before it runs.
//   K_ANON=... K_PUB=... node scripts/p1a-smoke.mjs
const U = 'https://ihrbvnpwdxdppsnqlsfb.supabase.co';
const KEYS = [['legacy anon key', process.env.K_ANON], ['publishable key', process.env.K_PUB]];
const Z = '00000000-0000-4000-8000-000000000000';
const calls = [
  ['import_actuals', { p_entity_id: Z, p_connection_id: Z, p_rows: [{ account_code: '4000', month: '2025-01-01', amount: '1.00' }], p_source_name: 'smoke.csv' }],
  ['set_line_map', { p_connection_id: Z, p_entries: [{ account_code: '4000', plan_line: 'revenue' }] }],
  ['account_map', { p_entity_id: Z }],
  ['unmapped_accounts', { p_entity_id: Z }],
  ['variance', { p_entity_id: Z, p_version_id: null, p_from: '2025-01-01', p_to: '2025-01-01' }],
  ['create_budget_from_actuals', { p_plan_id: Z, p_version_id: null, p_name: 'smoke', p_actuals_from: '2024-01-01', p_budget_from: '2025-01-01', p_uplifts: {} }],
  ['my_entity_ids', { p_min_role: 'viewer' }],
];
let refused = 0, total = 0;
for (const [kname, key] of KEYS) {
  if (!key) throw new Error('missing key');
  console.log(`\n=== ${kname} ===`);
  for (const [fn, body] of calls) {
    const h = { apikey: key, 'Content-Profile': 'fpa', 'Content-Type': 'application/json' };
    if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`;
    const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: h, body: JSON.stringify(body) });
    const t = await r.text();
    total++;
    const ok = r.status === 401 || r.status === 403;
    if (ok) refused++;
    console.log(`POST /rest/v1/rpc/${fn} [Content-Profile: fpa] -> ${r.status} ${ok ? 'REFUSED' : 'NOT REFUSED'}\n   ${t.slice(0, 300)}`);
  }
}
// Control: the public schema still answers the anonymous key as before (status only).
const r = await fetch(`${U}/rest/v1/companies?select=id&limit=1`, { headers: { apikey: process.env.K_PUB, 'Accept-Profile': 'public' } });
console.log(`\nControl: GET public companies with the publishable key -> ${r.status} (${(await r.text()).length} bytes)`);
console.log(`\n${refused} of ${total} anonymous calls refused`);
