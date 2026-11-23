import { describe, expect, it } from 'vitest';
import { switchTarget } from './EntitySwitcher';
import { entityPath, filterPalette, paletteItems, TASKS } from './tasks';

const A = '0b483fe4-e952-4170-83b5-a79b911b8023';
const B = '11111111-2222-4333-8444-555555555555';

describe('tasks, palette and switching', () => {
  it('has the four tasks plus Connect', () => {
    expect(TASKS.map(t => t.label)).toEqual(['Plan', 'Compare', 'Cash', 'Report', 'Connect']);
    expect(entityPath(A)).toBe(`/e/${A}/plan`);
  });
  it('palette lists only the current entity’s pages and the entity list', () => {
    const items = paletteItems(A, 'Acme');
    expect(items.map(i => i.to)).toEqual([...TASKS.map(t => `/e/${A}/${t.path}`), '/entities']);
    expect(items.every(i => i.to === '/entities' || i.to.startsWith(`/e/${A}/`))).toBe(true);
  });
  it('palette filter matches every word, any case', () => {
    const items = paletteItems(A, 'Acme');
    expect(filterPalette(items, '').length).toBe(items.length);
    expect(filterPalette(items, 'CASH').map(i => i.id)).toEqual(['cash']);
    expect(filterPalette(items, 'vat cash').map(i => i.id)).toEqual(['cash']);
    expect(filterPalette(items, 'zzz')).toEqual([]);
  });
  it('switching entity keeps the page, falling back to Plan', () => {
    expect(switchTarget(`/e/${A}/cash`, B)).toBe(`/e/${B}/cash`);
    expect(switchTarget(`/e/${A}/nonsense`, B)).toBe(`/e/${B}/plan`);
    expect(switchTarget('/entities', B)).toBe(`/e/${B}/plan`);
  });
});
