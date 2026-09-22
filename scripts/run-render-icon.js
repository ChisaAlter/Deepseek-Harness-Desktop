const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const electronBin = [
  process.env.ELECTRON_PATH,
  path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
  path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron'),
].find((item) => item && fs.existsSync(item));

if (!electronBin) {
  console.error('未找到本机 Electron，无法生成图标。');
  process.exit(1);
}

const child = spawn(electronBin, [path.join(__dirname, 'render-icon.js')], {
  cwd: repoRoot,
  stdio: 'inherit',
  windowsHide: true,
});
child.on('exit', (code) => process.exit(code ?? 0));
