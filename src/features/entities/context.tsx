// The current entity: always taken from the URL (/e/:entityId/...), loaded under row security, and
// provided to the pages below. A page that needs entity data takes the id from here; if the entity
// cannot be loaded, nothing below renders (fail closed).
import { createContext, useContext } from 'react';
import type { Entity, Role } from './model';

export interface CurrentEntity {
  entity: Entity;
  role: Role;
  /** All entities the user can open, for the switcher and the palette. */
  entities: Entity[];
}

export const EntityContext = createContext<CurrentEntity | null>(null);

export function useCurrentEntity(): CurrentEntity {
  const v = useContext(EntityContext);
  if (!v) throw new Error('useCurrentEntity is used outside an entity page.');
  return v;
}

/** Remembers the last entity opened, per Clerk user, so "/" can go straight back to it. */
const key = (userId: string) => `klaro.lastEntity.${userId}`;

export function rememberEntity(userId: string, entityId: string): void {
  try {
    window.localStorage.setItem(key(userId), entityId);
  } catch (err) {
    // Storage can be blocked (private mode); remembering is only a convenience.
    console.warn('[ui] could not remember the last entity:', err instanceof Error ? err.message : err);
  }
}

export function lastEntity(userId: string): string | null {
  try {
    return window.localStorage.getItem(key(userId));
  } catch (err) {
    console.warn('[ui] could not read the last entity:', err instanceof Error ? err.message : err);
    return null;
  }
}
