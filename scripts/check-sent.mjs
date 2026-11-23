// Usage: node scripts/check-sent.mjs <session transcript .jsonl> db/out
// Lists every Supabase execute_sql call in this session's transcript whose text matches a db/out file
// byte for byte (sha-256), with the result text that came back.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [transcript, outDir] = process.argv.slice(2);
const sha = t => createHash('sha256').update(t, 'utf8').digest('hex');
const files = Object.fromEntries(readdirSync(outDir).filter(f => f.endsWith('.sql')).map(f => [sha(readFileSync(`${outDir}/${f}`, 'utf8')), f]));
const calls = new Map(); const results = new Map();
for (const line of readFileSync(transcript, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let j; try { j = JSON.parse(line); } catch { continue; }
  const content = j?.message?.content; if (!Array.isArray(content)) continue;
  for (const c of content) {
    if (c.type === 'tool_use' && c.name === 'mcp__supabase__execute_sql') calls.set(c.id, { q: c.input.query, ts: j.timestamp });
    if (c.type === 'tool_result' && calls.has(c.tool_use_id)) {
      const t = Array.isArray(c.content) ? c.content.map(x => x.text ?? '').join('') : String(c.content);
      results.set(c.tool_use_id, t);
    }
  }
}
for (const [id, { q, ts }] of calls) {
  const h = sha(q);
  const exact = files[h] ?? (files[sha(q + '\n')] ? files[sha(q + '\n')] + ' (file has one extra final newline)' : null);
  if (!exact && q.length < 20000) continue;
  console.log(`${ts}  ${q.length} chars  sha256 ${h.slice(0, 16)}  matches: ${exact ?? 'none'}`);
  console.log(`   result: ${(results.get(id) ?? '(none)').replace(/\s+/g, ' ').slice(0, 160)}`);
}
