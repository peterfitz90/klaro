// The live KPI strip (docs/kpi-definitions.md): Revenue (month) and Net profit for the latest month of
// actuals, from fpa.variance(entity, NULL, month, month); Cash balance and Runway (with the net cash
// burn) from fpa.cash_position and src/engine/cash.ts, once CASH_KPIS_LIVE is on (Phase 2).
// Not shown until Peter signs off the definitions (src/app/shell/kpiSwitch.ts). Fails closed: a
// failed load shows "—" and says why, never a zero. Reloads when an import or a mapping save changes
// the entity's figures (src/lib/dataEvents.ts).
import { useEffect } from 'react';
import { CASH_KPIS_LIVE } from '../../app/shell/kpiSwitch';
import { cashKpis, formatMoney, kpiTiles, monthOf, toLines, withCashTiles, type Currency, type Period } from '../../engine';
import { onDataChanged } from '../../lib/dataEvents';
import { callMessage } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import { cashPosition, listConnections, unmappedAccounts } from '../connect/api';
import { useCurrentEntity } from '../entities/context';
import { variance } from '../plan/api';
import { latestActualsMonth } from '../plan/latest';

export async function loadKpis(entityId: string, currentMonth: Period, currency: Currency = 'EUR', cashLive = CASH_KPIS_LIVE) {
  const [connections, cashRows] = await Promise.all([listConnections(entityId), cashLive ? cashPosition(entityId) : Promise.resolve(null)]);
  const latest = latestActualsMonth(connections);
  const cash = cashRows === null ? null : cashKpis(cashRows, { currentMonth, actualsThrough: latest, currency });
  if (!latest) {
    const none = kpiTiles({ latestMonth: null, currentMonth, revenue: null, netProfit: null, unmappedAccounts: 0 });
    return { ...none, tiles: withCashTiles(none.tiles, cash) };
  }
  const [rows, unmapped] = await Promise.all([variance(entityId, null, latest, latest), unmappedAccounts(entityId)]);
  const lines = toLines(rows);
  const actual = (key: string) => lines.find(l => l.key === key)?.months.get(latest)?.actual ?? null;
  const out = kpiTiles({ latestMonth: latest, currentMonth, revenue: actual('revenue'), netProfit: actual('net_profit'), unmappedAccounts: unmapped.length });
  return { ...out, tiles: withCashTiles(out.tiles, cash) };
}

export function LiveKpiStrip({ today }: { today?: Date } = {}) {
  const { entity } = useCurrentEntity();
  const currentMonth = monthOf(today ?? new Date());
  const load = useLoad(() => loadKpis(entity.id, currentMonth, entity.currency), [entity.id, currentMonth], err => callMessage(err, 'kpi'));
  const { reload } = load;
  useEffect(() => onDataChanged(entity.id, reload), [entity.id, reload]);
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
        {tiles.map(t => {
          const shown = t.cents !== null ? formatMoney(t.cents, entity.currency) : t.text ?? null;
          return (
            <div className="kpi-card" key={t.label} data-testid={`kpi-${t.label}`} style={{ ['--tc' as string]: shown === null ? 'var(--border-2)' : 'var(--accent)' }}>
              <div className="kpi-label">{t.label}</div>
              <div className={`kpi-value${shown === null ? '' : ' kpi-live'}`} aria-label={shown === null ? 'No figure' : undefined}>
                {shown ?? '—'}
              </div>
              {t.notes.map(n => <div className="kpi-sub" key={n}>{n}</div>)}
            </div>
          );
        })}
      </section>
      {stripNote && <p className="msg msg-warn" style={{ marginBottom: 16 }} data-testid="kpi-strip-note">{stripNote}</p>}
    </>
  );
}
