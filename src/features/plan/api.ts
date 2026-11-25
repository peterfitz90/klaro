// Data access for the budget on Plan (Phase 1, step 1D) and for Compare and the KPI strip (1E).
// Everything goes through src/lib/db.ts under row security; every error is thrown. Lists that can be
// long are read a page at a time (pageAll); counts are exact counts, not the row cap.
import { assertComplete, db, DbError, must, mustCount, page, pageAll } from '../../lib/db';
import type { Period, VarianceRow } from '../../engine';

export interface Plan { id: string; name: string; fiscal_year_start: number }

/** The entity's plan (the first one: create_entity makes "Main plan"). */
export async function getPlan(entityId: string): Promise<Plan> {
  const rows = await must(
    db().from('plans').select('id,name,fiscal_year_start').eq('entity_id', entityId)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(0, 0),
    'load the plan',
  );
  const plan = (rows as Plan[])[0];
  if (!plan) throw new DbError('load the plan', { message: 'this entity has no plan' });
  return plan;
}

export interface Version {
  id: string;
  name: string;
  kind: 'budget' | 'forecast';
  locked_at: string | null;
  unlocked_at: string | null;
  created_at: string;
}
const VERSION_COLUMNS = 'id,name,kind,locked_at,unlocked_at,created_at';
const VERSION_LIST = 200;

/** Every budget version of the plan, oldest first. */
export async function listBudgets(planId: string): Promise<Version[]> {
  const [from, to] = page(0, VERSION_LIST);
  const rows = await must(
    db().from('plan_versions').select(VERSION_COLUMNS).eq('plan_id', planId).eq('kind', 'budget')
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to),
    'list the budgets',
  );
  return assertComplete(rows as Version[], VERSION_LIST, 'list the budgets');
}

/** The id of a version's base scenario, or null if it has none yet. */
export async function baseScenario(versionId: string): Promise<string | null> {
  const rows = await must(
    db().from('scenarios').select('id').eq('version_id', versionId).eq('is_base', true).range(0, 1),
    'load the base scenario',
  );
  const list = rows as { id: string }[];
  if (list.length > 1) throw new DbError('load the base scenario', { message: 'more than one base scenario' });
  return list[0]?.id ?? null;
}

export interface BudgetLine {
  id: string;
  plan_line: string;
  period: Period;
  /** Stored sign (trial-balance style). */
  amount: number | string | null;
  origin: 'actual' | 'driver' | 'manual' | 'from_actuals';
}

/** Every line of a version's base scenario, by month and line (paged). */
export async function budgetLines(versionId: string): Promise<BudgetLine[]> {
  const scenario = await baseScenario(versionId);
  if (!scenario) return [];
  return pageAll<BudgetLine>(
    (from, to) => db().from('plan_lines').select('id,plan_line,period,amount,origin').eq('scenario_id', scenario)
      .order('period', { ascending: true }).order('plan_line', { ascending: true }).order('id', { ascending: true }).range(from, to),
    'load the budget lines',
  );
}

/**
 * How many base-scenario lines of a version a rebuild from `budgetFrom` would replace (its 12
 * months), and how many of those were edited by hand (ui-rules section 4). Exact counts.
 */
export async function linesToReplace(versionId: string, budgetFrom: Period, budgetTo: Period): Promise<{ total: number; manual: number }> {
  const scenario = await baseScenario(versionId);
  if (!scenario) return { total: 0, manual: 0 };
  const q = () => db().from('plan_lines').select('id', { count: 'exact', head: true })
    .eq('scenario_id', scenario).gte('period', budgetFrom).lte('period', budgetTo);
  const [total, manual] = await Promise.all([
    mustCount(q(), 'count the lines to replace'),
    mustCount(q().eq('origin', 'manual'), 'count the lines edited by hand'),
  ]);
  return { total, manual };
}

/** fpa.create_budget_from_actuals: a new version (versionId null) or a rebuild of one. Returns its id. */
export async function createBudget(args: {
  planId: string; versionId: string | null; name: string | null; actualsFrom: Period; budgetFrom: Period; uplifts: Record<string, string>;
}): Promise<string> {
  const id = await must(
    db().rpc('create_budget_from_actuals', {
      p_plan_id: args.planId, p_version_id: args.versionId, p_name: args.name,
      p_actuals_from: args.actualsFrom, p_budget_from: args.budgetFrom, p_uplifts: args.uplifts,
    }),
    'build the budget',
  );
  if (typeof id !== 'string') throw new DbError('build the budget', { message: 'the database did not return the version' });
  return id;
}

/** Lock (editors and owners) or unlock (owners only; the database refuses anyone else). */
export async function setLocked(versionId: string, locked: boolean): Promise<Version> {
  const row = await must(
    db().from('plan_versions').update({ locked_at: locked ? new Date().toISOString() : null }).eq('id', versionId)
      .select(VERSION_COLUMNS).single(),
    locked ? 'lock the budget' : 'unlock the budget',
  );
  const v = row as unknown as Version;
  if ((v.locked_at !== null) !== locked) throw new DbError('lock the budget', { message: 'the database did not confirm the change' });
  return v;
}

/** A hand edit: the new amount (stored sign) and origin "manual". */
export async function editLine(lineId: string, amount: string): Promise<void> {
  const row = await must(
    db().from('plan_lines').update({ amount, origin: 'manual' }).eq('id', lineId).select('id').single(),
    'save the line',
  );
  if (!row) throw new DbError('save the line', { message: 'the database did not confirm the change' });
}

/** fpa.variance for a range of months (at most 36), read a page at a time. */
export function variance(entityId: string, versionId: string | null, from: Period, to: Period): Promise<VarianceRow[]> {
  return pageAll<VarianceRow>(
    (f, t) => db().rpc('variance', { p_entity_id: entityId, p_version_id: versionId, p_from: from, p_to: to }).range(f, t),
    'load the figures',
  );
}
