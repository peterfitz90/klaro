// The entity chip in the header (name, jurisdiction, currency) and its menu: switch to another
// entity (same page), see all entities, or create one.
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { entityMeta, type Entity } from '../../features/entities/model';
import { entityPath, TASKS, type Task } from './tasks';

/** The same task in another entity, so switching keeps you on the page you were on. */
export function switchTarget(pathname: string, toEntityId: string): string {
  const task = pathname.split('/')[3];
  const known = TASKS.find(t => t.path === task);
  return entityPath(toEntityId, (known?.path ?? 'plan') as Task['path']);
}

export function EntitySwitcher({ current, entities }: { current: Entity; entities: Entity[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="entity-switch" ref={box}>
      <button type="button" className="entity-chip" aria-haspopup="true" aria-expanded={open} aria-controls={menuId}
        onClick={() => setOpen(o => !o)} title="Switch entity">
        <span className="sr-only">Current entity: </span>
        <span className="entity-chip-name">{current.name}</span>
        <span className="entity-chip-meta">{entityMeta(current)}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="menu" id={menuId}>
          {entities.map(e => (
            <Link key={e.id} className="menu-item" to={switchTarget(pathname, e.id)} aria-current={e.id === current.id}>
              <span className="entity-chip-name">{e.name}</span>
              <span className="entity-chip-meta">{entityMeta(e)}</span>
            </Link>
          ))}
          <div className="menu-sep" />
          <Link className="menu-item" to="/entities">All entities</Link>
          <Link className="menu-item" to="/entities/new">+ Create entity</Link>
        </div>
      )}
    </div>
  );
}
