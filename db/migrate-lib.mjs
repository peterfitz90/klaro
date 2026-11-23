// Pure helpers for db/bundle.mjs (tested in db/migrate-lib.test.mjs). Copied from trinity-bookings.
import { createHash } from 'node:crypto';

export const MIGRATION_RE = /^(\d{4})_[a-z0-9_]+(?:_DRAFT)?\.sql$/i;
export const isDraft = filename => /DRAFT/i.test(filename);

/** SHA-256 of the file with line endings normalised to LF, so Windows and CI agree. */
export function checksum(text) {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/**
 * Which migrations to apply, in order. Refuses (throws) when:
 *  - an applied migration's file has changed (checksum differs) or is missing locally;
 *  - a file would be applied after a skipped DRAFT file (order matters; fail closed).
 * local: [{ filename, checksum }]; applied: [{ filename, checksum }].
 */
export function planMigrations(local, applied, { allowDraft = false } = {}) {
  const sorted = [...local].sort((a, b) => a.filename.localeCompare(b.filename));
  for (const f of sorted) if (!MIGRATION_RE.test(f.filename)) throw new Error(`Not a migration file name: ${f.filename}`);
  const done = new Map(applied.map(a => [a.filename, a.checksum]));
  const byName = new Map(sorted.map(f => [f.filename, f]));
  for (const [filename, sum] of done) {
    const f = byName.get(filename);
    if (!f) throw new Error(`${filename} is recorded as applied but the file is missing`);
    if (f.checksum !== sum) throw new Error(`${filename} has changed since it was applied (checksum differs); write a new migration instead`);
  }
  const pending = [];
  let skippedDraft = null;
  for (const f of sorted) {
    if (done.has(f.filename)) continue;
    if (isDraft(f.filename) && !allowDraft) { skippedDraft ??= f.filename; continue; }
    if (skippedDraft) throw new Error(`${f.filename} comes after the unapplied draft ${skippedDraft}; confirm and apply the draft first`);
    pending.push(f);
  }
  return { pending, skippedDraft };
}
