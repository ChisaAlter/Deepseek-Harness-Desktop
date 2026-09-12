import { isDeepStrictEqual } from 'node:util';

/** Recompute only side-effect-free internal projections after a concurrent write. */
export async function projectCatalog(scope, project) {
  for (let attempt = 0; ; attempt++) {
    const previous = scope.get();
    const next = project(previous);
    if (!next || next === previous) return previous;
    try { await scope.set(next, previous); return next; }
    catch (error) {
      if (error?.code !== 'SETTINGS_CONFLICT' || attempt >= 2) throw error;
    }
  }
}

/** Read-modify-write catalog access. Stale snapshots reject instead of losing mail. */
export function createCatalogScope(settings, schema) {
  settings.register('dshbot', schema);
  const revisions = new WeakMap();
  return {
    get() {
      const descriptor = settings.describe().find((entry) => entry.ns === 'dshbot');
      if (!descriptor) throw new Error('dshbot catalog is not registered');
      if (!Number.isInteger(descriptor.revision)) throw new Error('dshbot requires revision-aware Harness settings');
      const snapshot = structuredClone(descriptor.value);
      revisions.set(snapshot, descriptor.revision);
      return snapshot;
    },
    async set(next, previous) {
      if (!revisions.has(previous)) throw new Error('Catalog writes require their original snapshot');
      const patch = {};
      for (const key of Object.keys(next)) {
        if (!isDeepStrictEqual(next[key], previous[key])) patch[key] = next[key];
      }
      if (Object.keys(patch).length) await settings.update('dshbot', patch, revisions.get(previous));
    },
  };
}
