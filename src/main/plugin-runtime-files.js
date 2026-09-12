'use strict';

const fs = require('fs');
const path = require('path');

const SKIP_EXPORT_KEYS = new Set(['types', 'typings']);

function resolveDependencyDir(fromDir, name, resolveRoot) {
  const segments = String(name).split('/');
  let current = path.resolve(fromDir);
  const stop = path.resolve(resolveRoot);
  while (true) {
    const candidate = path.join(current, 'node_modules', ...segments);
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
    if (current === stop) {
      return null;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function addRelativeFile(files, spec) {
  if (typeof spec !== 'string' || spec.length === 0 || spec.includes('*')) {
    return;
  }
  const rel = spec.startsWith('./') ? spec.slice(2) : spec.replace(/^\//, '');
  if (!rel || rel.startsWith('node:')) {
    return;
  }
  files.add(rel);
}

function walkExportValue(files, value) {
  if (typeof value === 'string') {
    addRelativeFile(files, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      walkExportValue(files, item);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (SKIP_EXPORT_KEYS.has(key)) {
      continue;
    }
    walkExportValue(files, item);
  }
}

function declaredEntryRelatives(pkg) {
  const files = new Set();
  // Prefer package exports when present: many modern packages declare a stale
  // `main` (e.g. dist/index.js) while only shipping .cjs/.mjs via exports.
  if (pkg.exports !== undefined) {
    walkExportValue(files, pkg.exports);
    if (files.size > 0) {
      return [...files];
    }
  }
  addRelativeFile(files, pkg.module);
  addRelativeFile(files, pkg.main);
  return [...files];
}

/** True when rel exists as-is or with a Node-style resolution extension. */
function entryExists(depDir, rel) {
  const base = path.join(depDir, rel);
  if (fs.existsSync(base)) {
    return true;
  }
  for (const ext of ['.js', '.mjs', '.cjs', '.json', '.node']) {
    if (fs.existsSync(base + ext)) {
      return true;
    }
  }
  return false;
}

/**
 * Declared runtime entry files (main/module/exports, excluding type
 * declarations and the manifest itself) missing from an installed package
 * directory. Shared by the packaging gate and the launch pre-flight so both
 * reject the same partially built package: a resolvable manifest whose lib
 * entries were never built dies in Node's ESM loader exactly like an absent
 * package.
 * @param {string} dir - the installed package directory.
 * @param {object} pkg - the parsed package.json of that directory.
 * @returns {string[]} missing entry paths relative to dir.
 */
function missingDeclaredEntries(dir, pkg) {
  const missing = [];
  for (const rel of declaredEntryRelatives(pkg)) {
    if (rel.endsWith('.ts') || rel === 'package.json') {
      continue;
    }
    if (!entryExists(dir, rel)) {
      missing.push(rel);
    }
  }
  return missing;
}

function readPackageJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function posixJoin(...parts) {
  return parts.join('/');
}

/**
 * Declared production dependencies whose package.json or runtime entry file
 * is missing. Walks one level of nested dependencies so a hole like
 * js-yaml → argparse is visible.
 * @param {string} packageDir
 * @param {{ depth?: number, resolveRoot?: string }} [options]
 * @returns {string[]}
 */
function missingRuntimeFiles(packageDir, options = {}) {
  const depth = options.depth === undefined ? 1 : options.depth;
  const resolveRoot = options.resolveRoot || packageDir;
  const pkgFile = path.join(packageDir, 'package.json');
  if (!fs.existsSync(pkgFile)) {
    return ['package.json'];
  }
  const pkg = readPackageJson(pkgFile);
  if (!pkg) {
    return ['package.json'];
  }
  const deps = pkg.dependencies && typeof pkg.dependencies === 'object'
    ? Object.keys(pkg.dependencies)
    : [];
  const missing = [];
  for (const name of deps) {
    const depDir = resolveDependencyDir(packageDir, name, resolveRoot);
    if (!depDir) {
      missing.push(name);
      continue;
    }
    const depPkg = readPackageJson(path.join(depDir, 'package.json'));
    if (!depPkg) {
      missing.push(name);
      continue;
    }
    for (const rel of declaredEntryRelatives(depPkg)) {
      if (rel.endsWith('.ts')) {
        continue;
      }
      if (!entryExists(depDir, rel)) {
        missing.push(posixJoin(name, rel.split(path.sep).join('/')));
      }
    }
    if (depth > 0) {
      for (const nested of missingRuntimeFiles(depDir, { depth: depth - 1, resolveRoot })) {
        missing.push(posixJoin(name, nested));
      }
    }
  }
  return missing;
}

module.exports = {
  declaredEntryRelatives,
  missingDeclaredEntries,
  missingRuntimeFiles,
};
