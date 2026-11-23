// Cmd/Ctrl+K palette, scoped to the current entity: its pages only in Phase 0 (no data search).
// Keyboard handling follows Ledgrly's GlobalSearchPalette (arrows, Enter, Escape); results are a
// fixed list instead of Ledgrly's search RPCs. Focus stays in the dialog and returns on close.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { filterPalette, type PaletteItem } from './tasks';

export function usePaletteHotkey(open: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}

export function CommandPalette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const listId = useId();
  const results = useMemo(() => filterPalette(items, query), [items, query]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => setActive(0), [query]);

  const go = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    navigate(item.to);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[active]); }
    else if (e.key === 'Tab') {
      // Keep focus inside the dialog.
      const focusable = dialog.current?.querySelectorAll<HTMLElement>('input, button');
      if (!focusable?.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Go to a page" ref={dialog} onKeyDown={onKeyDown}>
        <label htmlFor={`${listId}-q`} className="sr-only">Go to a page</label>
        <input
          id={`${listId}-q`}
          ref={input}
          className="f-input palette-input"
          placeholder="Go to a page…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={results[active] ? `${listId}-${results[active].id}` : undefined}
          autoComplete="off"
        />
        <ul id={listId} role="listbox" className="palette-list">
          {results.length === 0 && <li className="f-hint" style={{ padding: '10px' }}>No page matches.</li>}
          {results.map((r, i) => (
            <li key={r.id} id={`${listId}-${r.id}`} role="option" aria-selected={i === active}>
              <button type="button" className="menu-item" aria-current={i === active} tabIndex={-1}
                onMouseEnter={() => setActive(i)} onClick={() => go(r)}>
                <span>{r.label}</span>
                <span className="f-hint">{r.detail}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="palette-hint"><span className="kbd">↑</span> <span className="kbd">↓</span> to move · <span className="kbd">Enter</span> to open · <span className="kbd">Esc</span> to close</p>
      </div>
    </div>
  );
}
