import { describe, expect, it } from 'vitest';
import { defaultCurrency, isEntityId, validateCreateEntity } from './model';

describe('create entity form checks', () => {
  it('accepts a valid entity and trims the name', () => {
    expect(validateCreateEntity({ name: '  Acme Ltd ', jurisdiction: 'IE', currency: 'EUR', fiscalYearStart: 1 }))
      .toEqual({ ok: true, args: { name: 'Acme Ltd', jurisdiction: 'IE', currency: 'EUR', fiscalYearStart: 1 } });
    expect(validateCreateEntity({ name: 'B', jurisdiction: 'UK', currency: 'EUR', fiscalYearStart: 12 }).ok).toBe(true);
  });
  it('names each wrong field', () => {
    const r = validateCreateEntity({ name: '   ', jurisdiction: 'FR', currency: 'USD', fiscalYearStart: 13 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['currency', 'fiscalYearStart', 'jurisdiction', 'name']);
    expect(validateCreateEntity({ name: 'x'.repeat(121), jurisdiction: 'IE', currency: 'EUR', fiscalYearStart: 1 }).ok).toBe(false);
    expect(validateCreateEntity({ name: 'x', jurisdiction: 'IE', currency: 'EUR', fiscalYearStart: 1.5 }).ok).toBe(false);
    expect(validateCreateEntity({ name: 'x', jurisdiction: 'ie', currency: 'EUR', fiscalYearStart: 1 }).ok).toBe(false);
  });
  it('suggests the usual currency only as a starting choice', () => {
    expect(defaultCurrency('IE')).toBe('EUR');
    expect(defaultCurrency('UK')).toBe('GBP');
  });
  it('uses an entity id from the URL only if it is a uuid', () => {
    expect(isEntityId('0b483fe4-e952-4170-83b5-a79b911b8023')).toBe(true);
    for (const bad of [undefined, '', '1', "0b483fe4-e952-4170-83b5-a79b911b8023' or 1=1", '0b483fe4e9524170']) expect(isEntityId(bad)).toBe(false);
  });
});
