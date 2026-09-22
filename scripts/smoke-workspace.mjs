import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

export function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

export function createSmokeDirs(prefix) {
  const smokeRoot = mkdtempSync(path.join(os.tmpdir(), prefix))
  const userData = path.join(smokeRoot, 'user-data')
  const workspace = path.join(smokeRoot, 'workspace')
  mkdirSync(userData, { recursive: true })
  mkdirSync(workspace, { recursive: true })
  return {
    smokeRoot,
    userData,
    workspace,
    resultPath: path.join(userData, 'dshd-smoke.json'),
  }
}

export function writeSmokeConfig(userData, workspace, port) {
  writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
    workspace,
    host: '127.0.0.1',
    port,
    closeToTray: false,
    openAtLogin: false,
    openDevTools: false,
    remoteEnabled: false,
  }, null, 2))
}

export function initGitWorkspace(workspace, options = {}) {
  writeFileSync(path.join(workspace, 'README.md'), 'smoke\n')
  const git = (args) => {
    const result = spawnSync('git', args, {
      cwd: workspace,
      encoding: 'utf8',
      windowsHide: true,
    })
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`)
    }
  }
  const branch = typeof options.branch === 'string' && options.branch.trim()
    ? options.branch.trim()
    : ''
  git(branch ? ['init', '-b', branch] : ['init'])
  git(['add', '.'])
  git([
    '-c', 'user.name=dsh-smoke',
    '-c', 'user.email=smoke@example.test',
    'commit',
    '-m',
    'smoke',
  ])
}

export function electronSpawnEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  delete env.DSH_HOME
  delete env.DSHD_HOME
  return env
}

export function assertDesktopHarnessHome(userData, result = {}) {
  const home = path.join(userData, 'dsh-home')
  if (!existsSync(home)) {
    throw new Error(`desktop Harness home was not created at ${home}`)
  }
  const recorded = typeof result.desktopHome === 'string' ? result.desktopHome : ''
  if (recorded && path.resolve(recorded) !== path.resolve(home)) {
    throw new Error(`desktopHome mismatch: recorded=${recorded} expected=${home}`)
  }
  if (result.electronEnv?.DSH_HOME) {
    throw new Error(`Electron process.env.DSH_HOME leaked: ${result.electronEnv.DSH_HOME}`)
  }
  const logs = Array.isArray(result.bootLogs) ? result.bootLogs : []
  const homeLog = result.homeLog || logs.find((line) => /Harness \u5bb6\u76ee\u5f55/.test(String(line)))
  if (!homeLog) {
    throw new Error('boot logs missing Harness 家目录')
  }
  if (!String(homeLog).toLowerCase().includes('dsh-home')) {
    throw new Error(`Harness 家目录 is not under dsh-home: ${homeLog}`)
  }
  return home
}

export function assertSmokeResult(outcome, result) {
  const buttons = Array.isArray(result.result?.titlebarButtons) ? result.result.titlebarButtons : []
  const hasTerminalToggle = buttons.some((label) => /terminal|\u7ec8\u7aef/i.test(label))
  const hasSurfacesToggle = buttons.some((label) => /right panel|surfaces|\u53f3\u4fa7\u680f/i.test(label))
  const hits = result.result?.titlebarHits?.hits || {}
  const hitCount = Number(hits.surfaces || 0) + Number(hits.branch || 0) + Number(hits.git || 0)
  const uiOk = result.result?.hasFrame === true
    && result.result?.hasTitlebar === true
    && hasTerminalToggle
    && hasSurfacesToggle
    && result.result?.hasDragStrip !== true
    && result.result?.hasDragMark !== true
    && result.result?.hasHitMark !== true
    && result.result?.captionRegion === 'drag'
    && result.result?.hasBootShellApi === true
    && result.result?.bootShellApiIsScoped === true
    && result.result?.hasHarnessShellApi === true
    && result.result?.harnessShellApiIsScoped === true
    && hitCount > 0
    && Number(hits.surfaces) > 0
    && Number(hits.branch) > 0
    && Number(hits.git) > 0
    && result.result?.titlebarHits?.error == null
    && (process.env.DSH_THEME_SMOKE !== '1' || result.result?.themeSmoke?.ok === true)
    && Array.isArray(result.pageErrors)
    && result.pageErrors.length === 0
  if (outcome.code !== 0 || result.ok !== true || !uiOk || result.ptyStatus !== 'echoed:ok') {
    throw new Error(`Smoke failed: ${JSON.stringify({ outcome, result })}`)
  }
}
