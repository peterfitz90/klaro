// Checks on the public configuration (VITE_ variables). Fail closed: a wrong value stops the app (and
// a Vercel build, see vite.config.ts) with a message naming the variable, instead of half-working.
// Plain functions with no Vite or browser imports, so vite.config.ts can use them at build time.

/** Supabase project URL: https://<ref>.supabase.co and nothing after it (the client adds /rest/v1). */
export function supabaseUrlProblem(url: string | undefined): string | null {
  if (!url) return 'VITE_SUPABASE_URL is not set.';
  let u: URL;
  try { u = new URL(url); } catch { return 'VITE_SUPABASE_URL is not a URL.'; }
  if (u.protocol !== 'https:') return 'VITE_SUPABASE_URL must start with https://.';
  if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash || url.endsWith('/')) {
    return `VITE_SUPABASE_URL must be the project URL only (https://${u.host}), without "${u.pathname}${u.search}" after it.`;
  }
  return null;
}

/**
 * Clerk publishable key. Any deployed build must use the shared production instance (pk_live_);
 * a development key (pk_test_) signs users into a separate instance whose tokens Supabase refuses.
 * Local `npm run dev` may use either.
 */
export function clerkKeyProblem(key: string | undefined, deployed: boolean): string | null {
  if (!key) return 'VITE_CLERK_PUBLISHABLE_KEY is not set.';
  if (!/^pk_(live|test)_[A-Za-z0-9+/=]+$/.test(key)) return 'VITE_CLERK_PUBLISHABLE_KEY is not a Clerk publishable key.';
  if (deployed && !key.startsWith('pk_live_')) {
    return 'VITE_CLERK_PUBLISHABLE_KEY is a development key (pk_test_). Deployed Klaro must use the shared production instance (pk_live_).';
  }
  return null;
}

export function anonKeyProblem(key: string | undefined): string | null {
  if (!key) return 'VITE_SUPABASE_ANON_KEY is not set.';
  if (/^sb_secret_/.test(key)) return 'VITE_SUPABASE_ANON_KEY is a secret key. Use the publishable (anon) key.';
  return null;
}
