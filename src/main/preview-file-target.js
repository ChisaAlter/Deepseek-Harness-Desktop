'use strict';

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
  const roots = authority
    .authorizedRoots()
    .filter((root) => typeof root === 'string' && root.trim() !== '')
    .map((root) => path.resolve(root))
    .filter((root) => {
      const rel = path.relative(root, target);
      return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`));
    })
    .sort((left, right) => right.length - left.length);
  if (roots.length === 0) return fail('Path is outside the workspace.');

  for (const root of roots) {
    const cwd = authority.resolveAuthorizedCwd(root);
    if (!cwd) continue;
    const relativePath = path.relative(cwd, target);
    if (relativePath === '') return fail('Directories cannot be previewed.');
    if (path.isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${path.sep}`)) {
      continue;
    }
    if (!authority.resolveInside(cwd, relativePath)) continue;
    return { ok: true, cwd, relativePath };
  }
  return fail('Path is outside the workspace.');
}

module.exports = { normalizePreviewFileTarget };
