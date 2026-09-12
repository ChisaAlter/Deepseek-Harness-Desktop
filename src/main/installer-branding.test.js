'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const nsis = pkg.build.nsis;

function readBmp(relative) {
  const buf = fs.readFileSync(path.join(ROOT, relative));
  return {
    magic: buf.toString('ascii', 0, 2),
    width: buf.readInt32LE(18),
    height: buf.readInt32LE(22),
    bitsPerPixel: buf.readUInt16LE(28),
    compression: buf.readUInt32LE(30),
  };
}

test('nsis keeps the assisted-installer product contract', () => {
  assert.equal(nsis.oneClick, false);
  assert.equal(nsis.allowToChangeInstallationDirectory, true);
  assert.equal(nsis.createDesktopShortcut, true);
  assert.equal(nsis.createStartMenuShortcut, true);
  assert.equal(nsis.shortcutName, 'Deepseek-Harness-Desktop');
  assert.equal(nsis.artifactName, 'Deepseek-Harness-Desktop-Setup-${version}.${ext}');
  // Per-user default install path (%LOCALAPPDATA%\Programs) — TC-INST-013
  // opens resources\node.exe there; do not flip to perMachine.
  assert.equal(nsis.perMachine, undefined);
  // Uninstall must never delete userData (desktop dsh-home lives there).
  assert.equal(nsis.deleteAppDataOnUninstall, undefined);
});

test('release workflow artifact globs still match the artifact name', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  const publish = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'publish.yml'), 'utf8');
  assert.ok(nsis.artifactName.startsWith('Deepseek-Harness-Desktop-Setup-'));
  assert.match(yml, /dist\/Deepseek-Harness-Desktop-Setup-\*\.exe/);
  assert.match(yml, /dist\/Deepseek-Harness-Desktop-Setup-\*\.exe\.blockmap/);
  assert.match(publish, /DeepSeek-Harness-windows-x64/);
  assert.match(publish, /Deepseek-Harness-Desktop-Setup-\*\.exe/);
  assert.match(publish, /Deepseek-Harness-Desktop-Setup-\*\.exe\.blockmap/);
});

test('bilingual release notes describe the installed Browser mini-player contract', () => {
  const notes = [
    fs.readFileSync(path.join(ROOT, '.github', 'release-notes.md'), 'utf8'),
    fs.readFileSync(path.join(ROOT, '.github', 'release-notes.en.md'), 'utf8'),
  ];
  for (const note of notes) {
    assert.match(note, /dshd mini-player/);
    assert.match(note, /Browser guest/);
    assert.match(note, /previewId/);
    assert.match(note, /renderer/);
    assert.match(note, /chat viewport|聊天可视区/);
    assert.match(note, /BrowserView/);
    assert.match(note, /URL/);
    assert.match(note, /history/);
  }
  assert.match(notes[0], /安装版 Browser.*P0/);
  assert.match(notes[1], /installed-package Browser.*P0/);
});

test('branded installer bitmaps are classic 24-bit BMPs at MUI2 geometry', () => {
  const cases = [
    [nsis.installerSidebar, 'build/installerSidebar.bmp', 164, 314],
    [nsis.uninstallerSidebar, 'build/uninstallerSidebar.bmp', 164, 314],
    [nsis.installerHeader, 'build/installerHeader.bmp', 150, 57],
  ];
  for (const [configured, expectedPath, width, height] of cases) {
    assert.equal(configured, expectedPath);
    const bmp = readBmp(expectedPath);
    assert.equal(bmp.magic, 'BM', `${expectedPath} must be a BMP`);
    assert.equal(bmp.width, width, `${expectedPath} width`);
    assert.equal(bmp.height, height, `${expectedPath} height`);
    assert.equal(bmp.bitsPerPixel, 24, `${expectedPath} must be 24-bit`);
    assert.equal(bmp.compression, 0, `${expectedPath} must be uncompressed (BI_RGB)`);
  }
});

test('installer and uninstaller icons stay on the product whale icon', () => {
  assert.equal(pkg.build.win.icon, 'assets/icon.ico');
  assert.equal(nsis.installerIcon, 'assets/icon.ico');
  assert.equal(nsis.uninstallerIcon, 'assets/icon.ico');
  const ico = fs.readFileSync(path.join(ROOT, 'assets', 'icon.ico'));
  assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0], 'assets/icon.ico must be an ICO container');
});

test('license page shows the repository MIT license', () => {
  assert.equal(nsis.license, 'LICENSE');
  const license = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
  assert.match(license, /^MIT License/);
});

test('installer languages are Chinese-first with an English fallback', () => {
  // zh_CN first: unmatched OS locales fall back to the first MUI language.
  assert.deepEqual(nsis.installerLanguages, ['zh_CN', 'en_US']);
});

test('installer.nsh customizes GUI pages only and stays silent-install (/S) safe', () => {
  assert.equal(nsis.include, 'build/installer.nsh');
  const nsh = fs.readFileSync(path.join(ROOT, 'build', 'installer.nsh'), 'utf8');
  // Exactly the three GUI-only extension points; anything else (customInstall,
  // customInit, sections…) would also run during silent installs/upgrades.
  const macros = [...nsh.matchAll(/^!macro\s+(\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(macros, ['customWelcomePage', 'customUnWelcomePage', 'customHeader']);
  assert.match(nsh, /!insertmacro MUI_PAGE_WELCOME/);
  // customUnWelcomePage *replaces* the stock un-welcome insertion in
  // electron-builder's assistedInstaller.nsh, so it must (a) re-insert the
  // page — or the uninstaller loses its welcome page entirely — and (b)
  // re-define the 3-line title, because MUI2 unsets MUI_WELCOMEPAGE_* after
  // every page and the installer-side define never reaches the uninstaller
  // (that was the clipped "…Uninstall" third line).
  // \r?\n: Windows CI checks out with autocrlf (no .gitattributes), so the
  // file arrives CRLF there while local/macOS/Linux trees keep LF.
  const unWelcome = nsh.match(/^!macro customUnWelcomePage\r?\n([\s\S]*?)^!macroend/m);
  assert.ok(unWelcome, 'customUnWelcomePage macro body');
  assert.match(unWelcome[1], /!define MUI_WELCOMEPAGE_TITLE_3LINES/);
  assert.match(unWelcome[1], /!insertmacro MUI_UNPAGE_WELCOME/);
  assert.match(nsh, /BrandingText "Deepseek-Harness-Desktop \$\{VERSION\}"/);
  const code = nsh
    .split('\n')
    .filter((line) => !line.trim().startsWith('#') && !line.trim().startsWith(';'))
    .join('\n');
  assert.doesNotMatch(code, /MessageBox/i);
  assert.doesNotMatch(code, /RequestExecutionLevel/i);
  assert.doesNotMatch(code, /^\s*Section\b/im);
  assert.doesNotMatch(code, /ExecWait|ExecShell\b/);
});

test('bitmap renderer pins the MUI2 geometry and stays regenerable', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'render-installer-assets.js'), 'utf8');
  assert.match(source, /SIDEBAR_WIDTH = 164/);
  assert.match(source, /SIDEBAR_HEIGHT = 314/);
  assert.match(source, /HEADER_WIDTH = 150/);
  assert.match(source, /HEADER_HEIGHT = 57/);
  // Bitmap literals mirror the official light table in dsh-webui-tokens.css
  // (launcher-aligned): sidebar fill, label primary, brand-blue accent.
  assert.match(source, /rgb\(249, 250, 251\)/); // --dsw-specific-sidebar-fill
  assert.match(source, /rgb\(15, 17, 21\)/); // --dsw-alias-label-primary
  assert.match(source, /rgb\(65, 118, 230\)/); // --dsw-static-deepseek-500
  // Sidebar carries the product name, not a parallel marketing wordmark.
  assert.match(source, /Deepseek-Harness-/);
  // The near-black icon-tile marketing panel (a second skin) must not return,
  // and boot instrument-canvas tokens never reach the installer.
  assert.doesNotMatch(source, /#0b0d12/i);
  assert.doesNotMatch(source, /--boot-/);
  assert.equal(pkg.scripts['installer:assets'], 'node scripts/run-render-installer-assets.js');
});

test('dist pipeline wraps the NSIS setup into the branded shell', () => {
  assert.match(pkg.scripts.dist, /wrap-setup\.mjs/);
});

test('stub tail format round-trips between wrap-setup and stub.c', async () => {
  const { buildTail, parseTail } = await import('../../scripts/wrap-setup.mjs');
  const manifest = {
    v: 1,
    payloadLen: 42,
    installBytes: 1000,
    version: '0.0.0-test',
    productName: 'Deepseek-Harness-Desktop',
    exeName: 'Deepseek-Harness-Desktop.exe',
  };
  const payload = Buffer.alloc(42, 0xab);
  const wrapped = Buffer.concat([Buffer.alloc(100, 0x5a), payload, buildTail(manifest)]);
  const parsed = parseTail(wrapped);
  assert.ok(parsed, 'wrapped exe parses');
  assert.equal(parsed.payloadOfs, 100);
  assert.equal(parsed.payloadLen, 42);
  assert.deepEqual(parsed.manifest, manifest);
  // An unwrapped buffer must not parse as a package.
  assert.equal(parseTail(Buffer.alloc(64, 7)), null);

  // C side must share the same magic + field names.
  const stub = fs.readFileSync(path.join(ROOT, 'installer', 'stub.c'), 'utf8');
  assert.match(stub, /DSHSTUB/);
  assert.match(stub, /payloadLen/);
  assert.match(stub, /installBytes/);
});

test('installer stub keeps silent /S pass-through and GUI fallback', () => {
  const stub = fs.readFileSync(path.join(ROOT, 'installer', 'stub.c'), 'utf8');
  // Silent installs hand straight to the embedded NSIS payload.
  assert.match(stub, /\/S/);
  assert.match(stub, /\/D=/);
  assert.match(stub, /runInner\(TRUE/);
  // The branded UI is optional: WebView2 unavailable, page never ready, or
  // browser process dead all fall back to the classic NSIS wizard.
  assert.match(stub, /runInnerGuiAndWait/);
  assert.match(stub, /TIMER_READY/);
  assert.match(stub, /g_wvReady/);
  // DSHD_SETUP_FORCE_FALLBACK forces the wizard path so the no-WebView2
  // user journey is testable on machines where the runtime is healthy.
  assert.match(stub, /DSHD_SETUP_FORCE_FALLBACK/);
});

test('release workflow gates the real wrapped Setup, not only win-unpacked', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(yml, /scripts\/verify-setup-install\.mjs/);
  // The gate verifies the actual artifact: wrapper tail, /S /D install,
  // uninstall registration, shortcuts, forced-fallback spawn, cleanup.
  const script = fs.readFileSync(path.join(ROOT, 'scripts', 'verify-setup-install.mjs'), 'utf8');
  assert.match(script, /DSHSTUB/);
  assert.match(script, /\/S/);
  assert.match(script, /\/D=/);
  assert.match(script, /DSHD_SETUP_FORCE_FALLBACK/);
  assert.match(script, /dsh-inner-setup/);
  assert.match(script, /UninstallString/);
});

test('installer stub rejects mangled install records before upgrade', () => {
  const stub = fs.readFileSync(path.join(ROOT, 'installer', 'stub.c'), 'utf8');
  // A stored install dir must be a proper absolute path: drive-relative
  // ("C:foo") or otherwise corrupted registry values are ignored instead of
  // steering an upgrade into a phantom location (incident 2026-09-12).
  assert.match(stub, /isAbsoluteDirW/);
  assert.match(stub, /dirContainsApp/);
  // Resolution precedence matches the inner NSIS upgrade path:
  // Software\<subkey> InstallLocation first, UninstallString-derived dir next.
  assert.match(stub, /InstallLocation/);
});

test('branded installer page stays on official light-theme tokens', () => {
  const html = fs.readFileSync(path.join(ROOT, 'installer', 'ui', 'app.html'), 'utf8');
  assert.match(html, /--dsw-alias-bg-base/);
  assert.match(html, /--dsw-alias-label-primary/);
  assert.match(html, /--dsw-alias-state-business-primary|--dsw-static-deepseek-500/);
  // No second skin: no boot-page tokens, no arbitrary hex palette.
  assert.doesNotMatch(html, /--boot-/);
  assert.doesNotMatch(html, /#[0-9a-fA-F]{3,8}\b/);
});
