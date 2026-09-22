'use strict';
/**
 * Link @chisacode workspace packages under vendor/chisacode-remote/node_modules
 * and optionally junction transitive deps from a sibling ChisaCode checkout.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..', 'vendor', 'chisacode-remote');
const nm = path.join(root, 'node_modules');
const scope = path.join(nm, '@chisacode');
const fromArg = process.argv.find((a) => a.startsWith('--from='));
const donor = fromArg
  ? fromArg.slice('--from='.length)
  : (fs.existsSync(path.join('C:/Ai/ChisaCode/node_modules'))
    ? 'C:/Ai/ChisaCode/node_modules'
    : '');

fs.mkdirSync(scope, { recursive: true });

function junction(link, target) {
  if (fs.existsSync(link)) {
    try { fs.rmSync(link, { recursive: true, force: true }); } catch { /* */ }
  }
  if (process.platform === 'win32') {
    execFileSync('cmd', ['/c', 'mklink', '/J', link, target], { stdio: 'inherit' });
  } else {
    fs.symlinkSync(target, link, 'dir');
  }
}

for (const name of ['protocol', 'relay', 'server', 'client', 'highlight', 'cli']) {
  junction(path.join(scope, name), path.join(root, 'packages', name));
}

if (donor && fs.existsSync(donor)) {
  for (const entry of fs.readdirSync(donor, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '@chisacode' || entry.name === '.bin') {
      continue;
    }
    if (entry.name.startsWith('@')) {
      const destScope = path.join(nm, entry.name);
      fs.mkdirSync(destScope, { recursive: true });
      const scoped = path.join(donor, entry.name);
      for (const child of fs.readdirSync(scoped, { withFileTypes: true })) {
        if (!child.isDirectory()) continue;
        const dest = path.join(destScope, child.name);
        if (!fs.existsSync(dest)) {
          junction(dest, path.join(scoped, child.name));
        }
      }
      continue;
    }
    const dest = path.join(nm, entry.name);
    if (!fs.existsSync(dest)) {
      junction(dest, path.join(donor, entry.name));
    }
  }
}

console.log('chisacode-remote deps linked under', nm);
