// The pages inside an entity: four tasks plus Connect. One list feeds the sidebar, the command
// palette and the routes, so they cannot drift apart.
export interface Task {
  path: 'plan' | 'compare' | 'cash' | 'report' | 'connect';
  label: string;
  icon: string;
  /** Shown under the title and in the palette. */
  summary: string;
  group: 'tasks' | 'setup';
}

export const TASKS: readonly Task[] = [
  { path: 'plan', label: 'Plan', icon: '◧', summary: 'Budget and forecast from drivers', group: 'tasks' },
  { path: 'compare', label: 'Compare', icon: '⇄', summary: 'Budget and forecast against actuals', group: 'tasks' },
  { path: 'cash', label: 'Cash', icon: '◔', summary: 'Cash runway and VAT timing', group: 'tasks' },
  { path: 'report', label: 'Report', icon: '▤', summary: 'Board packs and commentary', group: 'tasks' },
  { path: 'connect', label: 'Connect', icon: '⛓', summary: 'Where the actuals come from', group: 'setup' },
];

export function entityPath(entityId: string, task: Task['path'] = 'plan'): string {
  return `/e/${entityId}/${task}`;
}

export interface PaletteItem {
  id: string;
  label: string;
  detail: string;
  to: string;
}

/** Palette entries for the current entity: its pages only (Phase 0), plus the entity list. */
export function paletteItems(entityId: string, entityName: string): PaletteItem[] {
  return [
    ...TASKS.map(t => ({ id: t.path, label: t.label, detail: `${entityName} · ${t.summary}`, to: entityPath(entityId, t.path) })),
    { id: 'entities', label: 'All entities', detail: 'Switch entity or create one', to: '/entities' },
  ];
}

/** Case-insensitive match on every word typed, against the label and detail. */
export function filterPalette(items: PaletteItem[], query: string): PaletteItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter(i => {
    const text = `${i.label} ${i.detail}`.toLowerCase();
    return words.every(w => text.includes(w));
  });
}
