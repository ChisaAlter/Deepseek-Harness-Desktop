import { describe, expect, it } from 'vitest'
import { formatMcpClientError, isMcpAuthError, isMcpAuthLastError } from '../src/last-error.ts'

class StreamableHTTPError extends Error {
  constructor(
    public readonly code: number | undefined,
    message: string,
  ) {
    super(`Streamable HTTP error: ${message}`)
    this.name = 'StreamableHTTPError'
  }
}

describe('formatMcpClientError', () => {
  it('prefixes StreamableHTTPError status when the message omits it', () => {
    const error = new StreamableHTTPError(401, 'Error POSTing to endpoint: {"error":"invalid_token"}')
    expect(formatMcpClientError(error)).toBe(
      'HTTP 401: StreamableHTTPError: Streamable HTTP error: Error POSTing to endpoint: {"error":"invalid_token"}',
    )
  })

  it('does not double the status when the message already contains it', () => {
    const error = new StreamableHTTPError(401, 'Failed to open SSE stream: Unauthorized')
    error.message = 'HTTP 401 Unauthorized'
    expect(formatMcpClientError(error)).toBe('StreamableHTTPError: HTTP 401 Unauthorized')
  })

  it('stringifies non-Error values', () => {
    expect(formatMcpClientError('boom')).toBe('boom')
  })

  it('ignores a non-integer status code', () => {
    const error = new StreamableHTTPError(401.5 as number, 'partial')
    expect(formatMcpClientError(error)).toBe('StreamableHTTPError: Streamable HTTP error: partial')
  })
})

describe('isMcpAuthLastError', () => {
  it('matches formatted initialize 401 and bearer bodies', () => {
    expect(isMcpAuthLastError('HTTP 401: StreamableHTTPError: Streamable HTTP error: Error POSTing to endpoint: ')).toBe(true)
    expect(isMcpAuthLastError('Error: missing bearer token')).toBe(true)
    expect(isMcpAuthLastError('{"error":"invalid_token"}')).toBe(true)
  })

  it('rejects network failures, local ports, and oauth hostnames', () => {
    expect(isMcpAuthLastError('Error: fetch failed')).toBe(false)
    expect(isMcpAuthLastError('ECONNREFUSED 127.0.0.1:4010')).toBe(false)
    expect(isMcpAuthLastError('getaddrinfo ENOTFOUND foo.oauth.example.com')).toBe(false)
  })
})

describe('isMcpAuthError', () => {
  it('treats a 401 or 403 status code as auth even when the message is empty', () => {
    expect(isMcpAuthError(new StreamableHTTPError(401, ''))).toBe(true)
    expect(isMcpAuthError(new StreamableHTTPError(403, ''))).toBe(true)
  })

  it('rejects a generic Error', () => {
    expect(isMcpAuthError(new Error('server gone'))).toBe(false)
  })
})
