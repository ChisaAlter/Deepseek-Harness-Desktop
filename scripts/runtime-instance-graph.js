'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { RUNTIME_LINKS, materializeRuntimeLinks } = require('../src/shared/runtime-links');

/** Assemble one physical directory per source instance; links preserve Node's realpath cache keys. */
async function assembleRuntimeInstances(sourceRoot, targetRoot, seeds, helpers) {
  const { resolvePackageFrom, runtimeDependencyEntries, collectFiles, copyFiles,
    runtimeOmitRootDirs, samePublishedPackageFiles, devOnlyNames } = helpers;
  sourceRoot = fs.realpathSync(sourceRoot);
  targetRoot = path.resolve(targetRoot);
  if (targetRoot === sourceRoot || targetRoot.startsWith(sourceRoot + path.sep)
      || sourceRoot.startsWith(targetRoot + path.sep)) throw new Error('Runtime source and destination overlap');
  fs.mkdirSync(targetRoot, { recursive: true });
  targetRoot = fs.realpathSync(targetRoot);
  if (targetRoot === sourceRoot || targetRoot.startsWith(sourceRoot + path.sep)
      || sourceRoot.startsWith(targetRoot + path.sep)) throw new Error('Runtime source and destination overlap');
  const relative = file => path.relative(targetRoot, file).split(path.sep).join('/');
  const store = path.join(targetRoot, 'node_modules', '.dsh-instances');
  const workspace = new Map(seeds.map(seed => [fs.realpathSync(seed.source), seed]));
  const nodes = new Map();
  const targets = new Map();
  function visit(source) {
    source = fs.realpathSync(source);
    if (nodes.has(source)) return nodes.get(source);
    if (nodes.size >= 10000) throw new Error('Runtime instance graph exceeds package budget');
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    if (devOnlyNames.has(manifest.name)) throw new Error(`Test-only runtime dependency: ${manifest.name}`);
    const seed = workspace.get(source);
    const id = createHash('sha256').update(path.relative(sourceRoot, source).split(path.sep).join('/')).digest('hex').slice(0, 24);
    const target = seed ? path.resolve(targetRoot, path.relative(sourceRoot, source)) : path.join(store, id);
    if (!target.startsWith(targetRoot + path.sep)) throw new Error(`Runtime package escapes target: ${manifest.name}`);
    if (targets.has(target)) throw new Error(`Runtime instance target collision: ${target}`);
    const node = { source, target, manifest, deps: [] };
    nodes.set(source, node);
    targets.set(target, source);
    for (const [name, kind] of runtimeDependencyEntries(manifest)) {
      const dependency = resolvePackageFrom(source, name, sourceRoot);
      if (!dependency) {
        if (kind === 'required') throw new Error(`Missing runtime dependency: ${manifest.name} -> ${name}`);
        continue;
      }
      node.deps.push({ name, node: visit(dependency) });
    }
    return node;
  }
  for (const seed of seeds) visit(seed.source);
  const roots = new Map();
  for (const node of nodes.values()) if (!roots.has(node.manifest.name)) roots.set(node.manifest.name, node);
  for (const [name] of roots) {
    const resolved = resolvePackageFrom(sourceRoot, name, sourceRoot);
    const root = resolved && nodes.get(fs.realpathSync(resolved));
    if (root) roots.set(name, root);
  }
  for (const seed of seeds) roots.set(seed.name, nodes.get(fs.realpathSync(seed.source)));

  const nm = path.join(targetRoot, 'node_modules');
  // Only the generated target tree is replaced, after the complete source graph is known.
  fs.rmSync(nm, { recursive: true, force: true });
  let files = 0;
  for (const node of nodes.values()) {
    fs.rmSync(node.target, { recursive: true, force: true });
    const entries = collectFiles(node.source, node.target, false, false, runtimeOmitRootDirs(node.source, sourceRoot));
    files += await copyFiles(entries, 32);
  }
  const links = [];
  function addLink(owner, name, node) {
    if (!/^(@[^/]+\/)?[^/]+$/.test(name) || name.includes('\\') || name.includes('..')) {
      throw new Error(`Invalid runtime package name: ${name}`);
    }
    links.push({ path: relative(path.join(owner, 'node_modules', ...name.split('/'))), target: relative(node.target) });
  }
  for (const node of nodes.values()) for (const dep of node.deps) addLink(node.target, dep.name, dep.node);
  for (const [name, node] of roots) addLink(targetRoot, name, node);
  fs.writeFileSync(path.join(targetRoot, RUNTIME_LINKS), JSON.stringify({ version: 1, links }) + '\n');
  materializeRuntimeLinks(targetRoot);

  // Compare source bytes and each resolved edge independently of the generated manifest.
  for (const node of nodes.values()) {
    if (!samePublishedPackageFiles(node.source, node.target, sourceRoot)) {
      throw new Error(`Runtime package bytes differ: ${node.manifest.name}`);
    }
    for (const dep of node.deps) {
      const resolved = resolvePackageFrom(node.target, dep.name, targetRoot);
      if (!resolved || fs.realpathSync(resolved) !== fs.realpathSync(dep.node.target)) {
        throw new Error(`Runtime instance edge changed: ${node.manifest.name} -> ${dep.name}`);
      }
    }
  }
  console.log(`Runtime instance graph verified: ${nodes.size} packages, ${links.length} links`);
  return files;
}

module.exports = { assembleRuntimeInstances };
