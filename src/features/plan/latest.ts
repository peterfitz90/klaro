import type { Period } from '../../engine';

/** The latest month with actuals across the entity's connections, or null. */
export function latestActualsMonth(connections: readonly { actuals_through: Period | null }[]): Period | null {
  return connections.reduce<Period | null>((m, c) => (c.actuals_through && (!m || c.actuals_through > m) ? c.actuals_through : m), null);
}
