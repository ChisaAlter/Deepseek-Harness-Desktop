import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
if (process.platform !== 'win32') {
  console.log('SKIP native Windows window motion QA on non-Windows');
} else {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [fileURLToPath(new URL('./qa-window-motion.cjs', import.meta.url))], {
    env, stdio: 'inherit', windowsHide: true,
  });
  const timeout = setTimeout(() => { child.kill(); process.exitCode = 1; }, 45000);
  child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
  child.on('exit', code => { clearTimeout(timeout); process.exitCode = code ?? 1; });
}
