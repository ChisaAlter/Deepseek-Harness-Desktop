const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.join(__dirname, '..');

function isElectronBinary(file) {
  if (!file || !fs.existsSync(file)) {
    return false;
  }
  const base = path.basename(file);
  // Packaged helpers such as elevate.exe, and the installed
  // Deepseek-Harness-Desktop.exe, are not a source-launch Electron.
  return /^(electron)(\.exe)?$/i.test(base);
}

function candidates() {
  const list = [];
  if (isElectronBinary(process.env.ELECTRON_PATH)) {
    list.push(process.env.ELECTRON_PATH);
  } else if (process.env.ELECTRON_PATH) {
    console.warn(
      `忽略 ELECTRON_PATH（不是 electron.exe）：${process.env.ELECTRON_PATH}`,
    );
  }
  list.push(
    path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(repoRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'),
    path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron'),
  );
  return list;
}

const electronBin = candidates().find((item) => item && fs.existsSync(item));
if (!electronBin) {
  console.error('未找到本机 Electron。设置环境变量 ELECTRON_PATH 指向 electron.exe，或把已有的 dist 目录放到 node_modules/electron/dist。');
  process.exit(1);
}

const child = spawn(electronBin, ['.'], {
  cwd: repoRoot,
  stdio: 'inherit',
  windowsHide: false,
});
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
