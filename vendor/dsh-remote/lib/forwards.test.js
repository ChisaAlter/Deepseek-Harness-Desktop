import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { apply } from './index.js'
import { ForwardManager } from './forwards.js'

class FakeClient extends EventEmitter {
  constructor() {
    super()
    this.forwarded = []
    this.unforwarded = []
    this.forwardInCalls = []
  }

  forwardOut(host, port, targetHost, targetPort, cb) {
    this.forwarded.push({ host, port, targetHost, targetPort })
    cb(new Error('synthetic: no live channel'))
  }

  forwardIn(host, port, cb) {
    this.forwardInCalls.push({ host, port })
    cb(null)
  }

  unforwardIn(host, port, cb) {
    this.unforwarded.push({ host, port })
    cb()
  }
}

function fakePool(client) {
  return {
    connect: async () => client,
  }
}

async function createForwardRouteFixture(t) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'dsh-remote-forward-routes-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home

  const routes = []
  const cleanups = []
  t.after(() => {
    for (const cleanup of cleanups.reverse()) cleanup()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })

  const ctx = {
    effect: (createCleanup) => cleanups.push(createCleanup()),
    inject: (_deps, callback) => callback({
      get(name) {
        if (name === 'webServer') return { register(route) { routes.push(route); return () => {} } }
        return {}
      },
      effect: (createCleanup) => cleanups.push(createCleanup()),
    }),
    tools: { register() {} },
    systemPrompt: { section() {} },
    get() { return undefined },
  }
  await apply(ctx, {
    host: 'audit.example', port: 22, username: 'audit-user',
    password: 'CONFIG_CREDENTIAL_SENTINEL', privateKeyPath: '',
    passphrase: 'CONFIG_PASSPHRASE_SENTINEL', workspace: '', shell: '',
    commandTimeoutMs: 20000, connectTimeoutMs: 15000,
    maxOutputChars: 200000, maxFileBytes: 52428800,
    hostKeyMode: 'accept-new', useAgent: false, keyboardInteractive: false,
    proxy: { host: '', port: 22, username: '', password: '', privateKeyPath: '' },
    autoPush: false, auditLog: true, encoding: 'utf-8',
  })

  const route = routes.find((candidate) => candidate.path === '/dsh-remote/forwards')
  assert.ok(route, 'forwards endpoint should be registered')
  const auditFile = path.join(home, 'remote-workspaces', 'audit.log')
  return {
    route,
    auditLines: () => existsSync(auditFile) ? readFileSync(auditFile, 'utf8').trim().split(/\r?\n/) : [],
  }
}

async function invokeForwardRoute(route, payload) {
  const req = Readable.from([Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload))])
  req.method = 'POST'
  req.url = '/dsh-remote/forwards'
  const res = {
    statusCode: 200,
    setHeader() {},
    end(body) { this.body = body },
  }
  await route.handler(req, res)
  return { status: res.statusCode, body: JSON.parse(res.body) }
}

function assertForwardAudit(lines, { action, outcome, id }) {
  assert.match(lines.at(-1), new RegExp(`\\| forward-route \\| ${outcome === 'success' ? 0 : 1} \\| action=${action} outcome=${outcome} forwardId=${id}`))
}

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  return port
}

test('a local forward listens only on loopback and never binds all interfaces', async (t) => {
  const client = new FakeClient()
  const manager = new ForwardManager(fakePool(client))
  const port = await freePort()
  const def = manager.define({ direction: 'local', listenPort: port, targetHost: '127.0.0.1', targetPort: 9 })
  const started = await manager.start(def)
  assert.equal(started.ok, true)

  const entry = manager.servers.get(def.id)
  assert.ok(entry, 'the local forward should be active')
  const addresses = entry.server.address()
  assert.equal(addresses.address, '127.0.0.1')
  assert.equal(addresses.port, port)
  manager.stopAll()
  t.after(() => manager.stopAll())
})

test('only local forwards with autoStart are restored on attach; reverse forwards are not', async (t) => {
  const client = new FakeClient()
  const manager = new ForwardManager(fakePool(client))
  const local = await freePort()
  const reverse = await freePort()
  manager.define({ direction: 'local', listenPort: local, targetHost: '127.0.0.1', targetPort: 9, autoStart: true })
  manager.define({ direction: 'reverse', listenPort: reverse, targetHost: '127.0.0.1', targetPort: 9, autoStart: true })
  manager.attach(client)
  await new Promise((resolve) => setTimeout(resolve, 25))

  assert.equal(manager.servers.size, 1)
  const active = [...manager.servers.keys()][0]
  const activeDef = manager.defs.find((d) => d.id === active)
  assert.equal(activeDef.direction, 'local')
  assert.deepEqual(client.forwardInCalls, [])
  manager.stopAll()
  t.after(() => manager.stopAll())
})

test('reverse forwards require forwardIn and report an explicit failure without local fallback', async (t) => {
  const client = new FakeClient()
  client.forwardIn = undefined
  const manager = new ForwardManager(fakePool(client))
  const port = await freePort()
  const def = manager.define({ direction: 'reverse', listenPort: port, targetHost: '127.0.0.1', targetPort: 9 })
  const result = await manager.start(def)
  assert.equal(result.ok, false)
  assert.match(result.error, /forwardIn/)
  assert.equal(manager.servers.has(def.id), false)
  t.after(() => manager.stopAll())
})

test('stopping a reverse forward unregisters the remote listener on loopback', async (t) => {
  const client = new FakeClient()
  const manager = new ForwardManager(fakePool(client))
  const port = await freePort()
  const def = manager.define({ direction: 'reverse', listenPort: port, targetHost: '127.0.0.1', targetPort: 9 })
  assert.equal((await manager.start(def)).ok, true)
  manager.stop(def.id)
  assert.deepEqual(client.unforwarded, [{ host: '127.0.0.1', port }])
  t.after(() => manager.stopAll())
})

test('removing a forward stops it and deletes its persisted definition', async (t) => {
  const client = new FakeClient()
  const manager = new ForwardManager(fakePool(client))
  const port = await freePort()
  const def = manager.define({ direction: 'local', listenPort: port, targetHost: '127.0.0.1', targetPort: 9 })
  await manager.start(def)
  assert.equal(manager.remove(def.id), true)
  assert.equal(manager.servers.has(def.id), false)
  assert.equal(manager.defs.some((d) => d.id === def.id), false)
  t.after(() => manager.stopAll())
})

test('forward definitions persist to disk and reload with their scope intact', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-remote-forwards-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = path.join(root, 'forwards.json')
  const first = new ForwardManager(fakePool(new FakeClient()), { file })
  const local = first.define({
    direction: 'local',
    listenPort: 18080,
    targetHost: '127.0.0.1',
    targetPort: 8080,
    autoStart: true,
    machineId: 'synthetic-machine',
  })
  const reverse = first.define({
    direction: 'reverse',
    listenPort: 19090,
    targetHost: '127.0.0.1',
    targetPort: 9090,
    autoStart: true,
    machineId: 'synthetic-machine',
  })

  const persisted = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(persisted.defs.length, 2)
  const reloaded = new ForwardManager(fakePool(new FakeClient()), { file })
  assert.deepEqual(reloaded.list().map((row) => ({
    id: row.id,
    direction: row.direction,
    listenPort: row.listenPort,
    autoStart: row.autoStart,
    machineId: row.machineId,
  })).sort((a, b) => a.listenPort - b.listenPort), [
    { id: local.id, direction: 'local', listenPort: 18080, autoStart: true, machineId: 'synthetic-machine' },
    { id: reverse.id, direction: 'reverse', listenPort: 19090, autoStart: true, machineId: 'synthetic-machine' },
  ])
})

test('forwards HTTP mutations audit action, outcome, and only the forward id', async (t) => {
  const { route, auditLines } = await createForwardRouteFixture(t)
  const originalDefine = ForwardManager.prototype.define
  const originalStart = ForwardManager.prototype.start
  const originalStop = ForwardManager.prototype.stop
  const originalRemove = ForwardManager.prototype.remove
  const defineFailurePort = 41004
  const startFailurePort = 41002
  const stopFailurePort = 41007
  const removeFailurePort = 41010
  let stopFailureId = ''
  let removeFailureId = ''

  ForwardManager.prototype.define = function (options) {
    if (Number(options.listenPort) === defineFailurePort) throw new Error('DEFINE_FAILURE_CREDENTIAL_SENTINEL')
    return originalDefine.call(this, options)
  }
  ForwardManager.prototype.start = async function (def) {
    if (def.listenPort === startFailurePort) return { ok: false, error: 'START_FAILURE_CREDENTIAL_SENTINEL' }
    return { ok: true, active: true }
  }
  ForwardManager.prototype.stop = function (id) {
    if (id === stopFailureId) throw new Error('STOP_FAILURE_CREDENTIAL_SENTINEL')
    return originalStop.call(this, id)
  }
  ForwardManager.prototype.remove = function (id) {
    if (id === removeFailureId) throw new Error('REMOVE_FAILURE_CREDENTIAL_SENTINEL')
    return originalRemove.call(this, id)
  }

  try {
    const missingStart = await invokeForwardRoute(route, { action: 'start', id: 'REQUEST_ID_CREDENTIAL_SENTINEL' })
    assert.equal(missingStart.status, 404)
    assertForwardAudit(auditLines(), { action: 'start', outcome: 'failure', id: 'unknown' })

    const define = await invokeForwardRoute(route, {
      action: 'define', listenPort: 41001, targetPort: 42001,
      password: 'ROUTE_CREDENTIAL_SENTINEL', passphrase: 'ROUTE_PASSPHRASE_SENTINEL',
      proxy: { password: 'ROUTE_PROXY_CREDENTIAL_SENTINEL' },
    })
    assert.equal(define.status, 200)
    const firstId = define.body.forward.id
    assertForwardAudit(auditLines(), { action: 'define', outcome: 'success', id: firstId })

    const started = await invokeForwardRoute(route, { action: 'start', id: firstId })
    assert.equal(started.status, 200)
    assertForwardAudit(auditLines(), { action: 'start', outcome: 'success', id: firstId })

    const startFailureDef = await invokeForwardRoute(route, { action: 'define', listenPort: startFailurePort, targetPort: 42002 })
    assert.equal(startFailureDef.status, 200)
    const startFailureId = startFailureDef.body.forward.id
    const startFailure = await invokeForwardRoute(route, { action: 'start', id: startFailureId })
    assert.equal(startFailure.status, 500)
    assertForwardAudit(auditLines(), { action: 'start', outcome: 'failure', id: startFailureId })

    const defineFailure = await invokeForwardRoute(route, { action: 'define', listenPort: defineFailurePort })
    assert.equal(defineFailure.status, 500)
    assertForwardAudit(auditLines(), { action: 'define', outcome: 'failure', id: 'unknown' })

    const stopped = await invokeForwardRoute(route, { action: 'stop', id: firstId })
    assert.equal(stopped.status, 200)
    assertForwardAudit(auditLines(), { action: 'stop', outcome: 'success', id: firstId })

    const missingStop = await invokeForwardRoute(route, { action: 'stop', id: 'REQUEST_ID_CREDENTIAL_SENTINEL' })
    assert.equal(missingStop.status, 404)
    assertForwardAudit(auditLines(), { action: 'stop', outcome: 'failure', id: 'unknown' })

    const stopFailureDef = await invokeForwardRoute(route, { action: 'define', listenPort: stopFailurePort, targetPort: 42007 })
    stopFailureId = stopFailureDef.body.forward.id
    const stopFailure = await invokeForwardRoute(route, { action: 'stop', id: stopFailureId })
    assert.equal(stopFailure.status, 500)
    assertForwardAudit(auditLines(), { action: 'stop', outcome: 'failure', id: stopFailureId })

    const removed = await invokeForwardRoute(route, { action: 'remove', id: startFailureId })
    assert.equal(removed.status, 200)
    assertForwardAudit(auditLines(), { action: 'remove', outcome: 'success', id: startFailureId })

    const missingRemove = await invokeForwardRoute(route, { action: 'remove', id: 'REQUEST_ID_CREDENTIAL_SENTINEL' })
    assert.equal(missingRemove.status, 200)
    assertForwardAudit(auditLines(), { action: 'remove', outcome: 'failure', id: 'unknown' })

    const removeFailureDef = await invokeForwardRoute(route, { action: 'define', listenPort: removeFailurePort, targetPort: 42010 })
    removeFailureId = removeFailureDef.body.forward.id
    const removeFailure = await invokeForwardRoute(route, { action: 'remove', id: removeFailureId })
    assert.equal(removeFailure.status, 500)
    assertForwardAudit(auditLines(), { action: 'remove', outcome: 'failure', id: removeFailureId })

    assert.doesNotMatch(auditLines().join('\n'), /CREDENTIAL_SENTINEL|PASSPHRASE_SENTINEL/)
  } finally {
    ForwardManager.prototype.define = originalDefine
    ForwardManager.prototype.start = originalStart
    ForwardManager.prototype.stop = originalStop
    ForwardManager.prototype.remove = originalRemove
  }
})
