// P2-A smoke test after applying 0004: anonymous-key calls to the four new fpa functions, and reads of
// fpa.balances_monthly, must all be refused. Keys come from the environment (K_ANON, K_PUB) and are
// never printed. Calls carry valid-looking arguments so a refusal is about access, not input. Nothing
// here can change data: anon has no USAGE on fpa, and every call is expected to fail before it runs.
//   K_ANON=... K_PUB=... node scripts/p2a-smoke.mjs
const U = 'https://ihrbvnpwdxdppsnqlsfb.supabase.co';
const KEYS = [['legacy anon key', process.env.K_ANON], ['publishable key', process.env.K_PUB]];
const Z = '00000000-0000-4000-8000-000000000000';
const calls = [
  ['import_balances', { p_entity_id: Z, p_connection_id: Z, p_rows: [{ account_code: '1200', month: '2025-01-01', amount: '1.00' }], p_source_name: 'smoke.csv' }],
  ['balance_accounts', { p_entity_id: Z }],
  ['cash_position', { p_entity_id: Z }],
  ['save_budget_lines', { p_version_id: Z, p_lines: [{ id: Z, amount: '1.00' }] }],
];
let refused = 0, total = 0;
const isRefused = s => s === 401 || s === 403;
for (const [kname, key] of KEYS) {
  if (!key) throw new Error('missing key');
  console.log(`\n=== ${kname} ===`);
  const auth = key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {};
  for (const [fn, body] of calls) {
    const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: key, ...auth, 'Content-Profile': 'fpa', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const t = await r.text();
    total++; if (isRefused(r.status)) refused++;
    console.log(`POST /rest/v1/rpc/${fn} [Content-Profile: fpa] -> ${r.status} ${isRefused(r.status) ? 'REFUSED' : 'NOT REFUSED'}\n   ${t.slice(0, 300)}`);
  }
  for (const [method, extra] of [['GET', {}], ['POST', { 'Content-Type': 'application/json' }]]) {
    const prof = method === 'GET' ? { 'Accept-Profile': 'fpa' } : { 'Content-Profile': 'fpa' };
    const r = await fetch(`${U}/rest/v1/balances_monthly${method === 'GET' ? '?select=id&limit=1' : ''}`, {
      method, headers: { apikey: key, ...auth, ...prof, ...extra },
      body: method === 'POST' ? JSON.stringify({ entity_id: Z, connection_id: Z, account_code: 'x', period: '2025-01-01', closing_balance: 1 }) : undefined });
    const t = await r.text();
    total++; if (isRefused(r.status)) refused++;
    console.log(`${method} /rest/v1/balances_monthly [fpa] -> ${r.status} ${isRefused(r.status) ? 'REFUSED' : 'NOT REFUSED'}\n   ${t.slice(0, 300)}`);
  }
}
// Control: the public schema still answers the anonymous key as before (status only).
const r = await fetch(`${U}/rest/v1/companies?select=id&limit=1`, { headers: { apikey: process.env.K_PUB, 'Accept-Profile': 'public' } });
console.log(`\nControl: GET public companies with the publishable key -> ${r.status} (${(await r.text()).length} bytes)`);
console.log(`\n${refused} of ${total} anonymous calls refused`);
