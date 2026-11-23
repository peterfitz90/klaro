// B3 smoke test: read-only anon requests (plus one refused RPC call). Keys come from env; never printed.
import { createHash } from 'node:crypto';
const U = 'https://ihrbvnpwdxdppsnqlsfb.supabase.co';
const KEYS = [['legacy anon key', process.env.K_ANON], ['publishable key', process.env.K_PUB]];
const FPA_NAMES = ['actuals_monthly','connections','driver_values','drivers','entities','entity_members','line_map','packs','plan_lines','plan_versions','plans','scenarios','schema_migrations','vat_rules','create_entity','add_member','set_member','is_entity_member','member_for','guard_locked','fpa.'];
const cases = [
  ['F1','fpa','GET','/rest/v1/entities?select=*'],
  ['F2','fpa','GET','/rest/v1/schema_migrations?select=*'],
  ['F3','fpa','GET','/rest/v1/vat_rules?select=*'],
  ['F4','fpa','GET','/rest/v1/plan_versions?select=id,locked_by'],
  ['F5','fpa','GET','/rest/v1/entitie?select=*'],            // misspelt: must not hint a real table name
  ['F6','fpa','GET','/rest/v1/'],                            // OpenAPI root for fpa: must list no table
  ['F7','fpa','POST','/rest/v1/rpc/create_entity', {p_name:'smoke',p_jurisdiction:'IE',p_currency:'EUR'}],
  ['F8','fpa','HEAD','/rest/v1/entities?select=*'],
  ['P1','public','GET','/rest/v1/companies?select=id&limit=1'],
  ['P2','public','GET','/rest/v1/chart_of_accounts?select=id&limit=1'],
  ['P3',null,'GET','/rest/v1/companies?select=id&limit=1'],  // no profile header = default schema
  ['P4','public','GET','/rest/v1/'],
];
for (const [kname, key] of KEYS) {
  if (!key) throw new Error('missing key');
  console.log(`\n=== ${kname} ===`);
  for (const [id, prof, method, path, body] of cases) {
    const h = { apikey: key };
    if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`;
    if (prof) h[method === 'GET' || method === 'HEAD' ? 'Accept-Profile' : 'Content-Profile'] = prof;
    if (body) h['Content-Type'] = 'application/json';
    const r = await fetch(U + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const t = method === 'HEAD' ? '' : await r.text();
    const hdr = ['content-range','content-profile','proxy-status'].map(n => r.headers.get(n) ? `${n}: ${r.headers.get(n)}` : null).filter(Boolean).join('; ');
    const leaks = FPA_NAMES.filter(n => t.includes(n));
    const isPublicRoot = id === 'P4';
    let shown = t;
    if (isPublicRoot || t.length > 600) {
      let paths = '?'; try { paths = Object.keys(JSON.parse(t).paths ?? {}).length; } catch {}
      shown = `(${t.length} bytes, sha256 ${createHash('sha256').update(t).digest('hex').slice(0,16)}, OpenAPI paths: ${paths})`;
    }
    const leakNote = isPublicRoot ? (leaks.filter(n=>!['plans','connections','drivers','entities'].includes(n)).length ? ` fpa-only names: ${leaks}` : '') : (leaks.length ? `  NAMES IN RESPONSE: ${leaks.join(',')}` : '  names in response: none');
    console.log(`${id} ${method} ${path} [${prof ?? 'no profile header'}] -> ${r.status}${hdr ? ' ('+hdr+')' : ''}\n   ${shown}${leakNote}`);
  }
}
