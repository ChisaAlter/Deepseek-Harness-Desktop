'use strict';

const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  return { ok: false, message };
}

function hasNonFileScheme(value) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) && !/^[a-zA-Z]:[\\/]/.test(value);
}

/**
 * Normalize the floating preview request into the existing workspace
 * `{ cwd, relativePath }` contract. The caller supplies an authority whose
 * `resolveAuthorizedCwd` accepts the candidates the preview surface is allowed
 * to read; this function does not expand that allowlist.
 * @param {unknown} input
 * @param {{ authorizedRoots: Function, resolveAuthorizedCwd: Function, resolveInside: Function }} authority
 * @returns {{ ok: true, cwd: string, relativePath: string } | { ok: false, message: string }}
 */
function normalizePreviewFileTarget(input, authority) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return fail('File path is required.');
  }

  const hasCwd = Object.prototype.hasOwnProperty.call(input, 'cwd');
  const hasRelativePath = Object.prototype.hasOwnProperty.call(input, 'relativePath');
  const hasAbsolutePath = Object.prototype.hasOwnProperty.call(input, 'absolutePath');
  const relativeForm = hasCwd || hasRelativePath;
  const absoluteForm = hasAbsolutePath;

  if (relativeForm && absoluteForm) {
    return fail('Specify either cwd with relativePath or absolutePath, not both.');
  }
  if (!relativeForm && !absoluteForm) return fail('File path is required.');

  if (absoluteForm) {
    if (
      !authority
      || typeof authority.authorizedRoots !== 'function'
      || typeof authority.resolveAuthorizedCwd !== 'function'
      || typeof authority.resolveInside !== 'function'
    ) {
      return fail('Absolute paths require a workspace authority.');
    }
    return normalizeAbsolute(input.absolutePath, authority);
  }

  const cwd = input.cwd;
  const relativePath = input.relativePath;
  if (typeof cwd !== 'string' || cwd.trim() === '') {
    return fail('Workspace path is required.');
  }
  if (typeof relativePath !== 'string' || relativePath.trim() === '') {
    return fail('File path is required.');
  }
  if (hasNonFileScheme(relativePath)) {
    return fail('Only local file paths are supported.');
  }
  if (path.isAbsolute(relativePath)) {
    return fail('relativePath must be relative to cwd.');
  }
  if (authority && typeof authority.resolveInside === 'function'
    && !authority.resolveInside(cwd, relativePath)) {
    return fail('Path is outside the workspace.');
  }
  return { ok: true, cwd, relativePath };
}

function normalizeAbsolute(absolutePath, authority) {
  if (typeof absolutePath !== 'string' || absolutePath.trim() === '') {
    return fail('File path is required.');
  }
  if (hasNonFileScheme(absolutePath)) {
    return fail('Only local file paths are supported.');
  }
  if (!path.isAbsolute(absolutePath)) {
    return fail('absolutePath must be absolute.');
  }

  const target = path.resolve(absolutePath);
  // The authority canonicalizes its roots (see workspace-authority), so the
  // target must be canonicalized on the same path plane before containment is
  // checked. On macOS os.tmpdir() is reached through /var while realpathSync
  // returns /private/var, and the lexical form is what the renderer supplied.
  const realTarget = realPathOfDeepestExisting(target);
  const roots = authority
    .authorizedRoots()
    .filter((root) => typeof root === 'string' && root.trim() !== '')
    .map((root) => path.resolve(root))
    .filter((root) => {
      const rel = path.relative(root, realTarget);
      return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`));
    })
    .sort((left, right) => right.length - left.length);
  if (roots.length === 0) return fail('Path is outside the workspace.');

  for (const root of roots) {
    const relativePath = path.relative(root, realTarget);
    if (relativePath === '') return fail('Directories cannot be previewed.');
    if (path.isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${path.sep}`)) {
      continue;
    }
    // Keep the spelling the renderer supplied where possible (so /var/... on
    // macOS does not turn into /private/var/...), then let the authority
    // re-validate both the cwd and the relative target. A symlinked target
    // breaks that reconstruction (its lexical shape no longer matches the
    // canonical one), so fall back to the canonical root in that case.
    const lexicalCwd = lexicalCwdFor(target, relativePath);
    if (authority.resolveInside(lexicalCwd, relativePath)) {
      return { ok: true, cwd: lexicalCwd, relativePath };
    }
    if (authority.resolveInside(root, relativePath)) {
      return { ok: true, cwd: root, relativePath };
    }
  }
  return fail('Path is outside the workspace.');
}

/**
 * Canonicalize a target whose final components may not exist yet while keeping
 * any missing suffix attached to the real path of the deepest existing node.
 * @param {string} target - absolute, already path.resolve'd target.
 * @returns {string}
 */
function realPathOfDeepestExisting(target) {
  const missing = [];
  let node = target;
  while (true) {
    try {
      const real = fs.realpathSync(node);
      return missing.length === 0 ? real : path.join(real, ...missing.reverse());
    } catch {
      const parent = path.dirname(node);
      if (parent === node) return target;
      missing.push(path.basename(node));
      node = parent;
    }
  }
}

/**
 * Strip the target-relative suffix from the lexical target so the returned cwd
 * uses the same spelling the renderer supplied.
 * @param {string} target - absolute lexical target.
 * @param {string} relativePath - canonical target relative to the matching root.
 * @returns {string}
 */
function lexicalCwdFor(target, relativePath) {
  const segments = relativePath.split(path.sep).filter((part) => part.length > 0);
  let cwd = target;
  for (let index = segments.length; index > 0; index -= 1) cwd = path.dirname(cwd);
  return cwd;
}

module.exports = { normalizePreviewFileTarget };
