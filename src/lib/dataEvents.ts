// "The entity's figures changed": sent after an import or a mapping save, so views that stay on
// screen across pages (the KPI strip in the shell) reload. A browser event, nothing more.
const EVENT = 'klaro:data-changed';

export function dataChanged(entityId: string): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { entityId } }));
}

/** Calls `fn` whenever this entity's figures change. Returns the unsubscribe function. */
export function onDataChanged(entityId: string, fn: () => void): () => void {
  const handler = (e: Event) => { if ((e as CustomEvent<{ entityId: string }>).detail?.entityId === entityId) fn(); };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
