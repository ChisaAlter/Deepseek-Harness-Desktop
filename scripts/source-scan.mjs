/**
 * Shared filesystem scanning for the prestart/build freshness checks.
 *
 * The prestart gate only needs a boolean ("did any client input change after
 * the build record?"), but it used to answer that by walking the entire
 * Harness repository and filtering file paths afterwards. Two independent
 * scans then walked `packages/protocol/src` and `packages/client/src` twice
 * each. This module keeps one traversal implementation so the pruning and the
 * file predicate cannot drift apart, and so both callers can share one walk.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Directories that never contain a runtime input and are expensive to enter. */
export const DEFAULT_PRUNED_DIRS = [
  'node_modules',
  'lib',
  'dist',
  '.dsh-build',
  '.git',
  'coverage',
  '.artifacts',
];

/**
 * The remote-runtime freshness check has always used a much narrower prune
 * list than the client scan: `lib` and `coverage` there can be genuine source
 * directories (for example `packages/foo/src/lib`), so skipping them by name
 * would hide real edits. Keep that caller's semantics explicit instead of
 * applying the client list everywhere.
 */
export const REMOTE_PRUNED_DIRS = [
  'node_modules',
  'dist',
  '.tmp',
];

/**
 * Newest mtime under `dir` among files accepted by `filter`.
 * @param {string} dir root to walk.
 * @param {(file: string) => boolean} [filter] file predicate; all files when omitted.
 * @param {{
 *   pruneDir?: (dir: string) => boolean,
 *   skipDirs?: readonly string[],
 *   includeDirMtime?: boolean,
 * }} [options]
 *   `pruneDir` returns false to skip a directory entirely; `skipDirs` are always skipped.
 *   `includeDirMtime` also folds each visited directory's own mtime into the
 *   result, which is how the remote scanner detects a bare file deletion
 *   (the containing directory's mtime moves even though no file's does).
 * @returns {number} newest mtime in ms, or 0 when nothing matched.
 */
export function newestMtime(dir, filter, options = {}) {
  const skip = new Set(options.skipDirs ?? DEFAULT_PRUNED_DIRS);
  const pruneDir = options.pruneDir;
  const includeDirMtime = options.includeDirMtime === true;
  let newest = 0;
  if (!fs.existsSync(dir)) return 0;
  // Callers pass single files as well as directories (for example the mobile
  // entry module); preserve the previous "file mtime" behaviour instead of
  // failing with ENOTDIR.
  const rootStat = fs.statSync(dir);
  if (!rootStat.isDirectory()) {
    if (filter && !filter(dir)) return 0;
    return rootStat.mtimeMs;
  }
  if (includeDirMtime) newest = rootStat.mtimeMs;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (includeDirMtime) {
          try {
            newest = Math.max(newest, fs.statSync(full).mtimeMs);
          } catch {
            // A directory removed mid-walk cannot contribute a timestamp.
          }
        }
        if (skip.has(entry.name)) continue;
        if (pruneDir && !pruneDir(full)) continue;
        walk(full);
        continue;
      }
      if (filter && !filter(full)) continue;
      newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  };
  walk(dir);
  return newest;
}

/**
 * Build a scanner whose traversal only enters directories that can still
 * produce a match under `filter`. `filter` sees POSIX-normalized absolute
 * paths so it behaves the same on Windows and POSIX.
 * @param {(file: string) => boolean} filter file predicate over normalized absolute paths.
 * @param {{ skipDirs?: readonly string[], includeDirMtime?: boolean }} [options]
 * @returns {(dir: string, pruneDir?: (dir: string) => boolean) => number}
 */
export function createFileScanner(filter, options = {}) {
  return (dir, pruneDir) => newestMtime(
    dir,
    (file) => filter(file.replaceAll(path.sep, '/')),
    { ...options, pruneDir },
  );
}

/**
 * Client build inputs of the vendored Harness: TypeScript/TSX sources, styles,
 * HTML, JSON and YAML under `packages/*`, `apps/*`, `native/*` and `scripts/`.
 * The previous predicate matched by directory fragment alone, so it also
 * entered `docs`, `website`, `mobile`, `benchmarks` and every other top-level
 * tree that cannot contain a build input.
 * @param {string} file absolute path, POSIX or platform separated.
 * @returns {boolean} whether the file can affect the official client build.
 */
export function isClientSourceFile(file) {
  const normalized = file.replaceAll('\\', '/');
  if (!/(\/packages\/client\/|\/apps\/web\/|\/scripts\/)/.test(normalized)) return false;
  if (isNonBuildFile(normalized)) return false;
  return /\.(?:tsx?|css|html|json|ya?ml)$/i.test(normalized);
}

/**
 * Files that live inside a client source tree but are not read by the build:
 * test suites and their fixtures, and the README/i18n pairing documents. They
 * change constantly while working on the repo, and rebuilding the whole client
 * for them is the coarse invalidation this module exists to remove.
 * @param {string} normalized POSIX-normalized absolute path.
 * @returns {boolean} whether the build inputs are unaffected by this file.
 */
function isNonBuildFile(normalized) {
  const base = normalized.slice(normalized.lastIndexOf('/') + 1);
  if (/^README(?:[.-].*)?$/i.test(base)) return true;
  if (/\.(?:client|host|e2e|web)?\.?spec\.[cm]?[jt]sx?$/i.test(base)) return true;
  if (/\.test\.[cm]?[jt]sx?$/i.test(base)) return true;
  return /\/tests?\//.test(normalized) || /\/__tests__\//.test(normalized);
}

/**
 * Directory half of {@link isClientSourceFile}: only descend where a client
 * build input can still live under `harnessRoot`.
 * @param {string} harnessRoot absolute path of the vendored Harness checkout.
 * @returns {(dir: string) => boolean} prune predicate for {@link newestMtime}.
 */
export function createClientSourcePruner(harnessRoot) {
  const root = harnessRoot.replaceAll('\\', '/').replace(/\/+$/, '');
  return (dir) => {
    const normalized = dir.replaceAll('\\', '/');
    if (!normalized.startsWith(`${root}/`)) return false;
    const relative = normalized.slice(root.length + 1);
    // `scripts` is a top-level input, but its subdirectories are inputs too:
    // the file predicate accepts any `scripts/**/*.ts`, so the directory
    // predicate must not stop at the first level.
    if (relative === 'scripts' || relative.startsWith('scripts/')) return true;
    if (!/^(?:packages|apps|native)(?:\/|$)/.test(relative)) return false;
    return !/(?:^|\/)(?:tests?|__tests__)(?:\/|$)/.test(relative);
  };
}

/**
 * One-scan-per-directory memo for the prestart/build freshness checks. Several
 * consumers ask for the same subtree (the server stack and the mobile bundle
 * both need `packages/protocol/src` and `packages/client/src`); without the
 * memo each consumer walks it again. The memo is per run: it must never be
 * persisted, or a stale entry would hide a real source change.
 * @param {{
 *   scan?: (dir: string) => number,
 *   skipDirs?: readonly string[],
 *   includeDirMtime?: boolean,
 * }} [options] scanner seam for tests; the other options configure the default walk.
 * @returns {{ scan: (dir: string) => number, calls: Map<string, number> }}
 */
export function createScanMemo(options = {}) {
  const scan = options.scan ?? ((dir) => newestMtime(dir, undefined, {
    skipDirs: options.skipDirs,
    includeDirMtime: options.includeDirMtime,
  }));
  const cache = new Map();
  const calls = new Map();
  const fileCache = new Map();
  return {
    scan(dir) {
      calls.set(dir, (calls.get(dir) ?? 0) + 1);
      let value = cache.get(dir);
      if (value === undefined) {
        value = scan(dir);
        cache.set(dir, value);
      }
      return value;
    },
    /** Newest mtime of a single file, memoized on the same per-run basis. */
    scanFile(file) {
      calls.set(file, (calls.get(file) ?? 0) + 1);
      let value = fileCache.get(file);
      if (value === undefined) {
        value = fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;
        fileCache.set(file, value);
      }
      return value;
    },
    calls,
  };
}
