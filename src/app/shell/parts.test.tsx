// @vitest-environment jsdom
// The placeholder KPI strip, shown only when the live strip is switched off (src/app/shell/kpiSwitch.ts).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { KpiStrip } from './parts';

afterEach(cleanup);

describe('placeholder KPI strip', () => {
  // Gate 1 fix 5: it said "No actuals yet. Connect a source first.", which is false when actuals exist.
  it('says the figures are switched off, which is true whether or not actuals exist', () => {
    render(<KpiStrip />);
    expect(screen.queryByText(/No actuals yet/)).toBeNull();
    expect(screen.queryByText(/Connect a source first/)).toBeNull();
    expect(screen.getAllByText('Key figures are switched off.')).toHaveLength(4);
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.getByRole('region', { name: 'Key figures (switched off)' })).toBeTruthy();
  });
});
