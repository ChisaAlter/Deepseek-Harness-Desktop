// Real Electron window factories, isolated from the user's app/profile and Harness.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-window-motion-'));
app.setPath('userData', userData);
app.on('window-all-closed', () => {});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline) await delay(25);
  assert.ok(predicate(), label);
}
app.whenReady().then(async () => {
  const windows = require('../src/main/window');
  const { rendererFile } = require('../src/main/paths');
  for (const [name, factory, page] of [
    ['main', windows.createMainWindow, 'boot.html'],
    ['launcher', windows.createLauncherWindow, 'launcher.html'],
  ]) {
    const win = factory();
    await win.loadFile(rendererFile(page));
    win.show();
    const native = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-File',
      path.join(__dirname, 'probe-window-motion.ps1'), '-WindowHandle',
      String(win.getNativeWindowHandle().readBigUInt64LE())], { encoding: 'utf8', windowsHide: true }));
    console.log(`${name}: ${JSON.stringify(native)}`);
    assert.ok(native.caption, `${name}: WS_CAPTION required for native window transitions`);
    assert.ok(native.thickFrame, `${name}: WS_THICKFRAME required for native window transitions`);
    assert.equal(native.layered, false, `${name}: shell must not be a layered window`);
    win.setBounds({ x: 80, y: 80, width: 1000, height: 700 });
    await delay(300);
    const appearance = await win.webContents.executeJavaScript(`({
      native: document.documentElement.hasAttribute('data-native-window-frame'),
      radius: getComputedStyle(document.querySelector('${name === 'main' ? '.scene' : '.shell'}')).borderTopLeftRadius,
    })`);
    assert.deepEqual(appearance, { native: true, radius: '0px' }, `${name}: page must fill the native silhouette`);
    const normal = win.getBounds();
    // Drive the actual preload -> authorized IPC route, not a fake geometry helper.
    await win.webContents.executeJavaScript("window.shell.windowAction('maximize')");
    await until(() => win.isMaximized(), `${name}: must enter native maximized state (transparent-window regression)`);
    await win.webContents.executeJavaScript("window.shell.windowAction('maximize')");
    await until(() => !win.isMaximized(), `${name}: native unmaximize`);
    assert.deepEqual(win.getBounds(), normal, `${name}: restore normal bounds`);
    await win.webContents.executeJavaScript("window.shell.windowAction('minimize')");
    await until(() => win.isMinimized(), `${name}: native minimize`);
    win.restore();
    await until(() => !win.isMinimized(), `${name}: taskbar-style restore`);
    assert.deepEqual(win.getBounds(), normal, `${name}: minimize/restore bounds`);
    console.log(`PASS ${name}: native maximize/unmaximize/minimize/restore through production factories + IPC`);
    win.destroy();
  }
  console.log('Native state verified; visible DWM interpolation still requires interactive Windows QA.');
}).then(() => app.exit(0)).catch(error => {
  console.error(error);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(1);
});
