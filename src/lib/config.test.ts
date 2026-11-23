import { describe, expect, it } from 'vitest';
import { anonKeyProblem, clerkKeyProblem, supabaseUrlProblem } from './config';

describe('public configuration checks', () => {
  it('Supabase URL is the bare project URL', () => {
    expect(supabaseUrlProblem('https://ihrbvnpwdxdppsnqlsfb.supabase.co')).toBeNull();
    for (const bad of ['https://ihrbvnpwdxdppsnqlsfb.supabase.co/rest/v1/', 'https://ihrbvnpwdxdppsnqlsfb.supabase.co/rest/v1',
      'https://ihrbvnpwdxdppsnqlsfb.supabase.co/', 'http://ihrbvnpwdxdppsnqlsfb.supabase.co', 'not a url', undefined, '']) {
      expect(supabaseUrlProblem(bad), String(bad)).not.toBeNull();
    }
  });
  it('deployed builds need the live (shared) Clerk instance; local dev may use a test key', () => {
    const live = 'pk_live_Y2xlcmsubGVkZ3JseS5pZSQ', test = 'pk_test_dmFsaWQtdW5pY29ybi04MC5jbGVyay5hY2NvdW50cy5kZXYk';
    expect(clerkKeyProblem(live, true)).toBeNull();
    expect(clerkKeyProblem(test, true)).toMatch(/development key/);
    expect(clerkKeyProblem(test, false)).toBeNull();
    expect(clerkKeyProblem('sk_live_x', true)).not.toBeNull();
    expect(clerkKeyProblem(undefined, false)).not.toBeNull();
  });
  it('the anon key is never a secret key', () => {
    expect(anonKeyProblem('sb_publishable_abc')).toBeNull();
    expect(anonKeyProblem('sb_secret_abc')).not.toBeNull();
    expect(anonKeyProblem('')).not.toBeNull();
  });
});
