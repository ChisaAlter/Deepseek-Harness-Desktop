#!/usr/bin/env node
/*
 * Build the installer stub: installer/stub.c + embedded resources
 * (installer/ui/app.html, WebView2Loader.dll, product icon, asInvoker
 * manifest) -> build/dsh-setup-stub.exe via MinGW gcc + windres.
 *
 * scripts/wrap-setup.mjs appends the electron-builder NSIS payload and the
 * manifest tail onto this image to produce the shipped Setup.exe.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALLER_DIR = path.join(ROOT, 'installer');
const OUT = path.join(ROOT, 'build', 'dsh-setup-stub.exe');

function which(bin) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const ext of ['.exe', '']) {
      const candidate = path.join(dir, bin + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** MinGW gcc — PATH first, then the well-known CI/local locations. */
function findTool(name, envKey) {
  if (process.env[envKey]) return process.env[envKey];
  const onPath = which(name);
  if (onPath) return onPath;
  for (const candidate of [
    `C:\\msys64\\mingw64\\bin\\${name}.exe`,
    `C:\\ProgramData\\mingw64\\mingw64\\bin\\${name}.exe`,
    `C:\\mingw64\\bin\\${name}.exe`,
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const gcc = findTool('gcc', 'DSHD_GCC');
const windres = findTool('windres', 'DSHD_WINDRES');
if (!gcc || !windres) {
  console.error(
    'installer stub needs MinGW gcc + windres.\n' +
      'Install winlibs/llvm-mingw, or set DSHD_GCC / DSHD_WINDRES to the tools.'
  );
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const [maj, min, patch] = String(pkg.version).split('.').map((n) => Number.parseInt(n, 10) || 0);

// Resource script: icon id 1, the WebView2 page and loader DLL as named
// RCDATA blocks, plus version info so Properties shows the product instead of
// a bare stub. The manifest is NOT linked from this object: MinGW's endfile
// spec unconditionally appends its own `default-manifest.o`, which would
// collide with ours ("multiple non-default manifests" — two RT_MANIFEST
// entries at id 1 with undefined precedence). Instead we shadow that
// default: a manifest-only `default-manifest.o` built from stub.manifest and
// placed in a -B prefix dir wins the spec's `if-exists` lookup, so exactly
// one manifest — ours — is linked.
const posix = (p) => p.split(path.sep).join('/');
const manifestDir = path.join(INSTALLER_DIR, '.stub-manifest');
fs.mkdirSync(manifestDir, { recursive: true });
const manifestObj = path.join(manifestDir, 'default-manifest.o');
{
  const mrc = path.join(INSTALLER_DIR, '.stub.manifest.generated.rc');
  fs.writeFileSync(mrc, `1 24 "${posix(path.join(INSTALLER_DIR, 'stub.manifest'))}"\r\n`);
  execFileSync(windres, ['-O', 'coff', '-F', 'pe-x86-64', '-i', mrc, '-o', manifestObj], {
    stdio: 'inherit',
  });
  fs.rmSync(mrc, { force: true });
}

const rcPath = path.join(INSTALLER_DIR, '.stub.generated.rc');
fs.writeFileSync(
  rcPath,
  [
    `#include <windows.h>`,
    `1 ICON "${posix(path.join(ROOT, 'assets', 'icon.ico'))}"`,
    `APP_HTML RCDATA "${posix(path.join(INSTALLER_DIR, 'ui', 'app.html'))}"`,
    `WV2LOADER RCDATA "${posix(path.join(INSTALLER_DIR, 'vendor', 'webview2', 'WebView2Loader.dll'))}"`,
    `1 VERSIONINFO`,
    `FILEVERSION ${maj},${min},${patch},0`,
    `PRODUCTVERSION ${maj},${min},${patch},0`,
    `BEGIN`,
    `  BLOCK "StringFileInfo"`,
    `  BEGIN`,
    `    BLOCK "080404b0"`,
    `    BEGIN`,
    `      VALUE "FileDescription", "Deepseek-Harness-Desktop Setup\\0"`,
    `      VALUE "FileVersion", "${pkg.version}\\0"`,
    `      VALUE "InternalName", "dsh-setup-stub\\0"`,
    `      VALUE "ProductName", "Deepseek-Harness-Desktop\\0"`,
    `      VALUE "ProductVersion", "${pkg.version}\\0"`,
    `    END`,
    `  END`,
    `  BLOCK "VarFileInfo"`,
    `  BEGIN`,
    `    VALUE "Translation", 0x804, 1200`,
    `  END`,
    `END`,
    ``,
  ].join('\r\n')
);

const objPath = path.join(INSTALLER_DIR, '.stub.generated.o');
try {
  execFileSync(windres, ['-O', 'coff', '-F', 'pe-x86-64', '-i', rcPath, '-o', objPath], {
    stdio: 'inherit',
  });
  execFileSync(
    gcc,
    [
      '-O2', '-s', '-mwindows', '-municode',
      `-B${manifestDir}`,
      `-I${path.join(INSTALLER_DIR, 'vendor', 'webview2')}`,
      path.join(INSTALLER_DIR, 'stub.c'),
      objPath,
      '-o', OUT,
      '-lole32', '-luuid', '-lshlwapi', '-lshell32', '-loleaut32', '-ldwmapi',
    ],
    { stdio: 'inherit' }
  );
} finally {
  fs.rmSync(rcPath, { force: true });
  fs.rmSync(objPath, { force: true });
  fs.rmSync(manifestDir, { recursive: true, force: true });
}

console.log(`wrote ${path.relative(ROOT, OUT)} (${fs.statSync(OUT).size} bytes)`);
