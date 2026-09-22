import { describe, expect, it } from 'vitest'
import { authorizeMcpHttp, authorizationServerMetadataUrl, browserLaunch, windowsBrowserLaunchArgs, type McpOAuthRuntime } from '../src/oauth.ts'

const RESOURCE = 'https://mcp.example.test/mcp'
const METADATA = 'https://mcp.example.test/.well-known/oauth-protected-resource/mcp'
const ISSUER = 'https://auth.example.test'
const AUTHORIZE = `${ISSUER}/oauth/authorize`
const TOKEN = `${ISSUER}/oauth/token`
const REGISTER = `${ISSUER}/oauth/register`

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function runtime(overrides: {
  probeStatus?: number
  probeHeaders?: Record<string, string>
  tokenStatus?: number
  tokenBody?: unknown
}): { runtime: McpOAuthRuntime; opened: string[] } {
  const opened: string[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url === RESOURCE && method === 'POST') {
      const headers = overrides.probeHeaders ?? {
        'www-authenticate': `Bearer error="invalid_token", resource_metadata="${METADATA}"`,
      }
      return jsonResponse(overrides.probeStatus ?? 401, { error: 'missing bearer token' }, headers)
    }
    if (url === METADATA && method === 'GET') {
      return jsonResponse(200, { resource: RESOURCE, authorization_servers: [ISSUER], scopes_supported: ['mcp:use'] })
    }
    if (url === `${ISSUER}/.well-known/oauth-authorization-server` && method === 'GET') {
      return jsonResponse(200, {
        issuer: ISSUER,
        authorization_endpoint: AUTHORIZE,
        token_endpoint: TOKEN,
        registration_endpoint: REGISTER,
        code_challenge_methods_supported: ['S256'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
      })
    }
    if (url === REGISTER && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { redirect_uris?: string[] }
      expect(body.redirect_uris).toEqual(['http://127.0.0.1:9/callback'])
      return jsonResponse(201, { client_id: 'client-1', token_endpoint_auth_method: 'none' })
    }
    if (url === TOKEN && method === 'POST') {
      const params = new URLSearchParams(String(init?.body))
      expect(params.get('grant_type')).toBe('authorization_code')
      expect(params.get('code')).toBe('auth-code')
      expect(params.get('client_id')).toBe('client-1')
      expect(params.get('redirect_uri')).toBe('http://127.0.0.1:9/callback')
      expect(params.get('resource')).toBe(RESOURCE)
      expect(params.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]+$/)
      return jsonResponse(
        overrides.tokenStatus ?? 200,
        overrides.tokenBody ?? {
          access_token: 'tok-live',
          refresh_token: 'ref-live',
          token_type: 'Bearer',
          expires_in: 3600,
        },
      )
    }
    throw new Error(`unexpected fetch ${method} ${url}`)
  }
  return {
    opened,
    runtime: {
      fetch: fetchImpl,
      openBrowser: (url) => { opened.push(url) },
      createListener: async () => ({
        redirectUri: 'http://127.0.0.1:9/callback',
        waitForCode: async (state) => {
          expect(state.length).toBeGreaterThan(8)
          return 'auth-code'
        },
        close: async () => {},
      }),
    },
  }
}

describe('authorizeMcpHttp', () => {
  it('runs PKCE against discovered metadata and returns the access token', async () => {
    const { runtime: oauth, opened } = runtime({})
    const tokens = await authorizeMcpHttp(RESOURCE, oauth)
    expect(tokens.access_token).toBe('tok-live')
    expect(tokens.refresh_token).toBe('ref-live')
    expect(opened).toHaveLength(1)
    const authorize = new URL(opened[0]!)
    expect(authorize.origin + authorize.pathname).toBe(AUTHORIZE)
    expect(authorize.searchParams.get('response_type')).toBe('code')
    expect(authorize.searchParams.get('client_id')).toBe('client-1')
    expect(authorize.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:9/callback')
    expect(authorize.searchParams.get('scope')).toBe('mcp:use')
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorize.searchParams.get('resource')).toBe(RESOURCE)
    expect(authorize.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('refuses a server that does not challenge for OAuth', async () => {
    const { runtime: oauth } = runtime({ probeStatus: 200 })
    await expect(authorizeMcpHttp(RESOURCE, oauth)).rejects.toThrow(/did not request OAuth/)
  })

  it('falls back to well-known metadata when WWW-Authenticate is absent', async () => {
    const { runtime: oauth } = runtime({ probeHeaders: {} })
    const tokens = await authorizeMcpHttp(RESOURCE, oauth)
    expect(tokens.access_token).toBe('tok-live')
  })

  it('discovers a path-bearing issuer via RFC 8414 well-known insertion', async () => {
    const pathIssuer = 'https://auth.example.test/realms/foo'
    const rfcUrl = `${ISSUER}/.well-known/oauth-authorization-server/realms/foo`
    const opened: string[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url === RESOURCE && method === 'POST') {
        return jsonResponse(401, { error: 'missing bearer token' }, {
          'www-authenticate': `Bearer error="invalid_token", resource_metadata="${METADATA}"`,
        })
      }
      if (url === METADATA && method === 'GET') {
        return jsonResponse(200, { resource: RESOURCE, authorization_servers: [pathIssuer], scopes_supported: ['mcp:use'] })
      }
      if (url === rfcUrl && method === 'GET') {
        return jsonResponse(200, {
          issuer: pathIssuer,
          authorization_endpoint: AUTHORIZE,
          token_endpoint: TOKEN,
          registration_endpoint: REGISTER,
          code_challenge_methods_supported: ['S256'],
        })
      }
      if (url === REGISTER && method === 'POST') {
        return jsonResponse(201, { client_id: 'client-1', token_endpoint_auth_method: 'none' })
      }
      if (url === TOKEN && method === 'POST') {
        return jsonResponse(200, { access_token: 'tok-live' })
      }
      throw new Error(`unexpected fetch ${method} ${url}`)
    }
    const tokens = await authorizeMcpHttp(RESOURCE, {
      fetch: fetchImpl,
      openBrowser: (url) => { opened.push(url) },
      createListener: async () => ({
        redirectUri: 'http://127.0.0.1:9/callback',
        waitForCode: async () => 'auth-code',
        close: async () => {},
      }),
    })
    expect(tokens.access_token).toBe('tok-live')
    expect(opened).toHaveLength(1)
  })

  it('falls back to issuer-path well-known when RFC 8414 insertion 404s', async () => {
    const pathIssuer = 'https://auth.example.test/realms/foo'
    const rfcUrl = `${ISSUER}/.well-known/oauth-authorization-server/realms/foo`
    const suffixUrl = `${pathIssuer}/.well-known/oauth-authorization-server`
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url === RESOURCE && method === 'POST') {
        return jsonResponse(401, {}, {
          'www-authenticate': `Bearer resource_metadata="${METADATA}"`,
        })
      }
      if (url === METADATA && method === 'GET') {
        return jsonResponse(200, { resource: RESOURCE, authorization_servers: [pathIssuer], scopes_supported: ['mcp:use'] })
      }
      if (url === rfcUrl && method === 'GET') {
        return new Response('missing', { status: 404 })
      }
      if (url === suffixUrl && method === 'GET') {
        return jsonResponse(200, {
          issuer: pathIssuer,
          authorization_endpoint: AUTHORIZE,
          token_endpoint: TOKEN,
          registration_endpoint: REGISTER,
          code_challenge_methods_supported: ['S256'],
        })
      }
      if (url === REGISTER && method === 'POST') {
        return jsonResponse(201, { client_id: 'client-1' })
      }
      if (url === TOKEN && method === 'POST') {
        return jsonResponse(200, { access_token: 'tok-path' })
      }
      throw new Error(`unexpected fetch ${method} ${url}`)
    }
    const tokens = await authorizeMcpHttp(RESOURCE, {
      fetch: fetchImpl,
      openBrowser: () => {},
      createListener: async () => ({
        redirectUri: 'http://127.0.0.1:9/callback',
        waitForCode: async () => 'auth-code',
        close: async () => {},
      }),
    })
    expect(tokens.access_token).toBe('tok-path')
  })
})

describe('authorizationServerMetadataUrl', () => {
  it('keeps a host-only issuer at origin well-known', () => {
    expect(authorizationServerMetadataUrl(ISSUER)).toBe(`${ISSUER}/.well-known/oauth-authorization-server`)
  })

  it('inserts well-known between origin and issuer path', () => {
    expect(authorizationServerMetadataUrl('https://auth.example.test/realms/foo')).toBe(
      'https://auth.example.test/.well-known/oauth-authorization-server/realms/foo',
    )
  })
})

describe('windowsBrowserLaunchArgs', () => {
  it('quotes the authorize URL so cmd does not split on &', () => {
    const url = 'https://auth.example.test/oauth/authorize?response_type=code&client_id=abc'
    expect(windowsBrowserLaunchArgs(url)).toEqual(['/c', 'start', '""', `"${url}"`])
  })
})

describe('browserLaunch', () => {
  const url = 'https://auth.example.test/oauth/authorize?response_type=code&client_id=abc'

  function withPlatform(platform: NodeJS.Platform, run: () => void): void {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: platform })
    try {
      run()
    } finally {
      if (descriptor === undefined) {
        Object.defineProperty(process, 'platform', { configurable: true, value: process.platform })
        return
      }
      Object.defineProperty(process, 'platform', descriptor)
    }
  }

  it('uses quoted cmd start on Windows', () => {
    withPlatform('win32', () => {
      expect(browserLaunch(url)).toEqual({
        command: 'cmd',
        args: windowsBrowserLaunchArgs(url),
        options: { detached: true, stdio: 'ignore', windowsVerbatimArguments: true },
      })
    })
  })

  it('uses open on macOS and xdg-open on other platforms', () => {
    withPlatform('darwin', () => {
      expect(browserLaunch(url)).toEqual({
        command: 'open',
        args: [url],
        options: { detached: true, stdio: 'ignore' },
      })
    })
    withPlatform('linux', () => {
      expect(browserLaunch(url)).toEqual({
        command: 'xdg-open',
        args: [url],
        options: { detached: true, stdio: 'ignore' },
      })
    })
  })
})
