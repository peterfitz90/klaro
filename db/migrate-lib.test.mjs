import { describe, expect, it } from 'vitest';
import { checksum, isDraft, planMigrations } from './migrate-lib.mjs';

const f = (filename, text = filename) => ({ filename, checksum: checksum(text) });

describe('migration planning', () => {
  it('checksums ignore Windows line endings', () => {
    expect(checksum('a\r\nb\r\n')).toBe(checksum('a\nb\n'));
    expect(checksum('a\nb')).not.toBe(checksum('a\nc'));
  });

  it('skips the VAT draft', () => {
    const local = [f('0002_fpa_vat_rules_DRAFT.sql'), f('0001_fpa_schema.sql')];
    const r = planMigrations(local, []);
    expect(r.pending.map(x => x.filename)).toEqual(['0001_fpa_schema.sql']);
    expect(r.skippedDrafts).toEqual(['0002_fpa_vat_rules_DRAFT.sql']);
    expect(isDraft('0002_fpa_vat_rules_DRAFT.sql')).toBe(true);
    expect(isDraft('0001_fpa_schema.sql')).toBe(false);
  });

  it('nothing to do when all are applied', () => {
    const local = [f('0001_fpa_schema.sql')];
    expect(planMigrations(local, local).pending).toEqual([]);
  });

  it('refuses a changed or missing applied migration', () => {
    expect(() => planMigrations([f('0001_fpa_schema.sql', 'new text')], [f('0001_fpa_schema.sql', 'old text')])).toThrow(/changed since it was applied/);
    expect(() => planMigrations([], [f('0001_fpa_schema.sql')])).toThrow(/missing/);
  });

  it('applies a file after an unapplied draft (the draft is never applied)', () => {
    const local = [f('0001_a.sql'), f('0002_rates_DRAFT.sql'), f('0003_b.sql')];
    const r = planMigrations(local, [f('0001_a.sql')]);
    expect(r.pending.map(x => x.filename)).toEqual(['0003_b.sql']);
    expect(r.skippedDrafts).toEqual(['0002_rates_DRAFT.sql']);
  });

  it('refuses a pending file numbered below one already applied (a draft must be renumbered)', () => {
    const local = [f('0001_a.sql'), f('0002_rates.sql'), f('0003_b.sql')];
    expect(() => planMigrations(local, [f('0001_a.sql'), f('0003_b.sql')])).toThrow(/numbered below a migration already applied; renumber it after 0003/);
    expect(planMigrations([...local, f('0004_rates.sql')].filter(x => x.filename !== '0002_rates.sql'), [f('0001_a.sql'), f('0003_b.sql')]).pending.map(x => x.filename))
      .toEqual(['0004_rates.sql']);
  });

  it('refuses two files with one number, and odd file names', () => {
    expect(() => planMigrations([f('0003_a.sql'), f('0003_b_DRAFT.sql')], [])).toThrow(/share the number 0003/);
    expect(() => planMigrations([f('notes.sql')], [])).toThrow(/Not a migration/);
  });
});
