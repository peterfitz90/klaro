// Plan: empty driver panel and chart area (Phase 0). Drivers and the chart arrive in a later phase.
import { Link } from 'react-router-dom';
import { EmptyState } from '../../app/shell/parts';
import { entityPath } from '../../app/shell/tasks';
import { useCurrentEntity } from '../entities/context';

export function PlanPage() {
  const { entity } = useCurrentEntity();
  return (
    <div className="grid-2">
      <section className="card" aria-labelledby="drivers-title">
        <div className="card-header"><h2 className="card-title" id="drivers-title">Drivers</h2></div>
        <div className="card-body">
          <p className="f-hint">No drivers yet.</p>
          <p className="f-hint" style={{ marginTop: 8 }}>
            Drivers are the assumptions behind the plan, such as growth per month, headcount or days to be paid.
            Adding them comes in a later phase.
          </p>
        </div>
      </section>
      <section className="card" aria-labelledby="chart-title">
        <div className="card-header"><h2 className="card-title" id="chart-title">Plan for {entity.name}</h2></div>
        <div className="chart-area">
          <EmptyState title="Nothing to chart yet">
            <p>The plan starts from actuals. Connect where {entity.name}'s accounts come from, then build the budget from them.</p>
            <p><Link to={entityPath(entity.id, 'connect')}>Go to Connect</Link></p>
          </EmptyState>
        </div>
      </section>
    </div>
  );
}
