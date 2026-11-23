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

/** The fpa client, for building queries that are then passed to must()/mustMaybe(). */
export function db() {
  return fpaClient();
}
