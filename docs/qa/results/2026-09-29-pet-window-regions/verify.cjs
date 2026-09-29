// Run with the repository's Electron executable, ELECTRON_RUN_AS_NODE unset.
const { app, BrowserWindow, protocol, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const execFile = require('node:util').promisify(require('node:child_process').execFile);
const root = path.resolve(__dirname, '../../../..');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pet-region-')));
protocol.registerSchemesAsPrivileged([{ scheme: 'pet', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const area = screen.getPrimaryDisplay().bounds;
  const originalCursor = screen.getCursorScreenPoint();
  const main = new BrowserWindow({ x: area.x + 50, y: area.y + 50, width: 900, height: 650, backgroundColor: '#cceeff' });
  await main.loadURL('data:text/html,<body style="background:%23cceeff">Underlying window: <span id="n"></span><script>window.clicks=0;window.addEventListener("mousedown",()=>clicks++);window.framesPainted=0; function tick(){n.textContent=++framesPainted;requestAnimationFrame(tick)}tick()</script>');
  main.show(); main.focus();
  const { createLive2dPetManager } = require(path.join(root, 'src/main/desktop-live2d'));
  const manager = createLive2dPetManager({ getMainWindow: () => main,
    loadConfig: () => ({ live2dPet: { enabled: true, settings: { selfTalk: false, wander: false } } }), saveConfig: () => {} });
  const pet = manager.show();
  const results = [];
  async function mouse(point, action = 'Move') {
    const physical = screen.dipToScreenPoint(point);
    await execFile('powershell.exe', ['-NoProfile', '-File', path.join(__dirname, 'probe.ps1'),
      '-WindowHandle', String(pet.getNativeWindowHandle().readBigUInt64LE()),
      `-${action}`, '-X', String(physical.x), '-Y', String(physical.y)], { windowsHide: true });
  }
  async function region(stage) {
    const output = await execFile('powershell.exe', ['-NoProfile', '-File', path.join(__dirname, 'probe.ps1'),
      '-WindowHandle', String(pet.getNativeWindowHandle().readBigUInt64LE())], { windowsHide: true });
    const value = JSON.parse(output.stdout);
    results.push({ stage, ...value });
    console.log(`Region ${stage}: ${JSON.stringify(value)}`);
    assert.ok(value.kind > 0, `${stage}: HWND has a native region`);
    return value;
  }
  console.log('Waiting for actual pet renderer');
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await delay(500);
    const ready = await pet.webContents.executeJavaScript('typeof painted !== "undefined" && painted').catch(() => false);
    if (ready) break;
  }
  assert.equal(await pet.webContents.executeJavaScript('painted'), true, 'real THA4 renderer paints after initially empty region');
  assert.equal(pet.isFocused(), false, 'pet startup does not steal focus');
  const idle = await region('idle');
  const scale = screen.getPrimaryDisplay().scaleFactor;
  assert.ok(idle.box.right - idle.box.left < 600 * scale, 'idle native region is pet-sized');
  const before = await main.webContents.executeJavaScript('framesPainted');
  const grab = await pet.webContents.executeJavaScript('({ x: (petBodyBounds().x + petBodyBounds().right)/2 + overlayOrigin.x, y: (petBodyBounds().y + petBodyBounds().bottom)/2 + overlayOrigin.y })');
  await mouse(grab); await delay(150);
  const dragBefore = await pet.webContents.executeJavaScript('drawPos.x');
  await mouse(grab, 'Down');
  await mouse({ x: grab.x - 80, y: grab.y });
  await delay(200);
  await mouse({ x: grab.x - 80, y: grab.y }, 'Up');
  await delay(300);
  const dragAfter = await pet.webContents.executeJavaScript('drawPos.x');
  assert.ok(Math.abs(dragAfter - dragBefore) > 30, 'native drag remains captured across shaped region');
  await pet.webContents.executeJavaScript('openPanel(); paint()');
  await delay(400);
  assert.equal(await pet.webContents.executeJavaScript('!!panel'), true, 'panel remains visible');
  await region('panel');
  await pet.webContents.capturePage().then(image => fs.writeFileSync(path.join(__dirname, 'panel.png'), image.toPNG()));
  await pet.webContents.executeJavaScript('closePanel(); toggleChat(true); paint()');
  await delay(600);
  await region('chat');
  await pet.webContents.capturePage().then(image => fs.writeFileSync(path.join(__dirname, 'chat.png'), image.toPNG()));
  assert.equal(pet.isFocused(), true, 'explicit chat takes keyboard focus');
  main.focus();
  await delay(400);
  assert.equal(main.isFocused(), true, 'underlying window can regain focus with pet chat open');
  const after = await main.webContents.executeJavaScript('framesPainted');
  assert.ok(after > before + 10, 'underlying page continues rendering during pet interactions');
  await pet.webContents.executeJavaScript('toggleChat(false); paint()');
  await delay(250);
  await region('closed-chat');
  await pet.webContents.capturePage().then(image => fs.writeFileSync(path.join(__dirname, 'pet.png'), image.toPNG()));
  // Hold the real renderer's shape stationary and deliberately leave its
  // interaction flag true. Windows must deliver a click in the gap below it.
  await pet.webContents.executeJavaScript('window.requestAnimationFrame = () => 0; void 0');
  await delay(300);
  await mouse({ x: area.x + 250, y: area.y + 150 });
  await delay(200);
  const regions = [{ x: 100, y: 100, width: 80, height: 80 }, { x: 400, y: 100, width: 80, height: 80 }];
  await pet.webContents.executeJavaScript(`window.shell.setInteractive({ interactive: true, regions: ${JSON.stringify(regions)} })`);
  await region('disjoint-interactive');
  assert.equal(manager.isInteractive(), true, 'renderer exit deliberately remains stale before native click');
  await mouse({ x: area.x + 250, y: area.y + 150 }, 'Click');
  await delay(200);
  assert.ok(await main.webContents.executeJavaScript('clicks > 0'), 'native click in transparent gap reaches underlying page');
  assert.equal(manager.isInteractive(), true, 'native shape protects gap without renderer disabling interaction');
  await pet.webContents.executeJavaScript('window.shell.setInteractive({ regions: [] })');
  assert.equal((await region('empty')).kind, 1, 'empty shape stays empty at HWND level');
  await mouse(originalCursor);
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify({ results, underlyingFrames: after - before, dragBefore, dragAfter, nativeGapClick: true, scale }, null, 2));
  console.log('PASS native pet regions, real renderer startup, native drag, panel/chat, focus handoff, underlying rAF and native gap click');
  manager.dispose(); main.destroy(); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
setTimeout(() => { console.error('QA timed out'); app.exit(1); }, 120000).unref();
