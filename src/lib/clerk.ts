// Clerk configuration. Klaro uses the shared Ledgrly instance (clerk.ledgrly.ie). Its default
// redirects point at app.ledgrly.ie, so every sign-in and sign-out in Klaro passes an explicit
// redirect back to Klaro (see docs/reports/P0.md, section 5).
import { AppError } from './errors';

export function clerkPublishableKey(): string {
  const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (!key) throw new AppError('Klaro is not configured (VITE_CLERK_PUBLISHABLE_KEY).');
  return key;
}

/** Where Clerk sends the user after sign-in: always back into Klaro, never to Ledgrly. */
export const AFTER_SIGN_IN = '/';
export const SIGN_IN_PATH = '/sign-in';
