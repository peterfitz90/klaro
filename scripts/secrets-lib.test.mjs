import { expect, it } from 'vitest';
import { findSecrets } from './secrets-lib.mjs';

const jwt = role => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role, ref: 'abcdefghij' })).toString('base64url')}.c2lnbmF0dXJlc2lnbmF0dXJl`;

it('allows publishable keys', () => {
  expect(findSecrets(`const k="sb_publishable_abcdefghijklmnop"; const a="${jwt('anon')}"; const c="pk_live_abcdefghijkl";`)).toEqual([]);
});

it('finds server secrets', () => {
  expect(findSecrets(`x="${jwt('service_role')}"`)).toEqual(['a JWT with role service_role']);
  expect(findSecrets('sb_secret_abcdefghijklmnop')).toHaveLength(1);
  expect(findSecrets('sk_live_abcdefghijklmnop')).toHaveLength(1);
  expect(findSecrets('SUPABASE_SERVICE_ROLE_KEY')).toHaveLength(1);
  expect(findSecrets('postgresql://postgres:pw@db.example.com:5432/postgres')).toHaveLength(1);
});
