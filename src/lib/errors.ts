// Errors that reach the UI. Fail closed: callers show these, and nothing turns an error into an
// empty result.

/** Postgres/PostgREST codes mapped to a message a user can act on. */
const KNOWN: Record<string, string> = {
  '42501': 'You do not have access to this.',
  '23505': 'This already exists.',
  '23514': 'A value is not allowed.',
  '23503': 'This refers to something that does not exist or is not yours.',
};

export class AppError extends Error {
  override name = 'AppError';
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

/**
 * The text to show for any thrown value. Our own database errors (codes starting PT) carry
 * messages written for users, so those are shown as they are, without the "what:" prefix.
 */
export function userMessage(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    const what = (err as { what?: unknown }).what;
    if (typeof code === 'string' && code.startsWith('PT')) {
      return typeof what === 'string' && err.message.startsWith(`${what}: `) ? err.message.slice(what.length + 2) : err.message;
    }
    if (typeof code === 'string' && KNOWN[code]) return KNOWN[code];
    if (err.message) return err.message;
  }
  return 'Something went wrong.';
}
