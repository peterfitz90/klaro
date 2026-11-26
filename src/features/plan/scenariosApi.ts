// Data access for the Scenarios slice (Phase 3, behind SCENARIOS_LIVE). It uses only the existing
// tables and their existing grants and row security: fpa.scenarios, fpa.drivers and
// fpa.driver_values. No migration, and no grant was widened. The grants were checked as editor,
// viewer, outsider and anon in a rolled-back transaction (docs/reports/P3-LITE.md).
// - Scenarios belong to a budget version. The base scenario is the budget itself.
// - Drivers belong to the plan: three of them (percent, input), created once.
// - One value per driver per scenario, stored at the budget year's first month and applied to every
//   month.
// - Values are inserted once, then changed by updating `value` only. driver_values has UPDATE on
//   `value` only, so an upsert would be refused.
// - A locked version refuses every write (PT423, the existing lock triggers).
// Every error is thrown to the caller.
import { DRIVER_DEFS, DRIVER_KEYS, type DriverKey, type Period } from '../../engine';
import { assertComplete, db, DbError, must, page } from '../../lib/db';

export interface ScenarioRow { id: string; name: string; is_base: boolean }
export interface DriverRow { id: string; key: string }
export interface ValueRow { id: string; driver_id: string; scenario_id: string; period: Period; value: number | string }

/** The most scenarios a budget can have in this slice (Base included). */
export const MAX_SCENARIOS = 5;

export async function listScenarios(versionId: string): Promise<ScenarioRow[]> {
  const [from, to] = page(0, 50);
  const rows = await must(
    db().from('scenarios').select('id,name,is_base').eq('version_id', versionId)
      .order('is_base', { ascending: false }).order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to),
    'load the scenarios',
  );
  return assertComplete(rows as ScenarioRow[], 50, 'load the scenarios');
}

/** The plan's three scenario drivers (any that exist). */
export async function listDrivers(planId: string): Promise<DriverRow[]> {
  const keys = DRIVER_KEYS.map(k => DRIVER_DEFS[k].key);
  const rows = await must(db().from('drivers').select('id,key').eq('plan_id', planId).in('key', keys).order('key', { ascending: true }).range(0, 9), 'load the drivers');
  return rows as DriverRow[];
}

/** Creates the missing ones of the three drivers, in one request. Returns all three by driver key. */
export async function ensureDrivers(planId: string): Promise<Record<DriverKey, string>> {
  const have = await listDrivers(planId);
  const missing = DRIVER_KEYS.filter(k => !have.some(d => d.key === DRIVER_DEFS[k].key));
  if (missing.length) {
    await must(db().from('drivers').insert(missing.map(k => ({ plan_id: planId, key: DRIVER_DEFS[k].key, label: DRIVER_DEFS[k].label, unit: 'percent', kind: 'input' }))).select('id'), 'add the scenario drivers');
  }
  const all = missing.length ? await listDrivers(planId) : have;
  const out = {} as Record<DriverKey, string>;
  for (const k of DRIVER_KEYS) {
    const d = all.find(x => x.key === DRIVER_DEFS[k].key);
    if (!d) throw new DbError('add the scenario drivers', { message: 'the database did not confirm the drivers' });
    out[k] = d.id;
  }
  return out;
}

export async function listValues(scenarioIds: string[]): Promise<ValueRow[]> {
  if (scenarioIds.length === 0) return [];
  const rows = await must(db().from('driver_values').select('id,driver_id,scenario_id,period,value').in('scenario_id', scenarioIds)
    .order('scenario_id', { ascending: true }).order('driver_id', { ascending: true }).order('period', { ascending: true }).range(0, 999), 'load the scenario drivers');
  return rows as ValueRow[];
}

/** Adds scenarios (not base) to a version in one request; returns them with their ids. */
export async function addScenarios(versionId: string, names: string[]): Promise<ScenarioRow[]> {
  if (names.length === 0) return [];
  const rows = await must(db().from('scenarios').insert(names.map(name => ({ version_id: versionId, name, is_base: false }))).select('id,name,is_base'), 'add the scenarios');
  if (!Array.isArray(rows) || rows.length !== names.length) throw new DbError('add the scenarios', { message: 'the database did not confirm every scenario' });
  return rows as ScenarioRow[];
}

export async function renameScenario(id: string, name: string): Promise<void> {
  const row = await must(db().from('scenarios').update({ name }).eq('id', id).eq('is_base', false).select('id').single(), 'rename the scenario');
  if (!row) throw new DbError('rename the scenario', { message: 'the database did not confirm the change' });
}

/** Deletes a scenario that is not the base; its driver values go with it. */
export async function deleteScenario(id: string): Promise<void> {
  const rows = await must(db().from('scenarios').delete().eq('id', id).eq('is_base', false).select('id'), 'delete the scenario');
  if (!Array.isArray(rows) || rows.length !== 1) throw new DbError('delete the scenario', { message: 'the database did not confirm the deletion' });
}

/** New driver values, in one request (value is the percentage, e.g. 7.5). */
export async function insertValues(rows: { driver_id: string; scenario_id: string; period: Period; value: string }[]): Promise<void> {
  if (rows.length === 0) return;
  const out = await must(db().from('driver_values').insert(rows).select('id'), 'save the scenario drivers');
  if (!Array.isArray(out) || out.length !== rows.length) throw new DbError('save the scenario drivers', { message: 'the database did not confirm every value' });
}

/** Changes one stored value (only `value` can be updated). */
export async function updateValue(id: string, value: string): Promise<void> {
  const row = await must(db().from('driver_values').update({ value }).eq('id', id).select('id').single(), 'save the scenario drivers');
  if (!row) throw new DbError('save the scenario drivers', { message: 'the database did not confirm the change' });
}
