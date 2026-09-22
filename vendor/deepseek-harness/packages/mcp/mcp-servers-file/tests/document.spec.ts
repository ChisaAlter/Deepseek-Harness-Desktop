import { describe, expect, it } from 'vitest'
import {
  EMPTY_DOCUMENT,
  SECRET_MASK,
  isSecretKey,
  maskRecordSecrets,
  parseDocument,
  removeRecord,
  serializeDocument,
  setRecordEnabled,
  toClientConfig,
  upsertRecord,
} from '../src/document.ts'

const stdio = `
servers:
  - id: github
    enabled: true
    transport: stdio
    serverName: github
    command: npx
    args: ['-y', '@modelcontextprotocol/server-github']
    env:
      GITHUB_TOKEN: 'secret-token'
`

describe('mcp-servers-file document', () => {
  it('parses an empty file as an empty document', () => {
    expect(parseDocument('')).toEqual(EMPTY_DOCUMENT)
    expect(parseDocument('   \n')).toEqual(EMPTY_DOCUMENT)
  })

  it('rejects a non-object document and a non-array servers field', () => {
    expect(() => parseDocument('- just a list\n')).toThrow(/YAML object/)
    expect(() => parseDocument('servers: github\n')).toThrow(/servers must be an array/)
  })

  it('rejects an invalid serverName and a duplicate id', () => {
    expect(() => parseDocument(`
servers:
  - id: bad name
    command: npx
`)).toThrow(/id must match/)
    expect(() => parseDocument(`
servers:
  - id: a
    command: npx
  - id: a
    command: npx
`)).toThrow(/duplicate server id/)
  })

  it('round-trips a stdio record and projects mcp-client config', () => {
    const document = parseDocument(stdio)
    expect(document.servers).toHaveLength(1)
    const record = document.servers[0]
    if (record === undefined) throw new Error('expected a parsed stdio record')
    expect(record).toMatchObject({
      id: 'github',
      transport: 'stdio',
      command: 'npx',
      env: { GITHUB_TOKEN: 'secret-token' },
    })
    expect(toClientConfig(record)).toMatchObject({
      transport: 'stdio',
      serverName: 'github',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: 'secret-token' },
      failOnStartupError: false,
    })
    expect(parseDocument(serializeDocument(document)).servers[0]?.id).toBe('github')
  })

  it('masks secret keys and keeps a previous secret when the upsert is blank or masked', () => {
    expect(isSecretKey('GITHUB_TOKEN')).toBe(true)
    expect(isSecretKey('PATH')).toBe(false)
    const document = parseDocument(stdio)
    const masked = maskRecordSecrets(document.servers[0]!)
    expect(masked.transport === 'stdio' && masked.env?.GITHUB_TOKEN).toBe(SECRET_MASK)
    const kept = upsertRecord(document, {
      id: 'github',
      enabled: true,
      transport: 'stdio',
      serverName: 'github',
      command: 'npx',
      env: { GITHUB_TOKEN: SECRET_MASK },
    })
    expect(kept.servers[0]?.transport === 'stdio' && kept.servers[0].env?.GITHUB_TOKEN).toBe('secret-token')
  })

  it('keeps secret keys when the upsert omits env or headers and drops non-secret keys', () => {
    const document = parseDocument(stdio)
    const cleared = upsertRecord(document, {
      id: 'github',
      enabled: true,
      transport: 'stdio',
      serverName: 'github',
      command: 'npx',
    })
    const record = cleared.servers[0]
    expect(record?.transport === 'stdio' && record.env).toEqual({ GITHUB_TOKEN: 'secret-token' })
    expect(serializeDocument(cleared)).toContain('secret-token')

    const withPath = parseDocument(`
servers:
  - id: github
    enabled: true
    transport: stdio
    serverName: github
    command: npx
    env:
      GITHUB_TOKEN: 'secret-token'
      PATH: '/usr/bin'
`)
    const droppedPath = upsertRecord(withPath, {
      id: 'github',
      enabled: true,
      transport: 'stdio',
      serverName: 'github',
      command: 'npx',
    })
    const dropped = droppedPath.servers[0]
    expect(dropped?.transport === 'stdio' && dropped.env).toEqual({ GITHUB_TOKEN: 'secret-token' })

    const httpDocument = parseDocument(`
servers:
  - id: remote
    transport: streamable-http
    serverName: remote
    url: http://127.0.0.1:9/mcp
    headers:
      Authorization: 'secret-token'
`)
    const keptHttp = upsertRecord(httpDocument, {
      id: 'remote',
      enabled: true,
      transport: 'streamable-http',
      serverName: 'remote',
      url: 'http://127.0.0.1:9/mcp',
    })
    const httpRecord = keptHttp.servers[0]
    expect(httpRecord?.transport === 'streamable-http' && httpRecord.headers).toEqual({ Authorization: 'secret-token' })
    expect(serializeDocument(keptHttp)).toContain('secret-token')

    const emptyHeaders = upsertRecord(httpDocument, {
      id: 'remote',
      enabled: true,
      transport: 'streamable-http',
      serverName: 'remote',
      url: 'http://127.0.0.1:9/mcp',
      headers: {},
    })
    expect(emptyHeaders.servers[0]?.transport === 'streamable-http' && emptyHeaders.servers[0].headers).toEqual({
      Authorization: 'secret-token',
    })

    const droppedAuth = upsertRecord(httpDocument, {
      id: 'remote',
      enabled: true,
      transport: 'streamable-http',
      serverName: 'remote',
      url: 'http://127.0.0.1:9/mcp',
      headers: { Accept: 'application/json' },
    })
    expect(droppedAuth.servers[0]?.transport === 'streamable-http' && droppedAuth.servers[0].headers).toEqual({
      Accept: 'application/json',
    })
  })

  it('rejects invalid records, transports, and duplicate serverName', () => {
    expect(() => parseDocument('servers:\n  - just-a-string\n')).toThrow(/must be an object/)
    expect(() => parseDocument(`
servers:
  - id: x
    transport: udp
    command: npx
`)).toThrow(/transport must be/)
    expect(() => parseDocument(`
servers:
  - id: a
    serverName: shared
    command: npx
  - id: b
    serverName: shared
    command: npx
`)).toThrow(/duplicate serverName/)
    expect(() => setRecordEnabled(EMPTY_DOCUMENT, 'missing', true)).toThrow(/not in the managed document/)
  })

  it('parses http records, optional fields, and masks http secrets', () => {
    const document = parseDocument(`
servers:
  - id: remote
    transport: streamable-http
    serverName: remote
    url: http://127.0.0.1:9/mcp
    headers:
      Authorization: 'secret-token'
      Accept: application/json
    toolCallTimeoutMs: 1000
    failOnStartupError: true
    reconnect:
      enabled: true
      initialDelayMs: 10
`)
    const [record] = document.servers
    expect(record).toMatchObject({
      transport: 'streamable-http',
      url: 'http://127.0.0.1:9/mcp',
      toolCallTimeoutMs: 1000,
      failOnStartupError: true,
    })
    const masked = maskRecordSecrets(record!)
    expect(masked.transport === 'streamable-http' && masked.headers?.Authorization).toBe(SECRET_MASK)
    expect(masked.transport === 'streamable-http' && masked.headers?.Accept).toBe('application/json')
    const kept = upsertRecord(document, {
      id: 'remote',
      enabled: true,
      transport: 'streamable-http',
      serverName: 'remote',
      url: 'http://127.0.0.1:9/mcp',
      headers: { Authorization: '', Accept: 'text/plain' },
    })
    expect(kept.servers[0]?.transport === 'streamable-http' && kept.servers[0].headers?.Authorization).toBe('secret-token')
    expect(toClientConfig(record!)).toMatchObject({
      transport: 'streamable-http',
      url: 'http://127.0.0.1:9/mcp',
      failOnStartupError: true,
    })
  })

  it('upserts, disables, and removes records', () => {
    const added = upsertRecord(EMPTY_DOCUMENT, {
      id: 'memory',
      enabled: true,
      transport: 'streamable-http',
      serverName: 'memory',
      url: 'http://127.0.0.1:9/mcp',
    })
    expect(added.servers).toHaveLength(1)
    const disabled = setRecordEnabled(added, 'memory', false)
    expect(disabled.servers[0]?.enabled).toBe(false)
    expect(removeRecord(disabled, 'memory')).toEqual(EMPTY_DOCUMENT)
    expect(() => removeRecord(EMPTY_DOCUMENT, 'missing')).toThrow(/not in the managed document/)
  })
})
