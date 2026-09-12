#!/usr/bin/env node
// Release gate: verify the ACTUAL wrapped Setup.exe, not dist/win-unpacked.
//
//   node scripts/verify-setup-install.mjs [--skip-gui]
//
// What it proves on the real artifact in dist/:
//   1. The Setup is wrapped (DSHSTUB tail marker present) — catches the
//      "CI shipped a bare NSIS installer" regression class.
//   2. `/S /D=<dir>` silent install completes and produces the full tree
//      (exe + app.asar + embedded node + vendored harness payload).
//   3. A valid per-user uninstall registration is written (InstallLocation
//      is absolute and matches the /D target; UninstallString resolves).
//   4. Desktop + Start Menu shortcuts exist.
//   5. GUI launch with DSHD_SETUP_FORCE_FALLBACK=1 spawns the classic
//      wizard (dsh-inner-setup.exe child) — the same degradation path a
//      machine without a working WebView2 takes. The wizard is left
//      headless on CI and the process tree is killed after detection.
//   6. `/S` uninstall removes the tree and the registry registration.
//
// The branded-WebView2 page itself stays a manual TC-INST item: it needs a
// machine with a healthy WebView2 runtime, which CI cannot guarantee.

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  closeSync, existsSync, mkdtempSync, openSync, readdirSync,
  readFileSync, readSync, rmSync, statSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PRODUCT = 'Deepseek-Harness-Desktop'
const UNINSTALL_ROOT = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
const INSTALL_TIMEOUT_MS = 15 * 60 * 1000
const GUI_SPAWN_TIMEOUT_MS = 90 * 1000
const UNINSTALL_TIMEOUT_MS = 4 * 60 * 1000

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}
function ps(script) {
  return execFileSync('powershell', ['-NoProfile', '-Command', script], {
    encoding: 'utf8', timeout: 30000, windowsHide: true,
  }).trim()
}
function findSetup() {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version
  const expected = path.join('dist', `${PRODUCT}-Setup-${version}.exe`)
  if (!existsSync(expected)) {
    const candidates = readdirSync('dist')
      .filter((f) => /^Deepseek-Harness-Desktop-Setup-.*\.exe$/i.test(f))
    console.error(`missing ${expected} (dist has: ${candidates.join(', ') || 'none'})`)
    process.exit(2)
  }
  return path.resolve(expected)
}
function hasStubTail(file) {
  const fd = openSync(file, 'r')
  try {
    const size = statSync(file).size
    const buf = Buffer.alloc(8)
    readSync(fd, buf, 0, 8, size - 8)
    return buf.equals(Buffer.from('DSHSTUB\x01', 'latin1'))
  } finally {
    closeSync(fd)
  }
}
function uninstallKey() {
  let out = ''
  try {
    out = execFileSync('reg', ['query', UNINSTALL_ROOT, '/f', PRODUCT, '/d', '/s'], {
      encoding: 'utf8', timeout: 60000, windowsHide: true,
    })
  } catch {
    return null
  }
  const m = out.match(/^(HKEY_CURRENT_USER\\[^\r\n]+)/m)
  return m ? m[1].trim() : null
}
function regValue(key, name) {
  try {
    const out = execFileSync('reg', ['query', key, '/v', name], {
      encoding: 'utf8', timeout: 30000, windowsHide: true,
    })
    const m = out.match(new RegExp(`${name}\\s+REG_[A-Z_]+\\s+(.+)`))
    return m ? m[1].trim() : null
  } catch {
    return null
  }
}
function unquoteExe(uninstallString) {
  const q = uninstallString.match(/^"([^"]+)"/)
  if (q) return q[1]
  return uninstallString.split(/\s+\//)[0].trim()
}
function innerSetupRunning() {
  try {
    return ps("Get-CimInstance Win32_Process -Filter \"Name='dsh-inner-setup.exe'\" | Measure-Object | Select-Object -ExpandProperty Count") !== '0'
  } catch {
    return false
  }
}
function killTree(pid) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 30000, windowsHide: true })
  } catch { /* already gone */ }
}
function waitFor(fn, timeoutMs, stepMs = 1000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve) => {
    const tick = () => {
      if (fn()) return resolve(true)
      if (Date.now() > deadline) return resolve(false)
      setTimeout(tick, stepMs)
    }
    tick()
  })
}

const skipGui = process.argv.includes('--skip-gui')
const setup = findSetup()
console.log(`verifying ${setup}`)

check('setup carries the DSHSTUB wrapper tail', hasStubTail(setup))

// --- silent install -----------------------------------------------------
// /D= must be the LAST argument and must be space-free (NSIS parses it
// unquoted). mkdtemp under os.tmpdir() is space-free on CI runners.
const installDir = mkdtempSync(path.join(os.tmpdir(), 'dshd-verify-'))
console.log(`install target: ${installDir}`)
const inst = spawnSync(setup, ['/S', `/D=${installDir}`], {
  timeout: INSTALL_TIMEOUT_MS, windowsHide: true,
})
check('silent /S /D install exits 0', inst.status === 0, `status=${inst.status} signal=${inst.signal || ''}`)

const exe = path.join(installDir, `${PRODUCT}.exe`)
for (const [name, p] of [
  ['installed exe', exe],
  ['resources\\app.asar', path.join(installDir, 'resources', 'app.asar')],
  ['embedded node.exe', path.join(installDir, 'resources', 'node.exe')],
  ['vendored harness payload', path.join(installDir, 'resources', 'vendor', 'deepseek-harness.tar')],
]) {
  check(`${name} present`, existsSync(p) && statSync(p).size > 0, p)
}

// --- uninstall registration ---------------------------------------------
const key = uninstallKey()
check('uninstall registry key written', !!key, key || '')
// InstallLocation lives under HKCU\Software\<guid> (INSTALL_REGISTRY_KEY) —
// the same place the inner NSIS upgrade path and the stub read it from —
// while the Uninstall key only carries UninstallString & friends.
const installKey = key ? `HKCU\\Software\\${key.split('\\').pop()}` : null
if (key) {
  const loc = installKey && regValue(installKey, 'InstallLocation')
  check('InstallLocation is the /D target (Software\\<guid> key)',
    !!loc && path.normalize(loc).toLowerCase() === path.normalize(installDir).toLowerCase(), loc || '')
  const un = regValue(key, 'UninstallString')
  check('UninstallString resolves to an existing file',
    !!un && existsSync(unquoteExe(un)), un || '')
}

// --- shortcuts ------------------------------------------------------------
const desktopDirs = [path.join(os.homedir(), 'Desktop'), 'C:\\Users\\Public\\Desktop']
const desktop = desktopDirs.some((d) => existsSync(path.join(d, `${PRODUCT}.lnk`)))
const startMenu = existsSync(path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Microsoft', 'Windows', 'Start Menu', 'Programs', PRODUCT, `${PRODUCT}.lnk`)) ||
  existsSync(path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Microsoft', 'Windows', 'Start Menu', 'Programs', `${PRODUCT}.lnk`))
check('desktop shortcut created', desktop)
check('start menu shortcut created', startMenu)

// --- forced classic-wizard fallback ---------------------------------------
if (!skipGui) {
  const gui = spawn(setup, [], {
    env: { ...process.env, DSHD_SETUP_FORCE_FALLBACK: '1' },
    windowsHide: true, stdio: 'ignore',
  })
  const spawned = await waitFor(innerSetupRunning, GUI_SPAWN_TIMEOUT_MS)
  check('DSHD_SETUP_FORCE_FALLBACK spawns the classic wizard (dsh-inner-setup)', spawned)
  killTree(gui.pid)
}

// --- uninstall -------------------------------------------------------------
const uninstaller = path.join(installDir, `Uninstall ${PRODUCT}.exe`)
check('uninstaller present', existsSync(uninstaller), uninstaller)
if (existsSync(uninstaller)) {
  spawnSync(uninstaller, ['/S', '/currentuser'], { timeout: 60000, windowsHide: true })
  const gone = await waitFor(() => !existsSync(exe), UNINSTALL_TIMEOUT_MS)
  check('silent uninstall removes the installed exe', gone)
  const keyGone = await waitFor(
    () => !uninstallKey() && !(installKey && regValue(installKey, 'InstallLocation')), 60000)
  check('uninstall removes the registry registration', keyGone)
}

rmSync(installDir, { recursive: true, force: true })

if (failures) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nall setup-install checks passed')
