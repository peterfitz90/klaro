// Clerk configuration. Klaro uses the shared Ledgrly instance (clerk.ledgrly.ie), whose dashboard
// defaults (home, after sign-in, after sign-up) all point at app.ledgrly.ie. Klaro relies on none of
// them: ClerkProvider and every sign-in, sign-up and sign-out pass Klaro's own paths, and the
// destination after sign-in is Klaro's own `return` parameter, checked here to be a path on Klaro's
// own origin. Clerk's `redirect_url` is never used (see docs/reports/B4.md).
import { clerkKeyProblem } from './config';
import { AppError } from './errors';

export function clerkPublishableKey(): string {
  const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  // A production build (npm run build, as on Vercel) must be on the shared live instance.
  const problem = clerkKeyProblem(key, import.meta.env.PROD);
  if (problem || !key) throw new AppError(`Klaro is not configured: ${problem ?? 'missing value'}`);
  return key;
}

export const SIGN_IN_PATH = '/sign-in';
export const SIGN_UP_PATH = '/sign-up';
/** Where a user lands after sign-in or sign-up when no valid return path was given. */
export const HOME_PATH = '/';
/** Where sign-out ends: Klaro's own sign-in page, never Ledgrly. */
export const AFTER_SIGN_OUT_PATH = SIGN_IN_PATH;
/** Klaro's own query parameter for "come back here after signing in". */
export const RETURN_PARAM = 'return';

/**
 * A return path is accepted only if it is a path on this site: it starts with exactly one "/", has
 * no backslash or control character (browsers treat "/\host" as another host), and does not point
 * into sign-in or sign-up (which would loop). Anything else gives HOME_PATH.
 */
export function safeReturnPath(raw: string | null | undefined): string {
  if (!raw || raw.length > 512) return HOME_PATH;
  if (!raw.startsWith('/') || raw.startsWith('//')) return HOME_PATH;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return HOME_PATH;
  const path = raw.split(/[?#]/)[0] ?? '';
  for (const p of [SIGN_IN_PATH, SIGN_UP_PATH]) {
    if (path === p || path.startsWith(`${p}/`)) return HOME_PATH;
  }
  return raw;
}

/** The sign-in URL that comes back to `returnPath` afterwards (Klaro's own origin only). */
export function signInHref(returnPath: string): string {
  const safe = safeReturnPath(returnPath);
  return safe === HOME_PATH ? SIGN_IN_PATH : `${SIGN_IN_PATH}?${RETURN_PARAM}=${encodeURIComponent(safe)}`;
}
