// @vitest-environment jsdom
// Regression test for CI run 45362746252: "switching entity keeps the page" failed about 1 run in 20.
//
// Root cause: EntitySwitcher closed its menu in useEffect(..., [pathname]), which also runs after the
// first render. The shell first renders when the entity data arrives: an ordinary (non-urgent) update,
// after which React runs effects in a later task. Testing Library's findBy… watches the DOM with a
// MutationObserver, so it could resolve in that gap; the test's click then opened the menu, and the
// pending effect closed it again. A real user clicking in that instant would lose the click too.
//
// The same gap applied to the Ctrl/Cmd+K listener, which was attached in a useEffect: a key press in
// that instant was lost (in app.test.tsx the palette test would then time out at findByRole).
//
// These tests reproduce that order every time: render as an ordinary update, click from a
// MutationObserver callback the moment the chip appears (before React's next task), then let React
// finish. Both failed on the old code on every run and pass with the fix.
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { usePaletteHotkey } from './CommandPalette';
import { EntitySwitcher } from './EntitySwitcher';

const A = { id: '0b483fe4-e952-4170-83b5-a79b911b8023', name: 'Acme Ltd', jurisdiction: 'IE' as const, currency: 'EUR' as const };
const B = { id: '11111111-2222-4333-8444-555555555555', name: 'Brit Co', jurisdiction: 'UK' as const, currency: 'GBP' as const };

let host: HTMLDivElement | null = null;
let root: Root | null = null;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false; });
afterEach(() => { root?.unmount(); host?.remove(); root = null; host = null; });

/** Renders `node` as an ordinary update and calls `act` from the first DOM change after the commit. */
function actRightAfterFirstCommit(node: React.ReactNode, ready: (h: HTMLElement) => boolean, act: (h: HTMLElement) => void): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  const h = host;
  root = createRoot(h);
  const done = new Promise<void>(resolve => {
    const mo = new MutationObserver(() => {
      if (!ready(h)) return;
      mo.disconnect();
      act(h);
      resolve();
    });
    mo.observe(h, { childList: true, subtree: true });
  });
  root.render(node);
  return done;
}
const settle = () => new Promise(resolve => setTimeout(resolve, 50));

describe('Ctrl/Cmd+K in the instant after the shell first appears', () => {
  it('opens the palette', async () => {
    let opened = 0;
    function Shellish() { usePaletteHotkey(() => { opened++; }); return <p>shell</p>; }
    await actRightAfterFirstCommit(<Shellish />, h => h.textContent === 'shell',
      () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })));
    await settle();
    expect(opened).toBe(1);
  });
});

describe('entity switcher: a click in the instant after the shell first appears', () => {
  it('opens the menu, and the menu stays open once React has finished', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    const h = host;
    root = createRoot(h);

    let effectsWerePending = false;
    const clicked = new Promise<void>(resolve => {
      const mo = new MutationObserver(() => {
        const chip = h.querySelector<HTMLButtonElement>('button[title="Switch entity"]');
        if (!chip) return;
        mo.disconnect();
        effectsWerePending = true; // we are in a microtask straight after the commit
        chip.click();
        resolve();
      });
      mo.observe(h, { childList: true, subtree: true });
    });
    // An ordinary update, as when data arrives: React commits it, then runs effects in a later task.
    root.render(<MemoryRouter initialEntries={[`/e/${A.id}/cash`]}><EntitySwitcher current={A} entities={[A, B]} /></MemoryRouter>);
    await clicked;
    // Let React finish everything it had pending (the click's update and any effects).
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(effectsWerePending).toBe(true);
    const chip = h.querySelector('button[title="Switch entity"]');
    expect(chip?.getAttribute('aria-expanded')).toBe('true');
    expect([...h.querySelectorAll('a')].some(a => a.textContent?.includes('Brit Co'))).toBe(true);
  });
});
