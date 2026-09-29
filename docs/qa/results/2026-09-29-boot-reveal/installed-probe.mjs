import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSmokeDirs, electronSpawnEnv, prepareSmokeWorkspace, reservePort, writeSmokeConfig } from '../../../../scripts/smoke-workspace.mjs';

const dirs = createSmokeDirs('dsh-installed-diagnostic-');
prepareSmokeWorkspace(dirs);
writeSmokeConfig(dirs.userData, dirs.workspace, await reservePort());
const port = await reservePort();
const child = spawn('C:/软件/Whale Isle/Whale Isle.exe', [`--inspect-brk=127.0.0.1:${port}`, `--user-data-dir=${dirs.userData}`, '--no-first-run'], {
  env: electronSpawnEnv({ DSH_SMOKE: '1', DSHD_ALLOW_PACKAGED_QA: '1' }), windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const lines = [];
child.stdout.on('data', chunk => lines.push(String(chunk)));
child.stderr.on('data', chunk => lines.push(String(chunk)));
let socket;
try {
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.length) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!targets?.length) throw new Error('Inspector unavailable');
  socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let seq = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const result = JSON.parse(event.data);
    if (result.id) { pending.get(result.id)?.(result); pending.delete(result.id); }
  });
  const send = (method, params = {}) => new Promise(resolve => {
    const id = ++seq; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable');
  await send('Runtime.runIfWaitingForDebugger');
  // Inspector remains attached for read-only inspection once the app is ready.
  await new Promise(resolve => setTimeout(resolve, 8000));
  const inspected = await send('Runtime.evaluate', { expression: `(() => {
    const req = process.mainModule.require.bind(process.mainModule);
    const fs = req('fs'), e = req('electron'), path = req('path');
    const iconPath = path.join(e.app.getAppPath(), 'assets/icon.png');
    const icon = e.nativeImage.createFromPath(iconPath);
    const link = path.join(e.app.getPath('userData'), 'dsh-home/profiles/web/node_modules/dsh-task-control');
    const checks = {};
    for (const op of ['lstatSync','statSync','readlinkSync']) try { const v=fs[op](link); checks[op]=typeof v==='string'?v:{link:v.isSymbolicLink()}; } catch(err) { checks[op]=err.code; }
    return { versions: process.versions, iconPath, iconEmpty: icon.isEmpty(), iconSize: icon.getSize(), checks };
  })()`, returnByValue: true });
  console.log(JSON.stringify({ dirs, inspected }, null, 2));
  socket.close();
  await new Promise(resolve => child.once('exit', resolve));
} finally {
  socket?.close();
  writeFileSync(fileURLToPath(new URL('./installed-probe.log', import.meta.url)), lines.join(''));
}
