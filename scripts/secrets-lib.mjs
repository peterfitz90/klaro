// Patterns that must never appear in the browser bundle. Pure; tested in secrets-lib.test.mjs.

const NAMES = ['SUPABASE_SERVICE_ROLE_KEY', 'CLERK_SECRET_KEY', 'DATABASE_URL', 'STRIPE_SECRET_KEY', 'ANTHROPIC_API_KEY'];
const PATTERNS = [
  [/sb_secret_[A-Za-z0-9_-]{10,}/, 'a Supabase secret key (sb_secret_)'],
  [/sk_(live|test)_[A-Za-z0-9]{10,}/, 'a Clerk or Stripe secret key (sk_live_/sk_test_)'],
  [/postgres(ql)?:\/\/[^\s"'`]+:[^\s"'`]+@/, 'a database connection string with a password'],
];
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g;

export function findSecrets(text) {
  const hits = [];
  for (const n of NAMES) if (text.includes(n)) hits.push(`the server-only name ${n}`);
  for (const [re, what] of PATTERNS) if (re.test(text)) hits.push(what);
  for (const m of text.matchAll(JWT)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
      if (payload.role && payload.role !== 'anon') hits.push(`a JWT with role ${payload.role}`);
    } catch {
      hits.push('an unreadable JWT');
    }
  }
  return hits;
}
