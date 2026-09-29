'use strict';

// Read-only installed-path diagnostics plus disposable link stress fixtures.
const { app, nativeImage, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const originalFs = require('original-fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../../..');
const { ensureDirectoryLink } = require(path.join(root, 'src/main/desktop-plugin-link'));
const rows = [];
app.whenReady().then(() => {
  const home = path.join(app.getPath('appData'), 'Deepseek-Harness-Desktop/dsh-home/profiles/web/node_modules');
  const roots = ['C:/软件/Whale Isle/resources', 'C:/软件/whale isle/resources'];
  for (const file of [path.join(home, 'dsh-task-control'), path.join(home, 'dsh-usage-panel'),
    ...roots.flatMap(root => [root + '/vendor/dsh-task-control', root + '/app.asar/assets/icon.png'])]) {
    const row = { file };
    for (const [label, io] of [['fs', fs], ['original', originalFs]]) {
      row[label] = {};
      for (const method of ['lstatSync', 'statSync', 'readlinkSync', 'realpathSync']) {
        try { const value = io[method](file); row[label][method] = typeof value === 'string' ? value : { link: value.isSymbolicLink(), directory: value.isDirectory() }; }
        catch (error) { row[label][method] = error.code; }
      }
    }
    if (file.endsWith('.png')) {
      const icon = nativeImage.createFromPath(file);
      row.image = { empty: icon.isEmpty(), size: icon.getSize() };
    }
    rows.push(row);
  }
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-link-probe-'));
  const source = path.join(fixture, 'source');
  const link = path.join(fixture, 'link');
  fs.mkdirSync(source);
  const stress = { fixture, iterations: 0, reused: 0 };
  try {
    for (let i = 0; i < 200; i++) {
      if (!ensureDirectoryLink(source, link)) stress.reused++;
      fs.statSync(link);
      stress.iterations++;
    }
  } catch (error) { stress.error = error.stack; }
  const result = { rows, stress };
  const win = new BrowserWindow({ show: false, skipTaskbar: true });
  result.windowIcons = [];
  let messages = [];
  win.hookWindowMessage(0x80, (wparam, lparam) => {
    messages.push({ kind: Number(wparam.readBigUInt64LE()), handle: lparam.readBigUInt64LE().toString() });
  });
  for (const name of ['icon.png', 'icon.ico']) {
    messages = [];
    const icon = nativeImage.createFromPath(roots[0] + '/app.asar/assets/' + name);
    win.setIcon(icon);
    result.windowIcons.push({ name, size: icon.getSize(), messages });
  }
  const windowSource = fs.readFileSync(path.join(root, 'src/main/window.js'), 'utf8');
  const snippet = windowSource.slice(windowSource.indexOf('function iconImage()'), windowSource.indexOf('function createMainWindow'));
  const iconImage = vm.runInNewContext(`${snippet}\niconImage`, { process, nativeImage, assetFile: name => roots[0] + '/app.asar/assets/' + name });
  messages = [];
  const selected = iconImage();
  win.setIcon(selected);
  result.selectedIcon = { size: selected.getSize(), messages };
  assert.equal(stress.iterations, 200);
  assert.equal(stress.reused, 199);
  assert.equal(selected.getSize().width, 256);
  assert.equal(messages.length, 2);
  assert.ok(messages.every(message => message.handle !== '0'));
  win.destroy();
  fs.writeFileSync(path.join(__dirname, 'runtime-probe-result.json'), JSON.stringify(result, null, 2));
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
