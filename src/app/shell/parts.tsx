// Small shell pieces: the KPI strip skeleton and the empty state used by pages that are not built.
import type { ReactNode } from 'react';

/**
 * KPI strip skeleton. Phase 0 has no actuals, so every tile says so; it never shows a 0 that could
 * be read as a real figure. The four labels are Peter's choice (23 Nov 2026, after B4).
 */
export function KpiStrip() {
  const tiles = ['Revenue (month)', 'Net profit', 'Cash balance', 'Runway (months)'];
  return (
    <section className="kpi-grid" aria-label="Key figures (no data yet)">
      {tiles.map(label => (
        <div className="kpi-card" key={label} style={{ ['--tc' as string]: 'var(--border-2)' }}>
          <div className="kpi-label">{label}</div>
          <div className="kpi-value" aria-label="No figure yet">—</div>
          <div className="kpi-sub">No actuals yet. Connect a source first.</div>
        </div>
      ))}
    </section>
  );
}

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="empty">
      <h2>{title}</h2>
      {children}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </section>
  );
}
