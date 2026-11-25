// Pure helpers for db/bundle.mjs (tested in db/migrate-lib.test.mjs). Copied from trinity-bookings.
import { createHash } from 'node:crypto';

export const MIGRATION_RE = /^(\d{4})_[a-z0-9_]+(?:_DRAFT)?\.sql$/i;
export const isDraft = filename => /DRAFT/i.test(filename);
const number = filename => Number(MIGRATION_RE.exec(filename)[1]);

/** SHA-256 of the file with line endings normalised to LF, so Windows and CI agree. */
export function checksum(text) {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/**
 * Which migrations to apply, in order. Refuses (throws) when:
 *  - an applied migration's file has changed (checksum differs) or is missing locally;
 *  - a pending file is numbered at or below a file already applied (order matters; fail closed).
 * *_DRAFT.sql files are never applied and do not block later files (Phase 1 change): to apply a
 * draft, rename it to the next free number after the last applied file, which this order rule then
 * enforces. Two files may not share a number.
 * local: [{ filename, checksum }]; applied: [{ filename, checksum }].
 */
export function planMigrations(local, applied) {
  const sorted = [...local].sort((a, b) => a.filename.localeCompare(b.filename));
  for (const f of sorted) if (!MIGRATION_RE.test(f.filename)) throw new Error(`Not a migration file name: ${f.filename}`);
  const seen = new Map();
  for (const f of sorted) {
    const n = number(f.filename);
    if (seen.has(n)) throw new Error(`${f.filename} and ${seen.get(n)} share the number ${String(n).padStart(4, '0')}`);
    seen.set(n, f.filename);
  }
  const done = new Map(applied.map(a => [a.filename, a.checksum]));
  const byName = new Map(sorted.map(f => [f.filename, f]));
  for (const [filename, sum] of done) {
    const f = byName.get(filename);
    if (!f) throw new Error(`${filename} is recorded as applied but the file is missing`);
    if (f.checksum !== sum) throw new Error(`${filename} has changed since it was applied (checksum differs); write a new migration instead`);
  }
  const highest = Math.max(0, ...[...done.keys()].map(number));
  const pending = [];
  const skippedDrafts = [];
  for (const f of sorted) {
    if (done.has(f.filename)) continue;
    if (isDraft(f.filename)) { skippedDrafts.push(f.filename); continue; }
    if (number(f.filename) <= highest) {
      throw new Error(`${f.filename} is numbered below a migration already applied; renumber it after ${String(highest).padStart(4, '0')}`);
    }
    pending.push(f);
  }
  return { pending, skippedDrafts };
}
