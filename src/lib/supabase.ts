// The Supabase client: the publishable (anon) key plus the signed-in user's Clerk session token
// (Supabase third-party auth, as Ledgrly's src/supabase.js and Trinity's src/lib/supabase.ts), with
// default schema fpa, so row security sees auth.jwt()->>'sub'. Without a token a request runs as
// anon, which has no access to fpa at all: it fails, it does not leak.
import { createClient } from '@supabase/supabase-js';
import { AppError } from './errors';

type TokenGetter = () => Promise<string | null>;
let getToken: TokenGetter | null = null;

/** Set once Clerk has loaded (useAuth().getToken); cleared on sign-out. */
export function setTokenGetter(fn: TokenGetter | null): void {
  getToken = fn;
}

function make(url: string, key: string) {
  return createClient(url, key, {
    db: { schema: 'fpa' },
    auth: { persistSession: false, autoRefreshToken: false },
    accessToken: async () => (getToken ? getToken() : null),
  });
}

let client: ReturnType<typeof make> | null = null;

export function fpaClient(): ReturnType<typeof make> {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new AppError('Klaro is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
  client = make(url, key);
  return client;
}
