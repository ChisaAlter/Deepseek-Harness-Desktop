import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
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
