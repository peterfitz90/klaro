// Builds, from the files on disk, the exact SQL that is run through the Supabase connector (there is
// no direct database connection). Nothing here connects to a database. Output in db/out/ (ignored):
//   test_0001.sql        BEGIN; 0001; the schema test             (always raises its result: rolled back)
//   test_down.sql        BEGIN; 0001; the rollback test           (always raises its result: rolled back)
//   test_0002_draft.sql  BEGIN; 0001; 0002 DRAFT; the draft test  (always raises: rolled back; never applied)
//   apply_0001.sql       BEGIN; 0001; record it in fpa.schema_migrations; db/apply_checks.sql (raises,
//                        rolling everything back, unless all hold); COMMIT;
//   dryrun_apply.sql     apply_0001.sql without its COMMIT, then the dry-run test (rolled back)
// Migration files are embedded byte for byte (LF line endings, as stored in git), so each embedded copy
// has the same SHA-256 as its checksum. *_DRAFT.sql files are never part of an apply.
// Adapted from trinity-bookings db/bundle.mjs.
//   node db/bundle.mjs
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checksum, isDraft, planMigrations } from './migrate-lib.mjs';

const at = rel => fileURLToPath(new URL(rel, import.meta.url));
const read = rel => readFileSync(at(rel), 'utf8').replace(/\r\n/g, '\n');

const files = readdirSync(at('./migrations/')).filter(f => f.endsWith('.sql')).sort();
const all = files.map(f => ({ filename: f, text: read(`./migrations/${f}`) }));
for (const m of all) {
  if (!m.text.endsWith('\n')) throw new Error(`${m.filename} must end with a newline`);
  m.checksum = checksum(m.text);
}
// What an apply would include: everything not yet applied, skipping drafts (nothing is applied yet).
const { pending, skippedDraft } = planMigrations(all, []);
const APPLY = pending.map(p => all.find(m => m.filename === p.filename));
if (APPLY.map(m => m.filename).join() !== '0001_fpa_schema.sql') throw new Error(`Expected to apply 0001 only, got ${APPLY.map(m => m.filename)}`);
if (APPLY.some(m => isDraft(m.filename))) throw new Error('A DRAFT file is in the apply set');
const draft = all.find(m => m.filename === skippedDraft);
if (!draft) throw new Error('The VAT draft (0002) was expected and not found');

const embed = ms => ms.map(m => `-- ===== ${m.filename} =====\n${m.text}`).join('\n');
const body = embed(APPLY);

// Replaces a placeholder that must occur exactly `times` times, literally (String.replace would treat
// $' and $& in the inserted text as patterns, and replaces only the first occurrence).
const put = (name, src, token, text, times = 1) => {
  const parts = src.split(token);
  if (parts.length - 1 !== times) throw new Error(`${name}: expected ${token} ${times} time(s), found ${parts.length - 1}`);
  return parts.join(text);
};
const fill = (rel, token, text) => put(rel, read(rel), token, text).trim();

const down = read('./rollback/0001_down.sql');
if (down.includes('$down_text$')) throw new Error('The rollback script must not contain $down_text$');
const checks = put('apply_checks.sql', read('./apply_checks.sql'), '__CHECKSUM_0001__', APPLY[0].checksum, 2).trim();
if (checks.includes('$chk$')) throw new Error('db/apply_checks.sql must not contain $chk$');

const record = APPLY.map(m => `  ('${m.filename}', '${m.checksum}')`).join(',\n');
const beforeCommit = `BEGIN;\n${body}\n-- ===== record in fpa.schema_migrations =====\nINSERT INTO fpa.schema_migrations (filename, checksum) VALUES\n${record};\n\n-- ===== db/apply_checks.sql =====\n${checks}\n`;
const out = {
  'test_0001.sql': `BEGIN;\n${body}\n-- ===== tests/0001_fpa_schema.test.sql =====\n${read('./tests/0001_fpa_schema.test.sql').trim()}\n`,
  'test_down.sql': `BEGIN;\n${body}\n-- ===== tests/0001_down.test.sql =====\n${fill('./tests/0001_down.test.sql', '__DOWN_SQL__', down)}\n`,
  'test_0002_draft.sql': `BEGIN;\n${body}\n${embed([draft])}\n-- ===== tests/0002_vat_draft.test.sql =====\n${read('./tests/0002_vat_draft.test.sql').trim()}\n`,
  'apply_0001.sql': `${beforeCommit}COMMIT;\n`,
  'dryrun_apply.sql': `${beforeCommit}-- ===== tests/apply_dryrun.test.sql =====\n${fill('./tests/apply_dryrun.test.sql', '__APPLY_CHECKS__', checks)}\n`,
};

// The embedded migration text must be byte-identical to the file it came from, and no apply file may
// carry a draft.
for (const [name, text] of Object.entries(out)) {
  for (const m of name === 'test_0002_draft.sql' ? [...APPLY, draft] : APPLY) {
    const marker = `-- ===== ${m.filename} =====\n`;
    const start = text.indexOf(marker) + marker.length;
    if (text.slice(start, start + m.text.length) !== m.text) throw new Error(`${m.filename} is not embedded byte for byte in ${name}`);
  }
  if (name !== 'test_0002_draft.sql' && /_DRAFT\.sql =====/.test(text)) throw new Error(`${name} contains a DRAFT file`);
}

mkdirSync(at('./out/'), { recursive: true });
for (const [name, text] of Object.entries(out)) {
  writeFileSync(at(`./out/${name}`), text);
  console.log(`db/out/${name}: ${text.length} characters, sha256 ${checksum(text).slice(0, 16)}`);
}
for (const m of all) console.log(`${m.filename}: ${m.checksum}${isDraft(m.filename) ? ' (DRAFT: never applied)' : ''}`);
