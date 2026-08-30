/**
 * Deterministic HTTP provider for the web-fetch snapshot scenario: a small
 * HTML page (headings, named entities, a GFM table, nested formatting) on a
 * fixed loopback port behind the real address-pinned transport. Recording and
 * replay therefore exercise fetch and markdown rendering without
 * external network. The port is fixed because the fetched URL is recorded.
 */
import { createServer } from 'node:http'
import { HttpFetchProvider } from '@deepseek-ai/dsh-web-fetch-http'

/** Fixed loopback port the scenario prompt points `web_fetch` at. */
const PORT = 43117

const PAGE = `<!doctype html>
<html><head><title>Menu</title><style>.x{color:red}</style><script>ignored()</script></head>
<body>
<h1>Caf&eacute; menu</h1>
<p>Prices include <strong>service &amp; <em>tax</em></strong> &mdash; updated daily.</p>
<ul><li>Espresso</li><li>Flat white</li></ul>
<table><thead><tr><th>Drink</th><th>Price</th></tr></thead><tbody><tr><td>Espresso</td><td>&euro;2</td></tr><tr><td>Flat white</td><td>&euro;3</td></tr></tbody></table>
<p>See <a href="https://fixture.invalid/specials">today&rsquo;s specials</a>.</p>
</body></html>
`

/** Cordis plugin name. */
export const name = 'web-fetch-fixture-server'

/** Service used by the fixture provider. */
export const inject = ['web']

const LIMITS = {
  maxResponseBytes: 5_000_000,
  maxBodyChars: 100_000,
  timeoutMs: 30_000,
  maxRedirects: 5,
  userAgent: 'deepseek-harness-snapshot/1.0',
}

/**
 * Register the deterministic provider and start its loopback server.
 * @param ctx - Cordis context; the effect disposes the server with the fiber.
 */
export function apply(ctx) {
  const server = createServer((req, res) => {
    if (req.url === '/menu.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(PAGE)
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
  })
  const listening = new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(PORT, '127.0.0.1', () => resolve(undefined))
  })
  void listening.catch(() => undefined)
  // The fixture must never hold the process open past protocol shutdown.
  server.unref()

  const resolveAddresses = async (hostname) => {
    await listening
    if (hostname !== 'public.test') throw new Error(`unexpected snapshot hostname: ${hostname}`)
    return [{ address: '127.0.0.1', family: 4 }]
  }

  ctx.effect(() => async () => {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve(undefined))
      // Stop accepting first so a connection cannot arrive after the forced close.
      server.closeAllConnections()
    })
  }, 'web-fetch-fixture-server')
  ctx.web.registerFetchProvider(new HttpFetchProvider(LIMITS, resolveAddresses))
}
