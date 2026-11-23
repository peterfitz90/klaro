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
    expect(r.skippedDraft).toBe('0002_fpa_vat_rules_DRAFT.sql');
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

  it('refuses to apply a file after a skipped draft, and odd file names', () => {
    expect(() => planMigrations([f('0001_a.sql'), f('0002_rates_DRAFT.sql'), f('0003_b.sql')], [])).toThrow(/after the unapplied draft/);
    expect(() => planMigrations([f('notes.sql')], [])).toThrow(/Not a migration/);
  });
});
