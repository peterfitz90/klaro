import { Link } from 'react-router-dom';
import { EmptyState } from '../../app/shell/parts';
import { entityPath } from '../../app/shell/tasks';
import { useCurrentEntity } from '../entities/context';

export function ReportPage() {
  const { entity } = useCurrentEntity();
  return (
    <EmptyState title="No reports yet">
      <p>Report will put together a board pack for a month: the figures, the variances and written commentary.</p>
      <p>It needs a plan and actuals to report on. Start with <Link to={entityPath(entity.id, 'connect')}>Connect</Link>.</p>
    </EmptyState>
  );
}
