// The live KPI strip (docs/kpi-definitions.md): Revenue (month) and Net profit for the latest month of
// actuals, from fpa.variance(entity, NULL, month, month); Cash balance and Runway stay "—" in Phase 1.
// Not shown until Peter signs off the definitions (src/app/shell/kpiSwitch.ts). Fails closed: a
// failed load shows "—" and says why, never a zero.
import { formatMoney, kpiTiles, monthOf, toLines, type Period } from '../../engine';
import { callMessage } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import { listConnections, unmappedAccounts } from '../connect/api';
import { useCurrentEntity } from '../entities/context';
import { variance } from '../plan/api';
import { latestActualsMonth } from '../plan/latest';

export async function loadKpis(entityId: string, currentMonth: Period) {
  const latest = latestActualsMonth(await listConnections(entityId));
  if (!latest) return kpiTiles({ latestMonth: null, currentMonth, revenue: null, netProfit: null, unmappedAccounts: 0 });
  const [rows, unmapped] = await Promise.all([variance(entityId, null, latest, latest), unmappedAccounts(entityId)]);
  const lines = toLines(rows);
  const actual = (key: string) => lines.find(l => l.key === key)?.months.get(latest)?.actual ?? null;
  return kpiTiles({ latestMonth: latest, currentMonth, revenue: actual('revenue'), netProfit: actual('net_profit'), unmappedAccounts: unmapped.length });
}

export function LiveKpiStrip({ today }: { today?: Date } = {}) {
  const { entity } = useCurrentEntity();
  const currentMonth = monthOf(today ?? new Date());
  const load = useLoad(() => loadKpis(entity.id, currentMonth), [entity.id, currentMonth], err => callMessage(err, 'kpi'));
  const labels = ['Revenue (month)', 'Net profit', 'Cash balance', 'Runway (months)'];

  if (load.status !== 'ok') {
    return (
      <section className="kpi-grid" aria-label="Key figures" aria-busy={load.status === 'loading'}>
        {labels.map(label => (
          <div className="kpi-card" key={label} style={{ ['--tc' as string]: 'var(--border-2)' }}>
            <div className="kpi-label">{label}</div>
            <div className="kpi-value" aria-label="No figure">—</div>
            <div className="kpi-sub" role={load.status === 'error' ? 'alert' : undefined}>
              {load.status === 'loading' ? 'Loading…' : `Could not load the figures. ${load.message}`}
            </div>
          </div>
        ))}
      </section>
    );
  }
  const { tiles, stripNote } = load.data;
  return (
    <>
      <section className="kpi-grid" aria-label="Key figures" style={stripNote ? { marginBottom: 6 } : undefined}>
        {tiles.map(t => (
          <div className="kpi-card" key={t.label} style={{ ['--tc' as string]: t.cents === null ? 'var(--border-2)' : 'var(--accent)' }}>
            <div className="kpi-label">{t.label}</div>
            <div className={`kpi-value${t.cents === null ? '' : ' kpi-live'}`} aria-label={t.cents === null ? 'No figure' : undefined}>
              {t.cents === null ? '—' : formatMoney(t.cents, entity.currency)}
            </div>
            {t.notes.map(n => <div className="kpi-sub" key={n}>{n}</div>)}
          </div>
        ))}
      </section>
      {stripNote && <p className="msg msg-warn" style={{ marginBottom: 16 }} data-testid="kpi-strip-note">{stripNote}</p>}
    </>
  );
}
