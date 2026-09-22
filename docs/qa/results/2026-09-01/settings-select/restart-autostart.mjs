import { spawn, spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..')
const outDir = path.dirname(fileURLToPath(import.meta.url))
const CDP_PORT = 9229

function electronBin() {
  return [
    process.env.ELECTRON_PATH,
    path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
  ].find((item) => item && existsSync(item))
}

function killDesktopElectron() {
  spawnSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Get-CimInstance Win32_Process | Where-Object {
      $_.Name -match 'electron' -and $_.CommandLine -and $_.CommandLine -match 'electron\\\\dist\\\\electron' -and (
        $_.CommandLine -match 'Deepseek-Harness-Desktop' -or $_.CommandLine -match [regex]::Escape('${root.replace(/'/g, "''")}')
      )
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
  ], { windowsHide: true })
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms))
}

async function jsonList() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
  if (!res.ok) throw new Error(`cdp list ${res.status}`)
  return res.json()
}

async function main() {
  console.error(`[restart] root=${root}`)
  killDesktopElectron()
  await sleep(2000)
  const child = spawn(electronBin(), [`--remote-debugging-port=${CDP_PORT}`, '.'], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  })
  child.unref()
  writeFileSync(path.join(outDir, 'electron-pid.txt'), String(child.pid))
  console.error(`[restart] pid=${child.pid}`)
  const deadline = Date.now() + 180_000
  let sawPort = false
  while (Date.now() < deadline) {
    try {
      const targets = await jsonList()
      sawPort = true
      const harness = targets.find((t) => /^https?:\/\/(127\.0\.0\.1|localhost)/i.test(t.url || ''))
      console.error('[targets]', JSON.stringify(targets.map((t) => ({ title: t.title, url: t.url, type: t.type }))))
      if (harness) {
        console.log(JSON.stringify({ ok: true, url: harness.url }))
        return
      }
      if (Date.now() > deadline - 150_000) {
        spawnSync('powershell.exe', [
          '-NoProfile',
          '-Command',
          `$p = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match '启动器|Harness|发现' } | Select-Object -First 1; if ($p) { $w = New-Object -ComObject WScript.Shell; $w.AppActivate($p.Id) | Out-Null; Start-Sleep -Milliseconds 200; $w.SendKeys('{ESC}') }`,
        ], { windowsHide: true })
      }
    } catch (err) {
      if (sawPort) console.error(String(err))
    }
    await sleep(2000)
  }
  throw new Error('harness page did not appear')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
