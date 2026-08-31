import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, it } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const vendorDshbot = join(root, 'vendor/dshbot')
const clientSrc = readFileSync(join(vendorDshbot, 'client/client.js'), 'utf8')
const { hostDeclaresRegionTabs, hostDeclaresFooterAction } = await import(
  pathToFileURL(join(vendorDshbot, 'lib/sidebar-host.js')).href
)

describe('dshbot official UI fallback host probe', () => {
  it('reports region tabs only when both specs exist', () => {
    assert.equal(hostDeclaresRegionTabs(undefined), false)
    assert.equal(hostDeclaresRegionTabs({}), false)
    assert.equal(hostDeclaresRegionTabs({
      spec: (name) => (name === 'sidebar.nav.tab' ? { kind: 'list' } : undefined),
    }), false)
    assert.equal(hostDeclaresRegionTabs({
      spec: (name) => {
        if (name === 'sidebar.nav.tab') return { kind: 'list' }
        if (name === 'sidebar.page') return { kind: 'keyed' }
        return undefined
      },
    }), true)
    assert.equal(hostDeclaresRegionTabs({
      spec: () => { throw new Error('boom') },
    }), false)
  })

  it('reports footer.action when the official seat exists', () => {
    assert.equal(hostDeclaresFooterAction({
      spec: (name) => (name === 'sidebar.footer.action' ? { kind: 'list' } : undefined),
    }), true)
    assert.equal(hostDeclaresFooterAction({
      spec: () => undefined,
    }), false)
  })
})

describe('dshbot client registration contract', () => {
  it('keeps desktop tab path and official footer fallback in source', () => {
    assert.match(clientSrc, /hostDeclaresRegionTabs/)
    assert.match(clientSrc, /hostDeclaresFooterAction/)
    assert.match(clientSrc, /OfficialBotsEntry/)
    assert.match(clientSrc, /data-dshbot-official-trigger/)
    assert.match(clientSrc, /sidebar\.footer\.action/)
    assert.match(clientSrc, /sidebar\.nav\.tab/)
    assert.match(clientSrc, /sidebar\.page/)
    // Prefer tabs when present — must not register footer in the same branch.
    const tabBranch = clientSrc.indexOf('if (hostDeclaresRegionTabs')
    const footerBranch = clientSrc.indexOf('else if (hostDeclaresFooterAction')
    assert.ok(tabBranch >= 0 && footerBranch > tabBranch)
  })

  it('declares engines.node >=22.15.0 for official dsh zlib.zstd', () => {
    const pkg = JSON.parse(readFileSync(join(vendorDshbot, 'package.json'), 'utf8'))
    assert.equal(pkg.engines?.node, '>=22.15.0')
  })
})
