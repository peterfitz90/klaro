// The single wrapper for data access (Supabase client, fpa schema, under row security).
// Fail closed: any error throws a DbError, and nothing returns a partial or empty-looking result
// in place of an error. Lists must say how many rows they want, never relying on the API's
// default cap. Feature code imports this file, never supabase-js (enforced by ESLint).
import { fpaClient } from './supabase';

export interface PgErrorLike { message: string; code?: string; details?: string | null; hint?: string | null }
interface Result<T> { data: T | null; error: PgErrorLike | null }

export const MAX_PAGE = 500;

export class DbError extends Error {
  override name = 'DbError';
  readonly code: string | undefined;
  constructor(readonly what: string, err: PgErrorLike) {
    super(`${what}: ${err.message}`);
    this.code = err.code;
  }
}

/** Awaits a query and returns its data; throws on any error or on a missing result. */
export async function must<T>(query: PromiseLike<Result<T>>, what: string): Promise<T> {
  const { data, error } = await query;
  if (error) throw new DbError(what, error);
  if (data === null) throw new DbError(what, { message: 'no data returned' });
  return data;
}

/** As must(), for a lookup that may legitimately find nothing (maybeSingle). */
export async function mustMaybe<T>(query: PromiseLike<Result<T>>, what: string): Promise<T | null> {
  const { data, error } = await query;
  if (error) throw new DbError(what, error);
  return data;
}

/** A page bound for .range(from, to): explicit, and never more than MAX_PAGE rows. */
export function page(pageIndex: number, size = 100): [number, number] {
  if (!Number.isInteger(pageIndex) || pageIndex < 0) throw new RangeError('page index must be a whole number from 0');
  if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE) throw new RangeError(`page size must be 1 to ${MAX_PAGE}`);
  return [pageIndex * size, pageIndex * size + size - 1];
}

/**
 * A list read as one page is complete only if the page came back short. A full page means there
 * may be more rows, so this throws rather than treat it as the whole list.
 */
export function assertComplete<T>(rows: T[], size: number, what: string): T[] {
  if (rows.length >= size) throw new DbError(what, { message: `more than ${size - 1} rows; page through them` });
  return rows;
}

/**
 * An exact row count (select with count: 'exact', head: true): the database counts, no rows are
 * returned, so the API's row cap does not apply. A missing count is an error.
 */
export async function mustCount(query: PromiseLike<{ count: number | null; error: PgErrorLike | null }>, what: string): Promise<number> {
  const { count, error } = await query;
  if (error) throw new DbError(what, error);
  if (typeof count !== 'number') throw new DbError(what, { message: 'the database did not return a count' });
  return count;
}

/** Rows per request when paging a whole list: the API's own cap (docs/ui-rules.md section 1). */
export const API_PAGE = 1000;
/** A safety stop: no list in Phase 1 comes near this (20,000 rows per import). */
const MAX_PAGES = 500;

/**
 * Reads a whole list a page at a time: .range(from, from + size - 1) until a page comes back with
 * fewer rows than asked for. The list must have a fixed order so pages never overlap or skip. Any
 * failed page throws; a partial list is never returned (docs/ui-rules.md section 1).
 */
export async function pageAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<Result<T[]>>,
  what: string,
  size = API_PAGE,
): Promise<T[]> {
  if (!Number.isInteger(size) || size < 1 || size > API_PAGE) throw new RangeError(`page size must be 1 to ${API_PAGE}`);
  const all: T[] = [];
  for (let n = 0; n < MAX_PAGES; n++) {
    const from = n * size;
    const rows = await must(fetchPage(from, from + size - 1), what);
    if (!Array.isArray(rows)) throw new DbError(what, { message: 'the database did not return a list' });
    if (rows.length > size) throw new DbError(what, { message: `asked for ${size} rows, got ${rows.length}` });
    all.push(...rows);
    if (rows.length < size) return all;
  }
  throw new DbError(what, { message: `more than ${MAX_PAGES * size} rows` });
}

/** The fpa client, for building queries that are then passed to must()/mustMaybe(). */
export function db() {
  return fpaClient();
}
