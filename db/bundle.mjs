// Builds, from the files on disk, the exact SQL that is run through the Supabase connector (there is
// no direct database connection). Nothing here connects to a database. Output in db/out/ (ignored).
//
// Phase 0 (0001, applied 23 Nov 2026; rebuilt only to show they are byte-identical to what was run):
//   test_0001.sql        BEGIN; 0001; the schema test             (always raises its result: rolled back)
//   test_down.sql        BEGIN; 0001; the rollback test           (always raises its result: rolled back)
//   test_0002_draft.sql  BEGIN; 0001; 0002 DRAFT; the draft test  (always raises: rolled back; never applied)
//   apply_0001.sql       BEGIN; 0001; record it; db/apply_checks.sql; COMMIT;
//   dryrun_apply.sql     apply_0001.sql without its COMMIT, then the dry-run test (rolled back)
// Phase 1 (0003, on top of the live database where 0001 is applied):
//   test_0003.sql          BEGIN; 0003; the Phase 1 test, with the shared rounding cases (rolled back)
//   test_down_0003.sql     BEGIN; 0003; record it; the rollback test (rolled back)
//   apply_0003.sql         BEGIN; 0003; record it in fpa.schema_migrations; db/apply_checks_0003.sql
//                          (raises, rolling everything back, unless all hold); COMMIT;
//   dryrun_apply_0003.sql  apply_0003.sql without its COMMIT, then the dry-run test (rolled back)
//   timing_0003.sql        BEGIN; 0003; timings at the limits as authenticated with an 8s timeout (rolled back)
// Phase 2 (0004, on top of the live database where 0001 and 0003 are applied; 0003 applied 25 Nov 2026):
//   test_0004.sql           BEGIN; 0004; the Phase 2 test, with the 0003 variance as a test-only copy (rolled back)
//   test_0003_on_0004.sql   BEGIN; 0004; the UNCHANGED Phase 1 test (rolled back): every Phase 1 check
//                           against 0001 + 0003 + 0004 (the expected differences are listed in P2-0.md)
//   test_down_0004.sql      BEGIN; 0004; record it; the rollback test (rolled back)
//   apply_0004.sql          BEGIN; 0004; record it; db/apply_checks_0004.sql; COMMIT;
//   dryrun_apply_0004.sql   apply_0004.sql without its COMMIT, then the dry-run test (rolled back)
//   timing_0004.sql         BEGIN; 0004; timings at the limits as authenticated with an 8s timeout (rolled back)
// Migration files are embedded byte for byte (LF line endings, as stored in git), so each embedded copy
// has the same SHA-256 as its checksum. *_DRAFT.sql files are never part of an apply.
// Adapted from trinity-bookings db/bundle.mjs.
//   node db/bundle.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checksum, isDraft, planMigrations } from './migrate-lib.mjs';

const at = rel => fileURLToPath(new URL(rel, import.meta.url));
const read = rel => readFileSync(at(rel), 'utf8').replace(/\r\n/g, '\n');

// What fpa.schema_migrations holds on the live database (read-only checks, docs/reports/B5.md and
// docs/reports/P1-A-smoke.md).
const APPLIED = [
  { filename: '0001_fpa_schema.sql', checksum: 'afacaac26393543dd4ce1880f28e140dc119fcc4d5a2be828ed6e09806e996c6' },
  { filename: '0003_fpa_actuals_budget_variance.sql', checksum: '5ae7ea50a80405112989d1f6346cae3d3ee446cd293d91686c2ba800b75a91ba' },
];

const files = readdirSync(at('./migrations/')).filter(f => f.endsWith('.sql')).sort();
const all = files.map(f => ({ filename: f, text: read(`./migrations/${f}`) }));
for (const m of all) {
  if (!m.text.endsWith('\n')) throw new Error(`${m.filename} must end with a newline`);
  m.checksum = checksum(m.text);
}
const byName = name => {
  const m = all.find(x => x.filename === name);
  if (!m) throw new Error(`${name} not found`);
  return m;
};
const m0001 = byName('0001_fpa_schema.sql');
const draft = byName('0002_fpa_vat_rules_DRAFT.sql');
// Throws if 0001 or 0003 changed since they were applied; drafts are skipped and never applied.
const { pending, skippedDrafts } = planMigrations(all, APPLIED);
if (pending.map(m => m.filename).join() !== '0004_fpa_balances_cash.sql') throw new Error(`Expected to apply 0004 only, got ${pending.map(m => m.filename)}`);
if (skippedDrafts.join() !== draft.filename) throw new Error(`Unexpected drafts: ${skippedDrafts}`);
const m0003 = byName('0003_fpa_actuals_budget_variance.sql');
const m0004 = byName('0004_fpa_balances_cash.sql');
if ([m0001, m0003, m0004].some(m => isDraft(m.filename))) throw new Error('A DRAFT file is in an apply set');

// fpa.variance: the 0003 text, and the 0004 replacement, which may differ only in leaving out balance
// lines. md5 of the body (pg_proc.prosrc: the text between the $$ quotes) for the apply checks.
const functionText = (m, header) => {
  const start = m.text.indexOf(header);
  if (start < 0 || m.text.indexOf(header, start + 1) >= 0) throw new Error(`${m.filename}: expected one "${header}"`);
  const end = m.text.indexOf('END $$;', start);
  return m.text.slice(start, end + 'END $$;'.length);
};
const prosrc = fn => { const a = fn.indexOf('$$') + 2; return fn.slice(a, fn.indexOf('$$', a)); };
const md5 = t => createHash('md5').update(t, 'utf8').digest('hex');
const variance3 = functionText(m0003, 'CREATE FUNCTION fpa.variance(');
const variance4 = functionText(m0004, 'CREATE OR REPLACE FUNCTION fpa.variance(');
const expected4 = variance3.replace('CREATE FUNCTION fpa.variance(', 'CREATE OR REPLACE FUNCTION fpa.variance(')
  .replace("     WHERE d.kind <> 'excluded')", "     WHERE d.kind NOT IN ('excluded', 'balance'))");
if (variance4 !== expected4 || variance4 === variance3) throw new Error('0004 variance must be the 0003 text with only the balance-line change');
// The applied 0003 body hash, read from the live database after the apply (docs/reports/P1-A-smoke.md).
if (md5(prosrc(variance3)) !== 'e2f4425cc5cab847b4e52cf4ccb59a78') throw new Error('0003 variance body hash differs from the applied one');

const embed = ms => ms.map(m => `-- ===== ${m.filename} =====\n${m.text}`).join('\n');

// Replaces a placeholder that must occur exactly `times` times, literally (String.replace would treat
// $' and $& in the inserted text as patterns, and replaces only the first occurrence).
const put = (name, src, token, text, times = 1) => {
  const parts = src.split(token);
  if (parts.length - 1 !== times) throw new Error(`${name}: expected ${token} ${times} time(s), found ${parts.length - 1}`);
  return parts.join(text);
};
const fill = (rel, token, text) => put(rel, read(rel), token, text).trim();
const noTag = (name, text, tag) => {
  if (text.includes(tag)) throw new Error(`${name} must not contain ${tag}`);
  return text;
};

// ── Phase 0 (0001) ──
const body1 = embed([m0001]);
const down1 = noTag('rollback/0001_down.sql', read('./rollback/0001_down.sql'), '$down_text$');
const checks1 = noTag('apply_checks.sql', put('apply_checks.sql', read('./apply_checks.sql'), '__CHECKSUM_0001__', m0001.checksum, 2).trim(), '$chk$');
const beforeCommit1 = `BEGIN;\n${body1}\n-- ===== record in fpa.schema_migrations =====\nINSERT INTO fpa.schema_migrations (filename, checksum) VALUES\n  ('${m0001.filename}', '${m0001.checksum}');\n\n-- ===== db/apply_checks.sql =====\n${checks1}\n`;

// ── Phase 1 (0003) ──
const body3 = embed([m0003]);
const down3 = noTag('rollback/0003_down.sql', read('./rollback/0003_down.sql'), '$down_text$');
let checks3 = put('apply_checks_0003.sql', read('./apply_checks_0003.sql'), '__CHECKSUM_0001__', m0001.checksum, 2);
checks3 = noTag('apply_checks_0003.sql', put('apply_checks_0003.sql', checks3, '__CHECKSUM_0003__', m0003.checksum, 2).trim(), '$chk$');
const cases = noTag('rounding_cases.json', JSON.stringify(JSON.parse(read('./tests/fixtures/rounding_cases.json'))), '$rc$');
const record3 = `-- ===== record in fpa.schema_migrations =====\nINSERT INTO fpa.schema_migrations (filename, checksum) VALUES\n  ('${m0003.filename}', '${m0003.checksum}');\n`;
const beforeCommit3 = `BEGIN;\n${body3}\n${record3}\n-- ===== db/apply_checks_0003.sql =====\n${checks3}\n`;
const downTest3 = put('tests/0003_down.test.sql', fill('./tests/0003_down.test.sql', '__DOWN_SQL__', down3), '__APPLY_CHECKS_0001__', checks1);

// ── Phase 2 (0004) ──
const body4 = embed([m0004]);
const down4 = noTag('rollback/0004_down.sql', read('./rollback/0004_down.sql'), '$down_text$');
let checks4 = read('./apply_checks_0004.sql');
checks4 = put('apply_checks_0004.sql', checks4, '__CHECKSUM_0001__', m0001.checksum, 2);
checks4 = put('apply_checks_0004.sql', checks4, '__CHECKSUM_0003__', m0003.checksum, 2);
checks4 = put('apply_checks_0004.sql', checks4, '__CHECKSUM_0004__', m0004.checksum, 2);
checks4 = noTag('apply_checks_0004.sql', put('apply_checks_0004.sql', checks4, '__MD5_VARIANCE_0004__', md5(prosrc(variance4))).trim(), '$chk$');
const record4 = `-- ===== record in fpa.schema_migrations =====\nINSERT INTO fpa.schema_migrations (filename, checksum) VALUES\n  ('${m0004.filename}', '${m0004.checksum}');\n`;
const beforeCommit4 = `BEGIN;\n${body4}\n${record4}\n-- ===== db/apply_checks_0004.sql =====\n${checks4}\n`;
const varianceAsTest = variance3.replace('CREATE FUNCTION fpa.variance(', 'CREATE FUNCTION fpa_test.variance_0003(');
let downTest4 = fill('./tests/0004_down.test.sql', '__DOWN_SQL__', down4);
downTest4 = put('tests/0004_down.test.sql', downTest4, '__APPLY_CHECKS_0003__', checks3);
downTest4 = put('tests/0004_down.test.sql', downTest4, '__MD5_VARIANCE_0003__', md5(prosrc(variance3)));

const out = {
  'test_0001.sql': `BEGIN;\n${body1}\n-- ===== tests/0001_fpa_schema.test.sql =====\n${read('./tests/0001_fpa_schema.test.sql').trim()}\n`,
  'test_down.sql': `BEGIN;\n${body1}\n-- ===== tests/0001_down.test.sql =====\n${fill('./tests/0001_down.test.sql', '__DOWN_SQL__', down1)}\n`,
  'test_0002_draft.sql': `BEGIN;\n${body1}\n${embed([draft])}\n-- ===== tests/0002_vat_draft.test.sql =====\n${read('./tests/0002_vat_draft.test.sql').trim()}\n`,
  'apply_0001.sql': `${beforeCommit1}COMMIT;\n`,
  'dryrun_apply.sql': `${beforeCommit1}-- ===== tests/apply_dryrun.test.sql =====\n${fill('./tests/apply_dryrun.test.sql', '__APPLY_CHECKS__', checks1)}\n`,
  'test_0003.sql': `BEGIN;\n${body3}\n-- ===== tests/0003_phase1.test.sql =====\n${fill('./tests/0003_phase1.test.sql', '__ROUNDING_CASES__', cases)}\n`,
  'test_down_0003.sql': `BEGIN;\n${body3}\n${record3}\n-- ===== tests/0003_down.test.sql =====\n${downTest3}\n`,
  'apply_0003.sql': `${beforeCommit3}COMMIT;\n`,
  'timing_0003.sql': `BEGIN;
${body3}
-- ===== tests/0003_timing.test.sql =====
${read('./tests/0003_timing.test.sql').trim()}
`,
  'dryrun_apply_0003.sql': `${beforeCommit3}-- ===== tests/apply_dryrun_0003.test.sql =====\n${fill('./tests/apply_dryrun_0003.test.sql', '__APPLY_CHECKS_0003__', checks3)}\n`,
  'test_0004.sql': `BEGIN;\n${body4}\n-- ===== tests/0004_phase2.test.sql =====\n${fill('./tests/0004_phase2.test.sql', '__VARIANCE_0003_AS_TEST__', varianceAsTest)}\n`,
  'test_0003_on_0004.sql': `BEGIN;\n${body4}\n-- ===== tests/0003_phase1.test.sql (unchanged) =====\n${fill('./tests/0003_phase1.test.sql', '__ROUNDING_CASES__', cases)}\n`,
  'test_down_0004.sql': `BEGIN;\n${body4}\n${record4}\n-- ===== tests/0004_down.test.sql =====\n${downTest4}\n`,
  'apply_0004.sql': `${beforeCommit4}COMMIT;\n`,
  'dryrun_apply_0004.sql': `${beforeCommit4}-- ===== tests/apply_dryrun_0004.test.sql =====\n${fill('./tests/apply_dryrun_0004.test.sql', '__APPLY_CHECKS_0004__', checks4)}\n`,
  'timing_0004.sql': `BEGIN;\n${body4}\n-- ===== tests/0004_timing.test.sql =====\n${read('./tests/0004_timing.test.sql').trim()}\n`,
};

// The embedded migration text must be byte-identical to the file it came from, no apply file may
// carry a draft, and no 0003 file may keep a placeholder.
for (const [name, text] of Object.entries(out)) {
  const embedded = name === 'test_0002_draft.sql' ? [m0001, draft] : name.includes('0004') ? [m0004] : name.includes('0003') ? [m0003] : [m0001];
  for (const m of embedded) {
    const marker = `-- ===== ${m.filename} =====\n`;
    const start = text.indexOf(marker);
    if (start < 0 || text.slice(start + marker.length, start + marker.length + m.text.length) !== m.text) {
      throw new Error(`${m.filename} is not embedded byte for byte in ${name}`);
    }
  }
  if (name !== 'test_0002_draft.sql' && /_DRAFT\.sql =====/.test(text)) throw new Error(`${name} contains a DRAFT file`);
  const left = /__[A-Z0-9_]+__/.exec(text);
  if ((name.includes('0003') || name.includes('0004')) && left) throw new Error(`${name} still has a placeholder: ${left[0]}`);
}

mkdirSync(at('./out/'), { recursive: true });
for (const [name, text] of Object.entries(out)) {
  writeFileSync(at(`./out/${name}`), text);
  console.log(`db/out/${name}: ${text.length} characters, sha256 ${checksum(text).slice(0, 16)}`);
}
for (const m of all) console.log(`${m.filename}: ${m.checksum}${isDraft(m.filename) ? ' (DRAFT: never applied)' : ''}`);
