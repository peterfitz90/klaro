import { Link } from 'react-router-dom';
import { EmptyState } from '../../app/shell/parts';
import { entityPath } from '../../app/shell/tasks';
import { useCurrentEntity } from '../entities/context';

export function CashPage() {
  const { entity } = useCurrentEntity();
  return (
    <EmptyState title="No cash forecast yet">
      <p>Cash will show the three-way forecast: profit, balance sheet and cash, with the runway and when VAT falls due.</p>
      <p>It is built from the plan, so start with <Link to={entityPath(entity.id, 'connect')}>Connect</Link> and then <Link to={entityPath(entity.id, 'plan')}>Plan</Link>.</p>
    </EmptyState>
  );
}
