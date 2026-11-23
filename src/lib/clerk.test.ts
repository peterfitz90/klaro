import { describe, expect, it } from 'vitest';
import { safeReturnPath, signInHref } from './clerk';

describe('return path after sign-in (Klaro origin only)', () => {
  it('keeps a path on this site, with its query', () => {
    expect(safeReturnPath('/e/0b483fe4-e952-4170-83b5-a79b911b8023/cash')).toBe('/e/0b483fe4-e952-4170-83b5-a79b911b8023/cash');
    expect(safeReturnPath('/entities?x=1#y')).toBe('/entities?x=1#y');
  });
  it('refuses anything that could leave Klaro, including to Ledgrly', () => {
    for (const bad of ['https://app.ledgrly.ie/', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'evil', '', null, undefined,
      '/%0a', '/\u0000x', '/a\\b', `/${'a'.repeat(600)}`]) {
      expect(safeReturnPath(bad as string | null | undefined), String(bad)).toBe(bad === '/%0a' ? '/%0a' : '/');
    }
  });
  it('never returns into sign-in or sign-up (no loop)', () => {
    expect(safeReturnPath('/sign-in')).toBe('/');
    expect(safeReturnPath('/sign-in/factor-one')).toBe('/');
    expect(safeReturnPath('/sign-up?__clerk_ticket=x')).toBe('/');
    expect(safeReturnPath('/sign-inside')).toBe('/sign-inside');
  });
  it('builds the sign-in link with Klaro’s own parameter', () => {
    expect(signInHref('/')).toBe('/sign-in');
    expect(signInHref('/entities/new')).toBe('/sign-in?return=%2Fentities%2Fnew');
    expect(signInHref('//evil.example')).toBe('/sign-in');
  });
});
