// Copied from Ledgrly src/App.jsx ExportDropdown (see PROVENANCE.md), typed and made keyboard
// accessible (Escape closes; real buttons with a menu role).
import { useEffect, useRef, useState } from 'react';

export function ExportDropdown({ onCSV, onPrint }: { onCSV: () => void; onPrint?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const click = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', click);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', click); document.removeEventListener('keydown', key); };
  }, []);
  const item = (label: string, fn: () => void) => (
    <button type="button" role="menuitem" className="export-item" onClick={() => { fn(); setOpen(false); }}>{label}</button>
  );
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" className="btn btn-s btn-sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)}>Export ▾</button>
      {open && (
        <div role="menu" style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow)', minWidth: 180, zIndex: 200, overflow: 'hidden' }}>
          {item('Download CSV', onCSV)}
          {onPrint && item('Print / Save PDF', onPrint)}
        </div>
      )}
      <style>{`.export-item { display:block; width:100%; min-height:40px; padding:9px 14px; text-align:left; background:none; border:none; font:inherit; font-size:14px; color:var(--text); cursor:pointer; } .export-item:hover, .export-item:focus-visible { background: var(--surface-2); }`}</style>
    </div>
  );
}
