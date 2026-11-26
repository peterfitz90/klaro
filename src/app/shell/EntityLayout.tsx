// /e/:entityId/*: loads the entity from the URL under row security, then renders the shell around
// the entity's pages. If the entity cannot be loaded (no access, not found, bad id or an error),
// no entity page renders: the user sees why, and nothing else.
import { useAuth, useUser } from '@clerk/clerk-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { getEntity, listEntities, myRole } from '../../features/entities/api';
import { EntityContext, rememberEntity, type CurrentEntity } from '../../features/entities/context';
import { isEntityId } from '../../features/entities/model';
import { AppError } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import { SignOutButton } from '../auth';
import { ErrorBoundary } from '../ErrorBoundary';
import { CommandPalette, usePaletteHotkey } from './CommandPalette';
import { EntitySwitcher } from './EntitySwitcher';
import { LiveKpiStrip } from '../../features/kpi/LiveKpiStrip';
import { CASH_PAGE_LIVE, KPI_STRIP_LIVE, REPORT_LIVE } from './kpiSwitch';
import { KpiStrip } from './parts';
import { entityPath, paletteItems, TASKS } from './tasks';

async function loadCurrent(entityId: string | undefined, userId: string | null | undefined): Promise<CurrentEntity | null> {
  if (!isEntityId(entityId)) return null;
  if (!userId) throw new AppError('You are not signed in.');
  const [entity, role, entities] = await Promise.all([getEntity(entityId), myRole(entityId, userId), listEntities()]);
  if (!entity || !role) return null;
  return { entity, role, entities };
}

export function EntityLayout() {
  const { entityId } = useParams();
  const { userId } = useAuth();
  const load = useLoad(() => loadCurrent(entityId, userId), [entityId, userId]);

  useEffect(() => {
    if (load.status === 'ok' && load.data && userId) rememberEntity(userId, load.data.entity.id);
  }, [load, userId]);

  if (load.status === 'loading') return <main className="page"><p className="loading" role="status">Loading entity…</p></main>;
  if (load.status === 'error') {
    return (
      <main className="page" role="alert">
        <h1 className="topbar-title" style={{ margin: '24px 0 12px' }}>This entity could not be loaded</h1>
        <p className="msg msg-error">{load.message}</p>
        <p style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-s" onClick={load.reload}>Try again</button>
          <Link className="btn btn-s" to="/entities" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>All entities</Link>
        </p>
      </main>
    );
  }
  if (!load.data) {
    // Not found and "not a member" look the same on purpose: row security gives no difference.
    return (
      <main className="page" role="alert">
        <h1 className="topbar-title" style={{ margin: '24px 0 12px' }}>No entity here</h1>
        <p className="msg msg-warn">This entity does not exist, or you are not a member of it.</p>
        <p style={{ marginTop: 16 }}><Link to="/entities">Your entities</Link></p>
      </main>
    );
  }
  return (
    <EntityContext.Provider value={load.data}>
      <Shell current={load.data} />
    </EntityContext.Provider>
  );
}

function Shell({ current }: { current: CurrentEntity }) {
  const { user } = useUser();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  usePaletteHotkey(openPalette);
  const { entity } = current;
  const task = TASKS.find(t => location.pathname.startsWith(entityPath(entity.id, t.path)));
  // The monthly report has its own Headlines section (the same tiles), so the strip is not repeated there.
  const showKpis = task !== undefined && task.group === 'tasks' && !(REPORT_LIVE && task.path === 'report') && !(CASH_PAGE_LIVE && task.path === 'cash');

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-wordmark">Klaro</div>
          <div className="logo-sub">by Ledgrly</div>
        </div>
        <nav className="nav" aria-label="Tasks">
          {(['tasks', 'setup'] as const).map(group => (
            <div key={group} style={{ display: 'contents' }}>
              <div className="nav-label">{group === 'tasks' ? 'Tasks' : 'Setup'}</div>
              {TASKS.filter(t => t.group === group).map(t => (
                <NavLink key={t.path} to={entityPath(entity.id, t.path)} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                  <span className="nav-icon" aria-hidden="true">{t.icon}</span>{t.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          {user?.primaryEmailAddress && <div className="sidebar-user" title="Signed in as">{user.primaryEmailAddress.emailAddress}</div>}
          <SignOutButton />
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div>
            <div className="page-title">{task?.label ?? 'Klaro'}</div>
            {task && <div className="topbar-sub">{task.summary}</div>}
          </div>
          <div className="topbar-right">
            <button type="button" className="btn btn-s btn-sm" onClick={openPalette} aria-label="Go to a page (Ctrl+K or Cmd+K)">
              Go to… <span className="kbd" aria-hidden="true">Ctrl K</span>
            </button>
            <EntitySwitcher current={entity} entities={current.entities} />
            <span className="pill" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }} title="Your role in this entity">{current.role}</span>
          </div>
        </header>
        <main className="content" id="main">
          {showKpis && (KPI_STRIP_LIVE ? <LiveKpiStrip /> : <KpiStrip />)}
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      {paletteOpen && <CommandPalette items={paletteItems(entity.id, entity.name)} onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
