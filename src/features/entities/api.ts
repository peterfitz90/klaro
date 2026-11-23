// Entity data access. Everything goes through src/lib/db.ts and row security: the database decides
// what the signed-in user may see, and every error is thrown to the caller.
import { assertComplete, db, DbError, must, mustMaybe, page } from '../../lib/db';
import { isEntityId, type CreateEntityArgs, type Entity, type Role } from './model';

/** A user owns at most 10 entities and may be a member of others; 200 is far above any real list. */
const LIST_SIZE = 200;
const COLUMNS = 'id,name,jurisdiction,currency';

/** Every entity the signed-in user is an active member of, by name. Throws rather than truncate. */
export async function listEntities(): Promise<Entity[]> {
  const [from, to] = page(0, LIST_SIZE);
  const rows = await must(
    db().from('entities').select(COLUMNS).order('name', { ascending: true }).order('id', { ascending: true }).range(from, to),
    'list entities',
  );
  return assertComplete(rows as Entity[], LIST_SIZE, 'list entities');
}

/** One entity, or null if it does not exist or the user is not an active member (row security). */
export async function getEntity(entityId: string): Promise<Entity | null> {
  if (!isEntityId(entityId)) return null;
  const row = await mustMaybe(db().from('entities').select(COLUMNS).eq('id', entityId).maybeSingle(), 'load entity');
  return (row as Entity | null) ?? null;
}

/** The signed-in user's own role in an entity, or null if they have none. */
export async function myRole(entityId: string, clerkUserId: string): Promise<Role | null> {
  if (!isEntityId(entityId)) return null;
  const row = await mustMaybe(
    db().from('entity_members').select('role').eq('entity_id', entityId).eq('clerk_user_id', clerkUserId).eq('is_active', true).maybeSingle(),
    'load your role',
  );
  return ((row as { role: Role } | null)?.role) ?? null;
}

/**
 * Creates the entity, the caller's owner membership and a default plan in one transaction
 * (fpa.create_entity). Returns the new entity's id. Errors (including the 10-entity cap) are thrown.
 */
export async function createEntity(args: CreateEntityArgs): Promise<string> {
  const id = await must(
    db().rpc('create_entity', {
      p_name: args.name,
      p_jurisdiction: args.jurisdiction,
      p_currency: args.currency,
      p_fiscal_year_start: args.fiscalYearStart,
    }),
    'create entity',
  );
  if (typeof id !== 'string' || !isEntityId(id)) throw new DbError('create entity', { message: 'the database did not return the new entity id' });
  return id;
}
