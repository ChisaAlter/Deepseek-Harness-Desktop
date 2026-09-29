'use strict';

// Run with the repository Electron binary, not Node.
const { app, BrowserWindow, BrowserView } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../../..');
const source = fs.readFileSync(path.join(root, 'src/main/window.js'), 'utf8');
const snippet = source.slice(source.indexOf('const HARNESS_FADE_'), source.indexOf('function watchPluginBoot'));
const bootCss = fs.readFileSync(path.join(root, 'src/renderer/boot.css'), 'utf8');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const rows = [];
app.setPath('userData', path.join(__dirname, 'profile'));
app.on('window-all-closed', () => {});

async function scenario(name, reduced, color) {
  const win = new BrowserWindow({ width: 800, height: 500, show: false, frame: false, skipTaskbar: true,
    icon: path.join(root, 'assets/icon.png'),
    backgroundColor: '#ff00ff', webPreferences: { backgroundThrottling: false } });
  const view = new BrowserView({ webPreferences: { backgroundThrottling: false } });
  view.setBackgroundColor('#00000000');
  win.addBrowserView(view);
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  await win.loadURL('data:text/html,' + encodeURIComponent(`<style>:root{--boot-scene:rgb(20,40,60)}${bootCss}</style><main class="scene"></main>`));
  await view.webContents.loadURL('data:text/html,' + encodeURIComponent(`<style>
    :root { --ds-transition-duration: .2s; --ds-ease-in-out: cubic-bezier(.4,0,.2,1); }
    html,body { margin:0;width:100%;height:100%;background:transparent; }
    #surface { position:absolute;inset:0;background:${color}; }
    </style><div id="surface"></div>`));
  await view.webContents.debugger.attach('1.3');
  await view.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }],
  });
  win.showInactive();
  await delay(100);
  let coveredAt = null;
  const start = Date.now();
  const context = {
    harnessView: view, harnessRevealed: false,
    layoutHarnessView() { view.setBounds({ x: 0, y: 0, width: 800, height: 500 }); },
    setBootHarnessCovered(_win, covered) {
      coveredAt = Date.now() - start;
      void win.webContents.executeJavaScript(`document.body.toggleAttribute('data-harness-covered', ${covered})`);
    },
    desktopPet: () => null, prepareHarnessChrome() {},
    syncHarnessChrome: async () => {}, consumePendingMarketplaceJump() {},
  };
  const reveal = vm.runInNewContext(`${snippet}\nrevealHarnessView`, context);
  let done = false;
  const outcome = reveal(win).then(() => { done = true; });
  const samples = [];
  while (!done) {
    const [desktop, boot] = await Promise.all([
      view.webContents.executeJavaScript(`({opacity:+getComputedStyle(document.documentElement).opacity,held:document.documentElement.hasAttribute('data-dshd-harness-fade')})`),
      win.webContents.executeJavaScript(`({opacity:+getComputedStyle(document.querySelector('.scene')).opacity,visibility:getComputedStyle(document.body).visibility})`),
    ]);
    const screenshot = await view.webContents.capturePage();
    const bitmap = screenshot.toBitmap();
    const offset = (Math.floor(screenshot.getSize().height / 2) * screenshot.getSize().width + 30) * 4;
    const pixel = Array.from(bitmap.subarray(offset, offset + 4));
    samples.push({ at: Date.now() - start, desktop, boot, pixel });
    if (desktop.opacity > .15 && desktop.opacity < .85) {
      assert.equal(boot.opacity, 1);
      assert.equal(boot.visibility, 'visible');
      // Capture the view surface separately: BrowserWindow.capturePage does
      // not include child BrowserViews. Boot opacity is checked above.
      assert.ok(pixel[3] > 0 && pixel[3] < 255, `missing alpha fade: ${pixel}`);
      fs.writeFileSync(path.join(__dirname, `${name}-mid.png`), screenshot.toPNG());
    }
    assert.ok(Date.now() - start < 3000, 'reveal must settle');
    await delay(25);
  }
  await outcome;
  rows.push({ name, reduced, coveredAt, samples });
  assert.notEqual(coveredAt, null);
  if (!reduced) assert.ok(samples.some(sample => sample.desktop.opacity > 0 && sample.desktop.opacity < 1), 'must render intermediate frames');
  if (reduced) assert.ok(samples.every(sample => sample.desktop.opacity === 0 || sample.desktop.opacity === 1));
  const final = await view.webContents.executeJavaScript(`({opacity:+getComputedStyle(document.documentElement).opacity,held:document.documentElement.hasAttribute('data-dshd-harness-fade')})`);
  assert.deepEqual(final, { opacity: 1, held: false });
  fs.writeFileSync(path.join(__dirname, `${name}-end.png`), (await view.webContents.capturePage()).toPNG());
  rows[rows.length - 1].final = final;
  view.webContents.close();
  win.destroy();
}

app.whenReady().then(async () => {
  await scenario('light', false, 'rgb(240,244,248)');
  await scenario('dark', false, 'rgb(32,36,40)');
  await scenario('reduced', true, 'rgb(240,244,248)');
  fs.writeFileSync(path.join(__dirname, 'probe-result.json'), JSON.stringify({ ok: true, rows }, null, 2));
  console.log('PASS: light/dark/reduced-motion surface probes');
  app.exit(0);
}).catch(error => {
  fs.writeFileSync(path.join(__dirname, 'probe-result.json'), JSON.stringify({ ok: false, error: error.stack, rows }, null, 2));
  console.error(error);
  app.exit(1);
});
