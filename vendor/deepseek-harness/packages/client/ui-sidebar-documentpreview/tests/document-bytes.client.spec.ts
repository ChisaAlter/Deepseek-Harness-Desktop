import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { documentFileBytes } from '../src/client/rpc.ts'

const source = { absolutePath: '/report.pdf', version: 'v1', offset: 0, eof: true, missingFonts: ['Missing Serif'] }

it('preserves every byte value, source metadata, font notices, padding, and empty input', () => {
  for (const size of [0, 1, 2, 256, 257]) {
    const input = Uint8Array.from({ length: size }, (_, index) => index % 256)
    expect(documentFileBytes({ ...source, data: Buffer.from(input).toString('base64') }))
      .toEqual({ ...source, data: input })
  }
  expect(() => documentFileBytes({ ...source, data: '!invalid!' })).toThrow()
})

it('decodes a large response within a bounded JavaScript heap', () => {
  // Typed buffers fit this heap; expanding the binary string into JS elements does not.
  const decoder = new URL('../src/client/rpc.ts', import.meta.url).href
  const child = spawnSync(process.execPath, ['--max-old-space-size=96', '--import', 'tsx/esm', '--input-type=module', '-e', `
    import { documentFileBytes } from ${JSON.stringify(decoder)}
    const input = Buffer.alloc(12 * 1024 * 1024)
    for (let index = 0; index < input.length; index++) input[index] = index % 256
    const output = documentFileBytes({ ...${JSON.stringify(source)}, data: input.toString('base64') }).data
    if (!Buffer.from(output).equals(input)) throw new Error('Decoded PDF bytes differ')
    process.stdout.write(String(output.length))
  `], { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024, env: { ...process.env, NODE_OPTIONS: '' } })
  expect(child.error).toBeUndefined()
  expect(child.signal, child.stderr).toBeNull()
  expect(child.status, child.stderr).toBe(0)
  expect(child.stdout).toBe(String(12 * 1024 * 1024))
})
