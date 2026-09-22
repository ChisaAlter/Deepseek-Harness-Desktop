/**
 * ChisaCode Files work-loop adapters: nested directory listing, breadcrumb
 * segments, daemon path search (getDirectorySuggestions — fuzzy path match,
 * NOT content search), and read-only file preview classification over
 * `readFile`. Pure logic over an injected DaemonClient so app.js stays a thin
 * UI binder. Read-only by contract: there is no write/save RPC and none may
 * be added here.
 */

/** Files larger than this are never fetched for preview (phone budget). */
const PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
/** Text previews render at most this many bytes; longer files are truncated. */
const TEXT_RENDER_MAX_BYTES = 200 * 1024;

function normalizeRelativePath(path) {
  return String(path || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\//, '')
    .replace(/\/$/, '');
}

/**
 * List one directory level for the drill-down view. Directories sort before
 * files, each group alphabetically. Entry paths are normalized relative
 * paths without a trailing slash. Client errors propagate to the caller.
 * @param {object} client DaemonClient
 * @param {string} cwd workspace root
 * @param {string} path relative directory path ('' = root)
 * @returns {Promise<{ path: string, entries: Array<{ name: string, path: string, kind: 'file' | 'directory', size: number }> }>}
 */
async function listDirectoryView(client, cwd, path = '') {
  const relative = normalizeRelativePath(path);
  const directory = await client.listDirectory(cwd, relative);
  const raw = Array.isArray(directory?.entries) ? directory.entries : [];
  const entries = raw.flatMap((entry) => {
    const kind = entry?.kind === 'directory' ? 'directory' : 'file';
    const entryPath = normalizeRelativePath(
      typeof entry?.path === 'string' && entry.path ? entry.path : entry?.name,
    );
    if (!entryPath) return [];
    return [{
      name: typeof entry?.name === 'string' && entry.name ? entry.name : entryPath.split('/').pop(),
      path: entryPath,
      kind,
      size: Number.isFinite(entry?.size) ? entry.size : 0,
    }];
  });
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { path: relative, entries };
}

/**
 * Breadcrumb segments for a relative path; the root segment is always first.
 * @param {string} path
 * @returns {Array<{ label: string, path: string }>}
 */
function breadcrumbSegments(path) {
  const segments = [{ label: '根目录', path: '' }];
  const relative = normalizeRelativePath(path);
  if (!relative) return segments;
  let acc = '';
  for (const part of relative.split('/')) {
    acc = acc ? `${acc}/${part}` : part;
    segments.push({ label: part, path: acc });
  }
  return segments;
}

/** Parent of a relative path; the root's parent stays the root. */
function parentPath(path) {
  const relative = normalizeRelativePath(path);
  const index = relative.lastIndexOf('/');
  return index === -1 ? '' : relative.slice(0, index);
}

/**
 * Fuzzy path search via the daemon. This is `getDirectorySuggestions` — a
 * path-name matcher, explicitly NOT full-text content search. Falls back to
 * the legacy `directories` array when the daemon does not send `entries`.
 * @param {object} client DaemonClient
 * @param {string} cwd workspace root
 * @param {string} query non-empty search text
 * @param {{ limit?: number }} options
 * @returns {Promise<Array<{ path: string, kind: 'file' | 'directory' }>>}
 */
async function searchWorkspacePaths(client, cwd, query, { limit = 30 } = {}) {
  const trimmed = typeof query === 'string' ? query.trim() : '';
  if (!trimmed) {
    throw new Error('请输入要搜索的路径关键字');
  }
  const payload = await client.getDirectorySuggestions({
    query: trimmed,
    cwd,
    includeFiles: true,
    includeDirectories: true,
    matchMode: 'fuzzy',
    limit,
  });
  if (payload?.error) {
    throw new Error(typeof payload.error === 'string' ? payload.error : '路径搜索失败');
  }
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  if (entries.length) {
    return entries.flatMap((entry) => {
      const path = normalizeRelativePath(entry?.path);
      if (!path) return [];
      return [{ path, kind: entry?.kind === 'directory' ? 'directory' : 'file' }];
    });
  }
  const directories = Array.isArray(payload?.directories) ? payload.directories : [];
  return directories.flatMap((dir) => {
    const path = normalizeRelativePath(dir);
    return path ? [{ path, kind: 'directory' }] : [];
  });
}

/** True when a known file size exceeds the preview budget (skip the fetch). */
function previewSizeGate(size) {
  return Number.isFinite(size) && size > PREVIEW_MAX_BYTES;
}

/**
 * Classify a FileReadResult into one of the read-only preview states.
 * Pure: takes `{ bytes, mime, size, kind }` and never touches the network.
 * @returns {{ kind: 'too-large', size: number }
 *   | { kind: 'binary', size: number, mime: string }
 *   | { kind: 'image', mime: string, bytes: Uint8Array, size: number }
 *   | { kind: 'text', text: string, truncated: boolean, size: number }}
 */
function classifyFilePreview(result) {
  const size = Number.isFinite(result?.size) ? result.size : (result?.bytes?.byteLength ?? 0);
  if (size > PREVIEW_MAX_BYTES) {
    return { kind: 'too-large', size };
  }
  const mime = typeof result?.mime === 'string' ? result.mime : 'application/octet-stream';
  if (result?.kind === 'image') {
    return { kind: 'image', mime, bytes: result.bytes, size };
  }
  if (result?.kind !== 'text') {
    return { kind: 'binary', size, mime };
  }
  const bytes = result.bytes instanceof Uint8Array ? result.bytes : new Uint8Array();
  const truncated = bytes.byteLength > TEXT_RENDER_MAX_BYTES;
  const window = truncated ? bytes.subarray(0, TEXT_RENDER_MAX_BYTES) : bytes;
  const text = new TextDecoder('utf-8', { fatal: false }).decode(window);
  return { kind: 'text', text, truncated, size };
}

/**
 * Fetch and classify one file for read-only preview. Daemon errors (missing
 * file, >64MB transfer refusal, non-git cwd) propagate as thrown Errors.
 */
async function readFilePreview(client, cwd, path) {
  const result = await client.readFile(cwd, normalizeRelativePath(path));
  return classifyFilePreview(result);
}

/** Human file size: bytes under 1KB, else one-decimal KB / MB. */
function fileSizeLabel(size) {
  const bytes = Number.isFinite(size) ? size : 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export {
  PREVIEW_MAX_BYTES,
  TEXT_RENDER_MAX_BYTES,
  breadcrumbSegments,
  classifyFilePreview,
  fileSizeLabel,
  listDirectoryView,
  parentPath,
  previewSizeGate,
  readFilePreview,
  searchWorkspacePaths,
};
