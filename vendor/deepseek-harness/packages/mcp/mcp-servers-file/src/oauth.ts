/**
 * MCP HTTP OAuth 2.1 authorization-code + PKCE helper used by Settings login.
 * @module @deepseek-ai/dsh-mcp-servers-file/oauth
 */

import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { spawn, type SpawnOptions } from 'node:child_process'

/** Tokens returned by the authorization-code exchange. */
export interface McpOAuthTokens {
  readonly access_token: string
  readonly refresh_token?: string
  readonly token_type?: string
  readonly expires_in?: number
}

/** Localhost callback the authorization server redirects to. */
export interface McpOAuthListener {
  /** Exact redirect URI registered with the authorization server. */
  readonly redirectUri: string
  /**
   * Wait for one callback carrying `code` and matching `state`.
   * @param state - CSRF token placed on the authorize URL.
   * @param timeoutMs - how long to wait for the browser redirect.
   * @returns the authorization code.
   */
  waitForCode: (state: string, timeoutMs: number) => Promise<string>
  /** Stop listening. */
  close: () => Promise<void>
}

/** Injected I/O so tests never open a browser or bind a port. */
export interface McpOAuthRuntime {
  readonly fetch: typeof fetch
  readonly openBrowser: (url: string) => void
  readonly createListener: () => Promise<McpOAuthListener>
}

const AUTH_TIMEOUT_MS = 180_000
const SCOPE = 'mcp:use'

/**
 * Discover the resource, register a public client, and exchange a PKCE code
 * for an access token. Opens the system browser for the user to sign in.
 * @param resource - MCP Streamable HTTP endpoint URL.
 * @param runtime - fetch, browser, and localhost callback.
 * @returns the token response.
 */
export async function authorizeMcpHttp(resource: string, runtime: McpOAuthRuntime): Promise<McpOAuthTokens> {
  const metadataUrl = await discoverResourceMetadataUrl(resource, runtime.fetch)
  const protectedResource = await getJson(runtime.fetch, metadataUrl)
  const issuer = firstString(protectedResource.authorization_servers)
  if (issuer === undefined) {
    throw new Error('mcp-servers-file: OAuth metadata is missing authorization_servers')
  }
  const asMeta = await getAuthorizationServerMetadata(runtime.fetch, issuer)
  const methods = asMeta.code_challenge_methods_supported
  if (!Array.isArray(methods) || !methods.includes('S256')) {
    throw new Error('mcp-servers-file: authorization server does not advertise PKCE S256')
  }
  const authorizationEndpoint = requiredString(asMeta.authorization_endpoint, 'authorization_endpoint')
  const tokenEndpoint = requiredString(asMeta.token_endpoint, 'token_endpoint')
  const registrationEndpoint = requiredString(asMeta.registration_endpoint, 'registration_endpoint')
  const scope = firstString(protectedResource.scopes_supported) ?? SCOPE

  const listener = await runtime.createListener()
  try {
    const clientId = await registerClient(runtime.fetch, registrationEndpoint, listener.redirectUri, scope)
    const { verifier, challenge } = pkce()
    const state = b64url(randomBytes(16))
    const authorize = new URL(authorizationEndpoint)
    authorize.searchParams.set('response_type', 'code')
    authorize.searchParams.set('client_id', clientId)
    authorize.searchParams.set('redirect_uri', listener.redirectUri)
    authorize.searchParams.set('scope', scope)
    authorize.searchParams.set('code_challenge', challenge)
    authorize.searchParams.set('code_challenge_method', 'S256')
    authorize.searchParams.set('resource', resource)
    authorize.searchParams.set('state', state)
    const codePromise = listener.waitForCode(state, AUTH_TIMEOUT_MS)
    runtime.openBrowser(authorize.href)
    const code = await codePromise
    return await exchangeCode(runtime.fetch, {
      tokenEndpoint,
      clientId,
      code,
      redirectUri: listener.redirectUri,
      verifier,
      resource,
    })
  } finally {
    await listener.close()
  }
}

/**
 * Production I/O: global fetch, OS browser, and an ephemeral 127.0.0.1 listener.
 * @returns the default runtime.
 */
export function defaultOAuthRuntime(): McpOAuthRuntime {
  return {
    fetch,
    openBrowser,
    createListener,
  }
}

async function discoverResourceMetadataUrl(resource: string, fetchImpl: typeof fetch): Promise<string> {
  const probe = await fetchImpl(resource, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
  if (probe.status !== 401 && probe.status !== 403) {
    throw new Error('mcp-servers-file: MCP server did not request OAuth')
  }
  const challenge = probe.headers.get('www-authenticate')
  const fromHeader = parseResourceMetadata(challenge)
  return fromHeader ?? wellKnownProtectedResource(resource)
}

function parseResourceMetadata(header: string | null): string | undefined {
  if (header === null || header.length === 0) return undefined
  const quoted = /resource_metadata="([^"]+)"/.exec(header)
  if (quoted?.[1] !== undefined) return quoted[1]
  const bare = /resource_metadata=([^\s,]+)/.exec(header)
  return bare?.[1]
}

function wellKnownProtectedResource(resource: string): string {
  const url = new URL(resource)
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')
  return `${url.origin}/.well-known/oauth-protected-resource${path}`
}

/**
 * RFC 8414 authorization-server metadata URL: insert
 * `/.well-known/oauth-authorization-server` between origin and issuer path.
 * @param issuer - authorization server issuer identifier.
 * @returns the metadata URL.
 */
export function authorizationServerMetadataUrl(issuer: string): string {
  const url = new URL(issuer)
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')
  return `${url.origin}/.well-known/oauth-authorization-server${path}`
}

async function getAuthorizationServerMetadata(
  fetchImpl: typeof fetch,
  issuer: string,
): Promise<Record<string, unknown>> {
  const primary = authorizationServerMetadataUrl(issuer)
  const fallback = `${issuer.replace(/\/$/, '')}/.well-known/oauth-authorization-server`
  const first = await fetchImpl(primary)
  if (first.status !== 404 || primary === fallback) {
    return readJson(first)
  }
  return getJson(fetchImpl, fallback)
}

async function registerClient(
  fetchImpl: typeof fetch,
  endpoint: string,
  redirectUri: string,
  scope: string,
): Promise<string> {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'DeepSeek Harness',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope,
    }),
  })
  const body = await readJson(response)
  const clientId = body.client_id
  if (typeof clientId !== 'string' || clientId.length === 0) {
    throw new Error(`mcp-servers-file: OAuth registration failed (${String(response.status)})`)
  }
  return clientId
}

async function exchangeCode(fetchImpl: typeof fetch, input: {
  tokenEndpoint: string
  clientId: string
  code: string
  redirectUri: string
  verifier: string
  resource: string
}): Promise<McpOAuthTokens> {
  const response = await fetchImpl(input.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      code_verifier: input.verifier,
      resource: input.resource,
    }),
  })
  const body = await readJson(response)
  if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
    throw new Error(`mcp-servers-file: OAuth token exchange failed (${String(response.status)})`)
  }
  return {
    access_token: body.access_token,
    ...typeof body.refresh_token === 'string' ? { refresh_token: body.refresh_token } : {},
    ...typeof body.token_type === 'string' ? { token_type: body.token_type } : {},
    ...typeof body.expires_in === 'number' ? { expires_in: body.expires_in } : {},
  }
}

async function getJson(fetchImpl: typeof fetch, url: string): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url)
  return readJson(response)
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('mcp-servers-file: OAuth response is not a JSON object')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('mcp-servers-file:')) throw error
    throw new Error(`mcp-servers-file: OAuth response is not JSON (${String(response.status)})`)
  }
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) return value[0]
  return undefined
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`mcp-servers-file: OAuth metadata is missing ${field}`)
  }
  return value
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url')
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/**
 * Windows `cmd /c start` argv that keeps `&` inside the authorize URL.
 * @param url - absolute authorize URL.
 * @returns argv after `cmd`.
 */
export function windowsBrowserLaunchArgs(url: string): string[] {
  return ['/c', 'start', '""', `"${url.replace(/"/g, '')}"`]
}

/**
 * OS browser launch for the authorize URL. Windows quotes the URL so `cmd`
 * does not split on `&`.
 * @param url - absolute authorize URL.
 * @returns spawn command, args, and options.
 */
export function browserLaunch(url: string): {
  readonly command: string
  readonly args: string[]
  readonly options: SpawnOptions
} {
  if (process.platform === 'win32') {
    return {
      command: 'cmd',
      args: windowsBrowserLaunchArgs(url),
      options: { detached: true, stdio: 'ignore', windowsVerbatimArguments: true },
    }
  }
  return {
    command: process.platform === 'darwin' ? 'open' : 'xdg-open',
    args: [url],
    options: { detached: true, stdio: 'ignore' },
  }
}

function openBrowser(url: string): void {
  const launch = browserLaunch(url)
  spawn(launch.command, launch.args, launch.options).unref()
}

function createListener(): Promise<McpOAuthListener> {
  return new Promise((resolve, reject) => {
    let pending: { state: string; resolve: (code: string) => void; reject: (error: Error) => void } | undefined
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const error = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      const returnedState = url.searchParams.get('state')
      if (error !== null) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end(error)
        pending?.reject(new Error(`mcp-servers-file: OAuth error: ${error}`))
        pending = undefined
        return
      }
      if (code === null || pending === undefined || returnedState !== pending.state) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Invalid callback')
        pending?.reject(new Error('mcp-servers-file: OAuth callback is missing code or state'))
        pending = undefined
        return
      }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('Login complete. You can return to DeepSeek Harness.')
      pending.resolve(code)
      pending = undefined
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('mcp-servers-file: OAuth listener did not bind a TCP port'))
        return
      }
      resolve({
        redirectUri: `http://127.0.0.1:${String(address.port)}/callback`,
        waitForCode: (state, timeoutMs) => new Promise((codeResolve, codeReject) => {
          const timer = setTimeout(() => {
            pending = undefined
            codeReject(new Error('mcp-servers-file: OAuth login timed out'))
          }, timeoutMs)
          pending = {
            state,
            resolve: (code) => {
              clearTimeout(timer)
              codeResolve(code)
            },
            reject: (error) => {
              clearTimeout(timer)
              codeReject(error)
            },
          }
        }),
        close: () => new Promise((closeResolve, closeReject) => {
          server.close((error) => {
            if (error !== undefined) closeReject(error)
            else closeResolve()
          })
        }),
      })
    })
  })
}
