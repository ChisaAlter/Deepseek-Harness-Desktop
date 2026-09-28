'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RUNTIME_LINKS = '.dsh-runtime-links.json';

function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\')
      || relative.split('/').some(part => !part || part === '.' || part === '..')
      || path.isAbsolute(relative) || /^[a-z]:/i.test(relative)) {
    throw new Error(`Invalid runtime link path: ${relative}`);
  }
  const full = path.resolve(root, relative);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error(`Runtime link escapes root: ${relative}`);
  return full;
}

function readRuntimeLinks(root) {
  const file = path.join(root, RUNTIME_LINKS);
  if (!fs.existsSync(file)) return [];
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.links)) throw new Error('Invalid runtime link manifest');
  const seen = new Set();
  return manifest.links.map(link => {
    const from = inside(root, link.path);
    const target = inside(root, link.target);
    if (seen.has(from) || from === target) throw new Error(`Conflicting runtime link: ${link.path}`);
    seen.add(from);
    return { from, target };
  });
}

function materializeRuntimeLinks(root) {
  const links = readRuntimeLinks(root);
  for (const { from, target } of links) {
    const targetReal = fs.realpathSync(target);
    if (!targetReal.startsWith(fs.realpathSync(root) + path.sep) || !fs.statSync(targetReal).isDirectory()) {
      throw new Error(`Invalid runtime link target: ${target}`);
    }
    // Never follow a parent supplied as a junction to somewhere outside this extract.
    let parent = path.dirname(from);
    while (!fs.existsSync(parent)) parent = path.dirname(parent);
    const parentReal = fs.realpathSync(parent);
    const rootReal = fs.realpathSync(root);
    if (parentReal !== rootReal && !parentReal.startsWith(rootReal + path.sep)) {
      throw new Error(`Runtime link parent escapes root: ${from}`);
    }
    let info;
    try { info = fs.lstatSync(from); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (info) {
      if (!info.isSymbolicLink()) throw new Error(`Runtime link would replace a directory: ${from}`);
      let current;
      try { current = fs.realpathSync(from); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (current === targetReal) continue;
      fs.unlinkSync(from);
    }
    fs.mkdirSync(path.dirname(from), { recursive: true });
    fs.symlinkSync(process.platform === 'win32' ? targetReal : path.relative(path.dirname(from), targetReal),
      from, process.platform === 'win32' ? 'junction' : 'dir');
  }
  return links.length;
}

function removeRuntimeLinks(root) {
  const links = readRuntimeLinks(root);
  for (const { from } of links.reverse()) {
    let info;
    try { info = fs.lstatSync(from); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!info) continue;
    if (!info.isSymbolicLink()) throw new Error(`Runtime archive link is not a link: ${from}`);
    fs.unlinkSync(from);
  }
}

module.exports = { RUNTIME_LINKS, materializeRuntimeLinks, removeRuntimeLinks };
