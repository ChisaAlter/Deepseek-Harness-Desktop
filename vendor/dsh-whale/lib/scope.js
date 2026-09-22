/**
 * Read-modify-write access to the `dsh-whale` settings namespace.
 * Same contract as dshbot's catalog-scope: revision-aware snapshots so
 * concurrent client writes reject instead of losing updates.
 */
import { isDeepStrictEqual } from 'node:util';

export function createWhaleScope(settings, schema) {
  settings.register('dsh-whale', schema);
  const revisions = new WeakMap();
  return {
    get() {
      const descriptor = settings.describe().find((entry) => entry.ns === 'dsh-whale');
      if (!descriptor) throw new Error('dsh-whale catalog is not registered');
      if (!Number.isInteger(descriptor.revision)) throw new Error('dsh-whale requires revision-aware Harness settings');
      const snapshot = structuredClone(descriptor.value);
      revisions.set(snapshot, descriptor.revision);
      return snapshot;
    },
    async set(next, previous) {
      if (!revisions.has(previous)) throw new Error('Whale settings writes require their original snapshot');
      const patch = {};
      for (const key of Object.keys(next)) {
        if (!isDeepStrictEqual(next[key], previous[key])) patch[key] = next[key];
      }
      if (Object.keys(patch).length) await settings.update('dsh-whale', patch, revisions.get(previous));
    },
  };
}
