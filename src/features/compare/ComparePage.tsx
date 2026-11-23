import { Link } from 'react-router-dom';
import { EmptyState } from '../../app/shell/parts';
import { entityPath } from '../../app/shell/tasks';
import { useCurrentEntity } from '../entities/context';

export function ComparePage() {
  const { entity } = useCurrentEntity();
  return (
    <EmptyState title="Nothing to compare yet">
      <p>Compare puts the budget and forecast next to actuals, month by month, with the differences.</p>
      <p>It needs two things first: actuals (from <Link to={entityPath(entity.id, 'connect')}>Connect</Link>) and a budget (from <Link to={entityPath(entity.id, 'plan')}>Plan</Link>).</p>
    </EmptyState>
  );
}
