// Small shell pieces: the KPI strip skeleton and the empty state used by pages that are not built.
import type { ReactNode } from 'react';

/**
 * The placeholder KPI strip, shown only when the live strip is switched off (kpiSwitch.ts). It never
 * shows a 0 that could be read as a real figure, and says only what is true whether or not actuals
 * exist. The four labels are Peter's choice (23 Nov 2026, after B4).
 */
export function KpiStrip() {
  const tiles = ['Revenue (month)', 'Net profit', 'Cash balance', 'Runway (months)'];
  return (
    <section className="kpi-grid" aria-label="Key figures (switched off)">
      {tiles.map(label => (
        <div className="kpi-card" key={label} style={{ ['--tc' as string]: 'var(--border-2)' }}>
          <div className="kpi-label">{label}</div>
          <div className="kpi-value" aria-label="No figure">—</div>
          <div className="kpi-sub">Key figures are switched off.</div>
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
