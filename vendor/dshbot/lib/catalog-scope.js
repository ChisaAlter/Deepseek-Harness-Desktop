import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

/** Catalog lives on the plugin entry's own volatile Config fields, so the
 * settings namespace is the Loader entry id (`dsh-bot`), not a registered
 * free-standing key. */
const CATALOG_NS = 'dsh-bot';
const CATALOG_KEYS = ['routines', 'sections', 'items', 'tasks', 'audit', 'avatarShapeMigration', 'triggerToken'];

const conflict = () => Object.assign(
  new Error('Catalog changed since it was read.'),
  { code: 'SETTINGS_CONFLICT' },
);

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

/** Read-modify-write catalog access. Stale snapshots reject instead of losing mail.
 *
 * Overlay-mounted entries cannot write through `settings.update`: the profile
 * ConfigEditor refuses rows whose insert lives in a `--patch` layer. Reads use
 * `describe()` (`dsh-bot` projects the volatile Config fields); writes persist
 * `file` first, then commit the fields in place through the entry's volatile
 * update path — no remount — and a `describe()` pass publishes the
 * `settings/document-updated` invalidation the client mirror listens to.
 *
 * `describe()` only serves ACTIVE entries, so while this fiber is still loading
 * the catalog value falls back to the resolved volatile Config refs; writes
 * stay fenced to the descriptor's revision and therefore require activation. */
export function createCatalogScope(ctx, settings, { config = {}, empty = {}, schema, file } = {}) {
  const revisions = new WeakMap();
  const descriptor = () => settings.describe().find((entry) => entry.ns === CATALOG_NS);
  const fallbackValue = () => Object.fromEntries(
    CATALOG_KEYS.map((key) => [key, config[key]?.get?.() ?? empty[key]]),
  );
  const catalogFields = (value) => Object.fromEntries(CATALOG_KEYS.map((key) => [key, value[key]]));
  let tempCounter = 0;

  let committing = false;

  async function commitVolatile(next) {
    const entry = ctx.fiber?.entry;
    if (entry === undefined) throw new Error('dshbot catalog is not active');
    committing = true;
    try {
      await entry.update({ config: { ...(entry.options?.config ?? {}), ...catalogFields(next) } });
    } finally {
      committing = false;
    }
    // describe() observes entry.options.config and emits document-updated for
    // the client mirror; the revision bump also fences the next CAS write.
    settings.describe();
  }

  // Reconciles (settings writes, patch watches, plugin installs) re-apply the
  // overlay row's declared config — which never carries the catalog fields —
  // and an absent volatile key resets its ref to the schema default. The
  // volatile-update event is fiber-filtered, so catalog paths changing
  // outside our own commit means a wipe: re-seed live refs from the file.
  ctx.on?.('loader/volatile-update', (paths) => {
    if (committing || !Array.isArray(paths)) return;
    if (!paths.some((path) => Array.isArray(path) && CATALOG_KEYS.includes(path[0]))) return;
    void Promise.resolve()
      .then(() => scope.restore())
      .catch((error) => ctx.logger?.warn?.('dshbot catalog re-seed after external reset failed: %s', error?.message ?? error));
  });

  const scope = {
    get() {
      const entry = descriptor();
      const snapshot = structuredClone(entry === undefined ? fallbackValue() : entry.value);
      revisions.set(snapshot, entry?.revision);
      return snapshot;
    },
    async set(next, previous) {
      if (!revisions.has(previous)) throw new Error('Catalog writes require their original snapshot');
      // This scope only owns the catalog fields; other Config keys are read
      // back from live options.config at commit time, so they do not count
      // toward the patch.
      const changed = CATALOG_KEYS.filter((key) => !isDeepStrictEqual(next[key], previous[key]));
      if (!changed.length) return;
      const before = descriptor();
      if (before === undefined) throw new Error('dshbot catalog is not active');
      if (before.revision !== revisions.get(previous)) throw conflict();
      // Validate before touching disk or live refs: a rejected volatile commit
      // would leave entry.options.config ahead of fiber.config silently.
      const validated = schema === undefined ? next : schema({ ...empty, ...next });
      if (file !== undefined) {
        await mkdir(dirname(file), { recursive: true });
        const temp = `${file}.${process.pid}.${Date.now()}.${tempCounter++}.tmp`;
        await writeFile(temp, JSON.stringify(catalogFields(validated), null, 2));
        await rename(temp, file);
      }
      await commitVolatile(validated);
    },
    /** Seed live volatile fields from `file` once the entry is ACTIVE. */
    async restore() {
      if (file === undefined) return false;
      let seeded;
      try {
        const parsed = JSON.parse(await readFile(file, 'utf8'));
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('catalog file is not a JSON object');
        }
        seeded = schema === undefined ? { ...empty, ...parsed } : schema({ ...empty, ...parsed });
      } catch (error) {
        if (error?.code === 'ENOENT') return false;
        // A catalog that fails to parse or validate would re-trip every start
        // and shadow every future write. Set it aside as evidence and let the
        // catalog come up empty instead of wedging activation.
        await rename(file, `${file}.rejected-${Date.now()}`).catch(() => {});
        ctx.logger?.warn?.('dshbot catalog file unreadable (%s); moved aside and starting empty', error?.message ?? error);
        return false;
      }
      const live = catalogFields(scope.get());
      if (isDeepStrictEqual(live, catalogFields(seeded))) return false;
      await commitVolatile(seeded);
      return true;
    },
  };
  return scope;
}
